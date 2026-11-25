import { expect, test } from 'vitest';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { fakeFetch } from '../testing.js';
import { attioClient, type AttioRecord } from './attio.js';
import { fakeAttio, type FakeAttioWorkspace } from './fake.js';
import recording from './fixtures/recording.json' with { type: 'json' };
import { attioScenario } from './scenario.test-support.js';

const BASE = 'https://api.attio.com/v2';
const company = (n: number): AttioRecord => ({ id: { record_id: `rec_${String(n)}` }, created_at: `2026-11-0${String(n)}T10:00:00Z`,
  web_url: `https://app.attio.com/lumen/company/rec_${String(n)}`,
  values: { name: [{ attribute_type: 'text', active_until: null, value: `Company ${String(n)}` }] } });
const workspace: FakeAttioWorkspace = { workspace_id: 'ws_1', workspace_name: 'Lumen', workspace_slug: 'lumen',
  records: { companies: [1, 2, 3, 4, 5].map(company), people: [], deals: [] },
  notes: [{ id: { note_id: 'note_1' }, parent_object: 'companies', parent_record_id: 'rec_1', title: 'Kickoff',
    content_plaintext: 'They want onboarding in March.', created_at: '2026-11-02T10:00:00Z' }],
  members: [{ id: { workspace_member_id: 'mem_1' }, first_name: 'Ana', last_name: 'Reis', email_address: 'ana@lumen.test' }] };

providerKit(attioScenario, { recording: recording as Recording, fake: fakeAttio({ workspace: key => (key === GOOD_KEY ? workspace : null) }) });

const client = (fetchImpl: typeof fetch, apiKey = 'att_k') => attioClient({ apiKey, fetch: fetchImpl, minIntervalMs: 0 });

test("sends Attio's query, oldest first with the record id breaking ties, with the token", async () => {
  const fake = fakeFetch(fakeAttio({ workspace: () => workspace }));
  await client(fake.fetch).records({ object: 'deals', createdAfter: '2026-11-01T00:00:00Z', cursor: '500' });
  await client(fake.fetch).notes('50');
  expect(fake.calls.map(call => [call.method, call.url, call.body])).toEqual([
    ['POST', `${BASE}/objects/deals/records/query`, JSON.stringify({ filter: { created_at: { $gt: '2026-11-01T00:00:00Z' } },
      sorts: [{ direction: 'asc', attribute: 'created_at' }, { direction: 'asc', attribute: 'record_id' }], limit: 500,
      offset: 500 })],
    ['GET', `${BASE}/notes?limit=50&offset=50`, ''],
  ]);
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer att_k');
});

test('names the workspace, and reads notes and members', async () => {
  const fake = fakeFetch(fakeAttio({ workspace: () => workspace }));
  await expect(client(fake.fetch).workspace()).resolves.toMatchObject({ workspace_id: 'ws_1', workspace_name: 'Lumen' });
  await expect(client(fake.fetch).notes()).resolves.toEqual({ items: workspace.notes, skipped: [], cursor: null });
  await expect(client(fake.fetch).members()).resolves.toEqual(workspace.members);
});

test('refuses a token of the wrong length, which Attio answers 400', async () => {
  const fake = fakeFetch([{ url: `${BASE}/self`, respond: () => Response.json({ status_code: 400, type: 'invalid_request_error',
    code: 'missing_value', message: 'Token was not recognised' }, { status: 400 }) }]);
  await expect(client(fake.fetch).workspace()).rejects.toMatchObject({ code: 'rejected' });
});

test("skips an entry it cannot read by its own id, and ends on a short page", async () => {
  const fake = fakeFetch([{ url: `${BASE}/objects/companies/records/query`, respond: () => Response.json({ data: [company(1),
    { id: { workspace_id: 'ws_1', object_id: 'obj', record_id: 'rec_bad' }, values: {} }] }) }]);
  await expect(attioClient({ apiKey: 'k', fetch: fake.fetch, minIntervalMs: 0, pageSize: 3 }).records({ object: 'companies' }))
    .resolves.toEqual({ items: [company(1)], skipped: ['rec_bad'], cursor: null });
});

test('refuses a cursor it did not give', async () => {
  const fake = fakeFetch(fakeAttio({ workspace: () => workspace }));
  await expect(client(fake.fetch).records({ object: 'companies', cursor: '-1' })).rejects.toThrow('cursor_invalid');
});
