import { afterEach, expect, test, vi } from 'vitest';
import { defineProvider, type Entry } from './catalogue.js';
import { client } from './client.js';
import { ProviderHttpError } from './errors.js';
import { fakeFetch, sequence } from './testing.js';

const BASE = 'https://api.acme.test/v1';
const acme = defineProvider({
  id: 'acme', name: 'Acme Tasks', auth: [{ kind: 'key' }], http: { baseUrl: BASE, retry: { defaultWaitMs: 0 } },
  paging: { cursor: { kind: 'cursor', next: 'meta.next', send: { query: 'cursor' } }, link: { kind: 'nextUrl', next: 'next' } },
  operations: {
    'issues.list': { path: '/teams/{teamId}/issues', paging: 'cursor', records: 'data.items',
      params: { teamId: { in: 'path', type: 'string', required: true }, state: { in: 'query', type: 'string', enum: ['open', 'closed'] },
        limit: { in: 'query', type: 'integer' } },
      result: { data: { items: [{ id: 'string', title: 'string', 'labels?': ['string'] }] } } },
    'issues.get': { path: '/issues/{id}', notFound: 'null', params: { id: { in: 'path', type: 'string', required: true } },
      result: { id: 'string', 'assignee?': 'string', count: 'integer' } },
    'issues.create': { method: 'POST', path: '/issues', params: { title: { in: 'body', type: 'string', required: true },
      estimate: { in: 'body', type: { points: 'integer', 'unit?': 'string' } }, parent: { in: 'body', type: 'string', nullable: true },
      note: { in: 'body', type: 'string' } } },
    'issues.search': { method: 'POST', kind: 'read', path: '/issues/search', params: { q: { in: 'body', type: 'string' } } },
    'issues.touch': { kind: 'write', path: '/touch' },
    'requests.list': { path: '/requests' },
    viewer: { kind: 'read', graphql: 'query Viewer($first: Int) { viewer { id } }', params: { first: { in: 'variables', type: 'integer' } } },
  },
});
const json = (body: unknown, status = 200) => () => Response.json(body, { status });
const setup = (respond: () => Response, options: Partial<Parameters<typeof client>[1]> = {}) => {
  const fake = fakeFetch([{ url: /https:/, respond }]);
  return { fake, api: client(acme, { token: 'k', fetch: fake.fetch, ...options }) };
};
const wire = (fake: ReturnType<typeof fakeFetch>) => fake.calls.map(({ method, url, body }) => [method, url, body]);
/** Calls an operation as an untyped caller would. */
const untyped = (method: unknown) => method as (args?: Record<string, unknown>) => unknown;
afterEach(() => { vi.unstubAllGlobals(); });

test('each parameter goes to its place; a path value is one encoded segment; an undeclared or undefined one is not sent', async () => {
  const { fake, api } = setup(json({ id: 'x', count: 1 }));
  await api.issues.get({ id: 'a/b?c#d ../e' });
  await api.issues.create({ title: 'Ship', estimate: { points: 3 }, parent: null });
  await untyped(api.issues.create)({ title: 'Ship', note: undefined, extra: 'x', estimate: { points: 1, sneaky: true } });
  await api.issues.search({ q: 'bug' });
  await api.viewer({ first: 2 });
  await api.viewer();
  expect(wire(fake)).toEqual([
    ['GET', `${BASE}/issues/a%2Fb%3Fc%23d%20..%2Fe`, ''],
    ['POST', `${BASE}/issues`, '{"title":"Ship","estimate":{"points":3},"parent":null}'],
    ['POST', `${BASE}/issues`, '{"title":"Ship","estimate":{"points":1}}'],
    ['POST', `${BASE}/issues/search`, '{"q":"bug"}'],
    ['POST', BASE, '{"query":"query Viewer($first: Int) { viewer { id } }","variables":{"first":2}}'],
    ['POST', BASE, '{"query":"query Viewer($first: Int) { viewer { id } }","variables":{}}'],
  ]);
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer k');
});

test('an argument the request cannot carry is a TypeError before any request', async () => {
  const { fake, api } = setup(json({}));
  for (const [args, message] of [[{}, 'param_missing: id'], [{ id: null }, 'param_missing: id'], [{ id: '..' }, 'param_invalid: id'],
    [{ id: '' }, 'param_invalid: id'], [{ id: 7 }, 'param_invalid: id']] as const) {
    await expect(untyped(api.issues.get)(args)).rejects.toThrow(new TypeError(message));
  }
  await expect(untyped(api.issues.create)({ title: 'x', estimate: { points: 1.5 } })).rejects.toThrow(new TypeError('param_invalid: estimate'));
  const list = api.issues.list as unknown as (args: object) => AsyncGenerator;
  await expect(list({}).next()).rejects.toThrow(new TypeError('param_missing: teamId'));
  await expect(list({ teamId: 'T', state: 'merged' }).next()).rejects.toThrow(new TypeError('param_invalid: state'));
  expect(fake.calls).toEqual([]);
});

test('an answer keeps its declared keys; a key? missing or null is absent; anything else out of shape is invalid_response', async () => {
  const { api } = setup(sequence(json({ id: 'x', count: 2, assignee: null, secret: 's' }), json({ id: 'x', count: 2.5 }), json({ count: 1 })));
  expect(await api.issues.get({ id: 'x' })).toStrictEqual({ id: 'x', count: 2 });
  await expect(api.issues.get({ id: 'x' })).rejects.toEqual(new ProviderHttpError('invalid_response', null));
  await expect(api.issues.get({ id: 'x' })).rejects.toEqual(new ProviderHttpError('invalid_response', null));
});

test('notFound: null answers a 404 with null; any other operation keeps not_found', async () => {
  const { api } = setup(json({ message: 'nope' }, 404));
  expect(await api.issues.get({ id: 'x' })).toBeNull();
  await expect(api.issues.create({ title: 'x' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
});

test('a read is retried after a 429, a POST read included; a write never, a GET write included', async () => {
  const limited = () => sequence(json({}, 429), json({}));
  type Api = ReturnType<typeof setup>['api'];
  for (const call of [(api: Api) => api.issues.search({ q: 'x' }), (api: Api) => api.viewer()]) {
    const { fake, api } = setup(limited());
    await call(api);
    expect(fake.calls).toHaveLength(2);
  }
  // A caller's signal turns the retry off, a read's included.
  for (const call of [(api: Api) => api.issues.create({ title: 'x' }), (api: Api) => api.issues.touch(),
    (api: Api) => api.issues.search({}, { signal: new AbortController().signal })]) {
    const { fake, api } = setup(limited());
    await expect(call(api)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fake.calls).toHaveLength(1);
  }
});

test('a paged operation yields its records page by page, skips a bad one and returns the skipped ids', async () => {
  const { fake, api } = setup(sequence(
    json({ data: { items: [{ id: 'i1', title: 'One', labels: null, extra: 1 }, { id: 'bad-1' }] }, meta: { next: 'c2' } }),
    json({ data: { items: [{ id: 'i2', title: 'Two', labels: ['a'] }, { id: 9, title: 'Nine' }, 'junk'] }, meta: {} })));
  const records = api.issues.list({ teamId: 'T 1', state: 'open', limit: 10 });
  const seen: unknown[] = [];
  let next = await records.next();
  for (; next.done !== true; next = await records.next()) seen.push(next.value);
  expect(seen).toStrictEqual([{ id: 'i1', title: 'One' }, { id: 'i2', title: 'Two', labels: ['a'] }]);
  expect(next.value).toEqual(['bad-1', '9', null]);
  expect(fake.calls.map(call => call.url)).toEqual([`${BASE}/teams/T%201/issues?state=open&limit=10`,
    `${BASE}/teams/T%201/issues?state=open&limit=10&cursor=c2`]);
  const { api: broken } = setup(json({ data: { items: 'none' }, meta: {} }));
  await expect(broken.issues.list({ teamId: 'T' }).next()).rejects.toEqual(new ProviderHttpError('invalid_response', null));
});

test('json and request are authenticated, classified and carry no provider body; paginate walks a declared shape', async () => {
  const { fake, api } = setup(sequence(json({ ok: 1 }), json({ error: 'token k is bad' }, 403), json({}, 202),
    json({ meta: { next: 'c2' } }), json({ meta: {} })));
  expect(await api.json('/self')).toEqual({ ok: 1 });
  const refused = await api.json('/self').catch((error: unknown) => error);
  expect(refused).toEqual(new ProviderHttpError('rejected', 403));
  expect(JSON.stringify(refused)).not.toContain('bad');
  expect((await api.request('/jobs', { method: 'POST' })).status).toBe(202);
  const pages: unknown[] = [];
  for await (const page of api.paginate('cursor', '/issues')) pages.push(page);
  expect(pages).toEqual([{ meta: { next: 'c2' } }, { meta: {} }]);
  expect(fake.calls.map(call => call.headers.authorization)).toEqual(Array(5).fill('Bearer k'));
  expect(() => client(acme as Entry, { token: 'k' }).paginate('offset', '/issues')).toThrow(new TypeError('paging_unknown: offset'));
});

test('a string token and a function token send the same header; a missing or blank one is refused at once', async () => {
  const one = setup(json({}));
  const two = setup(json({}), { token: () => Promise.resolve('k') });
  await one.api.json('/x');
  await two.api.json('/x');
  expect(two.fake.calls[0]?.headers).toEqual(one.fake.calls[0]?.headers);
  for (const token of [undefined, '', ' ']) expect(() => client(acme, { token })).toThrow(new TypeError('token_missing'));
});

test("the HTTP client's options pass through: beforeRequest once per call, baseUrl for every call and next link, the global fetch", async () => {
  const seen: string[] = [];
  const { fake, api } = setup(sequence(json({ id: 'x', count: 1 }), json({ next: 'https://api.acme.test/v2/feed?page=2' }),
    json({ next: `${BASE}/feed?page=3` })), { baseUrl: 'https://api.acme.test/v2', beforeRequest: url => { seen.push(url.pathname); } });
  await api.issues.get({ id: 'x' });
  const pages = api.paginate('link', '/feed');
  await pages.next();
  // The second page names a link off the client's base: walk refuses it before that page is yielded.
  await expect(pages.next()).rejects.toMatchObject({ code: 'invalid_response', detail: 'next_link_foreign' });
  expect(seen).toEqual(['/v2/issues/x', '/v2/feed', '/v2/feed']);
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.acme.test/v2/issues/x', 'https://api.acme.test/v2/feed',
    'https://api.acme.test/v2/feed?page=2']);
  const global = fakeFetch([{ url: /https:/, respond: json({}) }]);
  vi.stubGlobal('fetch', global.fetch);
  await client(acme, { token: 'k' }).requests.list();
  expect(global.calls.map(call => call.url)).toEqual([`${BASE}/requests`]);
});

test('an operation id is nested by its dots beside the raw calls', () => {
  const { api } = setup(json({}));
  expect([typeof api.requests.list, typeof api.request, typeof api.issues.get]).toEqual(['function', 'function', 'function']);
});

test("an app's entry that would send a wrong request is a TypeError naming the cause", async () => {
  const wrong = { id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE },
    operations: {
      stray: { path: '/a', params: { id: { in: 'path', type: 'string' } } },
      lost: { path: '/b/{id}' },
      list: { path: '/c', paging: 'none' },
      flat: { path: '/d', params: { ids: { in: 'query', type: ['string'] } } },
      shapeless: { path: '/e', paging: 'cursor', records: 'items', result: { items: 'string' } },
    },
    paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'c' } } } } as const satisfies Entry;
  const fake = fakeFetch([]);
  const api = client(wrong as Entry, { token: 'k', fetch: fake.fetch }) as unknown as Record<string, (args?: object) => unknown>;
  const call = async (name: string, args = {}) => {
    const result = api[name]?.(args);
    return await (result && typeof result === 'object' && 'next' in result ? (result as AsyncGenerator).next() : result);
  };
  await expect(call('stray', { id: 'x' })).rejects.toThrow(new TypeError('param_unplaced: stray id'));
  await expect(call('lost')).rejects.toThrow(new TypeError('param_missing: id'));
  await expect(call('list')).rejects.toThrow(new TypeError('paging_unknown: none'));
  await expect(call('flat', { ids: ['a'] })).rejects.toThrow(new TypeError('param_invalid: ids'));
  await expect(call('shapeless')).rejects.toThrow(new TypeError('records_unshaped: shapeless'));
  expect(fake.calls).toEqual([]);
});
