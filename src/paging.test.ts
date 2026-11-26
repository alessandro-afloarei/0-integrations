import { expect, test } from 'vitest';
import { defineProvider } from './catalogue.js';
import { createClient } from './http.js';
import { nextCursor, nextLink, ownPath, walk } from './paging.js';
import { fakeFetch, sequence } from './testing.js';

const cursor = { kind: 'cursor', next: 'pagination.cursor', more: 'pagination.hasMore', send: { query: 'cursor' } } as const;
test('cursor: more decides, and a blank cursor with more is cursor_missing', () => {
  expect(nextCursor(cursor, { pagination: { hasMore: true, cursor: 'c2' } })).toBe('c2');
  expect(nextCursor(cursor, { pagination: { hasMore: false, cursor: 'c2' } })).toBeNull();
  expect(() => nextCursor(cursor, { pagination: { hasMore: true, cursor: '' } })).toThrow(expect.objectContaining({ code: 'invalid_response', detail: 'cursor_missing' }));
  const bare = { kind: 'cursor', next: 'response_metadata.next_cursor', send: { query: 'cursor' } } as const;
  expect(nextCursor(bare, { response_metadata: { next_cursor: '' } })).toBeNull();
  expect(nextCursor(bare, {})).toBeNull();
});

const graph = { kind: 'nextUrl', next: '@odata.nextLink', pathPrefix: '/me/' } as const;
const BASE = 'https://graph.microsoft.com/v1.0';
test("nextUrl stays on the provider's origin and under its prefix", () => {
  expect(nextLink(graph, BASE, { '@odata.nextLink': `${BASE}/me/messages?$skip=10` })).toBe('/me/messages?$skip=10');
  expect(nextLink(graph, BASE, {})).toBeNull();
  for (const link of ['https://elsewhere.test/v1.0/me/x', `${BASE}/users/x`, `${BASE}/me/%2e%2e/%2e%2e/users`,
    'http://graph.microsoft.com/v1.0/me/x', 'https://graph.microsoft.com:8443/v1.0/me/x', '//graph.microsoft.com/v1.0/me/x',
    'https://graph.microsoft.com@elsewhere.test/v1.0/me/x', 'https:\\\\elsewhere.test\\v1.0\\me\\x',
    'https://graph.microsoft.com/v1.0evil/me/x', '/v1.0/me/x', `blob:${BASE}/me/x`]) {
    expect(() => nextLink(graph, BASE, { '@odata.nextLink': link })).toThrow(expect.objectContaining({ detail: 'next_link_foreign' }));
  }
  expect(ownPath(graph, BASE, `${BASE}/me/../users`)).toBeNull();
  // A link the parser reads onto the same origin is a path on the base: the userinfo and the default port drop.
  for (const link of ['https://user:pass@graph.microsoft.com/v1.0/me/x', 'https://graph.microsoft.com:443/v1.0/me/x',
    'https://graph.microsoft.com\\v1.0\\me\\x']) expect(ownPath(graph, BASE, link)).toBe('/me/x');
  expect(ownPath({ kind: 'nextUrl', next: 'next' }, 'https://api.acme.test', 'blob:https://api.acme.test/me/x')).toBeNull();
  // An app's own entry may declare any prefix: the link must still sit under the base's path, as a whole segment.
  for (const pathPrefix of ['', 'me/']) expect(ownPath({ kind: 'nextUrl', next: 'next', pathPrefix }, BASE, 'https://graph.microsoft.com/v1.0evil/me/x')).toBeNull();
  expect(ownPath({ kind: 'nextUrl', next: 'next', pathPrefix: '' }, 'https://api.acme.test', 'blob:https://api.acme.test/x')).toBeNull();
});

test("nextUrl without a pathPrefix follows a link to the base's own path; with one, or beside it, it does not", () => {
  const plain = { kind: 'nextUrl', next: 'next' } as const;
  expect(ownPath(plain, 'https://api.acme.test/v1/items', 'https://api.acme.test/v1/items?page=2')).toBe('?page=2');
  expect(ownPath(plain, 'https://api.acme.test/v1', 'https://api.acme.test/v1')).toBe('');
  expect(ownPath({ ...plain, pathPrefix: '/me/' }, 'https://api.acme.test/v1', 'https://api.acme.test/v1?page=2')).toBeNull();
  for (const link of ['https://api.acme.test/v1evil', 'https://api.acme.test/v1evil?page=2']) {
    expect(ownPath(plain, 'https://api.acme.test/v1', link)).toBeNull();
  }
});

const acme = defineProvider({ id: 'acme', name: 'Acme', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' } });
const token = () => Promise.resolve('t');
test('walk sends the cursor where the shape says, and refuses one that comes back', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ paging: { after: 'a1' } }), () => Response.json({ paging: { after: 'a1' } })) }]);
  const shape = { kind: 'cursor', next: 'paging.after', send: { query: 'after' } } as const;
  const pages: unknown[] = [];
  await expect((async () => { for await (const page of walk(createClient(acme, { token, fetch: fake.fetch }), shape, '/owners', { query: { limit: '100' } })) pages.push(page); })())
    .rejects.toMatchObject({ detail: 'cursor_repeated' });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.acme.test/owners?limit=100', 'https://api.acme.test/owners?limit=100&after=a1']);
  expect(pages).toEqual([{ paging: { after: 'a1' } }, { paging: { after: 'a1' } }]);
});

test("walk follows a next link with its own search on the client's base, and a body cursor goes in the body", async () => {
  const links = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ next: 'https://api.acme.test/v1/me/x?page=2' }), () => Response.json({})) }]);
  const pages: unknown[] = [];
  for await (const page of walk(createClient(acme, { baseUrl: 'https://api.acme.test/v1', token, fetch: links.fetch }),
    { kind: 'nextUrl', next: 'next' }, '/me/x', { query: { top: '2' } })) pages.push(page);
  expect(links.calls.map(call => call.url)).toEqual(['https://api.acme.test/v1/me/x?top=2', 'https://api.acme.test/v1/me/x?page=2']);
  expect(pages).toEqual([{ next: 'https://api.acme.test/v1/me/x?page=2' }, {}]);
  const bodies = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ next: 'b2' }), () => Response.json({})) }]);
  for await (const page of walk(createClient(acme, { token, fetch: bodies.fetch }),
    { kind: 'cursor', next: 'next', send: { body: 'start' } }, '/search', { method: 'POST', json: { q: 'x' } })) expect(page).toBeTypeOf('object');
  expect(bodies.calls.map(call => call.body)).toEqual(['{"q":"x"}', '{"q":"x","start":"b2"}']);
});

test('walk follows a next link to the base itself with its query', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ next: 'https://api.acme.test/v1/items?page=2' }),
    () => Response.json({})) }]);
  const pages: unknown[] = [];
  for await (const page of walk(createClient(acme, { baseUrl: 'https://api.acme.test/v1/items', token, fetch: fake.fetch }),
    { kind: 'nextUrl', next: 'next' }, '', { query: { top: '2' } })) pages.push(page);
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.acme.test/v1/items?top=2', 'https://api.acme.test/v1/items?page=2']);
});

test("a next link that leaves the base's origin or path is an error, never a request", async () => {
  for (const [baseUrl, pathPrefix, link] of [['https://api.acme.test', '/', 'https://evil.test/me/x?page=2'],
    ['https://api.acme.test/v1', '', 'https://api.acme.test/v1evil/me/x'], ['https://api.acme.test/v1', 'me/', 'https://api.acme.test/v1evil/me/x'],
    ['https://api.acme.test', '', 'blob:https://api.acme.test/x']] as const) {
    const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ next: link }) }]);
    await expect(walk(createClient(acme, { baseUrl, token, fetch: fake.fetch }), { kind: 'nextUrl', next: 'next', pathPrefix }, '/me/x').next())
      .rejects.toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
    expect(fake.calls.map(call => call.url)).toEqual([`${baseUrl}/me/x`]);
  }
});
