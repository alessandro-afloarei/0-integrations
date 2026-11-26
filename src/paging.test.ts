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
});

const acme = defineProvider({ id: 'acme', name: 'Acme', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' } });
test('walk sends the cursor where the shape says, and refuses one that comes back', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ paging: { after: 'a1' } }), () => Response.json({ paging: { after: 'a1' } })) }]);
  const http = createClient(acme, { token: () => Promise.resolve('t'), fetch: fake.fetch });
  const shape = { kind: 'cursor', next: 'paging.after', send: { query: 'after' } } as const;
  const pages: unknown[] = [];
  await expect((async () => { for await (const page of walk(http, acme.http.baseUrl, shape, '/owners', { query: { limit: '100' } })) pages.push(page); })())
    .rejects.toMatchObject({ detail: 'cursor_repeated' });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.acme.test/owners?limit=100', 'https://api.acme.test/owners?limit=100&after=a1']);
});

test('walk follows a next link with its own search, and a body cursor goes in the body', async () => {
  const links = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ next: 'https://api.acme.test/me/x?page=2' }), () => Response.json({})) }]);
  const pages: unknown[] = [];
  for await (const page of walk(createClient(acme, { token: () => Promise.resolve('t'), fetch: links.fetch }), acme.http.baseUrl,
    { kind: 'nextUrl', next: 'next' }, '/me/x', { query: { top: '2' } })) pages.push(page);
  expect(links.calls.map(call => call.url)).toEqual(['https://api.acme.test/me/x?top=2', 'https://api.acme.test/me/x?page=2']);
  expect(pages).toHaveLength(2);
  const bodies = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ next: 'b2' }), () => Response.json({})) }]);
  for await (const page of walk(createClient(acme, { token: () => Promise.resolve('t'), fetch: bodies.fetch }), acme.http.baseUrl,
    { kind: 'cursor', next: 'next', send: { body: 'start' } }, '/search', { method: 'POST', json: { q: 'x' } })) pages.push(page);
  expect(bodies.calls.map(call => call.body)).toEqual(['{"q":"x"}', '{"q":"x","start":"b2"}']);
});

test('a next link on another origin is an error, never a request', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ next: 'https://evil.test/me/x?page=2' }) }]);
  const read = async () => { for await (const page of walk(createClient(acme, { token: () => Promise.resolve('t'), fetch: fake.fetch }),
    acme.http.baseUrl, { kind: 'nextUrl', next: 'next' }, '/me/x')) expect(page).toBeDefined(); };
  await expect(read()).rejects.toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.acme.test/me/x']);
});
