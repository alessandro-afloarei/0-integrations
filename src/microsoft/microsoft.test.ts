import { expect, test } from 'vitest';
import { microsoft } from '../catalogue/microsoft.js';
import { finishConnect, startConnect } from '../connect.js';
import { GrantRevoked } from '../errors.js';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { refreshGrant } from '../oauth.js';
import { fakeFetch, sequence } from '../testing.js';
import calendarRecording from './fixtures/calendar-recording.json' with { type: 'json' };
import mailRecording from './fixtures/mail-recording.json' with { type: 'json' };
import { fakeMicrosoft, userId } from './fake.js';
import { graphMailbox } from './microsoft.js';
import type { FakeMailbox } from '../mailbox/fake.js';
import { KIT_MAILBOX, kitMailbox } from '../mailbox/kit.test-support.js';
import { graphCalendarScenario, graphMailScenario, KIT_CLIENT, KIT_REDIRECT, kitMicrosoft } from './scenario.test-support.js';

providerKit(graphMailScenario, { recording: mailRecording as Recording, fake: kitMicrosoft() });
providerKit(graphCalendarScenario, { recording: calendarRecording as Recording, fake: kitMicrosoft() });

const GRAPH = 'https://graph.microsoft.com/v1.0';
const reader = (fetchImpl: typeof fetch) => graphMailbox({ token: () => Promise.resolve(GOOD_KEY), fetch: fetchImpl });
const folder = (id: string) => () => Response.json({ id });
/** Graph answering a mailbox's folders, `/me`, and each path's bodies in turn. */
const graph = (routes: Record<string, unknown[]>) => fakeFetch([
  { url: `${GRAPH}/me/mailFolders/sentitems`, respond: folder('AAMk-sent') },
  { url: `${GRAPH}/me/mailFolders/deleteditems`, respond: folder('AAMk-deleted') },
  { url: `${GRAPH}/me/mailFolders/junkemail`, respond: folder('AAMk-junk') },
  { url: `${GRAPH}/me`, respond: () => Response.json({ id: '6a3f…-lee', mail: 'Lee@Lumen.test', userPrincipalName: 'lee@lumen.onmicrosoft.com' }) },
  ...Object.entries(routes).map(([path, bodies]) => ({ url: `${GRAPH}${path}`, respond: sequence(...bodies.map(body => () => Response.json(body))) })),
]);

// A message as Graph's message resource documents it, with the headers asked for by $select.
const documented = {
  id: 'AAMkAGI2THVSAAA=', conversationId: 'AAQkAGI2TG93AAA=', internetMessageId: '<BY2PR15MB0839@namprd15.prod.outlook.com>',
  receivedDateTime: '2026-11-03T09:00:00Z', subject: 'Order form', parentFolderId: 'AAMk-inbox',
  from: { emailAddress: { name: 'Rui Costa', address: 'rui@northstar.test' } },
  toRecipients: [{ emailAddress: { name: 'Lee Park', address: 'lee@lumen.test' } }, { emailAddress: { name: 'A group', address: null } }],
  ccRecipients: [], body: { contentType: 'html', content: '<html><body><p>Here it is.</p></body></html>' },
  internetMessageHeaders: [{ name: 'In-Reply-To', value: '<m1@lumen.test>' }, { name: 'References', value: '<m0@lumen.test> <m1@lumen.test>' },
    { name: 'List-Unsubscribe', value: '<https://northstar.test/u/lee>' }, { name: 'Received', value: 'from mail.northstar.test' }],
};

test('reads a message as Graph documents it: its role from its folder, its kept headers, a reply\'s parent', async () => {
  const fetchImpl = graph({ '/me/messages': [{ value: [documented, { ...documented, id: 'sent-1', parentFolderId: 'AAMk-sent' },
    { ...documented, id: 'junk-1', parentFolderId: 'AAMk-junk' }, { ...documented, id: 'no-sender', from: null }] }] });
  const page = await reader(fetchImpl.fetch).thread('AAQkAGI2TG93AAA=', {});
  expect(page.items[0]).toEqual({ id: 'AAMkAGI2THVSAAA=', account_id: '', thread_id: 'AAQkAGI2TG93AAA=',
    message_id: '<BY2PR15MB0839@namprd15.prod.outlook.com>', provider_id: 'AAMkAGI2THVSAAA=', date: '2026-11-03T09:00:00.000Z',
    role: 'inbox', folders: ['INBOX'], subject: 'Order form', body_plain: '', body: '<html><body><p>Here it is.</p></body></html>',
    from_attendee: { display_name: 'Rui Costa', identifier: 'rui@northstar.test' },
    to_attendees: [{ display_name: 'Lee Park', identifier: 'lee@lumen.test' }], cc_attendees: [],
    in_reply_to: { message_id: '<m1@lumen.test>' },
    headers: [{ name: 'references', value: '<m0@lumen.test> <m1@lumen.test>' }, { name: 'list-unsubscribe', value: '' }] });
  expect(page.items.slice(1).map(email => [email.id, email.role])).toEqual([['sent-1', 'sent'], ['junk-1', 'spam']]);
  // A sender without an address cannot be read.
  expect(page.skipped).toEqual(['no-sender']);
  const thread = new URL(fetchImpl.calls.find(call => call.url.includes('/me/messages'))?.url ?? '');
  expect(thread.searchParams.get('$filter')).toBe("conversationId eq 'AAQkAGI2TG93AAA=' and isDraft eq false");
  expect(thread.searchParams.get('$select')).toContain('internetMessageHeaders');
});

test('lists mail newest first after a time without drafts, and reads a conversation whole', async () => {
  const fake = fakeFetch(kitMicrosoft());
  const mail = reader(fake.fetch);
  const listed = await mail.messages({ after: '2026-11-06T00:00:00Z', limit: 10 });
  expect(listed.items.map(email => [email.id, email.role])).toEqual([['msg-9', 'trash'], ['msg-8', 'spam'], ['msg-7', 'sent'], ['msg-6', 'inbox']]);
  expect(listed.items.every(email => email.body === '')).toBe(true);
  expect((await mail.thread('conv-3', {})).items.map(email => [email.id, email.body])).toEqual([['msg-3', '<p>Message 3</p>']]);
  expect((await mail.thread('conv-10', {})).items).toEqual([]);
  await expect(mail.messages({ after: '2026-11-06' })).rejects.toThrow('date_invalid');
});

test("reads events in UTC with their offset, refuses another zone, and adds the member's own answer", async () => {
  const time = (dateTime: string, timeZone = 'UTC') => ({ dateTime, timeZone });
  const base = { createdDateTime: '2026-11-01T08:00:00Z', lastModifiedDateTime: '2026-11-02T08:00:00.1234567Z', subject: 'Renewal',
    isCancelled: false, isAllDay: false, start: time('2026-11-09T14:00:00.0000000'), end: time('2026-11-09T14:30:00.0000000'),
    organizer: { emailAddress: { name: 'Rui Costa', address: 'rui@northstar.test' } }, responseStatus: { response: 'declined' },
    attendees: [{ type: 'required', status: { response: 'accepted' }, emailAddress: { name: 'Rui Costa', address: 'rui@northstar.test' } },
      { type: 'resource', status: { response: 'accepted' }, emailAddress: { name: 'Room 2', address: 'room2@lumen.test' } }],
    onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' }, onlineMeetingProvider: 'teamsForBusiness',
    sensitivity: 'normal' };
  const fetchImpl = graph({ '/me/calendars/cal-1/calendarView': [{ value: [{ ...base, id: 'e1', iCalUId: 'uid-1' },
    { ...base, id: 'local', start: time('2026-11-09T14:00:00.0000000', 'Pacific Standard Time') },
    { ...base, id: 'offsite', isAllDay: true, start: time('2026-11-10T00:00:00.0000000'), end: time('2026-11-11T00:00:00.0000000') }] }] });
  const page = await reader(fetchImpl.fetch).events('cal-1', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(page.items[0]).toMatchObject({ id: 'e1', ical_uid: 'uid-1', start: { date_time: '2026-11-09T14:00:00.000Z', time_zone: 'UTC' },
    updated_at: '2026-11-02T08:00:00.123Z', conference: { provider: 'teams', url: 'https://teams.microsoft.com/l/meetup-join/abc' },
    organizer: { email: 'rui@northstar.test', display_name: 'Rui Costa' } });
  expect(page.items[0]?.attendees.map(attendee => [attendee.email, attendee.is_organizer, attendee.is_resource, attendee.response_status]))
    .toEqual([['rui@northstar.test', true, false, 'yes'], ['room2@lumen.test', false, true, 'yes'], ['lee@lumen.test', false, false, 'no']]);
  expect(page.items[1]).toMatchObject({ id: 'offsite', is_all_day: true, start: { date: '2026-11-10' }, end: { date: '2026-11-11' } });
  expect(page.skipped).toEqual(['local']);
  const view = new URL(fetchImpl.calls.find(call => call.url.includes('calendarView'))?.url ?? '');
  expect([view.searchParams.get('startDateTime'), view.searchParams.get('endDateTime')]).toEqual(['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
  expect(fetchImpl.calls[0]?.headers.prefer).toBe('outlook.timezone="UTC"');
});

test("follows a next page only on Graph and under the member's own /me, in whatever form Graph names it", async () => {
  const foreign = graph({ '/me/messages': [{ value: [], '@odata.nextLink': 'https://graph.example/v1.0/me/messages?$skip=2' }] });
  await expect(reader(foreign.fetch).messages({})).rejects.toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
  const another = graph({ '/me/messages': [{ value: [], '@odata.nextLink': `${GRAPH}/users/someone/messages?$skip=2` }] });
  await expect(reader(another.fetch).messages({})).rejects.toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
  await expect(reader(foreign.fetch).messages({ cursor: '/users/someone/messages?$skip=2' })).rejects.toThrow('cursor_invalid');
  const keyed = graph({ "/me/calendars('cal-1')/calendarView": [{ value: [] }],
    '/me/calendars/cal-1/calendarView': [{ value: [], '@odata.nextLink': `${GRAPH}/me/calendars('cal-1')/calendarView?$skip=2` }] });
  const first = await reader(keyed.fetch).events('cal-1', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(first.cursor).toBe("/me/calendars('cal-1')/calendarView?$skip=2");
  await expect(reader(keyed.fetch).events('cal-1', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', cursor: first.cursor ?? '' }))
    .resolves.toMatchObject({ items: [], cursor: null });
});

test('signs a mailbox in with PKCE, keys it by its immutable user id, and rotates its refresh token', async () => {
  const fake = fakeFetch(kitMicrosoft());
  const started = await startConnect(microsoft, { clientId: KIT_CLIENT.clientId, redirectUri: KIT_REDIRECT, state: 'state-1' });
  if (!started.codeVerifier) throw new Error('expected a PKCE verifier');
  const consent = await fake.fetch(started.url, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location') ?? '');
  expect(back.searchParams.get('state')).toBe('state-1');
  const connected = await finishConnect(microsoft, { client: KIT_CLIENT, code: back.searchParams.get('code') ?? '',
    redirectUri: KIT_REDIRECT, codeVerifier: started.codeVerifier, fetch: fake.fetch, onRevokeFailed: () => undefined });
  // The account is the user's immutable id: a tenant's admin can set any address as `mail` (nOAuth).
  expect(connected.account).toEqual({ id: userId(KIT_MAILBOX), name: KIT_MAILBOX });
  expect(connected.values).toEqual({});
  const first = connected.secret.refreshToken ?? '';
  const renewed = await refreshGrant(microsoft, KIT_CLIENT, first, { fetch: fake.fetch });
  expect(renewed.refreshToken).not.toBe(first);
  await expect(refreshGrant(microsoft, KIT_CLIENT, first, { fetch: fake.fetch })).rejects.toBeInstanceOf(GrantRevoked);
  // The same code twice, or one without its verifier, is refused.
  await expect(finishConnect(microsoft, { client: KIT_CLIENT, code: back.searchParams.get('code') ?? '', redirectUri: KIT_REDIRECT,
    codeVerifier: started.codeVerifier, fetch: fake.fetch, onRevokeFailed: () => undefined })).rejects.toBeInstanceOf(GrantRevoked);
});

test('refuses a mailbox whose user has no address at its first read', async () => {
  const me = fakeFetch([{ url: `${GRAPH}/me`, respond: () => Response.json({ id: 'user-1', mail: null, userPrincipalName: null }) }]);
  await expect(reader(me.fetch).identify()).rejects.toMatchObject({ code: 'invalid_response', detail: 'no_mailbox' });
});

test("reads every sensitivity label but normal as private, personal included, and skips an event that names none", async () => {
  const [event] = kitMailbox.events;
  if (!event) throw new Error('the kit has events');
  const wire = (id: string, sensitivity?: string) => ({ id, createdDateTime: '2026-11-01T08:00:00Z', lastModifiedDateTime: '2026-11-02T08:00:00Z',
    subject: 'Call', isCancelled: false, isAllDay: false, start: { dateTime: '2026-11-09T14:00:00', timeZone: 'UTC' },
    end: { dateTime: '2026-11-09T14:30:00', timeZone: 'UTC' }, organizer: { emailAddress: { name: 'Lee Park', address: KIT_MAILBOX } },
    sensitivity });
  const fetchImpl = graph({ '/me/calendars/cal-1/calendarView': [{ value: [wire('normal', 'normal'), wire('personal', 'personal'),
    wire('private', 'private'), wire('confidential', 'confidential'), wire('none')] }] });
  const page = await reader(fetchImpl.fetch).events('cal-1', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(page.items.map(item => [item.id, item.visibility])).toEqual([['normal', 'public'], ['personal', 'private'],
    ['private', 'private'], ['confidential', 'private']]);
  expect(page.skipped).toEqual(['none']);
  // The fake answers a private event as Outlook does.
  const fake = fakeFetch(fakeMicrosoft({ client: KIT_CLIENT, redirectUri: KIT_REDIRECT, signIn: () => KIT_MAILBOX,
    mailboxes: address => (address === KIT_MAILBOX ? { ...kitMailbox, events: [{ ...event, visibility: 'private' }] } : null),
    tokens: { [GOOD_KEY]: KIT_MAILBOX } }));
  const faked = await reader(fake.fetch).events('calendar-lee', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(faked.items.map(item => item.visibility)).toEqual(['private']);
});

test('reads a calendar view without $select, as Graph answers created and modified times only then', async () => {
  const fake = fakeFetch(kitMicrosoft());
  const mailbox = reader(fake.fetch);
  const page = await mailbox.events('calendar-lee', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(page.items.length).toBeGreaterThan(0);
  expect(page.skipped).toEqual([]);
  expect(new URL(fake.calls.find(call => call.url.includes('calendarView'))?.url ?? '').searchParams.has('$select')).toBe(false);
  // The fake holds the rule: asking for them by $select is refused.
  const selected = await fake.fetch(`${GRAPH}/me/calendars/calendar-lee/calendarView?startDateTime=2026-11-01T00:00:00Z&endDateTime=2026-12-01T00:00:00Z&$select=id,createdDateTime`,
    { headers: { authorization: `Bearer ${GOOD_KEY}` } });
  expect(selected.status).toBe(400);
});

test("reads an all-day event's own date east of UTC, where Graph answers its midnight on the day before", async () => {
  const [event] = kitMailbox.events;
  if (!event) throw new Error('the kit has events');
  const rome: FakeMailbox = { ...kitMailbox, utcOffsetMinutes: 60,
    events: [{ ...event, is_all_day: true, start: { date: '2026-11-09' }, end: { date: '2026-11-10' } }] };
  const fake = fakeFetch(fakeMicrosoft({ client: KIT_CLIENT, redirectUri: KIT_REDIRECT, signIn: () => KIT_MAILBOX,
    mailboxes: address => (address === KIT_MAILBOX ? rome : null), tokens: { [GOOD_KEY]: KIT_MAILBOX } }));
  const page = await reader(fake.fetch).events('calendar-lee', { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
  expect(page.items.map(item => [item.start, item.end])).toEqual([[{ date: '2026-11-09' }, { date: '2026-11-10' }]]);
});

test('reads the path a cursor or next page resolves to, so dot segments cannot leave /me', async () => {
  const dotted = graph({ '/me/messages': [{ value: [], '@odata.nextLink': `${GRAPH}/me/%2e%2e/users/someone/messages?$skip=2` }] });
  await expect(reader(dotted.fetch).messages({})).rejects.toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
  await expect(reader(dotted.fetch).messages({ cursor: '/me/../users/someone/messages?$skip=2' })).rejects.toThrow('cursor_invalid');
});

test('takes no Exchange (X500) name for an address: a recipient named so is dropped, a sender makes the message unreadable', async () => {
  const x500 = { emailAddress: { name: 'Lee Park', address: '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS/CN=LEE' } };
  const fetchImpl = graph({ '/me/messages': [{ value: [{ ...documented, toRecipients: [x500, ...documented.toRecipients] },
    { ...documented, id: 'from-x500', from: x500 }] }] });
  const page = await reader(fetchImpl.fetch).thread('AAQkAGI2TG93AAA=', {});
  expect(page.items[0]?.to_attendees).toEqual([{ display_name: 'Lee Park', identifier: 'lee@lumen.test' }]);
  expect(page.skipped).toEqual(['from-x500']);
});
