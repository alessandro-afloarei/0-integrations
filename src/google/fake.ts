import { createHash, randomUUID } from 'node:crypto';
import { eventsIn, type FakeMailbox } from '../mailbox/fake.js';
import type { MailboxEmail, MailboxEmailAddress, MailboxEvent, MailboxEventTime } from '../mailbox/mailbox.js';
import type { OAuthClient } from '../oauth.js';
import { GOOGLE_CALENDAR_BASE, google } from '../providers.js';
import type { Route } from '../testing.js';
import { GOOGLE_SCOPES } from './google.js';

export type GoogleFakeData = {
  client: OAuthClient;
  /** The one redirect address registered for the app. */
  redirectUri: string;
  /** Who signs in at the consent page for a state (a fixture's member, a test's account); null declines. */
  signIn: (state: string) => string | null | Promise<string | null>;
  mailboxes: (address: string) => FakeMailbox | null;
  /** Access tokens that read a mailbox without a sign-in, to the mailbox's address: the provider kit's. */
  tokens?: Readonly<Record<string, string>>;
  /** The scopes a member leaves ticked on the consent screen (all the app asks for, unless named). */
  granted?: (address: string) => readonly string[];
};

const GMAIL = google.baseUrl ?? '';
const AUTHORIZE = google.oauth2?.authUrl ?? '';
const TOKEN = google.oauth2?.tokenUrl ?? '';
const REVOKE = google.oauth2?.revokeUrl ?? '';
const LABELS: Record<string, string> = { inbox: 'INBOX', sent: 'SENT', drafts: 'DRAFT', trash: 'TRASH', spam: 'SPAM' };
const RESPONSES = { yes: 'accepted', no: 'declined', maybe: 'tentative', noreply: 'needsAction' } as const;

const googleError = (code: number, status: string, reason: string, message: string) =>
  Response.json({ error: { code, message, errors: [{ message, domain: 'global', reason }], status } }, { status: code });
const unauthorized = () => googleError(401, 'UNAUTHENTICATED', 'authError', 'Request had invalid authentication credentials.');
const notFound = () => googleError(404, 'NOT_FOUND', 'notFound', 'Requested entity was not found.');
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const encoded = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
/** Gmail keeps a large body part apart, read as an attachment of its message; the fake does past this many bytes. */
const KEPT_APART = 4096;
/** A text body part as Gmail writes it: its text in the part, or kept apart under an attachment id (the fake's is the field). */
function textPart(email: MailboxEmail, field: 'body_plain' | 'body'): Record<string, unknown> {
  const type = field === 'body' ? 'text/html' : 'text/plain';
  const size = Buffer.byteLength(email[field], 'utf8');
  return { mimeType: type, filename: '', headers: [{ name: 'Content-Type', value: `${type}; charset="UTF-8"` }],
    body: size > KEPT_APART ? { size, attachmentId: field } : { size, data: encoded(email[field]) } };
}
const named = (person: MailboxEmailAddress) =>
  (person.display_name ? `"${person.display_name.replace(/["\\]/gu, '\\$&')}" <${person.identifier}>` : person.identifier);

/** A message as Gmail answers `format=full`, or `format=metadata` with only the headers asked for. */
function wireMessage(email: MailboxEmail, metadata: readonly string[] | null): Record<string, unknown> {
  const labels = [...new Set([LABELS[email.role] ?? 'INBOX', ...email.folders.filter(folder => folder.startsWith('CATEGORY_'))])];
  const headers = [{ name: 'From', value: named(email.from_attendee) }, { name: 'To', value: email.to_attendees.map(named).join(', ') },
    ...(email.cc_attendees.length ? [{ name: 'Cc', value: email.cc_attendees.map(named).join(', ') }] : []),
    { name: 'Subject', value: email.subject }, { name: 'Message-ID', value: email.message_id },
    ...(email.in_reply_to ? [{ name: 'In-Reply-To', value: email.in_reply_to.message_id }] : []),
    ...email.headers.map(header => ({ name: header.name, value: header.value }))];
  const wanted = metadata?.map(name => name.toLowerCase());
  const payload = wanted ? { mimeType: 'multipart/alternative', headers: headers.filter(header => wanted.includes(header.name.toLowerCase())) }
    : { mimeType: 'multipart/alternative', headers, parts: [textPart(email, 'body_plain'), textPart(email, 'body')] };
  return { id: email.id, threadId: email.thread_id ?? email.id, labelIds: labels, snippet: '', internalDate: String(Date.parse(email.date)), payload };
}

const wireTime = (time: MailboxEventTime) => ('date' in time ? { date: time.date } : { dateTime: time.date_time, timeZone: time.time_zone });

function wireEvent(event: MailboxEvent, owner: string): Record<string, unknown> {
  const meet = event.conference?.provider === 'google_meet' ? event.conference.url : null;
  return {
    kind: 'calendar#event', id: event.id, status: event.is_cancelled ? 'cancelled' : 'confirmed', created: event.created_at,
    updated: event.updated_at, summary: event.title, description: event.body, location: event.location, iCalUID: event.ical_uid,
    ...(event.master_event_id ? { recurringEventId: event.master_event_id } : {}), start: wireTime(event.start), end: wireTime(event.end),
    organizer: { email: event.organizer.email, displayName: event.organizer.display_name ?? undefined,
      ...(event.organizer.email.toLowerCase() === owner ? { self: true } : {}) },
    attendees: event.attendees.map(attendee => ({ email: attendee.email, displayName: attendee.display_name ?? undefined,
      ...(attendee.is_organizer ? { organizer: true } : {}), ...(attendee.email.toLowerCase() === owner ? { self: true } : {}),
      ...(attendee.is_resource ? { resource: true } : {}), responseStatus: RESPONSES[attendee.response_status] })),
    ...(meet ? { hangoutLink: meet } : {}),
    ...(event.conference && !meet ? { conferenceData: { conferenceSolution: { key: { type: 'addOn' }, name: event.conference.provider },
      entryPoints: [{ entryPointType: 'video', uri: event.conference.url }] } } : {}),
    eventType: event.event_type, transparency: event.transparency,
    ...(event.visibility === 'private' ? { visibility: 'private' } : {}),
  };
}

/** Gmail's listing query as the reader writes it: `after:<seconds>` and `-in:drafts`. Spam and trash stay out, as Gmail's do. */
function listingFilter(q: string): ((email: MailboxEmail) => boolean) | null {
  let after = 0;
  for (const term of q.split(' ').filter(Boolean)) {
    const since = /^after:(\d+)$/u.exec(term)?.[1];
    if (since !== undefined) after = Number(since) * 1000;
    else if (term !== '-in:drafts') return null;
  }
  return email => !['drafts', 'spam', 'trash'].includes(email.role) && Date.parse(email.date) > after;
}

/** A page by `pageToken` (an offset here) and `maxResults`. */
function page<T>(items: readonly T[], params: URLSearchParams, max: number): { items: T[]; next: string | undefined } | null {
  const size = Number(params.get('maxResults') ?? '100');
  const offset = Number(params.get('pageToken') ?? '0');
  if (!Number.isInteger(size) || size < 1 || size > max || !Number.isInteger(offset) || offset < 0) return null;
  return { items: items.slice(offset, offset + size), next: offset + size < items.length ? String(offset + size) : undefined };
}

/** Google's consent, Gmail and Google Calendar answered from synthetic mailboxes. A refresh token lasts until revoked. */
export function fakeGoogle(data: GoogleFakeData): Route[] {
  if (!URL.canParse(data.redirectUri)) throw new TypeError('fake_redirect_uri_invalid');
  const codes = new Map<string, { address: string; challenge: string }>();
  const scopesOf = (address: string) => data.granted?.(address) ?? GOOGLE_SCOPES;
  const accessTokens = new Map<string, { address: string; refresh: string | null; scopes: readonly string[] }>(
    Object.entries(data.tokens ?? {}).map(([token, address]) => [token, { address, refresh: null, scopes: GOOGLE_SCOPES }]));
  const refreshTokens = new Map<string, string>();
  const tokenAnswer = (address: string, refresh: string, withRefresh: boolean) => {
    const access = `fake-google-access-${randomUUID()}`;
    accessTokens.set(access, { address, refresh, scopes: scopesOf(address) });
    return Response.json({ access_token: access, expires_in: 3599, scope: scopesOf(address).join(' '), token_type: 'Bearer',
      ...(withRefresh ? { refresh_token: refresh } : {}) });
  };
  const invalidGrant = () => Response.json({ error: 'invalid_grant', error_description: 'Bad Request' }, { status: 400 });

  /** The mailbox an access token reads, or Google's 401; a token without the API's scope is 403, as Google answers it. */
  const mailboxOf = (request: Request, scope: string): FakeMailbox | Response => {
    const token = /^Bearer (.+)$/u.exec(request.headers.get('authorization') ?? '')?.[1];
    const held = token === undefined ? undefined : accessTokens.get(token);
    const mailbox = held === undefined ? null : data.mailboxes(held.address);
    if (!held || !mailbox) return unauthorized();
    return held.scopes.includes(scope) ? mailbox
      : googleError(403, 'PERMISSION_DENIED', 'insufficientPermissions', 'Request had insufficient authentication scopes.');
  };
  const api = (base: string, path: RegExp, respond: (mailbox: FakeMailbox, url: URL, match: RegExpExecArray) => Response): Route => ({
    method: 'GET', url: url => `${url.origin}${url.pathname}`.startsWith(base) && path.test(url.pathname.slice(new URL(base).pathname.length)),
    respond(request) {
      const scope = GOOGLE_SCOPES.find(granted => granted.includes(base === GMAIL ? 'gmail' : 'calendar')) ?? '';
      const mailbox = mailboxOf(request, scope);
      if (mailbox instanceof Response) return mailbox;
      const url = new URL(request.url);
      const match = path.exec(url.pathname.slice(new URL(base).pathname.length));
      return match ? respond(mailbox, url, match) : notFound();
    },
  });
  const ownMessage = (mailbox: FakeMailbox, id: string) => mailbox.emails.find(email => email.id === decodeURIComponent(id));

  return [
    { method: 'GET', url: AUTHORIZE, async respond(request) {
      const params = new URL(request.url).searchParams;
      const scopes = new Set((params.get('scope') ?? '').split(' '));
      const [state, challenge] = [params.get('state') ?? '', params.get('code_challenge') ?? ''];
      if (params.get('client_id') !== data.client.clientId || params.get('redirect_uri') !== data.redirectUri
        || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !challenge || !state.trim()
        || params.get('access_type') !== 'offline' || !GOOGLE_SCOPES.every(scope => scopes.has(scope))) {
        return new Response('Error 400: invalid_request', { status: 400 });
      }
      const back = new URL(data.redirectUri);
      back.searchParams.set('state', state);
      const address = await data.signIn(state);
      if (address === null) {
        back.searchParams.set('error', 'access_denied');
        return Response.redirect(back, 302);
      }
      const code = `fake-google-code-${randomUUID()}`;
      codes.set(code, { address, challenge });
      back.searchParams.set('code', code);
      return Response.redirect(back, 302);
    } },
    { method: 'POST', url: TOKEN, async respond(request) {
      const form = new URLSearchParams(await request.text());
      if (form.get('client_id') !== data.client.clientId || form.get('client_secret') !== data.client.clientSecret) {
        return Response.json({ error: 'invalid_client', error_description: 'Unauthorized' }, { status: 401 });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!pending || form.get('redirect_uri') !== data.redirectUri
          || challengeOf(form.get('code_verifier') ?? '') !== pending.challenge) return invalidGrant();
        const refresh = `fake-google-refresh-${randomUUID()}`;
        refreshTokens.set(refresh, pending.address);
        return tokenAnswer(pending.address, refresh, true);
      }
      if (form.get('grant_type') === 'refresh_token') {
        const refresh = form.get('refresh_token') ?? '';
        const address = refreshTokens.get(refresh);
        // Google keeps the refresh token: the answer carries a new access token only.
        return address === undefined ? invalidGrant() : tokenAnswer(address, refresh, false);
      }
      return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
    } },
    { method: 'POST', url: REVOKE, async respond(request) {
      const token = new URLSearchParams(await request.text()).get('token') ?? '';
      const refresh = refreshTokens.has(token) ? token : accessTokens.get(token)?.refresh ?? null;
      if (refresh === null || !refreshTokens.has(refresh)) {
        return Response.json({ error: 'invalid_token', error_description: 'Token expired or revoked' }, { status: 400 });
      }
      // Revoking the grant ends its refresh token and every access token it gave.
      refreshTokens.delete(refresh);
      for (const [access, held] of accessTokens) if (held.refresh === refresh) accessTokens.delete(access);
      return Response.json({});
    } },
    api(GMAIL, /^\/users\/me\/profile$/u, mailbox => Response.json({ emailAddress: mailbox.address,
      messagesTotal: mailbox.emails.length, threadsTotal: new Set(mailbox.emails.map(email => email.thread_id)).size, historyId: '1' })),
    api(GMAIL, /^\/users\/me\/messages$/u, (mailbox, url) => {
      const keep = listingFilter(url.searchParams.get('q') ?? '');
      if (keep === null) return googleError(400, 'INVALID_ARGUMENT', 'invalidArgument', 'Invalid query.');
      const listed = page(mailbox.emails.filter(keep).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)), url.searchParams, 500);
      if (!listed) return googleError(400, 'INVALID_ARGUMENT', 'invalidArgument', 'Invalid paging.');
      return Response.json({ ...(listed.items.length ? { messages: listed.items.map(email => ({ id: email.id, threadId: email.thread_id ?? email.id })) } : {}),
        ...(listed.next ? { nextPageToken: listed.next } : {}), resultSizeEstimate: listed.items.length });
    }),
    api(GMAIL, /^\/users\/me\/messages\/([^/]+)$/u, (mailbox, url, [, id = '']) => {
      const email = ownMessage(mailbox, id);
      if (!email) return notFound();
      return Response.json(wireMessage(email, url.searchParams.get('format') === 'metadata' ? url.searchParams.getAll('metadataHeaders') : null));
    }),
    api(GMAIL, /^\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/u, (mailbox, _url, [, id = '', attachment = '']) => {
      const email = ownMessage(mailbox, id);
      const field = decodeURIComponent(attachment);
      if (!email || (field !== 'body_plain' && field !== 'body')) return notFound();
      return Response.json({ attachmentId: field, size: Buffer.byteLength(email[field], 'utf8'), data: encoded(email[field]) });
    }),
    api(GMAIL, /^\/users\/me\/threads\/([^/]+)$/u, (mailbox, _url, [, id = '']) => {
      const messages = mailbox.emails.filter(email => (email.thread_id ?? email.id) === decodeURIComponent(id))
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      return messages.length ? Response.json({ id: decodeURIComponent(id), historyId: '1', messages: messages.map(email => wireMessage(email, null)) })
        : notFound();
    }),
    api(GOOGLE_CALENDAR_BASE, /^\/calendars\/([^/]+)$/u, (mailbox, _url, [, id = '']) => {
      const wanted = decodeURIComponent(id);
      return wanted === 'primary' || wanted === mailbox.calendar.id
        ? Response.json({ kind: 'calendar#calendar', id: mailbox.calendar.id, summary: mailbox.calendar.name, timeZone: 'UTC' }) : notFound();
    }),
    api(GOOGLE_CALENDAR_BASE, /^\/calendars\/([^/]+)\/events$/u, (mailbox, url, [, id = '']) => {
      const params = url.searchParams;
      if (decodeURIComponent(id) !== mailbox.calendar.id) return notFound();
      if (params.get('orderBy') === 'startTime' && params.get('singleEvents') !== 'true') {
        return googleError(400, 'INVALID_ARGUMENT', 'invalid', 'The requested ordering is not available for the particular query.');
      }
      const [start, end] = [Date.parse(params.get('timeMin') ?? ''), Date.parse(params.get('timeMax') ?? '')];
      const listed = page(eventsIn(mailbox.events, Number.isNaN(start) ? -Infinity : start, Number.isNaN(end) ? Infinity : end), params, 2500);
      if (!listed) return googleError(400, 'INVALID_ARGUMENT', 'invalid', 'Invalid paging.');
      const owner = mailbox.address.toLowerCase();
      return Response.json({ kind: 'calendar#events', items: listed.items.map(event => wireEvent(event, owner)),
        ...(listed.next ? { nextPageToken: listed.next } : {}) });
    }),
  ];
}
