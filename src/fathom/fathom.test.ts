import { expect, test } from 'vitest';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { fakeFetch, sequence } from '../testing.js';
import { fakeFathom, type FakeFathomMeeting } from './fake.js';
import { fathomClient } from './fathom.js';
import recording from './fixtures/recording.json' with { type: 'json' };
import { fathomScenario } from './scenario.test-support.js';

const BASE = 'https://api.fathom.ai/external/v1';
const meeting = (n: number, recorder = 'ana@lumen.test'): FakeFathomMeeting => ({
  recording_id: n, title: `Lumen call ${String(n)}`, meeting_title: 'Lumen intro', url: `https://fathom.video/calls/${String(n)}`,
  share_url: `https://fathom.video/share/${String(n)}`, meeting_url: 'https://meet.google.com/abc-defg-hij',
  created_at: `2026-11-${String(n).padStart(2, '0')}T11:00:00Z`, scheduled_start_time: `2026-11-${String(n).padStart(2, '0')}T10:00:00Z`,
  scheduled_end_time: `2026-11-${String(n).padStart(2, '0')}T10:30:00Z`, recording_start_time: `2026-11-${String(n).padStart(2, '0')}T10:01:00Z`,
  recording_end_time: `2026-11-${String(n).padStart(2, '0')}T10:29:00Z`,
  calendar_invitees: [{ name: 'Ana Reis', email: recorder, is_external: false }],
  recorded_by: { name: 'Ana Reis', email: recorder, team: 'Sales' },
  transcript: [{ speaker: { display_name: 'Ana Reis', matched_calendar_invitee_email: recorder }, text: 'Hello', timestamp: '00:00:05' }],
});
const twelve = Array.from({ length: 12 }, (_, index) => meeting(index + 1));

providerKit(fathomScenario, { recording: recording as Recording,
  fake: fakeFathom({ meetings: key => (key === GOOD_KEY ? twelve : null) }) });

const client = (fetchImpl: typeof fetch, apiKey = 'fth_k') => fathomClient({ apiKey, fetch: fetchImpl, minIntervalMs: 0 });

test("sends Fathom's query and the key, never asking for transcripts in a list", async () => {
  const fake = fakeFetch(fakeFathom({ meetings: () => twelve }));
  await client(fake.fetch).meetings({ createdAfter: '2026-11-01T00:00:00Z', recordedBy: 'ana@lumen.test', cursor: '10' });
  await client(fake.fetch).transcript(3);
  expect(fake.calls.map(call => call.url)).toEqual([
    `${BASE}/meetings?created_after=2026-11-01T00%3A00%3A00Z&recorded_by%5B%5D=ana%40lumen.test&cursor=10`,
    `${BASE}/recordings/3/transcript`,
  ]);
  expect(fake.calls[0]?.headers['x-api-key']).toBe('fth_k');
});

test("keeps only a recorder's own meetings when asked", async () => {
  const fake = fakeFetch(fakeFathom({ meetings: () => [meeting(1), meeting(2, 'lee@lumen.test')] }));
  const page = await client(fake.fetch).meetings({ recordedBy: 'ANA@lumen.test' });
  expect(page.items.map(item => item.recording_id)).toEqual([1]);
});

test("drops Fathom's summary, action items and CRM matches, which never reach an app's store", async () => {
  const first = (recording as Recording).exchanges[0]?.response as { items: Record<string, unknown>[] };
  const page = await client(fakeFetch([{ url: `${BASE}/meetings`, respond: () => Response.json(first) }]).fetch).meetings({});
  expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(['calendar_invitees', 'created_at', 'meeting_title', 'meeting_url',
    'recorded_by', 'recording_end_time', 'recording_id', 'recording_start_time', 'scheduled_end_time', 'scheduled_start_time',
    'share_url', 'title', 'url']);
  expect(page.items[0]?.calendar_invitees[0]).toEqual({ name: 'Alice Johnson', email: 'alice.johnson@acme.example', is_external: false });
});

test('reads a meeting without a schedule or call link, and a missing transcript as empty', async () => {
  const bare = { ...meeting(1), scheduled_start_time: null, scheduled_end_time: null, meeting_url: undefined };
  const fake = fakeFetch([
    { url: `${BASE}/meetings`, respond: () => Response.json({ limit: 10, next_cursor: null, items: [bare] }) },
    { url: `${BASE}/recordings/1/transcript`, respond: () => Response.json({ transcript: null }) },
  ]);
  const page = await client(fake.fetch).meetings({});
  expect(page.items[0]).toMatchObject({ scheduled_start_time: null, meeting_url: null });
  expect(await client(fake.fetch).transcript(1)).toEqual([]);
});

test('skips a listed meeting it cannot read, and refuses a transcript in another shape', async () => {
  const fake = fakeFetch([
    { url: `${BASE}/meetings`, respond: () => Response.json({ limit: 10, next_cursor: null, items: [meeting(1), { title: 'no id' }, { recording_id: 7 }] }) },
    { url: `${BASE}/recordings/1/transcript`, respond: () => Response.json({ transcript: [{ text: 'no speaker' }] }) },
  ]);
  expect(await client(fake.fetch).meetings({})).toMatchObject({ items: [{ recording_id: 1 }], skipped: [null, '7'] });
  await expect(client(fake.fetch).transcript(1)).rejects.toMatchObject({ code: 'invalid_response' });
});

test('reports a second 429 in a row as rate_limited, with its wait', async () => {
  const fake = fakeFetch([{ url: `${BASE}/recordings/1/transcript`, respond: sequence(
    () => Response.json({}, { status: 429, headers: { 'retry-after': '0.001' } }),
    () => Response.json({}, { status: 429, headers: { 'retry-after': '7' } })) }]);
  await expect(client(fake.fetch).transcript(1)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 7000 });
  expect(fake.calls).toHaveLength(2);
});

test('a blank next_cursor ends the list', async () => {
  const fake = fakeFetch([{ url: `${BASE}/meetings`, respond: () => Response.json({ limit: 10, next_cursor: '', items: [] }) }]);
  expect(await client(fake.fetch).meetings({})).toMatchObject({ cursor: null });
});
