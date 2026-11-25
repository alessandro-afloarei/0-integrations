import { z } from 'zod';
import type { OAuthConnect } from '../connect.js';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { decodeWords, headerValue, keptHeaders, parseAddressList, type MailboxEmail, type MailboxEvent, type MailboxEventTime,
  type MailboxReader } from '../mailbox/mailbox.js';
import { revokeGrant } from '../oauth.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { google as googleEntry } from '../catalogue/google.js';
import { GOOGLE_CALENDAR_BASE, google } from '../providers.js';
import { datetime, pageSize } from '../shapes.js';

/** A member's own mail and calendar, read-only. Gmail's is a restricted scope: Google verifies the app before it serves
 * more than its test users. */
export const GOOGLE_SCOPES: readonly string[] = googleEntry.scopes.default;

const header = z.object({ name: z.string(), value: z.string() });
type Part = { mimeType?: string | null | undefined; filename?: string | null | undefined;
  headers?: { name: string; value: string }[] | null | undefined;
  body?: { data?: string | null | undefined; attachmentId?: string | null | undefined } | null | undefined; parts?: Part[] | null | undefined };
const partSchema: z.ZodType<Part> = z.lazy(() => z.object({ mimeType: z.string().nullish(), filename: z.string().nullish(),
  headers: z.array(header).nullish(), body: z.object({ data: z.string().nullish(), attachmentId: z.string().nullish() }).nullish(),
  parts: z.array(partSchema).nullish() }));
const storedSchema = z.object({ data: z.string() });
const messageSchema = z.object({ id: z.string(), threadId: z.string(), labelIds: z.array(z.string()).nullish(),
  internalDate: z.string().regex(/^\d{1,15}$/u), payload: partSchema });
const listSchema = z.object({ messages: z.array(z.object({ id: z.string() })).nullish(), nextPageToken: z.string().nullish() });
const threadSchema = z.object({ messages: z.array(z.unknown()).nullish() });
const profileSchema = z.object({ emailAddress: z.string() });
const calendarSchema = z.object({ id: z.string(), summary: z.string().nullish() });
const eventTime = z.union([z.object({ dateTime: datetime, timeZone: z.string().nullish() }), z.object({ date: z.iso.date() })]);
// Google names a person's email "if available": one without is no one to match.
const person = z.object({ email: z.string().nullish(), displayName: z.string().nullish() });
const eventSchema = z.object({
  id: z.string(), iCalUID: z.string().nullish(), recurringEventId: z.string().nullish(), status: z.string().nullish(),
  created: datetime, updated: datetime, summary: z.string().nullish(), description: z.string().nullish(),
  location: z.string().nullish(), start: eventTime, end: eventTime, organizer: person.nullish(),
  attendees: z.array(person.extend({ organizer: z.boolean().nullish(), resource: z.boolean().nullish(),
    responseStatus: z.string().nullish() })).nullish(),
  hangoutLink: z.string().nullish(), eventType: z.string().nullish(), transparency: z.string().nullish(),
  // Left out for `default`, as Google leaves out every field at its default.
  visibility: z.string().nullish(),
  conferenceData: z.object({ conferenceSolution: z.object({ key: z.object({ type: z.string() }).nullish(), name: z.string().nullish() }).nullish(),
    entryPoints: z.array(z.object({ entryPointType: z.string(), uri: z.string().nullish() })).nullish() }).nullish(),
});
const eventListSchema = z.object({ items: z.array(z.unknown()).nullish(), nextPageToken: z.string().nullish() });

/** What a listing asks Gmail for, beside the labels: who, the subject, and the headers that say a message is bulk or a reply. */
const METADATA = ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'In-Reply-To', 'References', 'List-Unsubscribe', 'List-Id',
  'Auto-Submitted', 'Precedence'].map(name => `metadataHeaders=${name}`).join('&');
/** Gmail's labels for where a message sits, in the role words of the mailbox. */
const ROLES: [label: string, role: string][] = [['DRAFT', 'drafts'], ['TRASH', 'trash'], ['SPAM', 'spam'], ['SENT', 'sent']];
const RESPONSES: Record<string, MailboxEvent['attendees'][number]['response_status']> = { accepted: 'yes', declined: 'no', tentative: 'maybe' };
/** Message details read at a time, inside Gmail's per-user quota. */
const CONCURRENCY = 5;

/** Gmail's `after:` takes seconds; a time without its offset would be read in Google's own zone, so it is refused. */
function seconds(value: string): number {
  if (!datetime.safeParse(value).success) throw new TypeError('date_invalid');
  return Math.floor(Date.parse(value) / 1000);
}

/** A part's text (`data`, base64url) in the charset its Content-Type names, UTF-8 when it names none or one this runtime
 *  cannot read. */
function partText(part: Part, data: string): string {
  if (!data) return '';
  const charset = /charset="?([\w-]{1,40})/iu.exec(headerValue(part.headers ?? [], 'content-type') ?? '')?.[1] ?? 'utf-8';
  const bytes = Buffer.from(data, 'base64url');
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** The first text/plain and text/html part of a message, depth first. A file is never a body: not a part Gmail names a
 *  file, nor one sent as an attachment, nor any part inside either (a forwarded message, an attached archive of parts). */
function bodyParts(part: Part, found: { plain?: Part; html?: Part } = {}): { plain?: Part; html?: Part } {
  if (part.filename || /^attachment/iu.test(headerValue(part.headers ?? [], 'content-disposition') ?? '')) return found;
  const type = part.mimeType?.toLowerCase() ?? '';
  if (type === 'text/plain') found.plain ??= part;
  if (type === 'text/html') found.html ??= part;
  for (const child of part.parts ?? []) bodyParts(child, found);
  return found;
}

/** A message read from its headers; its bodies are the thread's to read. */
function email(message: z.infer<typeof messageSchema>): MailboxEmail | null {
  const headers = message.payload.headers ?? [];
  const [from] = parseAddressList(headerValue(headers, 'from') ?? '');
  if (!from) return null;
  const labels = message.labelIds ?? [];
  const role = ROLES.find(([label]) => labels.includes(label))?.[1] ?? 'inbox';
  const inReplyTo = headerValue(headers, 'in-reply-to')?.trim();
  return { id: message.id, account_id: '', thread_id: message.threadId,
    message_id: headerValue(headers, 'message-id')?.trim() || `<${message.id}@mail.gmail.com>`, provider_id: message.id,
    date: new Date(Number(message.internalDate)).toISOString(), role, folders: labels,
    subject: decodeWords(headerValue(headers, 'subject') ?? ''), body_plain: '', body: '', from_attendee: from,
    to_attendees: parseAddressList(headerValue(headers, 'to') ?? ''), cc_attendees: parseAddressList(headerValue(headers, 'cc') ?? ''),
    in_reply_to: inReplyTo ? { message_id: inReplyTo } : null, headers: keptHeaders(headers) };
}

function time(value: z.infer<typeof eventTime>): MailboxEventTime {
  return 'date' in value ? { date: value.date } : { date_time: value.dateTime, time_zone: value.timeZone ?? 'UTC' };
}

function conference(event: z.infer<typeof eventSchema>): MailboxEvent['conference'] {
  const solution = event.conferenceData?.conferenceSolution;
  const url = event.hangoutLink ?? event.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video')?.uri ?? null;
  if (url === null) return null;
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const provider = event.hangoutLink || solution?.key?.type === 'hangoutsMeet' || host === 'meet.google.com' ? 'google_meet'
    : host.endsWith('zoom.us') ? 'zoom' : host.endsWith('teams.microsoft.com') ? 'teams' : solution?.name?.toLowerCase() ?? 'unknown';
  return { provider, url };
}

/** At most `limit` at a time, the answers in the input's order. */
async function inTurn<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += limit) results.push(...await Promise.all(items.slice(start, start + limit).map(work)));
  return results;
}

/** One member's Gmail and Google Calendar, on their grant. */
export function googleMailbox(input: { token: (rejected?: string) => Promise<string>; fetch: typeof fetch }): MailboxReader {
  const gmail = createClient({ provider: google, token: input.token, fetch: input.fetch, headers: { accept: 'application/json' } });
  const calendar = createClient({ provider: google, token: input.token, fetch: input.fetch, baseUrl: GOOGLE_CALENDAR_BASE,
    headers: { accept: 'application/json' } });
  /** A body part's text. Gmail keeps a large one apart, as an attachment of its message named by `attachmentId`. */
  const bodyText = async (messageId: string, part: Part | undefined): Promise<string> => {
    if (!part) return '';
    const stored = part.body?.attachmentId;
    const data = part.body?.data || (stored ? parseAnswer(storedSchema, await gmail.json(
      `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(stored)}`)).data : '');
    return partText(part, data);
  };

  return {
    async identify() {
      const { emailAddress } = parseAnswer(profileSchema, await gmail.json('/users/me/profile'));
      return { email: emailAddress.trim().toLowerCase() };
    },
    async messages({ after, cursor, limit }) {
      const q = [after === undefined ? null : `after:${String(seconds(after))}`, '-in:drafts'].filter(Boolean).join(' ');
      const listed = parseAnswer(listSchema, await gmail.json('/users/me/messages', { query: { q,
        maxResults: String(pageSize(limit, 500)), ...(cursor ? { pageToken: cursor } : {}) } }));
      // A message deleted since the listing is gone, not unreadable.
      const details = await inTurn(listed.messages ?? [], CONCURRENCY, async ({ id }) => {
        try {
          return await gmail.json(`/users/me/messages/${encodeURIComponent(id)}?format=metadata&${METADATA}`);
        } catch (error) {
          if (error instanceof ProviderHttpError && error.code === 'not_found') return null;
          throw error;
        }
      });
      const parsed = parseEntries(messageSchema, details.filter(detail => detail !== null));
      const items = parsed.items.flatMap(message => {
        const read = email(message);
        if (!read) parsed.skipped.push(message.id);
        return read ? [read] : [];
      });
      return { items, skipped: parsed.skipped, cursor: listed.nextPageToken ?? null };
    },
    async thread(threadId) {
      const thread = parseAnswer(threadSchema, await gmail.json(`/users/me/threads/${encodeURIComponent(threadId)}`, { query: { format: 'full' } }));
      const parsed = parseEntries(messageSchema, thread.messages ?? []);
      const read = parsed.items.flatMap(message => {
        if (message.labelIds?.includes('DRAFT')) return [];
        const headed = email(message);
        if (!headed) parsed.skipped.push(message.id);
        return headed ? [{ message, headed }] : [];
      });
      const items = await inTurn(read, CONCURRENCY, async ({ message, headed }) => {
        const { plain, html } = bodyParts(message.payload);
        return { ...headed, body_plain: await bodyText(message.id, plain), body: await bodyText(message.id, html) };
      });
      // Gmail answers a thread whole.
      return { items, skipped: parsed.skipped, cursor: null };
    },
    async primaryCalendar() {
      const primary = parseAnswer(calendarSchema, await calendar.json('/calendars/primary'));
      return { id: primary.id, name: primary.summary ?? '', is_primary: true, is_owned_by_user: true };
    },
    async events(calendarId, { start, end, cursor, limit }) {
      const window = { timeMin: new Date(seconds(start) * 1000).toISOString(), timeMax: new Date(seconds(end) * 1000).toISOString() };
      const answer = parseAnswer(eventListSchema, await calendar.json(`/calendars/${encodeURIComponent(calendarId)}/events`, { query: {
        ...window, singleEvents: 'true', orderBy: 'startTime', maxResults: String(pageSize(limit, 2500)), ...(cursor ? { pageToken: cursor } : {}) } }));
      const parsed = parseEntries(eventSchema, answer.items ?? []);
      const items = parsed.items.flatMap((event): MailboxEvent[] => {
        // An organizer Google does not name is the calendar's owner, whose calendar id is their address; else unreadable.
        const organizer = event.organizer?.email ?? (calendarId.includes('@') ? calendarId : null);
        if (organizer === null) { parsed.skipped.push(event.id); return []; }
        const organizerEmail = organizer.toLowerCase();
        return [{ id: event.id, ical_uid: event.iCalUID || null, master_event_id: event.recurringEventId || null, calendar_id: calendarId,
          created_at: event.created, updated_at: event.updated, title: event.summary ?? '', body: event.description ?? '',
          location: event.location ?? '', is_cancelled: event.status === 'cancelled', is_all_day: 'date' in event.start,
          start: time(event.start), end: time(event.end),
          attendees: (event.attendees ?? []).flatMap(({ email, ...attendee }) => (email ? [{ email, display_name: attendee.displayName || null,
            is_organizer: attendee.organizer === true || email.toLowerCase() === organizerEmail, is_resource: attendee.resource === true,
            response_status: RESPONSES[attendee.responseStatus ?? ''] ?? 'noreply' }] : [])),
          organizer: { email: organizer, display_name: event.organizer?.displayName || null }, conference: conference(event),
          event_type: event.eventType ?? 'default', transparency: event.transparency ?? 'opaque',
          visibility: event.visibility === 'private' || event.visibility === 'confidential' ? 'private' : 'public' }];
      });
      return { items, skipped: parsed.skipped, cursor: answer.nextPageToken ?? null };
    },
  };
}

/**
 * The member's sign-in: the grant reads their Gmail, whose address is the account. Google's consent screen lets them untick
 * a scope, so a grant short of either is refused (`scope_missing`), and `finishConnect` revokes it: a mailbox without its
 * calendar would fail every read. Disconnect revokes the grant.
 */
export const googleConnect: OAuthConnect<{ email: string }> = {
  kind: 'oauth2', provider: google, scopes: GOOGLE_SCOPES,
  async identify({ grant, extras, fetch }) {
    const granted = new Set(typeof extras.scope === 'string' ? extras.scope.split(' ') : []);
    if (!GOOGLE_SCOPES.every(scope => granted.has(scope))) throw new ProviderHttpError('rejected', null, 'scope_missing');
    const { email } = await googleMailbox({ token: () => Promise.resolve(grant.accessToken), fetch }).identify();
    return { account: { id: email, name: email }, details: { email } };
  },
  async revoke({ grant, client, fetch }) {
    try {
      await revokeGrant(google, client, grant.refreshToken ?? grant.accessToken, { fetch });
    } catch (error) {
      // Google answers a token already revoked as `invalid_token`: the grant is gone either way.
      if (!(error instanceof ProviderHttpError && error.detail === 'invalid_token')) throw error;
    }
  },
};
