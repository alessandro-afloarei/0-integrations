import { expect, test } from 'vitest';
import { ProviderHttpError } from '../errors.js';
import { fakeFetch } from '../testing.js';
import { fakeFireflies } from './fake.js';
import { FirefliesTranscriptError } from './errors.js';
import { changedTranscripts, firefliesClient, identify, type FirefliesListItem } from './fireflies.js';

const URL = 'https://api.fireflies.ai/graphql';
const user = { userId: 'u1', email: 'ana@example.invalid', name: 'Ana' };
const transcript = { id: 't1', title: 'Planning', date: 1_000, duration: 30,
  participants: ['ana@example.invalid'], speakers: [{ id: 1, name: 'Ana' }],
  sentences: [{ speaker_id: '1', speaker_name: 'Ana', text: 'Hello world', start_time: '0' }],
  meeting_info: { summary_status: 'processed' }, is_live: false };
const window = { userId: 'u1', fromDate: 0, toDate: 10_000 };
const cursor = (skip: unknown, overrides: Record<string, unknown> = {}) => JSON.stringify({ ...window, limit: 50, skip, ...overrides });
const client = (fake: { fetch: typeof fetch }, apiKey = 'key') => firefliesClient({ apiKey, fetch: fake.fetch });
const answer = (body: unknown, status = 200) => fakeFetch([{ url: URL, method: 'POST', respond: () => Response.json(body, { status }) }]);

test('sends the documented String search scope on the wire', async () => {
  const fake = answer({ data: { transcripts: [] } });
  await client(fake).search({ userId: 'u1', keyword: 'hello', limit: 5 });
  const request: unknown = JSON.parse(fake.calls[0]?.body ?? '{}');
  expect(request).toHaveProperty('query', expect.stringContaining('scope: "all"'));
  expect(request).toHaveProperty('variables', { userId: 'u1', keyword: 'hello', limit: 5 });
});

test('search selects every field promised by its result type and fake', async () => {
  const fields = { id: 't1', title: 'Planning', date: 1_000, duration: 30, meeting_link: 'https://example.invalid/call',
    calendar_id: 'calendar', cal_id: 'event', is_live: false, meeting_info: { summary_status: 'processed' },
  } satisfies Required<FirefliesListItem>;
  const fake = fakeFetch(fakeFireflies({ account: () => ({ user, transcripts: [{ ...transcript, ...fields }] }) }));
  expect(await client(fake).search({ userId: 'u1', keyword: 'Planning', limit: 5 })).toEqual({ items: [fields], skipped: [] });
  const request: unknown = JSON.parse(fake.calls[0]?.body ?? '{}');
  for (const field of Object.keys(fields)) {
    expect(request).toHaveProperty('query', expect.stringMatching(new RegExp(`\\b${field}\\b`, 'u')));
  }
  expect(request).toHaveProperty('query', expect.stringMatching(/meeting_info\s*\{\s*summary_status\s*\}/u));
});

test('round-trips every call through its fake', async () => {
  const fake = fakeFetch(fakeFireflies({ account: key => key === 'key' ? { user, transcripts: [transcript] } : null }));
  const c = client(fake);
  expect(await identify(c)).toEqual(user);
  expect(await c.transcripts(window)).toMatchObject({ items: [{ id: 't1' }], skipped: [], cursor: null });
  expect(await c.transcripts({ ...window, fromDate: 2_000 })).toMatchObject({ items: [] });
  await expect(c.transcripts({ ...window, userId: 'other' })).rejects.toMatchObject({ code: 'request_failed', status: 403, detail: 'not_in_team' });
  expect(await c.transcript('t1')).toEqual({ ...transcript, meeting_info: undefined, summary_status: 'processed' });
  expect(await c.transcript('missing')).toBeNull();
  expect(await c.search({ userId: 'u1', keyword: 'WORLD', limit: 5 })).toMatchObject({ items: [{ id: 't1' }], skipped: [] });
  expect(await c.search({ userId: 'u1', keyword: 'absent', limit: 5 })).toMatchObject({ items: [] });
  await expect(c.search({ userId: 'other', keyword: 'WORLD', limit: 5 })).rejects.toMatchObject({ code: 'request_failed', status: 403, detail: 'not_in_team' });
  await expect(identify(client(fake, 'wrong'))).rejects.toMatchObject({ code: 'rejected' });
  expect(fake.calls.every(call => call.method === 'POST' && call.url === URL)).toBe(true);
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer key');
});

test('pages 101 records at offsets 0, 50, 100', async () => {
  const fake = fakeFetch(fakeFireflies({ account: () => ({ user,
    transcripts: Array.from({ length: 101 }, (_, i) => ({ ...transcript, id: `t${String(i)}` })) }) }));
  const pages = [];
  for await (const page of changedTranscripts(client(fake), window)) pages.push(page);
  expect(pages.map(page => page.items.length)).toEqual([50, 50, 1]);
  expect(pages.map(page => page.cursor)).toEqual([cursor('50'), cursor('100'), null]);
  expect(fake.calls.map(call => JSON.parse(call.body) as unknown)).toMatchObject([
    { variables: { skip: 0, limit: 50, fromDate: '1970-01-01T00:00:00.000Z', toDate: '1970-01-01T00:00:10.000Z' } },
    { variables: { skip: 50, limit: 50 } }, { variables: { skip: 100, limit: 50 } },
  ]);
});

test('resumes an offset and stops when the caller breaks', async () => {
  const fake = fakeFetch(fakeFireflies({ account: () => ({ user,
    transcripts: Array.from({ length: 151 }, (_, i) => ({ ...transcript, id: `t${String(i)}` })) }) }));
  const first = await client(fake).transcripts(window);
  if (first.cursor === null) throw new Error('expected next page');
  for await (const page of changedTranscripts(client(fake), { ...window, cursor: first.cursor })) {
    expect(page.items[0]?.id).toBe('t50');
    expect(page.cursor).toBe(cursor('100'));
    break;
  }
  expect(fake.calls).toHaveLength(2);
  expect(JSON.parse(fake.calls[1]?.body ?? '{}')).toMatchObject({ variables: { skip: 50 } });
});

test.each([{ userId: 'other' }, { fromDate: 1 }, { toDate: 20_000 }])('refuses a cursor from another query: %j', async change => {
  const fake = fakeFetch(fakeFireflies({ account: () => ({ user,
    transcripts: Array.from({ length: 50 }, () => transcript) }) }));
  const first = await client(fake).transcripts(window);
  if (first.cursor === null) throw new Error('expected next page');
  await expect(client(fake).transcripts({ ...window, ...change, cursor: first.cursor })).rejects.toMatchObject({ name: 'TypeError', message: 'cursor_invalid' });
  expect(fake.calls).toHaveLength(1);
});

test.each(['', ' ', '-1', '0x32', '1e2', '00', '01', '1.5', '9007199254740991', '10000000000000000', 50, null])
('refuses a malformed cursor offset before requesting: %j', async skip => {
  const fake = answer({ data: { transcripts: [] } });
  await expect(client(fake).transcripts({ ...window, cursor: cursor(skip) })).rejects.toMatchObject({ name: 'TypeError', message: 'cursor_invalid' });
  expect(fake.calls).toHaveLength(0);
});

test.each(['', ' ', '50', 'null', '{}', '[]', '{', cursor('50', { limit: 25 }), cursor('50', { fromDate: null })])
('refuses a malformed cursor envelope or mismatched limit: %s', async value => {
  const fake = answer({ data: { transcripts: [] } });
  await expect(client(fake).transcripts({ ...window, cursor: value })).rejects.toMatchObject({ name: 'TypeError', message: 'cursor_invalid' });
  expect(fake.calls).toHaveLength(0);
});

test.each([Number.NaN, Infinity, -Infinity, 8_640_000_000_000_001])('refuses dates outside the finite Date range: %s', async date => {
  const fake = answer({ data: { transcripts: [] } });
  for (const change of [{ fromDate: date }, { toDate: date }]) {
    await expect(client(fake).transcripts({ ...window, ...change })).rejects.toMatchObject({ name: 'TypeError', message: 'date_invalid' });
  }
  expect(fake.calls).toHaveLength(0);
});

test.each([0, -1, 1.5, 51, Number.NaN, Infinity])('refuses an invalid search limit before requesting: %s', async limit => {
  const fake = answer({ data: { transcripts: [] } });
  await expect(client(fake).search({ userId: 'u1', keyword: 'hello', limit })).rejects.toMatchObject({ name: 'TypeError', message: 'limit_invalid' });
  expect(fake.calls).toHaveLength(0);
});

test.each([1, 50])('accepts a search limit at the boundary: %i', async limit => {
  const fake = answer({ data: { transcripts: [transcript] } });
  expect((await client(fake).search({ userId: 'u1', keyword: 'hello', limit })).items).toHaveLength(1);
  expect(JSON.parse(fake.calls[0]?.body ?? '{}')).toHaveProperty('variables.limit', limit);
});

test('counts malformed entries toward the offset', async () => {
  const fake = answer({ data: { transcripts: [transcript, ...Array.from({ length: 49 }, () => ({ id: 'bad' }))] } });
  const page = await client(fake).transcripts(window);
  expect(page.items).toHaveLength(1);
  expect(page.skipped).toEqual(Array.from({ length: 49 }, () => 'bad'));
  expect(page.cursor).toBe(cursor('50'));
});

test.each(['bad', Array.from({ length: 51 }, () => transcript)])('rejects an oversized or malformed list: %j', async transcripts => {
  await expect(client(answer({ data: { transcripts } })).transcripts(window)).rejects.toMatchObject({ code: 'invalid_response' });
});

test.each([
  [500, 'auth_failed', 'rejected'], [429, 'auth_failed', 'rejected'], [401, 'too_many_requests', 'rejected'],
  [500, 'too_many_requests', 'rate_limited'], [200, 'object_not_found', 'not_found'],
  [429, 'object_not_found', 'rate_limited'], [500, 'query_too_big', 'request_failed'],
] as const)('classifies GraphQL errors before status: %i %s', async (status, detail, code) => {
  for (const error of [{ code: detail }, { extensions: { code: detail } }]) {
    await expect(identify(client(answer({ errors: [error] }, status)))).rejects.toMatchObject({ code, status, detail });
  }
});

test('keeps HTTP failures and malformed envelopes distinct', async () => {
  await expect(identify(client(answer({}, 503)))).rejects.toMatchObject({ code: 'unavailable' });
  await expect(identify(client(answer({})))).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(client(answer({ errors: [{ code: 'object_not_found' }] })).transcript('gone')).resolves.toBeNull();
});

test.each([{ message: 'private provider text' }, null, { extensions: {} }])
('refuses codeless GraphQL errors even with success data: %j', async error => {
  await expect(client(answer({ errors: [error], data: { transcript: null } })).transcript('t1'))
    .rejects.toMatchObject({ code: 'request_failed', status: 200, detail: null });
});

test('allows an empty GraphQL errors array', async () => {
  await expect(client(answer({ errors: [], data: { transcript: null } })).transcript('t1')).resolves.toBeNull();
});

test.each([
  { field: 'duration', value: null }, { field: 'date', value: 'private-hostile-value' },
  { field: 'meeting_link', value: { private: 'private-hostile-value' } },
])('keeps the invalid transcript discriminator and sanitized field path: $field', async ({ field, value }) => {
  const error: unknown = await client(answer({ data: { transcript: { ...transcript, [field]: value } } }))
    .transcript('t1').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProviderHttpError);
  expect(error).toBeInstanceOf(FirefliesTranscriptError);
  expect(error).toMatchObject({ code: 'invalid_response', status: null, detail: 'transcript_invalid', path: field });
  expect(JSON.stringify(error)).not.toContain('private-hostile-value');
  await expect(client(answer({ data: {} })).transcript('t1'))
    .rejects.toMatchObject({ code: 'invalid_response', status: null, detail: null });
});

test('uses the same untitled fallback for list and transcript records', async () => {
  const fake = fakeFetch(fakeFireflies({ account: () => ({ user, transcripts: [{ ...transcript, title: ' ' }] }) }));
  expect((await client(fake).transcripts(window)).items[0]?.title).toBe('Untitled call');
  expect((await client(fake).transcript('t1'))?.title).toBe('Untitled call');
});

test('normalizes live transcript variations without summary fields', async () => {
  const raw = { ...transcript, date: 1_000.9, title: '  Planning\ncall ', summary: { overview: 'private' },
    participants: ['z@example.invalid, a@example.invalid', 'a@example.invalid', 'junk', null],
    speakers: [{ id: 'spk_a', name: 'Listed Name' }],
    sentences: [
      { speaker_id: 'spk_a', speaker_name: ' Line\nName ', text: 'Hello', start_time: '1.2300' },
      { speaker_id: 'spk_a', text: 'Next', start_time: 2.3456 },
      { speaker_id: 3, text: 'Unnamed', start_time: -1 }, { text: '  ' },
    ] };
  expect(await client(answer({ data: { transcript: raw } })).transcript('t1')).toEqual({
    id: 't1', title: 'Planning call', date: 1_000, duration: 30, participants: ['a@example.invalid', 'z@example.invalid'],
    is_live: false, summary_status: 'processed',
    speakers: [{ id: 9999, name: 'Line Name' }, { id: 9998, name: 'Listed Name' }, { id: 3, name: 'Speaker 3' }],
    sentences: [
      { speaker_id: '9999', speaker_name: 'Line Name', text: 'Hello', start_time: '1.2300' },
      { speaker_id: '9998', speaker_name: 'Listed Name', text: 'Next', start_time: '2.346' },
      { speaker_id: '3', speaker_name: 'Speaker 3', text: 'Unnamed', start_time: '0' },
    ],
  });
});

test('keeps AbortSignal and never includes provider messages in errors', async () => {
  const abort = new AbortController();
  abort.abort();
  const fake = answer({ data: { user: { user_id: 'u1', email: 'e', name: 'n' } } });
  await expect(firefliesClient({ apiKey: 'key', fetch: fake.fetch, signal: abort.signal }).user()).rejects.toBeDefined();
  expect(fake.calls).toHaveLength(0);
  const error: unknown = await identify(client(answer({ errors: [{ code: 'auth_failed', message: 'secret payload' }] }, 500))).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderHttpError);
  expect(JSON.stringify(error)).not.toContain('secret payload');
});

test.each(['upstream_error; private_context=synthetic-marker', 'x'.repeat(65), 'error\nprivate'])
('redacts non-token GraphQL detail without changing query-failure classification: %s', async detail => {
  for (const error of [{ code: detail }, { extensions: { code: detail } }]) {
    const caught: unknown = await identify(client(answer({ errors: [error] }, 500))).catch((e: unknown) => e);
    expect(caught).toMatchObject({ code: 'request_failed', status: 500, detail: null });
    expect(JSON.stringify(caught)).not.toContain(detail);
  }
});

test('a GraphQL code that echoes the key is no detail', async () => {
  await expect(client(answer({ errors: [{ code: 'fixture_key' }] }), 'fixture_key').user())
    .rejects.toMatchObject({ code: 'request_failed', detail: null });
});
