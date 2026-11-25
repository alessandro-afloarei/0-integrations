import { createHash, randomUUID } from 'node:crypto';
import { eventsIn, type FakeMailbox } from '../mailbox/fake.js';
import type { MailboxEmail, MailboxEvent, MailboxEventTime } from '../mailbox/mailbox.js';
import type { OAuthClient } from '../oauth.js';
import { microsoft } from '../catalogue/microsoft.js';
import type { Route } from '../testing.js';
import { MICROSOFT_SCOPES } from './microsoft.js';

export type MicrosoftFakeData = {
  client: OAuthClient;
  /** The one redirect address registered for the app. */
  redirectUri: string;
  /** Who signs in at the consent page for a state (a fixture's member, a test's account); null declines. */
  signIn: (state: string) => string | null | Promise<string | null>;
  mailboxes: (address: string) => FakeMailbox | null;
  /** Access tokens that read a mailbox without a sign-in, to the mailbox's address: the provider kit's. */
  tokens?: Readonly<Record<string, string>>;
};

const GRAPH = microsoft.http.baseUrl;
const AUTHORIZE = microsoft.auth[0].authorizeUrl;
const TOKEN = microsoft.auth[0].tokenUrl;
const FOLDERS = { sentitems: 'sent', deleteditems: 'trash', junkemail: 'spam', inbox: 'inbox', drafts: 'drafts' } as const;
const RESPONSES = { yes: 'accepted', no: 'declined', maybe: 'tentativelyAccepted', noreply: 'none' } as const;

const graphError = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });
const unauthorized = () => graphError(401, 'InvalidAuthenticationToken', 'Access token validation failure.');
const notFound = () => graphError(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
const escapeHtml = (value: string) => value.replace(/[&<>"]/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
/** The fake's stable Graph user id for an address, shaped like Entra's object ids. */
export const userId = (address: string) => createHash('sha256').update(address.toLowerCase()).digest('hex')
  .slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, '$1-$2-$3-$4-$5');

/** A time as Graph writes one asked for in UTC: seven fraction digits, no offset. An all-day date is midnight in the
 *  mailbox's own zone, which UTC moves (`utcOffsetMinutes`: Rome's 9 November is 23:00 on the 8th). */
function graphTime(time: MailboxEventTime, utcOffsetMinutes: number): { dateTime: string; timeZone: string } {
  const instant = 'date' in time ? Date.parse(`${time.date}T00:00:00Z`) - utcOffsetMinutes * 60_000 : Date.parse(time.date_time);
  return { dateTime: new Date(instant).toISOString().replace(/\.(\d{3})Z$/u, (_match, millis: string) => `.${millis}0000`),
    timeZone: 'UTC' };
}
const recipient = (person: { display_name: string; identifier: string }) => ({ emailAddress: { name: person.display_name, address: person.identifier } });

function wireMessage(email: MailboxEmail, select: ReadonlySet<string>): Record<string, unknown> {
  const folder = Object.entries(FOLDERS).find(([, role]) => role === email.role)?.[0] ?? 'inbox';
  const role = FOLDERS[folder as keyof typeof FOLDERS];
  const headers = [...email.headers.map(header => ({ name: header.name, value: header.value })),
    ...(email.in_reply_to ? [{ name: 'In-Reply-To', value: email.in_reply_to.message_id }] : [])];
  const all: Record<string, unknown> = {
    id: email.id, conversationId: email.thread_id, internetMessageId: email.message_id, receivedDateTime: email.date,
    subject: email.subject, isDraft: role === 'drafts', parentFolderId: `folder-${folder}`, from: recipient(email.from_attendee),
    toRecipients: email.to_attendees.map(recipient), ccRecipients: email.cc_attendees.map(recipient),
    // Graph lists bodies as HTML only.
    body: { contentType: 'html', content: email.body || email.body_plain.split('\n').map(line => `<div>${escapeHtml(line)}</div>`).join('') },
    internetMessageHeaders: headers,
  };
  return Object.fromEntries(Object.entries(all).filter(([key]) => key === 'id' || select.has(key)));
}

function wireEvent(event: MailboxEvent, owner: string, utcOffsetMinutes: number): Record<string, unknown> {
  const mine = event.attendees.find(attendee => attendee.email.toLowerCase() === owner);
  const organizer = event.organizer.email.toLowerCase() === owner;
  return {
    id: event.id, iCalUId: event.ical_uid, seriesMasterId: event.master_event_id, createdDateTime: event.created_at,
    lastModifiedDateTime: event.updated_at, subject: event.title, body: { contentType: 'html', content: event.body },
    location: { displayName: event.location }, isCancelled: event.is_cancelled, isAllDay: event.is_all_day,
    start: graphTime(event.start, utcOffsetMinutes), end: graphTime(event.end, utcOffsetMinutes), type: event.event_type,
    showAs: event.transparency === 'transparent' ? 'free' : 'busy',
    // Graph names the member's own answer apart, and leaves them out of the attendees.
    attendees: event.attendees.filter(attendee => attendee !== mine).map(attendee => ({ type: attendee.is_resource ? 'resource' : 'required',
      status: { response: attendee.is_organizer ? 'organizer' : RESPONSES[attendee.response_status] },
      emailAddress: { name: attendee.display_name ?? '', address: attendee.email } })),
    organizer: { emailAddress: { name: event.organizer.display_name ?? '', address: event.organizer.email } },
    responseStatus: { response: organizer ? 'organizer' : RESPONSES[mine?.response_status ?? 'noreply'] },
    onlineMeeting: event.conference?.url ? { joinUrl: event.conference.url } : null,
    onlineMeetingProvider: event.conference?.provider === 'teams' ? 'teamsForBusiness' : 'unknown',
    sensitivity: event.visibility === 'private' ? 'private' : 'normal',
  };
}

/** A page of a Graph list by `$top` and `$skip`, the next page's address in `@odata.nextLink`. */
function graphPage(url: URL, items: readonly unknown[]): Response {
  const top = Number(url.searchParams.get('$top') ?? '10');
  const skip = Number(url.searchParams.get('$skip') ?? '0');
  if (!Number.isInteger(top) || top < 1 || top > 1000 || !Number.isInteger(skip) || skip < 0) {
    return graphError(400, 'BadRequest', 'Invalid $top or $skip.');
  }
  const next = new URL(url);
  next.searchParams.set('$skip', String(skip + top));
  return Response.json({ value: items.slice(skip, skip + top), ...(skip + top < items.length ? { '@odata.nextLink': next.href } : {}) });
}

/** The two filters the reader sends: mail after a time, or one conversation; drafts out in both. */
function messageFilter(url: URL): ((email: MailboxEmail) => boolean) | Response {
  const filter = url.searchParams.get('$filter') ?? '';
  const orderby = url.searchParams.get('$orderby');
  const after = /^receivedDateTime ge (\S+) and isDraft eq false$/u.exec(filter);
  const conversation = /^conversationId eq '((?:[^']|'')*)' and isDraft eq false$/u.exec(filter);
  // Graph's rule: a field sorted by leads the filter.
  if (orderby !== null && (orderby !== 'receivedDateTime desc' || !after)) {
    return graphError(400, 'InefficientFilter', 'The restriction or sort order is too complex for this operation.');
  }
  const since = after?.[1];
  if (since !== undefined && !Number.isNaN(Date.parse(since))) {
    return email => email.role !== 'drafts' && Date.parse(email.date) >= Date.parse(since);
  }
  const thread = conversation?.[1]?.replaceAll("''", "'");
  if (thread !== undefined) return email => email.role !== 'drafts' && email.thread_id === thread;
  return graphError(400, 'BadRequest', 'Unsupported $filter.');
}

/** Microsoft's sign-in and Microsoft Graph answered from synthetic mailboxes. Refresh tokens rotate, as Microsoft's do. */
export function fakeMicrosoft(data: MicrosoftFakeData): Route[] {
  if (!URL.canParse(data.redirectUri)) throw new TypeError('fake_redirect_uri_invalid');
  const codes = new Map<string, { address: string; challenge: string }>();
  const accessTokens = new Map<string, string>(Object.entries(data.tokens ?? {}));
  const refreshTokens = new Map<string, string>();
  const issue = (address: string) => {
    const [access, refresh] = [`fake-ms-access-${randomUUID()}`, `fake-ms-refresh-${randomUUID()}`];
    accessTokens.set(access, address);
    refreshTokens.set(refresh, address);
    return Response.json({ token_type: 'Bearer', scope: MICROSOFT_SCOPES.join(' '), expires_in: 3600, ext_expires_in: 3600,
      access_token: access, refresh_token: refresh });
  };
  const invalidGrant = () => Response.json({ error: 'invalid_grant', error_description: 'AADSTS70000: The provided grant is invalid.' }, { status: 400 });

  /** The mailbox an access token reads, or the 401 Graph answers. */
  const mailboxOf = (request: Request): FakeMailbox | Response => {
    const token = /^Bearer (.+)$/u.exec(request.headers.get('authorization') ?? '')?.[1];
    const address = token === undefined ? undefined : accessTokens.get(token);
    return (address === undefined ? null : data.mailboxes(address)) ?? unauthorized();
  };
  const graph = (path: RegExp, respond: (mailbox: FakeMailbox, url: URL, match: RegExpExecArray) => Response): Route => ({
    method: 'GET', url: url => url.origin === new URL(GRAPH).origin && path.test(url.pathname),
    respond(request) {
      const mailbox = mailboxOf(request);
      if (mailbox instanceof Response) return mailbox;
      const url = new URL(request.url);
      const match = path.exec(url.pathname);
      return match ? respond(mailbox, url, match) : notFound();
    },
  });

  return [
    { method: 'GET', url: AUTHORIZE, async respond(request) {
      const params = new URL(request.url).searchParams;
      const scopes = new Set((params.get('scope') ?? '').split(' '));
      const [state, challenge] = [params.get('state') ?? '', params.get('code_challenge') ?? ''];
      if (params.get('client_id') !== data.client.clientId || params.get('redirect_uri') !== data.redirectUri
        || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !challenge || !state.trim()
        || !MICROSOFT_SCOPES.every(scope => scopes.has(scope))) {
        return new Response('AADSTS50011: The request is not valid for the application.', { status: 400 });
      }
      const back = new URL(data.redirectUri);
      back.searchParams.set('state', state);
      const address = await data.signIn(state);
      if (address === null) {
        back.searchParams.set('error', 'access_denied');
        return Response.redirect(back, 302);
      }
      const code = `fake-ms-code-${randomUUID()}`;
      codes.set(code, { address, challenge });
      back.searchParams.set('code', code);
      return Response.redirect(back, 302);
    } },
    { method: 'POST', url: TOKEN, async respond(request) {
      const form = new URLSearchParams(await request.text());
      if (form.get('client_id') !== data.client.clientId || form.get('client_secret') !== data.client.clientSecret) {
        return Response.json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, { status: 401 });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!pending || form.get('redirect_uri') !== data.redirectUri
          || challengeOf(form.get('code_verifier') ?? '') !== pending.challenge) return invalidGrant();
        return issue(pending.address);
      }
      if (form.get('grant_type') === 'refresh_token') {
        const address = refreshTokens.get(form.get('refresh_token') ?? '');
        if (address === undefined) return invalidGrant();
        // Each refresh token works once: the answer carries its successor.
        refreshTokens.delete(form.get('refresh_token') ?? '');
        return issue(address);
      }
      return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
    } },
    // A user's id is a GUID that never changes; the fake derives it from the address.
    graph(/^\/v1\.0\/me$/u, mailbox => Response.json({ id: userId(mailbox.address), mail: mailbox.address, userPrincipalName: mailbox.address,
      displayName: mailbox.name })),
    graph(/^\/v1\.0\/me\/mailFolders\/(\w+)$/u, (_mailbox, _url, [, name = '']) => (name in FOLDERS
      ? Response.json({ id: `folder-${name}` }) : notFound())),
    graph(/^\/v1\.0\/me\/messages$/u, (mailbox, url) => {
      const keep = messageFilter(url);
      if (keep instanceof Response) return keep;
      const select = new Set((url.searchParams.get('$select') ?? '').split(','));
      const listed = mailbox.emails.filter(keep).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      return graphPage(url, listed.map(email => wireMessage(email, select)));
    }),
    graph(/^\/v1\.0\/me\/calendar$/u, mailbox => Response.json(mailbox.calendar)),
    graph(/^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/u, (mailbox, url, [, id = '']) => {
      const [start, end] = [Date.parse(url.searchParams.get('startDateTime') ?? ''), Date.parse(url.searchParams.get('endDateTime') ?? '')];
      if (decodeURIComponent(id) !== mailbox.calendar.id) return notFound();
      if (Number.isNaN(start) || Number.isNaN(end)) return graphError(400, 'ErrorInvalidParameter', 'startDateTime and endDateTime are required.');
      // Graph's documented rule: an event's createdDateTime and lastModifiedDateTime come only without $select.
      if (/createdDateTime|lastModifiedDateTime/u.test(url.searchParams.get('$select') ?? '')) {
        return graphError(400, 'RequestBroker--ParseUri', "Could not find a property named 'createdDateTime' on type 'Microsoft.OutlookServices.Event'.");
      }
      const owner = mailbox.address.toLowerCase();
      return graphPage(url, eventsIn(mailbox.events, start, end).map(event => wireEvent(event, owner, mailbox.utcOffsetMinutes ?? 0)));
    }),
  ];
}
