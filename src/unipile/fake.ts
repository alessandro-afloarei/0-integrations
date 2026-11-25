import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { unipile } from '../catalogue/unipile.js';
import type { Route } from '../testing.js';
import type { LinkedInCompany, LinkedInPost, UnipileCalendar, UnipileEmail, UnipileEmailAddress, UnipileEvent, UnipileEventTime,
  UnipileSignInProvider } from './unipile.js';

const PROVIDERS = ['linkedin', 'google', 'outlook'] as const;
const linkRequest = z.object({ state: z.string(), redirect_uri: z.string(), expires_on: z.string(),
  providers: z.array(z.enum(PROVIDERS)).min(1).optional(), account_id: z.string().optional(),
  config: z.record(z.string(), z.object({ oauth_scope: z.array(z.string()).min(1) })).optional() });

/** What a sign-in asked for, as the consent hands it to `accountId`. */
type SignIn = { state: string; providers: readonly UnipileSignInProvider[]; scopes: Record<string, string[]> };
/** The hosted page at `consentUrl`: it makes the account `accountId` names and sends the browser back, with it, to the
 *  link's return address, which must be one of `redirectUris`. */
type HostedConsent = { consentUrl: string; redirectUris: readonly string[]; accountId: (signIn: SignIn) => string | Promise<string> };
type Mailbox = { emails: readonly UnipileEmail[]; calendars: readonly UnipileCalendar[]; events: readonly UnipileEvent[] };
type Account = { createdAt: string; provider?: string; email?: string | null; scopes?: readonly string[] };

/** Unipile's error answer. */
const failure = (status: number, type: string, title: string) => Response.json({ object: 'Error', title, type, status }, { status });
const notFound = () => failure(404, 'api/resource_not_found', 'Not Found');
const invalid = () => failure(400, 'api/invalid_parameters', 'Bad Request');
const wirePerson = (person: UnipileEmailAddress) => ({ email: person.identifier, display_name: person.display_name });
const wireTime = (time: UnipileEventTime) => ('date' in time ? { type: 'date', date: time.date }
  : { type: 'datetime', date_time: time.date_time, timezone: time.time_zone });
const instant = (time: UnipileEventTime) => Date.parse('date' in time ? time.date : time.date_time);
const API = unipile.http.baseUrl;
const BESIDE_CURSOR = new Set(['cursor', 'limit', 'meta_only']);
/** A folder's role, as Gmail's system labels have one: its own name, but `DRAFTS` for the label `DRAFT`. */
const folderRole = (id: string) => (id === 'DRAFT' ? 'DRAFTS' : ['INBOX', 'SENT', 'TRASH', 'SPAM'].includes(id) ? id : null);

function safeUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !value.includes('#');
}

/**
 * Unipile V2's API: every company id answers `company`, every company's posts are `posts` (never cut to the limit), and an
 * account `accounts` maps to null is one Unipile does not know. With `apiKey`, any other key is refused. `mailboxes(accountId)`
 * is an account's mail and calendars (null: none); an email's folders name its role (`INBOX`, `SENT`, `DRAFT`, `TRASH`,
 * `SPAM`). A deleted account is unknown from then on. Without `hostedConsent`, a sign-in link is `authLink`'s.
 */
export function fakeUnipile(data: { authLink?: (link: { state: string; redirectUri: string }) => string; accounts: (accountId: string) => Account | null;
  company: LinkedInCompany; posts: readonly LinkedInPost[]; hostedConsent?: HostedConsent; apiKey?: string;
  mailboxes?: (accountId: string) => Mailbox | null }): Route[] {
  const consent = data.hostedConsent ? { ...data.hostedConsent } : undefined;
  if (consent && ![consent.consentUrl, ...consent.redirectUris].every(safeUrl)) throw new TypeError('fake_hosted_url_invalid');
  const pending = new Map<string, SignIn & { redirectUri: string; expiresAt: number }>();
  const consentRoutes: Route[] = consent ? [{ method: 'GET',
    url: url => url.origin === new URL(consent.consentUrl).origin && url.pathname === new URL(consent.consentUrl).pathname,
    async respond(request) {
      const binding = pending.get(request.url);
      if (!binding || binding.expiresAt <= Date.now()) return new Response(null, { status: 400 });
      // Consumed first, so two concurrent browser requests cannot make two accounts.
      pending.delete(request.url);
      const back = new URL(binding.redirectUri);
      const accountId = await consent.accountId({ state: binding.state, providers: binding.providers, scopes: binding.scopes });
      back.searchParams.set('account_id', accountId);
      back.searchParams.set('provider', data.accounts(accountId)?.provider ?? binding.providers[0] ?? 'linkedin');
      back.searchParams.set('state', binding.state);
      return Response.redirect(back.href, 302);
    } }] : [];
  const api = (path: RegExp) => (url: URL) => url.origin === new URL(API).origin && path.test(url.pathname);
  const deleted = new Set<string>();
  const account = (id: string) => (deleted.has(id) ? null : data.accounts(id));
  // A path's nth part: `/v2/{account}/…` names the account second, `/v2/accounts/{account}` third.
  const segment = (request: Request, n: number) => decodeURIComponent(new URL(request.url).pathname.split('/')[n] ?? '');
  const { company, mailboxes } = data;
  // As Unipile's cursor does, each holds its list, that list's filters and where the next page starts.
  const cursors = new Map<string, { path: string; query: URLSearchParams; offset: number }>();
  /** One page of what `listed` keeps under the first page's filters: `limit` of them (100 unless asked). Null for a cursor
   *  this list never gave, or one sent beside a filter, which Unipile refuses too (live, 2026-11-24). Beside a cursor it
   *  takes a limit, and `meta_only`, which it ignores: the cursor keeps the first page's. */
  function page<T>(request: Request, listed: (query: URLSearchParams) => readonly T[]) {
    const { pathname: path, searchParams: asked } = new URL(request.url);
    const cursor = asked.get('cursor');
    const resumed = cursor === null ? { path, query: asked, offset: 0 } : cursors.get(cursor);
    if (resumed?.path !== path || (cursor !== null && [...asked.keys()].some(key => !BESIDE_CURSOR.has(key)))) return null;
    const items = listed(resumed.query);
    const end = resumed.offset + Number(asked.get('limit') ?? '100');
    const next = end < items.length ? `cursor-${String(cursors.size + 1)}` : undefined;
    if (next) cursors.set(next, { path, query: resumed.query, offset: end });
    return { items: items.slice(resumed.offset, end), next, query: resumed.query };
  }
  const mailboxOf = (request: Request) => (account(segment(request, 2)) === null ? null : mailboxes?.(segment(request, 2)) ?? null);
  const wireEmail = (email: UnipileEmail, meta: boolean) => ({ object: 'Email', id: email.id, message_id: email.message_id,
    thread_id: email.thread_id, date: email.date, folders: email.folders, subject: email.subject,
    body: meta ? '' : email.body, body_plain: meta ? '' : email.body_plain, from: [wirePerson(email.from_attendee)],
    to: email.to_attendees.map(wirePerson), cc: email.cc_attendees.map(wirePerson),
    headers: [...email.headers, ...(email.in_reply_to ? [{ name: 'In-Reply-To', value: email.in_reply_to.message_id }] : [])] });

  const mailRoutes: Route[] = mailboxes ? [
    { method: 'GET', url: api(/^\/v2\/[^/]+\/emails$/u), respond(request) {
      const mailbox = mailboxOf(request);
      if (!mailbox) return notFound();
      if (Number(new URL(request.url).searchParams.get('limit') ?? '100') > 100) return invalid();
      const paged = page(request, query => {
        const after = query.get('after');
        return mailbox.emails.filter(email => after === null || Date.parse(email.date) > Date.parse(after))
          .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      });
      if (!paged) return invalid();
      return Response.json({ data: paged.items.map(email => wireEmail(email, paged.query.get('meta_only') === 'true')),
        next_cursor: paged.next });
    } },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/threads\/[^/]+$/u), respond(request) {
      const mailbox = mailboxOf(request);
      const threadId = segment(request, 4);
      const emails = mailbox?.emails.filter(email => email.thread_id === threadId) ?? [];
      if (emails.length === 0) return notFound();
      return Response.json({ object: 'EmailThread', id: threadId,
        emails: [...emails].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).map(email => wireEmail(email, false)) });
    } },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/folders$/u), respond(request) {
      const mailbox = mailboxOf(request);
      if (!mailbox) return notFound();
      const ids = [...new Set(mailbox.emails.flatMap(email => email.folders))];
      return Response.json({ data: ids.map(id => ({ object: 'EmailFolder', id, name: id, role: folderRole(id) })) });
    } },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/calendars$/u), respond(request) {
      const mailbox = mailboxOf(request);
      if (!mailbox) return notFound();
      const paged = page(request, () => mailbox.calendars);
      if (!paged) return invalid();
      return Response.json({ data: paged.items.map(({ is_primary: primary, ...calendar }) => ({ object: 'Calendar', ...calendar,
        is_default: primary })), next_cursor: paged.next });
    } },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/calendars\/[^/]+\/events$/u), respond(request) {
      const mailbox = mailboxOf(request);
      const calendarId = segment(request, 4);
      if (!mailbox?.calendars.some(calendar => calendar.id === calendarId)) return notFound();
      const paged = page(request, query => {
        const [start, end, updated] = [query.get('start'), query.get('end'), query.get('updated_after')];
        // As Unipile's reference words it: `start` keeps the events starting after it, `end` those ending before it.
        return mailbox.events.filter(event => event.calendar_id === calendarId
          && (start === null || instant(event.start) >= Date.parse(start)) && (end === null || instant(event.end) <= Date.parse(end))
          && (updated === null || Date.parse(event.updated_at) > Date.parse(updated)))
          .sort((a, b) => instant(a.start) - instant(b.start));
      });
      if (!paged) return invalid();
      return Response.json({ data: paged.items.map(event => ({ object: 'CalendarEvent', ...event, start: wireTime(event.start),
        end: wireTime(event.end) })), next_cursor: paged.next });
    } },
  ] : [];

  const apiRoutes: Route[] = [
    { method: 'POST', url: `${API}/auth/link`, async respond(request) {
      const parsed = linkRequest.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return invalid();
      const link = parsed.data;
      const expiresAt = Date.parse(link.expires_on);
      // A new account names its providers, a reconnection its account: never both, never neither.
      if (!link.state.trim() || (link.providers === undefined) === (link.account_id === undefined)
        || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return invalid();
      const scopes = Object.fromEntries(Object.entries(link.config ?? {}).map(([provider, config]) => [provider, config.oauth_scope]));
      if (consent) {
        if (!consent.redirectUris.includes(link.redirect_uri)) return invalid();
        for (const [url, binding] of pending) if (binding.expiresAt <= Date.now()) pending.delete(url);
        const url = new URL(consent.consentUrl);
        url.searchParams.set('ticket', randomUUID());
        const reconnected = link.account_id === undefined ? undefined : account(link.account_id)?.provider;
        pending.set(url.href, { state: link.state, scopes, expiresAt, redirectUri: link.redirect_uri,
          providers: link.providers ?? (PROVIDERS.filter(provider => provider === reconnected)) });
        return Response.json({ object: 'HostedAuthLink', link: url.href });
      }
      if (!data.authLink) return invalid();
      return Response.json({ object: 'HostedAuthLink', link: data.authLink({ state: link.state, redirectUri: link.redirect_uri }) });
    } },
    { method: 'GET', url: api(/^\/v2\/accounts\/[^/]+$/u), respond(request) {
      const id = segment(request, 3);
      const found = account(id);
      if (!found) return notFound();
      return Response.json({ object: 'Account', id, created_at: found.createdAt, provider: found.provider ?? 'linkedin',
        ...(found.scopes ? { oauth_scope: found.scopes.join(',') } : {}) });
    } },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/email-senders$/u), respond(request) {
      const found = account(segment(request, 2));
      if (!found?.email) return notFound();
      return Response.json({ data: [{ object: 'EmailSender', email: found.email, is_primary: true }] });
    } },
    { method: 'DELETE', url: api(/^\/v2\/accounts\/[^/]+$/u), respond(request) {
      const id = segment(request, 3);
      if (!account(id)) return notFound();
      deleted.add(id);
      return Response.json({ success: true });
    } },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/linkedin\/company\/[^/]+$/u), respond: request => (account(segment(request, 2)) === null
      ? notFound() : Response.json({ object: 'CompanyProfile', id: company.id, name: company.name, tagline: company.tagline,
        description: company.description, industry: company.industry, profile_url: company.profileUrl,
        insights: { headcount: company.headcount ?? undefined },
        locations: company.city === null ? [] : [{ is_headquarter: true, city: company.city }] })) },
    { method: 'GET', url: api(/^\/v2\/[^/]+\/users\/[^/]+\/posts$/u), respond: request => (account(segment(request, 2)) === null
      ? notFound() : Response.json({ data: data.posts.map(post => ({ object: 'Post', share_url: post.url, text: post.text,
        created_at: post.createdAt, author: { display_name: post.author } })) })) },
    ...mailRoutes,
  ];
  const refused = (request: Request) => data.apiKey !== undefined && request.headers.get('x-api-key') !== data.apiKey;
  return [
    ...apiRoutes.map(route => ({ ...route,
      respond: (request: Request) => (refused(request) ? failure(401, 'api/missing_authorization', 'Unauthorized') : route.respond(request)) })),
    ...consentRoutes,
  ];
}
