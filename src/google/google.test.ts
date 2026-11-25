import { expect, test } from 'vitest';
import { finishConnect, startConnect } from '../connect.js';
import { GrantRevoked } from '../errors.js';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import type { FakeMailbox } from '../mailbox/fake.js';
import { KIT_MAILBOX, kitMailbox } from '../mailbox/kit.test-support.js';
import { refreshGrant } from '../oauth.js';
import { google } from '../providers.js';
import { fakeFetch, sequence } from '../testing.js';
import calendarRecording from './fixtures/calendar-recording.json' with { type: 'json' };
import mailRecording from './fixtures/mail-recording.json' with { type: 'json' };
import { googleConnect, googleMailbox } from './google.js';
import { fakeGoogle } from './fake.js';
import { googleCalendarScenario, googleMailScenario, KIT_CLIENT, KIT_REDIRECT, kitGoogle } from './scenario.test-support.js';

providerKit(googleMailScenario, { recording: mailRecording as Recording, fake: kitGoogle() });
providerKit(googleCalendarScenario, { recording: calendarRecording as Recording, fake: kitGoogle() });

const GMAIL = 'https://gmail.googleapis.com/gmail/v1';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const reader = (fetchImpl: typeof fetch) => googleMailbox({ token: () => Promise.resolve(GOOD_KEY), fetch: fetchImpl });
const answering = (routes: Record<string, (() => Response)[]>) => fakeFetch(Object.entries(routes)
  .map(([url, responses]) => ({ url, respond: sequence(...responses) })));
const data = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

// A message as Gmail's users.messages resource documents `format=full`: headers as sent, the bodies base64url in their parts.
const documented = (id: string, labelIds: string[], headers: { name: string; value: string }[]) => ({ id, threadId: '18c2a', labelIds,
  snippet: 'Here it is', internalDate: '1762160400000', payload: { mimeType: 'multipart/mixed', headers, parts: [
    { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: data('Here it is.\n') } },
      { mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }], body: { data: data('<p>Here it is.</p>') } }] },
    { mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="notes.txt"' }], body: { data: data('secret') } }] } });
const headers = [{ name: 'From', value: '"Costa, Rui" <rui@northstar.test>' }, { name: 'To', value: 'Lee Park <lee@lumen.test>, ana@lumen.test' },
  { name: 'Cc', value: '=?UTF-8?B?Sm/Do28=?= <joao@northstar.test>, undisclosed-recipients:;' },
  { name: 'Subject', value: '=?UTF-8?Q?Order_form_=E2=80=94_signed?=' }, { name: 'Message-ID', value: '<CAF=abc@mail.gmail.com>' },
  { name: 'In-Reply-To', value: '<m1@lumen.test>' }, { name: 'List-Unsubscribe', value: '<https://northstar.test/u/lee>' },
  { name: 'Received', value: 'from mail.northstar.test' }];

test('reads a thread as Gmail documents it: bodies from their parts, names decoded, roles from labels, drafts left out', async () => {
  const fetchImpl = answering({ [`${GMAIL}/users/me/threads/18c2a`]: [() => Response.json({ id: '18c2a', messages: [
    documented('m1', ['INBOX', 'CATEGORY_UPDATES'], headers), documented('m2', ['SENT'], headers), documented('draft', ['DRAFT'], headers),
    documented('anonymous', ['INBOX'], headers.filter(header => header.name !== 'From'))] })] });
  const page = await reader(fetchImpl.fetch).thread('18c2a', {});
  expect(page.items[0]).toEqual({ id: 'm1', account_id: '', thread_id: '18c2a', message_id: '<CAF=abc@mail.gmail.com>', provider_id: 'm1',
    date: '2025-11-03T09:00:00.000Z', role: 'inbox', folders: ['INBOX', 'CATEGORY_UPDATES'], subject: 'Order form — signed',
    body_plain: 'Here it is.\n', body: '<p>Here it is.</p>', from_attendee: { display_name: 'Costa, Rui', identifier: 'rui@northstar.test' },
    to_attendees: [{ display_name: 'Lee Park', identifier: 'lee@lumen.test' }, { display_name: '', identifier: 'ana@lumen.test' }],
    cc_attendees: [{ display_name: 'João', identifier: 'joao@northstar.test' }], in_reply_to: { message_id: '<m1@lumen.test>' },
    headers: [{ name: 'list-unsubscribe', value: '' }] });
  expect(page.items.map(email => [email.id, email.role])).toEqual([['m1', 'inbox'], ['m2', 'sent']]);
  // A sender without an address cannot be read; a draft is simply not part of the thread.
  expect(page.skipped).toEqual(['anonymous']);
  expect(page.cursor).toBeNull();
});

test('lists mail after a time by its metadata, leaving out drafts, spam, trash and a message gone since the listing', async () => {
  const fake = fakeFetch(kitGoogle());
  const listed = await reader(fake.fetch).messages({ after: '2026-11-06T00:00:00Z', limit: 10 });
  expect(listed.items.map(email => [email.id, email.role, email.body])).toEqual([['msg-7', 'sent', ''], ['msg-6', 'inbox', '']]);
  const query = new URL(fake.calls[0]?.url ?? '');
  expect(query.searchParams.get('q')).toBe(`after:${String(Date.parse('2026-11-06T00:00:00Z') / 1000)} -in:drafts`);
  const detail = new URL(fake.calls[1]?.url ?? '');
  expect([detail.searchParams.get('format'), detail.searchParams.getAll('metadataHeaders')]).toEqual(['metadata',
    ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'In-Reply-To', 'References', 'List-Unsubscribe', 'List-Id', 'Auto-Submitted', 'Precedence']]);
  const gone = answering({ [`${GMAIL}/users/me/messages`]: [() => Response.json({ messages: [{ id: 'gone', threadId: 't' }] })],
    [`${GMAIL}/users/me/messages/gone`]: [() => Response.json({ error: { code: 404, status: 'NOT_FOUND', errors: [{ reason: 'notFound' }] } }, { status: 404 })] });
  await expect(reader(gone.fetch).messages({})).resolves.toEqual({ items: [], skipped: [], cursor: null });
});

test("reads Google's quota refusal as a rate limit, and a revoked grant as rejected", async () => {
  const quota = () => Response.json({ error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 });
  await expect(reader(answering({ [`${GMAIL}/users/me/profile`]: [quota] }).fetch).identify())
    .rejects.toMatchObject({ code: 'rate_limited', detail: 'userRateLimitExceeded' });
  const revoked = () => Response.json({ error: { code: 401, status: 'UNAUTHENTICATED', errors: [{ reason: 'authError' }] } }, { status: 401 });
  await expect(reader(answering({ [`${GMAIL}/users/me/profile`]: [revoked] }).fetch).identify())
    .rejects.toMatchObject({ code: 'rejected', detail: 'authError' });
});

test("reads events with their own offset, a Meet link, an all-day date and the member's decline", async () => {
  const event = { kind: 'calendar#event', status: 'confirmed', created: '2026-11-01T08:00:00.000Z', updated: '2026-11-02T08:00:00.000Z',
    summary: 'Renewal', iCalUID: 'uid-1@google.com', organizer: { email: 'rui@northstar.test', displayName: 'Rui Costa' },
    start: { dateTime: '2026-11-09T15:00:00+01:00', timeZone: 'Europe/Lisbon' }, end: { dateTime: '2026-11-09T15:30:00+01:00', timeZone: 'Europe/Lisbon' },
    attendees: [{ email: 'rui@northstar.test', organizer: true, responseStatus: 'accepted' },
      { email: 'lee@lumen.test', self: true, responseStatus: 'declined' }, { email: 'room@resource.calendar.google.com', resource: true, responseStatus: 'accepted' }],
    hangoutLink: 'https://meet.google.com/abc-defg-hij' };
  const fetchImpl = answering({ [`${CALENDAR}/calendars/lee%40lumen.test/events`]: [() => Response.json({ items: [{ ...event, id: 'e1' },
    { ...event, id: 'offsite', start: { date: '2026-11-10' }, end: { date: '2026-11-11' }, hangoutLink: undefined },
    { ...event, id: 'no-time', start: { dateTime: '2026-11-09T15:00:00' } }] })] });
  const page = await reader(fetchImpl.fetch).events('lee@lumen.test', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(page.items[0]).toMatchObject({ id: 'e1', start: { date_time: '2026-11-09T15:00:00+01:00', time_zone: 'Europe/Lisbon' },
    conference: { provider: 'google_meet', url: 'https://meet.google.com/abc-defg-hij' }, is_all_day: false });
  expect(page.items[0]?.attendees.map(attendee => [attendee.email, attendee.is_organizer, attendee.is_resource, attendee.response_status]))
    .toEqual([['rui@northstar.test', true, false, 'yes'], ['lee@lumen.test', false, false, 'no'], ['room@resource.calendar.google.com', false, true, 'yes']]);
  expect(page.items[1]).toMatchObject({ id: 'offsite', is_all_day: true, start: { date: '2026-11-10' }, conference: null });
  // A time without its offset is not read in any zone.
  expect(page.skipped).toEqual(['no-time']);
  const window = new URL(fetchImpl.calls[0]?.url ?? '').searchParams;
  expect([window.get('timeMin'), window.get('timeMax'), window.get('singleEvents'), window.get('orderBy')])
    .toEqual(['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z', 'true', 'startTime']);
});

test('signs a mailbox in with PKCE, keeps its refresh token, and revokes the grant once, then again harmlessly', async () => {
  const fake = fakeFetch(kitGoogle());
  const started = await startConnect(googleConnect, { clientId: KIT_CLIENT.clientId, redirectUri: KIT_REDIRECT, state: 'state-1' });
  if (started.kind !== 'redirect' || !started.codeVerifier) throw new Error('expected a PKCE redirect');
  expect(new URL(started.url).searchParams.get('access_type')).toBe('offline');
  const consent = await fake.fetch(started.url, { redirect: 'manual' });
  const code = new URL(consent.headers.get('location') ?? '').searchParams.get('code') ?? '';
  const connected = await finishConnect(googleConnect, { client: KIT_CLIENT, code, redirectUri: KIT_REDIRECT,
    codeVerifier: started.codeVerifier, fetch: fake.fetch, onRevokeFailed: () => undefined });
  expect(connected.account).toEqual({ id: KIT_MAILBOX, name: KIT_MAILBOX });
  const refresh = connected.secret.refreshToken ?? '';
  expect((await refreshGrant(google, KIT_CLIENT, refresh, { fetch: fake.fetch })).refreshToken).toBe(refresh);
  await googleConnect.revoke({ grant: connected.secret, client: KIT_CLIENT, fetch: fake.fetch });
  await expect(refreshGrant(google, KIT_CLIENT, refresh, { fetch: fake.fetch })).rejects.toBeInstanceOf(GrantRevoked);
  await expect(googleConnect.revoke({ grant: connected.secret, client: KIT_CLIENT, fetch: fake.fetch })).resolves.toBeUndefined();
});

test('refuses and revokes a grant a member left a scope unticked on, so a mailbox without its calendar never connects', async () => {
  const fake = fakeFetch(fakeGoogle({ client: KIT_CLIENT, redirectUri: KIT_REDIRECT, signIn: () => KIT_MAILBOX,
    mailboxes: address => (address === KIT_MAILBOX ? kitMailbox : null),
    granted: () => ['https://www.googleapis.com/auth/gmail.readonly'] }));
  const started = await startConnect(googleConnect, { clientId: KIT_CLIENT.clientId, redirectUri: KIT_REDIRECT, state: 'state-1' });
  if (started.kind !== 'redirect' || !started.codeVerifier) throw new Error('expected a PKCE redirect');
  const consent = await fake.fetch(started.url, { redirect: 'manual' });
  const code = new URL(consent.headers.get('location') ?? '').searchParams.get('code') ?? '';
  await expect(finishConnect(googleConnect, { client: KIT_CLIENT, code, redirectUri: KIT_REDIRECT, codeVerifier: started.codeVerifier,
    fetch: fake.fetch, onRevokeFailed: () => undefined })).rejects.toMatchObject({ code: 'rejected', detail: 'scope_missing' });
  expect(fake.calls.some(call => call.url === 'https://oauth2.googleapis.com/revoke')).toBe(true);
});

test("never reads an attachment's parts as the body, a text part inside an attached message included", async () => {
  const attached = { id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: '1762160400000', payload: { mimeType: 'multipart/mixed',
    headers: [{ name: 'From', value: 'rui@northstar.test' }], parts: [
      { mimeType: 'message/rfc822', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="forwarded.eml"' }], parts: [
        { mimeType: 'text/plain', body: { data: data('The forwarded secret.') } }] },
      // A file Gmail names, sent inline: its text is kept apart, as a large body's would be, and is never read.
      { mimeType: 'text/html', filename: 'invoice.html', headers: [{ name: 'Content-Disposition', value: 'inline' }],
        body: { attachmentId: 'file-1' } },
      { mimeType: 'text/plain', body: { data: data('The real body.') } }] } };
  const fetchImpl = answering({ [`${GMAIL}/users/me/threads/t1`]: [() => Response.json({ id: 't1', messages: [attached] })] });
  expect((await reader(fetchImpl.fetch).thread('t1', {})).items[0]).toMatchObject({ body_plain: 'The real body.', body: '' });
  expect(fetchImpl.calls).toHaveLength(1);
});

test('reads a body Gmail keeps apart as an attachment of its message, in a thread only', async () => {
  const long = `<p>${'The full order form. '.repeat(300)}</p>`;
  const [first, ...rest] = kitMailbox.emails;
  if (!first) throw new Error('the kit has mail');
  const mailbox: FakeMailbox = { ...kitMailbox, emails: [{ ...first, body: long }, ...rest] };
  const fake = fakeFetch(fakeGoogle({ client: KIT_CLIENT, redirectUri: KIT_REDIRECT, signIn: () => KIT_MAILBOX,
    mailboxes: address => (address === KIT_MAILBOX ? mailbox : null), tokens: { [GOOD_KEY]: KIT_MAILBOX } }));
  const page = await reader(fake.fetch).thread(first.thread_id ?? '', {});
  expect(page.items[0]).toMatchObject({ id: first.id, body_plain: first.body_plain, body: long });
  expect(fake.calls.map(call => new URL(call.url).pathname.replace('/gmail/v1', ''))).toEqual([`/users/me/threads/${first.thread_id ?? ''}`,
    `/users/me/messages/${first.id}/attachments/body`]);
  // A listing reads no body, so it fetches none.
  await reader(fake.fetch).messages({});
  expect(fake.calls.filter(call => call.url.includes('/attachments/'))).toHaveLength(1);
});

test('reads a private or confidential event as private, and a default, public or unmarked one as not', async () => {
  const [event] = kitMailbox.events;
  if (!event) throw new Error('the kit has events');
  const wire = (id: string, visibility?: string) => ({ id, status: 'confirmed', created: '2026-11-01T08:00:00.000Z',
    updated: '2026-11-02T08:00:00.000Z', summary: 'Call', start: { dateTime: '2026-11-09T15:00:00Z' },
    end: { dateTime: '2026-11-09T15:30:00Z' }, visibility });
  const fetchImpl = answering({ [`${CALENDAR}/calendars/lee%40lumen.test/events`]: [() => Response.json({ items: [wire('unmarked'),
    wire('default', 'default'), wire('public', 'public'), wire('private', 'private'), wire('confidential', 'confidential')] })] });
  const page = await reader(fetchImpl.fetch).events('lee@lumen.test', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(page.items.map(item => [item.id, item.visibility])).toEqual([['unmarked', 'public'], ['default', 'public'],
    ['public', 'public'], ['private', 'private'], ['confidential', 'private']]);
  // The fake answers a private event as Google does.
  const fake = fakeFetch(fakeGoogle({ client: KIT_CLIENT, redirectUri: KIT_REDIRECT, signIn: () => KIT_MAILBOX,
    mailboxes: address => (address === KIT_MAILBOX ? { ...kitMailbox, events: [{ ...event, visibility: 'private' }] } : null),
    tokens: { [GOOD_KEY]: KIT_MAILBOX } }));
  const faked = await reader(fake.fetch).events('calendar-lee', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(faked.items.map(item => item.visibility)).toEqual(['private']);
});

test('drops an attendee Google names no email for, and takes the calendar owner for an organizer it names none for', async () => {
  const base = { status: 'confirmed', created: '2026-11-01T08:00:00.000Z', updated: '2026-11-02T08:00:00.000Z', summary: 'Call',
    start: { dateTime: '2026-11-09T15:00:00Z' }, end: { dateTime: '2026-11-09T15:30:00Z' } };
  const fetchImpl = answering({
    [`${CALENDAR}/calendars/lee%40lumen.test/events`]: [() => Response.json({ items: [{ ...base, id: 'e1',
      attendees: [{ displayName: 'A room', responseStatus: 'accepted' }, { email: 'rui@northstar.test', responseStatus: 'accepted' }] }] })],
    [`${CALENDAR}/calendars/team-room/events`]: [() => Response.json({ items: [{ ...base, id: 'nobody' }] })] });
  const window = { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  const page = await reader(fetchImpl.fetch).events('lee@lumen.test', window);
  expect(page.items[0]).toMatchObject({ organizer: { email: 'lee@lumen.test', display_name: null },
    attendees: [{ email: 'rui@northstar.test', response_status: 'yes' }] });
  // A calendar whose id is no address names no owner to stand in: that event cannot be read.
  expect(await reader(fetchImpl.fetch).events('team-room', window)).toMatchObject({ items: [], skipped: ['nobody'] });
});
