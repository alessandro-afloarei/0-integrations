import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient, type HttpClient } from '../http.js';
import { headerValue, keptHeaders, type MailboxEmail, type MailboxEmailAddress, type MailboxEvent, type MailboxEventTime,
  type MailboxReader } from '../mailbox/mailbox.js';
import type { Page } from '../paginate.js';
import { followed, ownPath } from '../paging.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { microsoft } from '../catalogue/microsoft.js';
import { datetime, pageSize, utc } from '../shapes.js';

const text = z.string().nullish().transform(value => value ?? '');
const emailAddress = z.object({ name: z.string().nullish(), address: z.string().nullish() });
const recipient = z.object({ emailAddress });
const messageSchema = z.object({
  id: z.string(), conversationId: z.string().nullish(), internetMessageId: z.string(), receivedDateTime: datetime,
  subject: text, from: recipient.nullish(), toRecipients: z.array(recipient).nullish(), ccRecipients: z.array(recipient).nullish(),
  parentFolderId: z.string().nullish(), body: z.object({ contentType: z.string(), content: z.string() }).nullish(),
  internetMessageHeaders: z.array(z.object({ name: z.string(), value: z.string() })).nullish(),
});
// Asked for in UTC (`Prefer: outlook.timezone`), a time comes without its offset and names the zone beside it.
const graphTime = z.object({ dateTime: z.string(), timeZone: z.string() });
const eventSchema = z.object({
  id: z.string(), iCalUId: z.string().nullish(), seriesMasterId: z.string().nullish(), createdDateTime: datetime,
  lastModifiedDateTime: datetime, subject: text, body: z.object({ content: z.string() }).nullish(),
  location: z.object({ displayName: z.string().nullish() }).nullish(), isCancelled: z.boolean(), isAllDay: z.boolean(),
  start: graphTime, end: graphTime, type: z.string().nullish(), showAs: z.string().nullish(),
  attendees: z.array(z.object({ type: z.string().nullish(), status: z.object({ response: z.string() }).nullish(), emailAddress }))
    .nullish(),
  organizer: recipient.nullish(), responseStatus: z.object({ response: z.string() }).nullish(),
  onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish(), onlineMeetingProvider: z.string().nullish(),
  // Graph answers it on every event: one without it is skipped, never taken as public.
  sensitivity: z.string(),
});
const listSchema = z.object({ value: z.array(z.unknown()), '@odata.nextLink': z.string().nullish() });
const meSchema = z.object({ mail: z.string().nullish(), userPrincipalName: z.string().nullish() });
const calendarSchema = z.object({ id: z.string(), name: z.string().nullish() });
const folderSchema = z.object({ id: z.string() });

const LIST_FIELDS = 'id,conversationId,internetMessageId,receivedDateTime,subject,from,toRecipients,ccRecipients,parentFolderId';
/** The folders a message's role is read from; every other folder is the inbox's. */
const ROLES = { sentitems: 'sent', deleteditems: 'trash', junkemail: 'spam' } as const;
const RESPONSES: Record<string, MailboxEvent['attendees'][number]['response_status']> = {
  accepted: 'yes', organizer: 'yes', tentativelyAccepted: 'maybe', declined: 'no' };

/** An OData string literal: quotes doubled. */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** An e-mail address only: Graph can name an internal or deleted sender by its Exchange (X500) name, which is no address,
 *  and would read a teammate as someone outside the team. */
const address = (value: z.infer<typeof recipient> | null | undefined): MailboxEmailAddress | null => {
  const identifier = value?.emailAddress.address?.trim();
  return identifier?.includes('@') ? { display_name: value?.emailAddress.name ?? '', identifier } : null;
};
const addresses = (list: readonly z.infer<typeof recipient>[] | null | undefined) =>
  (list ?? []).flatMap(item => { const found = address(item); return found ? [found] : []; });

const DAY_MS = 86_400_000;

/**
 * A time asked for in UTC; one in another zone, or not a time at all, makes the event unreadable rather than misread.
 * An all-day event starts and ends at midnight in its own zone, which UTC moves (Rome's 9 November is 23:00 on the 8th):
 * its date is the nearest UTC midnight, exact for every zone from UTC−11 to UTC+12. East of UTC+12 (New Zealand's summer,
 * Tonga, Kiribati) it reads a day early.
 */
function eventTime(time: z.infer<typeof graphTime>, allDay: boolean): MailboxEventTime | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/u.test(time.dateTime) || time.timeZone !== 'UTC') return null;
  const instant = Date.parse(`${time.dateTime.slice(0, 23)}Z`);
  if (Number.isNaN(instant)) return null;
  if (allDay) return { date: new Date(Math.round(instant / DAY_MS) * DAY_MS).toISOString().slice(0, 10) };
  return { date_time: new Date(instant).toISOString(), time_zone: 'UTC' };
}

function conference(event: z.infer<typeof eventSchema>): MailboxEvent['conference'] {
  const url = event.onlineMeeting?.joinUrl ?? null;
  if (url === null) return null;
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const provider = event.onlineMeetingProvider === 'teamsForBusiness' || host.endsWith('teams.microsoft.com') ? 'teams'
    : host.endsWith('zoom.us') ? 'zoom' : event.onlineMeetingProvider ?? 'unknown';
  return { provider, url };
}

/** The mailbox address (`mail`, else the sign-in name), lowercased: a reader needs one to match its owner in a meeting. */
async function graphUser(http: HttpClient): Promise<{ email: string }> {
  const { mail, userPrincipalName } = parseAnswer(meSchema, await http.json('/me', { query: { $select: 'id,mail,userPrincipalName' } }));
  const email = (mail ?? userPrincipalName ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new ProviderHttpError('invalid_response', null, 'no_mailbox');
  return { email };
}

/** One member's Outlook mail and calendar through Microsoft Graph, on their delegated grant. */
export function graphMailbox(input: { token: (rejected?: string) => Promise<string>; fetch: typeof fetch }): MailboxReader {
  const http = createClient(microsoft, { token: input.token, fetch: input.fetch,
    headers: { prefer: 'outlook.timezone="UTC"' } });
  let me: Promise<{ email: string }> | undefined;
  let folders: Promise<Map<string, string>> | undefined;

  const identify = () => {
    me ??= graphUser(http).catch((error: unknown) => { me = undefined; throw error; });
    return me;
  };

  /** The well-known folders' ids, read once: a role is where a message sits. A folder the mailbox lacks is left out. */
  const roles = () => {
    folders ??= Promise.all(Object.entries(ROLES).map(async ([name, role]) => {
      try {
        return [parseAnswer(folderSchema, await http.json(`/me/mailFolders/${name}`, { query: { $select: 'id' } })).id, role] as const;
      } catch (error) {
        if (error instanceof ProviderHttpError && error.code === 'not_found') return null;
        throw error;
      }
    })).then(found => new Map(found.flatMap(entry => (entry ? [entry] : []))))
      .catch((error: unknown) => { folders = undefined; throw error; });
    return folders;
  };

  /**
   * A page of a Graph list. The next page is Graph's `@odata.nextLink`, followed only under the member's own `/me/` (the
   * entry's `pathPrefix`), so the token goes nowhere else, and kept as that path.
   */
  async function list(path: string, query: Record<string, string>, cursor: string | undefined): Promise<{ value: unknown[]; cursor: string | null }> {
    if (cursor !== undefined && ownPath(microsoft.paging.nextLink, http.baseUrl, http.baseUrl + cursor) === null) throw new TypeError('cursor_invalid');
    const answer = parseAnswer(listSchema, await http.json(cursor ?? path, cursor === undefined ? { query } : {}));
    return { value: answer.value, cursor: followed(microsoft.paging.nextLink, http.baseUrl, answer['@odata.nextLink']) };
  }

  async function emails(path: string, query: Record<string, string>, cursor: string | undefined): Promise<Page<MailboxEmail>> {
    const [page, folderRoles] = await Promise.all([list(path, query, cursor), roles()]);
    const parsed = parseEntries(messageSchema, page.value);
    const items: MailboxEmail[] = [];
    for (const message of parsed.items) {
      const from = address(message.from);
      // A sender without an address cannot be read.
      if (from === null) { parsed.skipped.push(message.id); continue; }
      const role = folderRoles.get(message.parentFolderId ?? '') ?? 'inbox';
      const headers = message.internetMessageHeaders ?? [];
      const inReplyTo = headerValue(headers, 'in-reply-to')?.trim();
      const body = message.body?.content ?? '';
      const html = message.body?.contentType.toLowerCase() === 'html';
      items.push({ id: message.id, account_id: '', thread_id: message.conversationId ?? null, message_id: message.internetMessageId,
        provider_id: message.id, date: new Date(message.receivedDateTime).toISOString(), role, folders: [role.toUpperCase()],
        subject: message.subject, body_plain: html ? '' : body, body: html ? body : '', from_attendee: from,
        to_attendees: addresses(message.toRecipients), cc_attendees: addresses(message.ccRecipients),
        in_reply_to: inReplyTo ? { message_id: inReplyTo } : null, headers: keptHeaders(headers) });
    }
    return { items, skipped: parsed.skipped, cursor: page.cursor };
  }

  return {
    identify,
    // Drafts are left out at the source; `receivedDateTime` leads the filter, as Graph requires of the field it sorts by.
    async messages({ after, cursor, limit }) {
      return emails('/me/messages', { $filter: `receivedDateTime ge ${utc(after ?? '1970-01-01T00:00:00Z')} and isDraft eq false`,
        $orderby: 'receivedDateTime desc', $top: String(pageSize(limit, 1000)), $select: LIST_FIELDS }, cursor);
    },
    async thread(threadId, { cursor, limit }) {
      return emails('/me/messages', { $filter: `conversationId eq ${literal(threadId)} and isDraft eq false`,
        $top: String(pageSize(limit, 1000)), $select: `${LIST_FIELDS},body,internetMessageHeaders` }, cursor);
    },
    async primaryCalendar() {
      const calendar = parseAnswer(calendarSchema, await http.json('/me/calendar', { query: { $select: 'id,name' } }));
      return { id: calendar.id, name: calendar.name ?? '', is_primary: true, is_owned_by_user: true };
    },
    async events(calendarId, { start, end, cursor, limit }) {
      const [{ email: owner }, page] = await Promise.all([identify(), list(`/me/calendars/${encodeURIComponent(calendarId)}/calendarView`,
        // No $select: Graph answers an event's createdDateTime and lastModifiedDateTime only without one.
        { startDateTime: utc(start), endDateTime: utc(end), $top: String(pageSize(limit, 1000)) }, cursor)]);
      const parsed = parseEntries(eventSchema, page.value);
      const items: MailboxEvent[] = [];
      for (const event of parsed.items) {
        const [startTime, endTime] = [eventTime(event.start, event.isAllDay), eventTime(event.end, event.isAllDay)];
        const organizer = address(event.organizer);
        if (startTime === null || endTime === null || organizer === null) { parsed.skipped.push(event.id); continue; }
        const organizerEmail = organizer.identifier.toLowerCase();
        const attendees = (event.attendees ?? []).flatMap(attendee => {
          const email = attendee.emailAddress.address?.trim();
          return email ? [{ email, display_name: attendee.emailAddress.name || null, is_organizer: email.toLowerCase() === organizerEmail,
            is_resource: attendee.type === 'resource', response_status: RESPONSES[attendee.status?.response ?? ''] ?? 'noreply' }] : [];
        });
        // The member's own answer is the event's `responseStatus`; Graph may leave them out of the attendees.
        const own = RESPONSES[event.responseStatus?.response ?? ''] ?? 'noreply';
        const mine = attendees.find(attendee => attendee.email.toLowerCase() === owner);
        if (mine) mine.response_status = own;
        else attendees.push({ email: owner, display_name: null, is_organizer: owner === organizerEmail, is_resource: false, response_status: own });
        items.push({ id: event.id, ical_uid: event.iCalUId || null, master_event_id: event.seriesMasterId || null, calendar_id: calendarId,
          created_at: new Date(event.createdDateTime).toISOString(), updated_at: new Date(event.lastModifiedDateTime).toISOString(),
          title: event.subject, body: event.body?.content ?? '', location: event.location?.displayName ?? '',
          is_cancelled: event.isCancelled, is_all_day: event.isAllDay, start: startTime, end: endTime, attendees,
          organizer: { email: organizer.identifier, display_name: organizer.display_name || null }, conference: conference(event),
          event_type: event.type ?? 'singleInstance', transparency: event.showAs === 'free' ? 'transparent' : 'opaque',
          visibility: event.sensitivity === 'normal' ? 'public' : 'private' });
      }
      return { items, skipped: parsed.skipped, cursor: page.cursor };
    },
  };
}
