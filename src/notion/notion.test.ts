import { expect, test } from 'vitest';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { fakeFetch, sequence } from '../testing.js';
import { fakeNotion, type FakeNotionPage, type FakeNotionWorkspace } from './fake.js';
import recording from './fixtures/recording.json' with { type: 'json' };
import { notionClient } from './notion.js';
import { notionScenario } from './scenario.test-support.js';

const BASE = 'https://api.notion.com/v1';
const page = (n: number, edited = `2026-11-0${String(n)}T10:00:00.000Z`): FakeNotionPage => ({
  id: `page-${String(n)}`, url: `https://app.notion.com/p/page${String(n)}`, created_time: '2026-10-01T09:00:00.000Z',
  last_edited_time: edited, in_trash: false, title: `Page ${String(n)}`, markdown: `# Page ${String(n)}\n\nNotes.` });
const workspace: FakeNotionWorkspace = { workspace_id: 'ws-1', workspace_name: 'Lumen', pages: [1, 2, 3, 4, 5].map(n => page(n)) };

providerKit(notionScenario, { recording: recording as Recording,
  fake: fakeNotion({ workspace: key => (key === GOOD_KEY ? workspace : null) }) });

const client = (fetchImpl: typeof fetch, pageSize?: number) =>
  notionClient({ apiKey: 'ntn_k', fetch: fetchImpl, minIntervalMs: 0, ...(pageSize === undefined ? {} : { pageSize }) });
const searchAnswer = (results: unknown[], next: string | null) =>
  Response.json({ object: 'list', results, has_more: next !== null, next_cursor: next, type: 'page_or_data_source' });
const searchPage = (n: number) => (recording as Recording).exchanges[n]?.response as { results: unknown[] };

test("sends Notion's search, newest edit first, its version and the key", async () => {
  const fake = fakeFetch(fakeNotion({ workspace: () => workspace }));
  await client(fake.fetch).pages({ cursor: '2' });
  await client(fake.fetch).text('page-1');
  expect(fake.calls.map(call => [call.method, call.url, call.body])).toEqual([
    ['POST', `${BASE}/search?filter_properties=title`, JSON.stringify({ filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' }, page_size: 100, start_cursor: '2' })],
    ['GET', `${BASE}/pages/page-1/markdown?markdown_version=v2`, ''],
  ]);
  expect(fake.calls[0]?.headers).toMatchObject({ authorization: 'Bearer ntn_k', 'notion-version': '2026-03-11',
    'content-type': 'application/json' });
});

test("keeps a page's ids, times and title, from any title property, and dropping the rest", async () => {
  const fake = fakeFetch([{ url: `${BASE}/search`, respond: sequence(() => searchAnswer(searchPage(1).results, null),
    () => searchAnswer(searchPage(2).results, null)) }]);
  const [first, second] = [await client(fake.fetch).pages({}), await client(fake.fetch).pages({})];
  expect(Object.keys(first.items[0] ?? {}).sort()).toEqual(['created_time', 'id', 'in_trash', 'last_edited_time', 'title', 'url']);
  // A database row keys its title by the property's name; an untitled page has none.
  expect([...first.items, ...second.items].map(item => item.title)).toEqual(['Lumen renewal plan', 'Bug bash', '',
    'Discovery call notes Acme']);
});

test('ends an incremental read at the first page edited before the time, keeping one edited at it', async () => {
  const pages = [page(9, '2026-11-09T10:00:00.000Z'), page(8, '2026-11-08T10:00:00.000Z'), page(7, '2026-11-07T10:00:00.000Z')];
  const fake = fakeFetch(fakeNotion({ workspace: () => ({ ...workspace, pages }) }));
  await expect(client(fake.fetch, 2).pages({ editedAfter: '2026-11-08T10:00:00.000Z' }))
    .resolves.toMatchObject({ items: [{ id: 'page-9' }, { id: 'page-8' }], cursor: '2' });
  await expect(client(fake.fetch, 2).pages({ editedAfter: '2026-11-08T10:00:00.000Z', cursor: '2' }))
    .resolves.toEqual({ items: [], skipped: [], cursor: null });
  // Notion rounds an edit time down to the minute: a page edited at 10:00:45 lists as 10:00, after a time of 10:00:30.
  await expect(client(fake.fetch).pages({ editedAfter: '2026-11-08T10:00:30.000Z' }))
    .resolves.toMatchObject({ items: [{ id: 'page-9' }, { id: 'page-8' }], cursor: null });
  await expect(client(fake.fetch).pages({ editedAfter: 'yesterday' })).rejects.toThrow('date_invalid');
});

test('skips an entry it cannot read, and refuses more pages without a cursor', async () => {
  const fake = fakeFetch([{ url: `${BASE}/search`, respond: sequence(
    () => searchAnswer([...searchPage(1).results, { object: 'page', id: 'partial-1' }], null),
    () => Response.json({ object: 'list', results: [], has_more: true, next_cursor: null })) }]);
  await expect(client(fake.fetch).pages({})).resolves.toMatchObject({ skipped: ['partial-1'], cursor: null });
  await expect(client(fake.fetch).pages({})).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_missing' });
});

test("reads a page's markdown, saying when Notion cut it", async () => {
  const fake = fakeFetch(fakeNotion({ workspace: () => ({ ...workspace, pages: [page(1), { ...page(2), cut: true }] }) }));
  await expect(client(fake.fetch).text('page-1')).resolves.toEqual({ markdown: '# Page 1\n\nNotes.', cut: false });
  await expect(client(fake.fetch).text('page-2')).resolves.toEqual({ markdown: '# Page 2\n\nNotes.', cut: true });
  await expect(client(fake.fetch).text('page-404')).rejects.toMatchObject({ code: 'not_found' });
});

test("names the bot's workspace, or null where Notion's own example leaves it out", async () => {
  const fake = fakeFetch(fakeNotion({ workspace: () => workspace }));
  await expect(client(fake.fetch).bot()).resolves.toEqual({ id: '9188c6a5-7381-452f-b3dc-d4865aa89bdf', workspace_id: 'ws-1',
    workspace_name: 'Lumen' });
  const documented = { object: 'user', id: 'bot-1', name: 'Test Connection', avatar_url: null, type: 'bot',
    bot: { owner: { type: 'workspace', workspace: true }, workspace_name: 'Ada Lovelace’s Notion' } };
  await expect(client(fakeFetch([{ url: `${BASE}/users/me`, respond: () => Response.json(documented) }]).fetch).bot())
    .resolves.toEqual({ id: 'bot-1', workspace_id: null, workspace_name: 'Ada Lovelace’s Notion' });
});

test('reports a second 429 in a row as rate_limited, with its wait', async () => {
  const limited = (seconds: string) => () => Response.json({ object: 'error', status: 429, code: 'rate_limited',
    message: 'You have been rate limited. Please try again later.' }, { status: 429, headers: { 'retry-after': seconds } });
  const fake = fakeFetch([{ url: `${BASE}/search`, respond: sequence(limited('0.001'), limited('37')) }]);
  await expect(client(fake.fetch).pages({})).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 37000 });
  expect(fake.calls).toHaveLength(2);
});
