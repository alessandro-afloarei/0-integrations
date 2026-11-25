import { expect, test } from 'vitest';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { fakeFetch } from '../testing.js';
import { aircallClient } from './aircall.js';
import { fakeAircall, type FakeAircallCall } from './fake.js';
import recording from './fixtures/recording.json' with { type: 'json' };
import { aircallScenario } from './scenario.test-support.js';

const BASE = 'https://api.aircall.io/v1';
const utterances = [
  { start_time: 12.54, end_time: 13.8, text: 'We need the renewal by Friday.', participant_type: 'external' as const, phone_number: '+12025550178' },
  { start_time: 14.1, end_time: 15.5, text: 'I will send it today.', participant_type: 'internal' as const, user_id: 456 },
];
const call = (id: number, transcript: FakeAircallCall['transcript'] = utterances): FakeAircallCall => ({
  id, direction: 'outbound', status: 'done', started_at: 1_793_440_800 + id * 86_400, answered_at: 1_793_440_806 + id * 86_400,
  ended_at: 1_793_441_411 + id * 86_400, raw_digits: '+1 202-555-0143', asset: `https://assets.aircall.io/recording/${String(id)}`,
  user: { id: 456, name: 'John Doe', email: 'john@lumen.test' },
  contact: { id: 5443, first_name: 'Jennifer', last_name: 'Smith', company_name: 'Acme Inc.', emails: [{ value: 'jen@acme.test' }] },
  transcript,
});
const calls = [1, 2, 3, 4, 5].map(id => call(id));

providerKit(aircallScenario, { recording: recording as Recording,
  fake: fakeAircall({ account: credentials => (credentials === `kit-id:${GOOD_KEY}` ? { name: 'Lumen', calls } : null) }) });

const client = (fetchImpl: typeof fetch) => aircallClient({ apiId: 'api_id', apiToken: 'api_token', fetch: fetchImpl, minIntervalMs: 0 });
const fake = (list: FakeAircallCall[]) => fakeFetch(fakeAircall({ account: credentials =>
  (credentials === 'api_id:api_token' ? { name: 'Lumen', calls: list } : null) }));

test("sends Aircall's query and the key as Basic auth", async () => {
  const http = fake(calls);
  await client(http.fetch).calls({ from: 1_793_440_800, cursor: '1793440800:3' });
  await client(http.fetch).transcript(2);
  expect(http.calls.map(item => item.url)).toEqual([
    `${BASE}/calls?order=asc&per_page=50&fetch_contact=true&from=1793440800&page=3`,
    `${BASE}/calls/2/transcription`,
  ]);
  expect(http.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('api_id:api_token').toString('base64')}`);
});

test("drops a call's recording links, costs, comments and tags, which never reach an app's store", async () => {
  const listed = (recording as Recording).exchanges[1]?.response;
  const page = await client(fakeFetch([{ url: `${BASE}/calls`, respond: () => Response.json(listed) }]).fetch).calls({});
  expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(['answered_at', 'asset', 'contact', 'direction', 'ended_at', 'id',
    'raw_digits', 'started_at', 'status', 'user']);
  expect(page.items[0]?.contact).toEqual({ id: 5443, first_name: 'Jennifer', last_name: 'Smith', company_name: 'Acme Inc.',
    emails: [{ value: 'jennifer@acme.example' }] });
});

test('reads a transcript, none while Aircall has none, and refuses a company without AI Assist', async () => {
  const http = fake([call(1), call(2, 'none'), call(3, 'ai_assist_required')]);
  await expect(client(http.fetch).transcript(1)).resolves.toEqual(utterances);
  await expect(client(http.fetch).transcript(2)).resolves.toBeNull();
  await expect(client(http.fetch).transcript(3)).rejects.toMatchObject({ code: 'request_failed', status: 403,
    detail: 'ai_assist_required' });
});

test("reads a webhook-style string user id as Aircall's number, and a null user id or phone number as none", async () => {
  const http = fakeFetch([{ url: `${BASE}/calls/1/transcription`, respond: () => Response.json({ transcription: { content: {
    utterances: [{ ...utterances[1], user_id: '456' }, { ...utterances[0], user_id: null, phone_number: null }] } } }) }]);
  const read = await client(http.fetch).transcript(1);
  expect(read).toEqual([utterances[1], { ...utterances[0], phone_number: undefined }]);
  expect(read?.[1]?.user_id).toBeUndefined();
});

test('carries a listing past the 10,000 calls Aircall serves from a second before its last call, and refuses a cursor it did not give', async () => {
  const http = fakeFetch([{ url: `${BASE}/calls`, respond: () => Response.json({ calls: calls.slice(0, 2),
    meta: { next_page_link: `${BASE}/calls?page=5001` } }) }]);
  const capped = aircallClient({ apiId: 'api_id', apiToken: 'api_token', fetch: http.fetch, minIntervalMs: 0, pageSize: 2 });
  const restart = (calls[1]?.started_at ?? 0) - 1;
  await expect(capped.calls({ cursor: ':5000' })).resolves.toMatchObject({ cursor: `${String(restart)}:1` });
  await expect(capped.calls({ cursor: ':4999' })).resolves.toMatchObject({ cursor: ':5000' });
  await capped.calls({ cursor: `${String(restart)}:1` });
  expect(http.calls.at(-1)?.url).toBe(`${BASE}/calls?order=asc&per_page=2&fetch_contact=true&from=${String(restart)}`);
  await expect(capped.calls({ cursor: '3' })).rejects.toThrow('cursor_invalid');
});
