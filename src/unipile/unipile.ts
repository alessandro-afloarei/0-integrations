import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DirectConnect } from '../connect.js';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { headerValue, keptHeaders, type MailboxCalendar, type MailboxEmail, type MailboxEmailAddress, type MailboxEvent,
  type MailboxEventTime, type MailboxReader } from '../mailbox/mailbox.js';
import { paginate, type Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { unipile } from '../providers.js';

export type LinkedInCompany = { id: string; name: string; tagline: string; description: string; industry: string[];
  headcount: number | null; city: string | null; profileUrl: string };
export type LinkedInPost = { url: string; text: string; createdAt: string | null; author: string };
export type UnipileSignInProvider = 'linkedin' | 'google' | 'outlook';
/**
 * A hosted sign-in: a new account of one of `providers`, or `accountId` signed in again. Unipile sends the browser back to
 * `redirectUri` with `account_id`, `provider` and `state` (or `error_type` when it failed). `scopes` is the whole list
 * each OAuth provider is asked for, which the workspace's own OAuth settings must hold; without it Unipile asks for theirs.
 */
export type HostedSignIn = { state: string; redirectUri: string; expiresOn: string;
  scopes?: Partial<Record<'google' | 'outlook', readonly string[]>> }
  & ({ providers: readonly UnipileSignInProvider[] } | { accountId: string });
/** `provider` as Unipile names it (linkedin, google, outlook, …); `email` is the mailbox's own address (the one it signed in
 *  with), null for an account with no mailbox; `scopes` what the account granted (OAuth providers only). */
export type UnipileAccount = { createdAt: string; provider: string; email: string | null; scopes: string[] };

// The mailbox shapes are the library's own, shared with Microsoft Graph and Gmail; these names stay for the apps that use them.
export type UnipileEmailAddress = MailboxEmailAddress;
export type UnipileEmail = MailboxEmail;
export type UnipileCalendar = MailboxCalendar;
export type UnipileEventTime = MailboxEventTime;
export type UnipileEvent = MailboxEvent;

export type UnipileClient = {
  authLink(link: HostedSignIn): Promise<string>;
  account(accountId: string, signal?: AbortSignal): Promise<UnipileAccount>;
  company(accountId: string, companyId: string): Promise<LinkedInCompany>;
  posts(accountId: string, companyId: string, limit: number): Promise<LinkedInPost[]>;
  /** GET /v2/{account}/emails, newest first, limit 1–100 (default 100). `metaOnly` leaves the bodies empty; headers come
   *  either way. */
  emails(accountId: string, query: { after?: string | undefined; cursor?: string | undefined; limit?: number | undefined;
    metaOnly?: boolean | undefined }): Promise<Page<UnipileEmail>>;
  /** GET /v2/{account}/threads/{thread}: every message of one thread, with its body, in one answer. */
  thread(accountId: string, threadId: string): Promise<Page<UnipileEmail>>;
  /** GET /v2/{account}/calendars, every page. */
  calendars(accountId: string): Promise<UnipileCalendar[]>;
  /** GET /v2/{account}/calendars/{id}/events with expand_recurring=true (each instance on its own), start/end/updated_after,
   *  limit 1–100 (default 100). */
  events(accountId: string, calendarId: string, query: { start?: string | undefined; end?: string | undefined;
    updatedAfter?: string | undefined; cursor?: string | undefined; limit?: number | undefined }): Promise<Page<UnipileEvent>>;
  /** DELETE /v2/accounts/{id}: stops Unipile reading the account (and billing it). An account already gone (404) resolves. */
  deleteAccount(accountId: string): Promise<void>;
};

const linkSchema = z.object({ link: z.string() });
const accountSchema = z.object({ created_at: z.string(), provider: z.string(), oauth_scope: z.string().nullish() });
const sendersSchema = z.object({ data: z.array(z.object({ email: z.string(), is_primary: z.boolean() })) });
const companySchema = z.object({ id: z.string(), name: z.string(), tagline: z.string().nullish(), description: z.string().nullish(),
  industry: z.array(z.string()).nullish(), profile_url: z.string().nullish(),
  locations: z.array(z.object({ is_headquarter: z.boolean().nullish(), city: z.string().nullish() })).nullish(),
  insights: z.object({ headcount: z.number().nullish() }).nullish() });
const postsSchema = z.object({ data: z.array(z.object({ share_url: z.string(), text: z.string().nullish(),
  created_at: z.string().nullish(), author: z.object({ display_name: z.string().nullish() }).nullish() })) });
/** Unipile's account kinds that hold a mailbox: their address is read from the account's senders. */
const MAILBOXES = new Set(['google', 'outlook', 'imap']);

const datetime = z.iso.datetime({ offset: true });
const text = z.string().nullish().transform(value => value ?? '');
const orNull = z.string().nullish().transform(value => value ?? null);
// Unipile sends an empty master_event_id or display name where there is none.
const emptyAsNull = z.string().nullish().transform(value => value || null);

const attendee = z.object({ email: z.string(), display_name: z.string().nullish() });
const isEmailAddress = (person: z.infer<typeof attendee>) => person.email.includes('@');
const address = (person: z.infer<typeof attendee>): UnipileEmailAddress => ({ display_name: person.display_name ?? '',
  identifier: person.email });
const recipients = z.array(attendee).nullish().transform(list => (list ?? []).filter(isEmailAddress).map(address));
// Every key it does not name is dropped: bcc, reply-to, attachments and the other headers never leave the client. A message
// with no sender, or one that is not an e-mail address, is unreadable: skipped.
const emailSchema = z.object({
  id: z.string(), thread_id: orNull, message_id: z.string(), date: datetime, folders: z.array(z.string()), subject: z.string(),
  body_plain: text, body: text, from: z.tuple([attendee.refine(isEmailAddress)], attendee), to: recipients, cc: recipients,
  headers: z.array(z.object({ name: z.string(), value: z.string() })).nullish().transform(list => list ?? []),
}).transform(({ from: [sender], to, cc, headers, ...email }) => {
  const inReplyTo = headerValue(headers, 'in-reply-to')?.trim();
  return { ...email, provider_id: email.id, from_attendee: address(sender), to_attendees: to, cc_attendees: cc,
    in_reply_to: inReplyTo ? { message_id: inReplyTo } : null, headers: keptHeaders(headers) };
});
const threadSchema = z.object({ emails: z.array(z.unknown()) });
const folderSchema = z.object({ id: z.string(), role: z.string().nullish() });
/** The folder roles that say where a message sits, in the mailbox's words; a message in none of them is the inbox's. */
const ROLES: [folderRole: string, role: string][] = [['DRAFTS', 'drafts'], ['TRASH', 'trash'], ['SPAM', 'spam'], ['SENT', 'sent']];

const calendarSchema = z.object({ id: z.string(), name: z.string(), is_default: z.boolean().nullish(), is_owned_by_user: z.boolean() })
  .transform(({ is_default: primary, ...calendar }): MailboxCalendar => ({ ...calendar, is_primary: primary ?? false }));
// A date and time, with its offset or in its time zone; an all-day event has a date alone.
const eventTime = z.union([z.object({ type: z.literal('datetime'), date_time: z.string(), timezone: z.string().nullish() }),
  z.object({ type: z.literal('date'), date: z.iso.date() })]);
const eventSchema = z.object({
  id: z.string(), ical_uid: emptyAsNull, master_event_id: emptyAsNull, calendar_id: z.string(), created_at: datetime,
  updated_at: datetime, title: z.string(), body: text, location: text, is_cancelled: z.boolean(), is_all_day: z.boolean(),
  start: eventTime, end: eventTime, timezone: z.string().nullish(),
  attendees: z.array(z.object({ email: z.string(), display_name: emptyAsNull, is_organizer: z.boolean(), is_resource: z.boolean(),
    response_status: z.enum(['yes', 'no', 'maybe', 'noreply']) })).nullish().transform(list => list ?? []),
  organizer: z.object({ email: z.string(), display_name: emptyAsNull }),
  conference: z.object({ provider: z.string(), url: orNull }).nullish().transform(conference => conference ?? null),
  event_type: z.string(), transparency: z.string(),
  // Required: an event that does not say whether it is private is skipped, never taken as public.
  visibility: z.enum(['public', 'private']),
});
const listSchema = z.object({ data: z.array(z.unknown()), next_cursor: z.string().nullish(), total_count: z.number().nullish() });

function pageSize(limit = 100): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('limit_invalid');
  return limit;
}

/** Unipile takes a date only as `YYYY-MM-DDTHH:MM:SS.sssZ`: an ISO time with its offset, written in UTC; anything else is
 *  refused before a request, never read in the server's own time zone. */
function utc(value: string): string {
  if (!datetime.safeParse(value).success) throw new TypeError('date_invalid');
  return new Date(value).toISOString();
}

/** A wall-clock time in an IANA zone as the instant it names, in UTC; null when either is not one. */
function inZone(local: string, zone: string): string | null {
  const wall = Date.parse(`${local}Z`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/u.test(local) || !Number.isFinite(wall)) return null;
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    // The zone's offset at an instant, as `GMT+01:00` (or `GMT` at zero) says it, in milliseconds.
    const offset = (instant: number) => {
      const name = format.formatToParts(instant).find(item => item.type === 'timeZoneName')?.value ?? '';
      const [, sign, hours = '0', minutes = '0'] = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/u.exec(name) ?? [];
      return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
    };
    // Twice, so a time just past a change of offset reads the offset in force then.
    return new Date(wall - offset(wall - offset(wall))).toISOString();
  } catch {
    return null;
  }
}

/** An event's time as the mailbox shape holds it: always with its offset, beside the zone it was set in (UTC when Unipile
 *  names none). A time that names no instant makes the event unreadable. */
function eventInstant(time: z.infer<typeof eventTime>, eventZone: string | null | undefined): MailboxEventTime | null {
  if (time.type === 'date') return { date: time.date };
  const zone = time.timezone ?? eventZone ?? 'UTC';
  const dateTime = datetime.safeParse(time.date_time).success ? time.date_time : inZone(time.date_time, zone);
  return dateTime === null ? null : { date_time: dateTime, time_zone: zone };
}

const eventRead = eventSchema.transform(({ timezone, ...event }, context): MailboxEvent => {
  const [start, end] = [eventInstant(event.start, timezone), eventInstant(event.end, timezone)];
  if (start === null || end === null) {
    context.addIssue({ code: 'custom', message: 'event_time_invalid' });
    return z.NEVER;
  }
  return { ...event, start, end };
});

/** Unipile V2. The sign-in link is a POST, so a 429 on it is never waited out: a person is waiting on it. */
export function unipileClient(input: { apiKey: string; fetch: typeof fetch }): UnipileClient {
  const http = createClient({ provider: unipile, token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    headers: { accept: 'application/json' } });
  const on = (accountId: string, path: string) => `/${encodeURIComponent(accountId)}${path}`;

  /**
   * A list paged by `next_cursor` where the provider has one, else by `offset`: one opaque cursor for both. By offset, the
   * next page is asked for while `total_count` says more remain (Gmail's labels) or, with no total, after any non-empty
   * page, since a provider may cap a page below `limit`. The list ends at the total, on an empty page, on the same page
   * coming back again, or on an offset refused as a bad request: Outlook pages by cursor, and gives none on its last page.
   */
  async function listPage<T>(path: string, query: Record<string, string>, schema: z.ZodType<T>, limit: number,
    cursor: string | undefined): Promise<Page<T>> {
    const resume = cursor === undefined ? [] : /^(?:cursor:(.+)|offset:(\d+):(.*))$/su.exec(cursor);
    if (resume === null) throw new TypeError('cursor_invalid');
    const [, providerCursor, offset = '0', previousPage] = resume;
    // Unipile's cursor holds the list's filters, and refuses any sent beside it (400 `api/invalid_parameters`, 2026-11-24).
    const asked = providerCursor === undefined ? { ...query, limit: String(limit), ...(offset === '0' ? {} : { offset }) }
      : { limit: String(limit), cursor: providerCursor };
    const answer = parseAnswer(listSchema, await http.json(path, { query: asked })
      .catch((error: unknown) => {
        if (offset !== '0' && error instanceof ProviderHttpError && error.status === 400) return { data: [] };
        throw error;
      }));
    // The whole raw page: a repeat ends the list even where nothing in it parses, and two pages that differ never do.
    const pageHash = createHash('sha256').update(JSON.stringify(answer.data)).digest('base64url');
    if (previousPage !== undefined && pageHash === previousPage) return { items: [], skipped: [], cursor: null };
    const read = Number(offset) + answer.data.length;
    const more = providerCursor === undefined && answer.data.length > 0 && read < (answer.total_count ?? Infinity);
    const next = answer.next_cursor ? `cursor:${answer.next_cursor}` : more ? `offset:${String(read)}:${pageHash}` : null;
    return { ...parseEntries(schema, answer.data), cursor: next };
  }

  async function readRoles(accountId: string): Promise<Map<string, string>> {
    const roles = new Map<string, string>();
    for await (const page of paginate(cursor => listPage(on(accountId, '/folders'), {}, folderSchema, 100, cursor))) {
      for (const folder of page.items) if (folder.role) roles.set(folder.id, folder.role);
    }
    return roles;
  }
  // A message says where it sits by its folders' ids: their roles are read once per account, and read again after a failure.
  const folderRoles = new Map<string, Promise<Map<string, string>>>();
  function rolesOf(accountId: string): Promise<Map<string, string>> {
    const known = folderRoles.get(accountId);
    if (known) return known;
    const roles = readRoles(accountId).catch((error: unknown) => { folderRoles.delete(accountId); throw error; });
    folderRoles.set(accountId, roles);
    return roles;
  }

  /** A page of mail read alongside the account's folder roles, the first time with them. */
  async function mailPage(accountId: string, page: Promise<{ data: unknown[]; cursor: string | null }>): Promise<Page<UnipileEmail>> {
    const [{ data, cursor }, roles] = await Promise.all([page, rolesOf(accountId)]);
    const { items, skipped } = parseEntries(emailSchema, data);
    return { skipped, cursor, items: items.map(email => {
      const folderRolesOf = new Set(email.folders.map(folder => roles.get(folder)));
      return { ...email, account_id: accountId, role: ROLES.find(([folderRole]) => folderRolesOf.has(folderRole))?.[1] ?? 'inbox' };
    }) };
  }

  return {
    async authLink(link) {
      if (!link.state.trim()) throw new TypeError('state_required');
      const config = Object.fromEntries(Object.entries(link.scopes ?? {}).map(([provider, scopes]) => [provider, { oauth_scope: scopes }]));
      const answer = parseAnswer(linkSchema, await http.json('/auth/link', { method: 'POST', json: {
        ...('accountId' in link ? { account_id: link.accountId } : { providers: link.providers }),
        expires_on: utc(link.expiresOn), redirect_uri: link.redirectUri, state: link.state,
        ...(Object.keys(config).length > 0 ? { config } : {}) } }));
      return answer.link;
    },
    async account(accountId, signal) {
      const options = signal ? { signal } : {};
      const answer = parseAnswer(accountSchema, await http.json(`/accounts/${encodeURIComponent(accountId)}`, options));
      const senders = MAILBOXES.has(answer.provider)
        ? parseAnswer(sendersSchema, await http.json(on(accountId, '/email-senders'), options)).data : [];
      return { createdAt: answer.created_at, provider: answer.provider,
        email: senders.find(sender => sender.is_primary)?.email ?? null,
        scopes: (answer.oauth_scope ?? '').split(',').map(scope => scope.trim()).filter(Boolean) };
    },
    async company(accountId, companyId) {
      const c = parseAnswer(companySchema, await http.json(on(accountId, `/linkedin/company/${encodeURIComponent(companyId)}`)));
      return { id: c.id, name: c.name, tagline: c.tagline ?? '', description: c.description ?? '', industry: c.industry ?? [],
        headcount: c.insights?.headcount ?? null, city: c.locations?.find(location => location.is_headquarter)?.city ?? null,
        profileUrl: c.profile_url ?? '' };
    },
    async posts(accountId, companyId, limit) {
      const answer = parseAnswer(postsSchema, await http.json(on(accountId, `/users/${encodeURIComponent(companyId)}/posts`),
        { query: { limit: String(limit) } }));
      return answer.data.flatMap(post => (post.text
        ? [{ url: post.share_url, text: post.text, createdAt: post.created_at ?? null, author: post.author?.display_name ?? '' }] : []));
    },
    async emails(accountId, { after, cursor, limit, metaOnly }) {
      // A next page names its cursor alone: the cursor holds the first page's filters, and Unipile refuses them beside it.
      const query = cursor ? { limit: String(pageSize(limit)), cursor } : { limit: String(pageSize(limit)),
        ...(metaOnly ? { meta_only: 'true' } : {}), ...(after ? { after: utc(after) } : {}) };
      return mailPage(accountId, http.json(on(accountId, '/emails'), { query }).then(answer => {
        const page = parseAnswer(listSchema, answer);
        return { data: page.data, cursor: page.next_cursor ?? null };
      }));
    },
    async thread(accountId, threadId) {
      return mailPage(accountId, http.json(on(accountId, `/threads/${encodeURIComponent(threadId)}`))
        .then(answer => ({ data: parseAnswer(threadSchema, answer).emails, cursor: null })));
    },
    async calendars(accountId) {
      const calendars: UnipileCalendar[] = [];
      for await (const page of paginate(cursor => listPage(on(accountId, '/calendars'), {}, calendarSchema, 100, cursor))) {
        calendars.push(...page.items);
      }
      return calendars;
    },
    async events(accountId, calendarId, { start, end, updatedAfter, cursor, limit }) {
      return listPage(on(accountId, `/calendars/${encodeURIComponent(calendarId)}/events`), { expand_recurring: 'true',
        ...(start ? { start: utc(start) } : {}), ...(end ? { end: utc(end) } : {}),
        ...(updatedAfter ? { updated_after: utc(updatedAfter) } : {}) },
      eventRead, pageSize(limit), cursor);
    },
    async deleteAccount(accountId) {
      try {
        await http.json(`/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE', idempotent: true });
      } catch (error) {
        if (!(error instanceof ProviderHttpError && error.code === 'not_found')) throw error;
      }
    },
  };
}

/** The account id is the secret; the app decides ownership, acceptable creation age and persistence. */
export function unipileConnect(input: { client: UnipileClient; link: HostedSignIn; signal?: AbortSignal }):
DirectConnect<string, UnipileAccount> {
  return { kind: 'hosted', authorize: () => input.client.authLink(input.link),
    identify: async accountId => ({ account: { id: accountId, name: accountId },
      details: await input.client.account(accountId, input.signal) }) };
}

/** One account of the workspace as a mailbox reader: its mail by metadata, a thread whole, its main calendar and events. */
export function unipileMailbox(client: UnipileClient, accountId: string): MailboxReader {
  // Unipile lists drafts with the mail. A reader leaves them out, as Graph and Gmail do, and not as `skipped`: a draft is
  // read fine, and an app reads most of a page skipped as the provider changing its format.
  const withoutDrafts = (page: Page<MailboxEmail>): Page<MailboxEmail> =>
    ({ ...page, items: page.items.filter(email => email.role !== 'drafts') });
  return {
    async identify() {
      const email = (await client.account(accountId)).email?.trim().toLowerCase();
      if (!email) throw new ProviderHttpError('invalid_response', null, 'no_mailbox');
      return { email };
    },
    messages: async query => withoutDrafts(await client.emails(accountId, { ...query, metaOnly: true })),
    thread: async threadId => withoutDrafts(await client.thread(accountId, threadId)),
    async primaryCalendar() {
      const calendars = await client.calendars(accountId);
      return calendars.find(calendar => calendar.is_primary) ?? calendars.find(calendar => calendar.is_owned_by_user) ?? null;
    },
    events: (calendarId, query) => client.events(accountId, calendarId, query),
  };
}
