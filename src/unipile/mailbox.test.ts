import { expect, test } from 'vitest';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { paginate } from '../paginate.js';
import { fakeFetch, sequence } from '../testing.js';
import { fakeUnipile } from './fake.js';
import calendarRecording from './fixtures/calendar-recording.json' with { type: 'json' };
import mailRecording from './fixtures/mail-recording.json' with { type: 'json' };
import { KIT_ACCOUNT, unipileCalendarScenario, unipileMailScenario } from './scenario.test-support.js';
import { unipileClient, unipileMailbox, type UnipileCalendar, type UnipileEmail, type UnipileEvent } from './unipile.js';

const API = 'https://api.unipile.com/v2';
const ON = `${API}/${KIT_ACCOUNT}`;
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
const ana = { display_name: 'Ana Reis', identifier: 'ana@lumen.test' };
const lee = { display_name: 'Lee Park', identifier: 'lee@lumen.test' };
const email = (n: number): UnipileEmail => ({ id: `mail-${String(n)}`, account_id: KIT_ACCOUNT, thread_id: `thread-${String(n)}`,
  message_id: `<m${String(n)}@lumen.test>`, provider_id: `mail-${String(n)}`, date: `${day(n)}T09:00:00.000Z`, role: 'inbox',
  folders: ['INBOX'], subject: `Lumen ${String(n)}`, body_plain: 'Hello', body: '<p>Hello</p>', from_attendee: ana, to_attendees: [lee],
  cc_attendees: [], in_reply_to: null, headers: [{ name: 'list-id', value: 'Lumen news <news.lumen.test>' }] });
const calendars: UnipileCalendar[] = [{ id: 'lee@lumen.test', name: 'Lee Park', is_primary: true, is_owned_by_user: true },
  { id: 'holidays', name: 'Holidays', is_primary: false, is_owned_by_user: false }];
const event = (n: number): UnipileEvent => ({ id: `event-${String(n)}`, ical_uid: `event-${String(n)}@google.com`,
  master_event_id: null, calendar_id: 'lee@lumen.test', created_at: `${day(1)}T08:00:00.000Z`, updated_at: `${day(n)}T08:00:00.000Z`,
  title: `Call ${String(n)}`, body: '', location: '', is_cancelled: false, is_all_day: false,
  start: { date_time: `${day(n)}T10:00:00.000Z`, time_zone: 'UTC' }, end: { date_time: `${day(n)}T10:30:00.000Z`, time_zone: 'UTC' },
  attendees: [], organizer: { email: 'lee@lumen.test', display_name: 'Lee Park' }, conference: null, event_type: 'default',
  transparency: 'opaque', visibility: 'public' });
const six = [1, 2, 3, 4, 5, 6];
const mailbox = { emails: [...six.map(email), { ...email(7), role: 'drafts', folders: ['DRAFT'] }], calendars,
  events: [...six.map(event), { ...event(7), calendar_id: 'holidays' }] };
const fake = () => fakeUnipile({ apiKey: GOOD_KEY,
  accounts: id => (id === KIT_ACCOUNT ? { createdAt: `${day(1)}T08:00:00.000Z`, provider: 'google', email: 'lee@lumen.test' } : null),
  company: { id: '1', name: 'Lumen', tagline: '', description: '', industry: [], headcount: null, city: null, profileUrl: '' }, posts: [],
  mailboxes: id => (id === KIT_ACCOUNT ? mailbox : null) });

providerKit(unipileMailScenario, { recording: mailRecording as Recording, fake: fake() });
providerKit(unipileCalendarScenario, { recording: calendarRecording as Recording, fake: fake() });

const client = (fetchImpl: typeof fetch) => unipileClient({ apiKey: GOOD_KEY, fetch: fetchImpl });
const NO_FOLDERS = { url: `${ON}/folders`, respond: () => Response.json({ data: [] }) };
const answering = (path: string, ...bodies: unknown[]) =>
  fakeFetch([{ url: `${ON}${path}`, respond: sequence(...bodies.map(body => () => Response.json(body))) }, NO_FOLDERS]);
const recorded = (recording: unknown, path: string) => (recording as Recording).exchanges
  .find(exchange => exchange.key === 'good' && new URL(exchange.url).pathname.endsWith(path))?.response as { data: Record<string, unknown>[] };
const wireEmail = recorded(mailRecording, '/emails').data[0] ?? {};
const [meeting = {}] = recorded(calendarRecording, '/events').data;

test('asks for mail by the account in the path, its metadata alone when asked, the dates as Unipile takes them', async () => {
  const unipile = fakeFetch(fake());
  await client(unipile.fetch).emails(KIT_ACCOUNT, {});
  const first = await client(unipile.fetch).emails(KIT_ACCOUNT, { after: '2026-11-01T00:00:00Z', metaOnly: true, limit: 2 });
  expect(first.cursor).toBeTruthy();
  // The next page names its cursor alone: Unipile's cursor holds the filters, and refuses them beside it.
  const next = await client(unipile.fetch).emails(KIT_ACCOUNT, { after: '2026-11-01T00:00:00Z', metaOnly: true,
    cursor: first.cursor ?? '', limit: 2 });
  expect(next.items.map(item => [item.id, item.body])).toEqual([['mail-5', ''], ['mail-4', '']]);
  expect(unipile.calls.map(call => call.url).filter(url => !url.includes('/folders'))).toEqual([`${ON}/emails?limit=100`,
    `${ON}/emails?limit=2&meta_only=true&after=2026-11-01T00%3A00%3A00.000Z`, `${ON}/emails?limit=2&cursor=${first.cursor ?? ''}`]);
  expect(unipile.calls[0]?.headers['x-api-key']).toBe(GOOD_KEY);
});

test('reads metadata alone with empty bodies, and the headers either way', async () => {
  const unipile = client(fakeFetch(fake()).fetch);
  expect((await unipile.emails(KIT_ACCOUNT, { metaOnly: true })).items[0])
    .toMatchObject({ id: 'mail-7', subject: 'Lumen 7', from_attendee: ana, body_plain: '', body: '', headers: email(6).headers });
  expect((await unipile.emails(KIT_ACCOUNT, {})).items[1]).toMatchObject({ body: '<p>Hello</p>', headers: email(6).headers });
});

test('keeps the headers an app filters on, lowercased, the recipients that are e-mail addresses, and the reply it answers', async () => {
  const headers = [{ name: 'Received', value: 'from mx (203.0.113.7)' }, { name: 'List-Unsubscribe', value: '<https://x.test/u>' },
    { name: 'X-Mailer', value: 'x' }, { name: 'REFERENCES', value: '<a@x.test>' }, { name: 'Precedence', value: 'bulk' },
    { name: 'Auto-Submitted', value: 'auto-replied' }, { name: 'List-Id', value: 'x <x.test>' }, { name: 'In-Reply-To', value: ' <a@x.test> ' }];
  const cc = [{ display_name: 'Lee', email: 'lee@lumen.test' }, { email: 'ACoAAA8BYqEB' }];
  const page = await client(answering('/emails', { data: [{ ...wireEmail, headers, cc }] }).fetch).emails(KIT_ACCOUNT, {});
  expect(page.items[0]?.headers).toEqual([{ name: 'list-unsubscribe', value: '' },
    { name: 'references', value: '<a@x.test>' }, { name: 'precedence', value: 'bulk' }, { name: 'auto-submitted', value: 'auto-replied' },
    { name: 'list-id', value: 'x <x.test>' }]);
  expect(page.items[0]?.cc_attendees).toEqual([{ display_name: 'Lee', identifier: 'lee@lumen.test' }]);
  expect(page.items[0]?.in_reply_to).toEqual({ message_id: '<a@x.test>' });
  expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(['account_id', 'body', 'body_plain', 'cc_attendees', 'date', 'folders',
    'from_attendee', 'headers', 'id', 'in_reply_to', 'message_id', 'provider_id', 'role', 'subject', 'thread_id', 'to_attendees']);
  expect(page.items[0]).toMatchObject({ id: wireEmail.id, provider_id: wireEmail.id, account_id: KIT_ACCOUNT });
});

test('skips an e-mail it cannot read: no sender, or a sender that is not an e-mail address', async () => {
  const unsent = { ...wireEmail, id: 'no-sender', from: [] };
  const phone = { ...wireEmail, id: 'sms-1', from: [{ email: '+33600000000' }] };
  const page = await client(answering('/emails', { data: [wireEmail, unsent, phone], next_cursor: 'next' }).fetch).emails(KIT_ACCOUNT, {});
  expect(page).toMatchObject({ items: [{ id: wireEmail.id }], skipped: ['no-sender', 'sms-1'], cursor: 'next' });
});

test("says where a message sits by its folders' roles, read once per account and again after a failure", async () => {
  const folders = [{ id: 'AAMk-drafts', role: 'DRAFTS' }, { id: 'AAMk-sent', role: 'SENT' }, { id: 'AAMk-junk', role: 'SPAM' },
    { id: 'AAMk-bin', role: 'TRASH' }, { id: 'AAMk-in', role: 'INBOX' }, { id: 'AAMk-mine', role: null }];
  const list = { data: ['AAMk-drafts', 'AAMk-sent', 'AAMk-junk', 'AAMk-bin', 'AAMk-in', 'AAMk-mine'].map(folder => ({ ...wireEmail,
    id: folder, folders: [folder] })) };
  const unipile = fakeFetch([{ url: `${ON}/emails`, respond: () => Response.json(list) },
    { url: `${ON}/folders`, respond: sequence(() => new Response(null, { status: 503 }), () => Response.json({ data: folders })) }]);
  const reader = client(unipile.fetch);
  await expect(reader.emails(KIT_ACCOUNT, {})).rejects.toMatchObject({ code: 'unavailable' });
  for (let read = 0; read < 2; read++) {
    expect((await reader.emails(KIT_ACCOUNT, {})).items.map(item => [item.id, item.role])).toEqual([['AAMk-drafts', 'drafts'],
      ['AAMk-sent', 'sent'], ['AAMk-junk', 'spam'], ['AAMk-bin', 'trash'], ['AAMk-in', 'inbox'], ['AAMk-mine', 'inbox']]);
  }
  expect(unipile.calls.filter(call => call.url.includes('/folders'))).toHaveLength(3);
});

test('reads a thread whole by its own route, and a thread gone as not found', async () => {
  const unipile = fakeFetch(fake());
  const thread = await client(unipile.fetch).thread(KIT_ACCOUNT, 'thread-3');
  expect(thread).toMatchObject({ items: [{ id: 'mail-3', body: '<p>Hello</p>' }], skipped: [], cursor: null });
  expect(unipile.calls.map(call => call.url)).toContain(`${ON}/threads/thread-3`);
  await expect(client(unipile.fetch).thread(KIT_ACCOUNT, 'thread-0')).rejects.toMatchObject({ code: 'not_found' });
});

test('reads events as Unipile sends them: empty ids and names as null, an all-day date, missing fields as empty', async () => {
  const bare = { id: 'e1', calendar_id: 'c', created_at: `${day(1)}T08:00:00Z`, updated_at: `${day(2)}T08:00:00.000Z`, title: 'Busy',
    is_cancelled: false, is_all_day: false, is_attendees_list_hidden: false,
    start: { type: 'datetime', date_time: `${day(3)}T10:00:00+01:00`, timezone: 'Europe/Paris' },
    end: { type: 'datetime', date_time: `${day(3)}T11:00:00+01:00` }, organizer: { email: 'lee@lumen.test' }, event_type: 'default',
    transparency: 'opaque', visibility: 'public', master_event_id: '' };
  const offsite = { ...meeting, id: 'offsite', is_all_day: true, start: { type: 'date', date: day(4) }, end: { type: 'date', date: day(5) } };
  const page = await client(answering('/calendars/c/events', { data: [meeting, offsite, bare] }).fetch).events(KIT_ACCOUNT, 'c', {});
  expect(page.items[0]).toMatchObject({ ical_uid: meeting.ical_uid, master_event_id: null, location: 'Meets',
    organizer: { email: 'lee@acme.example', display_name: 'Lee Park' }, start: { date_time: '2026-11-02T14:30:00+01:00',
      time_zone: 'Europe/Paris' }, conference: { provider: 'google_meet', url: 'https://meet.google.com/abc-defg-hij' } });
  expect(page.items[1]).toMatchObject({ is_all_day: true, start: { date: day(4) }, end: { date: day(5) } });
  expect(page.items[2]).toEqual({ ...bare, is_attendees_list_hidden: undefined, ical_uid: null, master_event_id: null, body: '',
    location: '', attendees: [], organizer: { email: 'lee@lumen.test', display_name: null }, conference: null,
    start: { date_time: `${day(3)}T10:00:00+01:00`, time_zone: 'Europe/Paris' }, end: { date_time: `${day(3)}T11:00:00+01:00`,
      time_zone: 'UTC' } });
});

test('reads a time without an offset in its zone, or the event\'s, across a change of offset; one in no zone it knows is skipped', async () => {
  const at = (date_time: string, timezone?: string) => ({ type: 'datetime', date_time, ...(timezone ? { timezone } : {}) });
  const entries = [{ ...meeting, id: 'paris-winter', start: at('2026-11-10T14:30:00', 'Europe/Paris'), end: at('2026-11-10T15:00:00') },
    { ...meeting, id: 'new-york-summer', timezone: 'America/New_York', start: at('2026-07-01T09:00:00'), end: at('2026-07-01T09:30:00.000') },
    { ...meeting, id: 'after-the-change', start: at('2026-03-29T03:30:00', 'Europe/Paris'), end: at('2026-03-29T04:00:00', 'Europe/Paris') },
    { ...meeting, id: 'nowhere', start: at('2026-11-10T14:30:00', 'Mars/Olympus'), end: at('2026-11-10T15:00:00', 'Mars/Olympus') },
    { ...meeting, id: 'garbled', start: at('soon', 'Europe/Paris') }];
  const page = await client(answering('/calendars/c/events', { data: entries }).fetch).events(KIT_ACCOUNT, 'c', {});
  expect(page.items.map(item => [item.id, item.start, item.end])).toEqual([
    ['paris-winter', { date_time: '2026-11-10T13:30:00.000Z', time_zone: 'Europe/Paris' },
      { date_time: '2026-11-10T14:00:00.000Z', time_zone: 'Europe/Paris' }],
    ['new-york-summer', { date_time: '2026-07-01T13:00:00.000Z', time_zone: 'America/New_York' },
      { date_time: '2026-07-01T13:30:00.000Z', time_zone: 'America/New_York' }],
    ['after-the-change', { date_time: '2026-03-29T01:30:00.000Z', time_zone: 'Europe/Paris' },
      { date_time: '2026-03-29T02:00:00.000Z', time_zone: 'Europe/Paris' }]]);
  expect(page.skipped).toEqual(['nowhere', 'garbled']);
});

test('says whether the owner marked an event private, and skips one that does not say', async () => {
  const open = { ...meeting, id: 'open', visibility: 'public' };
  const hidden = { ...meeting, id: 'hidden', visibility: 'private' };
  // JSON drops an undefined key: the event comes without the field.
  const silent = { ...meeting, id: 'silent', visibility: undefined };
  const page = await client(answering('/calendars/c/events', { data: [hidden, open, silent] }).fetch).events(KIT_ACCOUNT, 'c', {});
  expect(page.items.map(item => [item.id, item.visibility])).toEqual([['hidden', 'private'], ['open', 'public']]);
  expect(page.skipped).toEqual(['silent']);
});

test('asks for every instance of a series, the window and the update time, by calendar', async () => {
  const unipile = fakeFetch(fake());
  expect((await client(unipile.fetch).calendars(KIT_ACCOUNT)).map(calendar => calendar.id)).toEqual(['lee@lumen.test', 'holidays']);
  const first = await client(unipile.fetch).events(KIT_ACCOUNT, 'lee@lumen.test', { start: `${day(2)}T10:00:00Z`,
    end: `${day(5)}T10:30:00Z`, updatedAfter: `${day(1)}T00:00:00Z`, limit: 2 });
  expect(first.cursor).toMatch(/^cursor:/u);
  // The next page names its cursor alone, whatever filters its caller passes again: the cursor holds them.
  const next = await client(unipile.fetch).events(KIT_ACCOUNT, 'lee@lumen.test', { start: `${day(2)}T10:00:00Z`,
    end: `${day(5)}T10:30:00Z`, updatedAfter: `${day(1)}T00:00:00Z`, cursor: first.cursor ?? '' });
  expect(first.items.map(item => item.id)).toEqual(['event-2', 'event-3']);
  expect(next.items.map(item => item.id)).toEqual(['event-4', 'event-5']);
  expect(unipile.calls.map(call => call.url)).toEqual([`${ON}/calendars?limit=100`,
    // One page without a cursor or a total: one more ask, by offset, finds it was the whole list.
    `${ON}/calendars?limit=100&offset=2`,
    `${ON}/calendars/lee%40lumen.test/events?expand_recurring=true&start=2026-11-02T10%3A00%3A00.000Z`
      + '&end=2026-11-05T10%3A30%3A00.000Z&updated_after=2026-11-01T00%3A00%3A00.000Z&limit=2',
    `${ON}/calendars/lee%40lumen.test/events?limit=100&cursor=${first.cursor?.slice('cursor:'.length) ?? ''}`]);
});

test('the fake refuses a cursor sent beside a filter, or on a list that never gave it, as Unipile V2 does (live, 2026-11-24)', async () => {
  const unipile = fakeFetch(fake());
  const status = async (path: string, query: string) =>
    (await unipile.fetch(`${ON}${path}?${query}`, { headers: { 'x-api-key': GOOD_KEY } })).status;
  const events = '/calendars/lee%40lumen.test/events';
  const eventsCursor = (await client(unipile.fetch).events(KIT_ACCOUNT, 'lee@lumen.test', { limit: 2 })).cursor?.slice('cursor:'.length) ?? '';
  const mailCursor = (await client(unipile.fetch).emails(KIT_ACCOUNT, { limit: 2 })).cursor ?? '';
  expect([eventsCursor, mailCursor].every(Boolean)).toBe(true);
  expect(await status(events, `limit=2&cursor=${eventsCursor}`)).toBe(200);
  expect(await status(events, `expand_recurring=true&limit=2&cursor=${eventsCursor}`)).toBe(400);
  expect(await status('/emails', `limit=2&cursor=${mailCursor}`)).toBe(200);
  expect(await status('/emails', `after=2026-11-01T00%3A00%3A00.000Z&limit=2&cursor=${mailCursor}`)).toBe(400);
  expect(await status('/emails', `meta_only=true&limit=2&cursor=${mailCursor}`)).toBe(200);
  expect(await status(events, `limit=2&cursor=${mailCursor}`)).toBe(400);
  expect(await status('/emails', 'limit=2&cursor=never-given')).toBe(400);
});

test('pages by offset while the total says more remain, past a page shorter than asked, to the total', async () => {
  const wire = (n: number) => ({ ...meeting, id: `event-${String(n)}` });
  // A provider capping its pages below the limit: two events a page, though five were asked.
  const pages: Record<string, unknown[]> = { 0: [wire(1), wire(2)], 2: [wire(3)] };
  const offsets = fakeFetch([{ url: `${ON}/calendars/c/events`, respond: request =>
    Response.json({ data: pages[new URL(request.url).searchParams.get('offset') ?? '0'] ?? [], total_count: 3 }) }]);
  const read: string[] = [];
  for await (const page of paginate(cursor => client(offsets.fetch).events(KIT_ACCOUNT, 'c', { cursor, limit: 5 }))) {
    read.push(...page.items.map(item => item.id));
  }
  expect(read).toEqual(['event-1', 'event-2', 'event-3']);
  expect(offsets.calls.map(call => new URL(call.url).searchParams.get('offset'))).toEqual([null, '2']);
});

test('ends where an offset is refused as a bad request, as Outlook pages by cursor and gives none on its last page', async () => {
  const outlook = (path: string, data: unknown[]) => ({ url: `${ON}${path}`, respond: (request: Request) =>
    (new URL(request.url).searchParams.has('offset')
      ? Response.json({ object: 'Error', type: 'provider/invalid_parameters', status: 400 }, { status: 400 }) : Response.json({ data })) });
  const unipile = fakeFetch([{ url: `${ON}/emails`, respond: () => Response.json({ data: [{ ...wireEmail, folders: ['AAMk-junk'] }] }) },
    outlook('/folders', [{ id: 'AAMk-junk', role: 'SPAM' }]), outlook('/calendars', [{ id: 'a', name: 'A', is_owned_by_user: true }])]);
  expect((await client(unipile.fetch).emails(KIT_ACCOUNT, {})).items.map(item => item.role)).toEqual(['spam']);
  expect(await client(unipile.fetch).calendars(KIT_ACCOUNT)).toHaveLength(1);
  // A first page refused is no list: the error stands.
  const failing = fakeFetch([{ url: `${ON}/calendars/c/events`, respond: () => Response.json({ status: 400 }, { status: 400 }) }]);
  await expect(client(failing.fetch).events(KIT_ACCOUNT, 'c', {})).rejects.toMatchObject({ code: 'request_failed', status: 400 });
});

test('with no total, pages by offset after any non-empty page, past a page shorter than asked, to an empty one', async () => {
  // A provider capping its pages below the limit: two events a page, though five were asked.
  const pages: Record<string, unknown[]> = { 0: [meeting, { ...meeting, id: 'second' }], 2: [{ ...meeting, id: 'third' }] };
  const offsets = fakeFetch([{ url: `${ON}/calendars/c/events`, respond: request =>
    Response.json({ data: pages[new URL(request.url).searchParams.get('offset') ?? '0'] ?? [] }) }]);
  const read: string[] = [];
  for await (const page of paginate(cursor => client(offsets.fetch).events(KIT_ACCOUNT, 'c', { cursor, limit: 5 }))) {
    read.push(...page.items.map(item => item.id));
  }
  expect(read).toEqual([meeting.id, 'second', 'third']);
  expect(offsets.calls.map(call => new URL(call.url).searchParams.get('offset'))).toEqual([null, '2', '3']);
});

test('ends where a provider paging by cursor answers the offset with its first page again, even one nothing in which parses', async () => {
  for (const first of [[meeting, { ...meeting, id: 'other' }], [{ id: 'unreadable-1' }, { id: 'unreadable-2' }]]) {
    const ignoring = answering('/calendars/c/events', { data: first, total_count: 10 }, { data: first, total_count: 10 });
    const pages = [];
    for await (const page of paginate(cursor => client(ignoring.fetch).events(KIT_ACCOUNT, 'c', { cursor, limit: 2 }))) pages.push(page);
    expect(pages.at(-1)).toEqual({ items: [], skipped: [], cursor: null });
    expect(ignoring.calls).toHaveLength(2);
  }
});

test('refuses a cursor that repeats or is not its own', async () => {
  const stuck = answering('/calendars/c/events', { data: [meeting], next_cursor: 'same' });
  const reading = (async () => {
    const read = [];
    for await (const page of paginate(cursor => client(stuck.fetch).events(KIT_ACCOUNT, 'c', { cursor }))) read.push(page);
    return read;
  })();
  await expect(reading).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_repeated' });
  await expect(client(stuck.fetch).events(KIT_ACCOUNT, 'c', { cursor: 'same' })).rejects.toThrow('cursor_invalid');
});

test('reads every page of calendars, the default one as primary', async () => {
  const pages = answering('/calendars', { data: [{ id: 'a', name: 'A', is_owned_by_user: true }], next_cursor: 'n' },
    { data: [{ id: 'b', name: 'B', is_default: true, is_owned_by_user: true }] });
  expect(await client(pages.fetch).calendars(KIT_ACCOUNT)).toEqual([{ id: 'a', name: 'A', is_primary: false, is_owned_by_user: true },
    { id: 'b', name: 'B', is_primary: true, is_owned_by_user: true }]);
  expect(pages.calls[1]?.url).toBe(`${ON}/calendars?limit=100&cursor=n`);
});

test('refuses a limit or a date Unipile would not take, before asking', async () => {
  const unipile = client(fakeFetch(fake()).fetch);
  for (const limit of [0, 101, 1.5]) {
    await expect(unipile.emails(KIT_ACCOUNT, { limit })).rejects.toThrow('limit_invalid');
    await expect(unipile.events(KIT_ACCOUNT, 'lee@lumen.test', { limit })).rejects.toThrow('limit_invalid');
  }
  for (const after of ['yesterday', '2026-11-05T10:00:00']) {
    await expect(unipile.emails(KIT_ACCOUNT, { after })).rejects.toThrow('date_invalid');
    await expect(unipile.events(KIT_ACCOUNT, 'lee@lumen.test', { start: after })).rejects.toThrow('date_invalid');
  }
});

test('the fake answers mail and events as Unipile filters them, and an unknown account or calendar as not found', async () => {
  const unipile = client(fakeFetch(fake()).fetch);
  const ids = (page: { items: { id: string }[] }) => page.items.map(item => item.id);
  expect(ids(await unipile.emails(KIT_ACCOUNT, { after: email(5).date }))).toEqual(['mail-7', 'mail-6']);
  expect(ids(await unipile.events(KIT_ACCOUNT, 'holidays', {}))).toEqual(['event-7']);
  for (const read of [unipile.emails('acc_other', {}), unipile.calendars('acc_other'), unipile.events(KIT_ACCOUNT, 'nope', {})]) {
    await expect(read).rejects.toMatchObject({ code: 'not_found', status: 404 });
  }
  const limited = await fakeFetch(fake()).fetch(`${ON}/emails?limit=101`, { headers: { 'x-api-key': GOOD_KEY } });
  expect(limited.status).toBe(400);
});

test('deletes an account, which the fake then does not know anywhere; one already gone resolves', async () => {
  const unipile = fakeFetch(fake());
  await client(unipile.fetch).deleteAccount(KIT_ACCOUNT);
  expect(unipile.calls[0]).toMatchObject({ method: 'DELETE', url: `${API}/accounts/kit-account` });
  for (const read of [client(unipile.fetch).account(KIT_ACCOUNT), client(unipile.fetch).emails(KIT_ACCOUNT, {}),
    client(unipile.fetch).company(KIT_ACCOUNT, '1')]) await expect(read).rejects.toMatchObject({ code: 'not_found' });
  await expect(client(unipile.fetch).deleteAccount(KIT_ACCOUNT)).resolves.toBeUndefined();
  const failing = fakeFetch([{ url: `${API}/accounts/kit-account`, respond: () => Response.json({ status: 500 }, { status: 500 }) }]);
  await expect(client(failing.fetch).deleteAccount(KIT_ACCOUNT)).rejects.toMatchObject({ code: 'unavailable' });
});

test('reads one account as a mailbox: its address, mail by metadata without drafts, a thread whole, the primary calendar', async () => {
  const unipile = fakeFetch(fake());
  const reader = unipileMailbox(client(unipile.fetch), KIT_ACCOUNT);
  await expect(reader.identify()).resolves.toEqual({ email: 'lee@lumen.test' });
  const listed = await reader.messages({ limit: 2 });
  expect(listed.items.map(item => [item.id, item.body])).toEqual([['mail-6', '']]);
  expect(unipile.calls.map(call => call.url)).toContain(`${ON}/emails?limit=2&meta_only=true`);
  expect((await reader.thread('thread-3', {})).items.map(item => [item.id, item.body])).toEqual([['mail-3', '<p>Hello</p>']]);
  expect((await reader.thread('thread-7', {})).items).toEqual([]);
  expect(await reader.primaryCalendar()).toMatchObject({ id: 'lee@lumen.test', is_primary: true });
});
