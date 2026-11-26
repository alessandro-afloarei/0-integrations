import { expect, test } from 'vitest';
import { defineProvider, type Paging } from './catalogue.js';
import { createClient, type RequestOptions } from './http.js';
import { followed, nextCursor, ownPath, walk } from './paging.js';
import { clickup } from './catalogue/clickup.js';
import { client } from './client.js';
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
  expect(followed(graph, BASE, `${BASE}/me/messages?$skip=10`)).toBe('/me/messages?$skip=10');
  expect(followed(graph, BASE, undefined)).toBeNull();
  for (const link of ['https://elsewhere.test/v1.0/me/x', `${BASE}/users/x`, `${BASE}/me/%2e%2e/%2e%2e/users`,
    'http://graph.microsoft.com/v1.0/me/x', 'https://graph.microsoft.com:8443/v1.0/me/x', '//graph.microsoft.com/v1.0/me/x',
    'https://graph.microsoft.com@elsewhere.test/v1.0/me/x', 'https:\\\\elsewhere.test\\v1.0\\me\\x',
    'https://graph.microsoft.com/v1.0evil/me/x', '/v1.0/users/x', `blob:${BASE}/me/x`]) {
    expect(() => followed(graph, BASE, link)).toThrow(expect.objectContaining({ detail: 'next_link_foreign' }));
  }
  expect(ownPath(graph, BASE, `${BASE}/me/../users`)).toBeNull();
  // A path is read on the base's origin, then by the same rule.
  expect(ownPath(graph, BASE, '/v1.0/me/x')).toBe('/me/x');
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

const linkBase = 'https://api.k.test/v2';
const linkHeader = { kind: 'linkHeader' } as const;
/** Every request's URL and every page a walk on `linkBase` yields, or the error it ends on: each answer a body and its
 * `Link` header (none when null), or a bare status. */
async function linkWalk(shape: Paging, answers: readonly (readonly [body: unknown, link: string | null] | number)[]) {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(...answers.map(answer => () => (typeof answer === 'number'
    ? new Response(null, { status: answer })
    : Response.json(answer[0], { headers: answer[1] === null ? {} : { link: answer[1] } })))) }]);
  const pages: unknown[] = [];
  let error: unknown;
  try {
    for await (const page of walk(createClient(acme, { baseUrl: linkBase, token, fetch: fake.fetch }), shape, '/builds', { query: { per_page: '2' } })) pages.push(page);
  } catch (caught) { error = caught; }
  return { urls: fake.calls.map(call => call.url), pages, error };
}

test("linkHeader: walks the rel=\"next\" links to the end, and a page with no header ends it", async () => {
  const walked = await linkWalk(linkHeader, [
    [[1], `<${linkBase}/builds?page=2&per_page=2>; rel="next", <${linkBase}/builds?page=3&per_page=2>; rel="last"`],
    [[2], `<${linkBase}/builds?page=1&per_page=2>; rel="prev",<${linkBase}/builds?page=3&per_page=2>; rel="next last"`],
    [[3], null]]);
  expect(walked.urls).toEqual([`${linkBase}/builds?per_page=2`, `${linkBase}/builds?page=2&per_page=2`, `${linkBase}/builds?page=3&per_page=2`]);
  expect(walked.pages).toEqual([[1], [2], [3]]);
  expect(walked.error).toBeUndefined();
  const last = await linkWalk(linkHeader, [[[1], `<${linkBase}/builds?page=1>; rel="first prev"`]]);
  expect([last.urls.length, last.error]).toEqual([1, undefined]);
});

test('linkHeader: a quoted parameter holding `<`, `,` or `; rel=next` is no link and no rel (RFC 8288 quoted-string)', async () => {
  const next = `${linkBase}/builds?page=2`;
  // A valid header whose title holds a link-like `<x>` and a `rel=next`: the real next link is followed.
  const titled = await linkWalk(linkHeader, [[[1], `<${next}>; title="see <x>, then; rel=next" ; rel=next`], [[2], null]]);
  expect([titled.urls, titled.error]).toEqual([[`${linkBase}/builds?per_page=2`, next], undefined]);
  // A prev link whose title says `rel=next` is not followed.
  const prev = await linkWalk(linkHeader, [[[1], `<${linkBase}/builds?page=0>; title="a; rel=next" ; rel="prev"`]]);
  expect([prev.urls.length, prev.error]).toEqual([1, undefined]);
});

test('linkHeader: an error answer throws, as a json call does', async () => {
  const walked = await linkWalk(linkHeader, [[[1], `<${linkBase}/builds?page=2>; rel="next"`], 404]);
  expect(walked.error).toMatchObject({ code: 'not_found' });
  expect(walked.pages).toEqual([[1]]);
});

test("a next link that leaves the base's origin or path is next_link_foreign, never a request, from a header or a body", async () => {
  for (const link of ['https://evil.test/v2/builds?page=2', '//evil.test/v2/builds', 'https://api.k.test@evil.test/v2/builds',
    '/\\evil.test/v2/builds', '/v2/../admin', '/v2/%2e%2e/admin', '/v2/%2E%2E/admin', 'v2/builds?page=2', '/v3/builds',
    'http://api.k.test/v2/builds', `${linkBase}/x/builds`]) {
    for (const [shape, answer] of [[{ kind: 'linkHeader', pathPrefix: '/builds/' }, [[1], `<${link}>; rel="next"`]],
      [{ kind: 'nextUrl', next: '_links.next', pathPrefix: '/builds/' }, [{ _links: { next: link } }, null]]] as const) {
      const walked = await linkWalk(shape, [answer, answer]);
      expect(walked.error, link).toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
      expect(walked.urls).toEqual([`${linkBase}/builds?per_page=2`]);
    }
  }
});

test("a next link that is a path resolves on the base's origin and must sit under the base's path and pathPrefix", async () => {
  // Shortcut's search: `next` is "the URL path and query string for the next page", on a base that is the origin.
  const origin = 'https://api.k.test';
  const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ data: [1], next: '/api/v3/search/stories?query=x&next=c2' }),
    () => Response.json({ data: [2], next: null })) }]);
  for await (const page of walk(createClient(acme, { baseUrl: origin, token, fetch: fake.fetch }),
    { kind: 'nextUrl', next: 'next' }, '/api/v3/search/stories', { query: { query: 'x' } })) expect(page).toBeTypeOf('object');
  expect(fake.calls.map(call => call.url)).toEqual([`${origin}/api/v3/search/stories?query=x`, `${origin}/api/v3/search/stories?query=x&next=c2`]);
  // On a base with a path, a path keeps the base's path and the prefix after it.
  expect(ownPath({ kind: 'linkHeader' }, linkBase, '/v2/builds?page=2')).toBe('/builds?page=2');
  expect(ownPath({ kind: 'nextUrl', next: 'next', pathPrefix: '/builds/' }, linkBase, '/v2/builds/x?page=2')).toBe('/builds/x?page=2');
  for (const link of ['/builds/x?page=2', '/v2/admin/x', '/v2x/builds/x']) {
    expect(ownPath({ kind: 'nextUrl', next: 'next', pathPrefix: '/builds/' }, linkBase, link)).toBeNull();
  }
});

test('linkHeader: a link that comes back is cursor_repeated', async () => {
  const again = `<${linkBase}/builds?page=2>; rel="next"`;
  const walked = await linkWalk(linkHeader, [[[1], again], [[2], again]]);
  expect(walked.error).toMatchObject({ code: 'invalid_response', detail: 'cursor_repeated' });
  expect(walked.urls).toEqual([`${linkBase}/builds?per_page=2`, `${linkBase}/builds?page=2`]);
});

/** Every request's URL and every page a page-number walk yields, or the error it ends on. */
async function pageWalk(shape: Paging, answers: readonly unknown[], options: RequestOptions = {}) {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(...answers.map(answer => () => Response.json(answer))) }]);
  const pages: unknown[] = [];
  let error: unknown;
  try { for await (const page of walk(createClient(acme, { token, fetch: fake.fetch }), shape, '/items', options)) pages.push(page); } catch (caught) { error = caught; }
  return { urls: fake.calls.map(call => call.url), bodies: fake.calls.map(call => call.body), pages, error };
}

test('page: the first request sends no page, then 2, 3; an empty list ends the walk', async () => {
  const walked = await pageWalk({ kind: 'page', send: { query: 'page' }, list: 'result.items' },
    [{ result: { items: [1] } }, { result: { items: [2] } }, { result: { items: [] } }], { query: { status: 'active' } });
  expect(walked.urls).toEqual(['https://api.acme.test/items?status=active', 'https://api.acme.test/items?status=active&page=2',
    'https://api.acme.test/items?status=active&page=3']);
  expect(walked.pages).toEqual([{ result: { items: [1] } }, { result: { items: [2] } }, { result: { items: [] } }]);
  expect(walked.error).toBeUndefined();
});

test('page: zeroBased sends nothing, then 1; a body page is a number', async () => {
  const zero = await pageWalk({ kind: 'page', send: { query: 'page' }, list: 'tasks', zeroBased: true }, [{ tasks: [1] }, { tasks: [] }]);
  expect(zero.urls).toEqual(['https://api.acme.test/items', 'https://api.acme.test/items?page=1']);
  const body = await pageWalk({ kind: 'page', send: { body: 'page' } }, [[1], []], { method: 'POST', json: { q: 'x' } });
  expect(body.bodies).toEqual(['{"q":"x"}', '{"q":"x","page":2}']);
});

test('page: a falsy more ends the walk before an empty page', async () => {
  const walked = await pageWalk({ kind: 'page', send: { query: 'page' }, list: 'data', more: 'has_more' },
    [{ data: [1], has_more: true }, { data: [2], has_more: false }, { data: [] }]);
  expect(walked.urls).toEqual(['https://api.acme.test/items', 'https://api.acme.test/items?page=2']);
  expect(walked.error).toBeUndefined();
});

test('page: a provider that ignores the page number is page_repeated, and the repeat is never yielded', async () => {
  const walked = await pageWalk({ kind: 'page', send: { query: 'page' }, list: 'data', more: 'has_more' },
    [{ data: [1], has_more: true }]);
  expect(walked.error).toMatchObject({ code: 'invalid_response', detail: 'page_repeated' });
  expect(walked.urls).toEqual(['https://api.acme.test/items', 'https://api.acme.test/items?page=2']);
  expect(walked.pages).toEqual([{ data: [1], has_more: true }]);
});

test('page: a missing list path, or an answer that is not a list, is invalid_response, never an empty end', async () => {
  for (const [shape, answer] of [[{ kind: 'page', send: { query: 'page' }, list: 'result.items' }, { result: {} }],
    [{ kind: 'page', send: { query: 'page' } }, { items: [1] }], [{ kind: 'page', send: { query: 'page' }, list: 'items' }, { items: 'x' }]] as const) {
    const walked = await pageWalk(shape, [answer, answer]);
    expect(walked.urls).toEqual(['https://api.acme.test/items']);
    expect(walked.pages).toEqual([]);
    expect(walked.error).toMatchObject({ code: 'invalid_response', detail: 'missing_fields' });
  }
});

test('ClickUp tasks.list, through client() and raw paginate: { tasks: [] } ends cleanly, {} fails loudly', async () => {
  const run = async (last: unknown, read: (api: ReturnType<typeof client<typeof clickup>>) => AsyncGenerator<unknown>) => {
    const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ tasks: [{ id: 't1' }] }), () => Response.json(last)) }]);
    const seen: unknown[] = [];
    try { for await (const item of read(client(clickup, { token, fetch: fake.fetch }))) seen.push(item); } catch (error) { return { seen, error }; }
    return { seen, error: undefined };
  };
  for (const read of [(api: ReturnType<typeof client<typeof clickup>>) => api.tasks.list({ list_id: 5 }),
    (api: ReturnType<typeof client<typeof clickup>>) => api.paginate('page', '/list/5/task')]) {
    expect((await run({ tasks: [] }, read)).error).toBeUndefined();
    const broken = await run({}, read);
    expect(broken.seen).toHaveLength(1);
    expect(broken.error).toMatchObject({ code: 'invalid_response' });
  }
});
