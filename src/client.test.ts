import { afterEach, expect, test, vi } from 'vitest';
import { defineProvider, type Entry } from './catalogue.js';
import { helpscout } from './catalogue/helpscout.js';
import { client } from './client.js';
import { ProviderHttpError } from './errors.js';
import { fakeFetch, sequence } from './testing.js';

const BASE = 'https://api.acme.test/v1';
const acme = defineProvider({
  id: 'acme', name: 'Acme Tasks', auth: [{ kind: 'key' }], http: { baseUrl: BASE, retry: { defaultWaitMs: 0 } },
  paging: { cursor: { kind: 'cursor', next: 'meta.next', send: { query: 'cursor' } }, link: { kind: 'nextUrl', next: 'next' },
    header: { kind: 'linkHeader' } },
  operations: {
    'issues.list': { path: '/teams/{teamId}/issues', paging: 'cursor', records: 'data.items',
      params: { teamId: { in: 'path', type: 'string', required: true }, state: { in: 'query', type: 'string', enum: ['open', 'closed'] },
        limit: { in: 'query', type: 'integer' } },
      result: { data: { items: [{ id: 'string', title: 'string', 'labels?': ['string'] }] } } },
    'issues.get': { path: '/issues/{id}', notFound: 'null', params: { id: { in: 'path', type: 'string', required: true } },
      result: { id: 'string', 'assignee?': 'string', count: 'integer' } },
    'issues.create': { method: 'POST', path: '/issues', params: { title: { in: 'body', type: 'string', required: true },
      estimate: { in: 'body', type: { points: 'integer', 'unit?': 'string' } }, parent: { in: 'body', type: 'string', nullable: true },
      note: { in: 'body', type: 'string' }, status: { in: 'body', type: 'string', enum: ['open', 'closed'], nullable: true } } },
    'issues.search': { method: 'POST', kind: 'read', path: '/issues/search', params: { q: { in: 'body', type: 'string' } } },
    'issues.touch': { kind: 'write', path: '/touch' },
    'issues.delete': { method: 'DELETE', path: '/issues/{id}', params: { id: { in: 'path', type: 'string', required: true } } },
    'issues.archive': { method: 'PUT', path: '/archive', result: { ok: 'boolean' } },
    'issues.rate': { method: 'POST', path: '/rate', params: { score: { in: 'body', type: 'number' } } },
    'issues.raw': { path: '/raw', result: { raw: 'unknown' } },
    feed: { path: '/feed', paging: 'link', result: { 'next?': 'string', n: 'integer' } },
    'builds.list': { path: '/builds', paging: 'header', result: [{ id: 'string', 'number?': 'integer' }] },
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

test('an operation with a body parameter sends a JSON object, {} when given none; one with no body parameter sends none', async () => {
  const { fake, api } = setup(json({ ok: true }));
  await api.issues.rate();
  await api.issues.archive();
  expect(wire(fake)).toEqual([['POST', `${BASE}/rate`, '{}'], ['PUT', `${BASE}/archive`, '']]);
  expect(fake.calls[0]?.headers['content-type']).toBe('application/json');
});

/** Form parameters on a POST, under an entry whose every request names JSON. */
const former = defineProvider({ id: 'former', name: 'Former', auth: [{ kind: 'key' }],
  http: { baseUrl: BASE, headers: { 'content-type': 'application/json' } },
  operations: { 'messages.create': { method: 'POST', path: '/rooms/{room}/messages', anyOf: [['text'], ['file']],
    params: { room: { in: 'path', type: 'integer', required: true }, to: { in: 'form', type: 'integer', required: true },
      text: { in: 'form', type: 'string' }, file: { in: 'form', type: 'string' }, unread: { in: 'form', type: 'boolean' },
      extra: { in: 'form', type: 'unknown' } } } } });
const FORM = 'application/x-www-form-urlencoded;charset=UTF-8';

test("form parameters are sent as a form, each a string, its content type over the entry's and the app's", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  await client(former, { token: 'k', fetch: fake.fetch }).messages.create({ room: 7, to: 1, text: 'x' });
  const own = client(former, { token: 'k', fetch: fake.fetch, headers: { 'content-type': 'text/plain' } });
  await own.messages.create({ room: 7, to: 2, text: 'a & b=c', unread: true, extra: 3 });
  expect(wire(fake)).toEqual([['POST', `${BASE}/rooms/7/messages`, 'to=1&text=x'],
    ['POST', `${BASE}/rooms/7/messages`, 'to=2&text=a+%26+b%3Dc&unread=true&extra=3']]);
  expect(fake.calls.map(call => call.headers['content-type'])).toEqual([FORM, FORM]);
});

test('a form parameter is a scalar, required and grouped as a body one is, all checked before anything is sent', async () => {
  const fake = fakeFetch([]);
  const create = untyped(client(former, { token: 'k', fetch: fake.fetch }).messages.create);
  for (const [args, message] of [[{ room: 7, to: 1, text: 'x', extra: { a: 1 } }, 'param_invalid: extra'],
    [{ room: 7, to: 1, text: 'x', extra: ['a'] }, 'param_invalid: extra'], [{ room: 7, to: '1', text: 'x' }, 'param_invalid: to'],
    [{ room: 7, text: 'x' }, 'param_missing: to'], [{ room: 7, to: 1, text: ' ' }, 'param_group_missing: messages.create']] as const) {
    await expect(create(args)).rejects.toThrow(new TypeError(message));
  }
  expect(fake.calls).toEqual([]);
});

test('a nullable argument with an enum sends null, and is held to its enum otherwise', async () => {
  const { fake, api } = setup(json({}));
  await api.issues.create({ title: 'Ship', status: null });
  await api.issues.create({ title: 'Ship', status: 'open' });
  await expect(untyped(api.issues.create)({ title: 'Ship', status: 'merged' })).rejects.toThrow(new TypeError('param_invalid: status'));
  expect(fake.calls.map(call => call.body)).toEqual(['{"title":"Ship","status":null}', '{"title":"Ship","status":"open"}']);
});

test('an argument the request cannot carry is a TypeError before any request', async () => {
  const { fake, api } = setup(json({}));
  for (const [args, message] of [[{}, 'param_missing: id'], [{ id: null }, 'param_missing: id'], [{ id: '..' }, 'param_invalid: id'],
    [{ id: '' }, 'param_invalid: id'], [{ id: '.' }, 'param_invalid: id'], [{ id: 7 }, 'param_invalid: id']] as const) {
    await expect(untyped(api.issues.get)(args)).rejects.toThrow(new TypeError(message));
  }
  await expect(untyped(api.issues.create)({ title: 'x', estimate: { points: 1.5 } })).rejects.toThrow(new TypeError('param_invalid: estimate'));
  for (const score of [Number.NaN, Infinity, -Infinity]) {
    await expect(api.issues.rate({ score })).rejects.toThrow(new TypeError('param_invalid: score'));
  }
  const list = api.issues.list as unknown as (args: object) => AsyncGenerator;
  await expect(list({}).next()).rejects.toThrow(new TypeError('param_missing: teamId'));
  await expect(list({ teamId: 'T', state: 'merged' }).next()).rejects.toThrow(new TypeError('param_invalid: state'));
  expect(fake.calls).toEqual([]);
});

/** Literal types: a send fixed inside an object, an author fixed in each list element, a version fixed in a header. */
const fixed = defineProvider({ id: 'fixed', name: 'Fixed', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, operations: {
  'messages.create': { method: 'POST', path: '/drafts', params: { drafts: { in: 'body', required: true, type: { send: true, 'subject?': 'string' } } } },
  'threads.create': { method: 'POST', path: '/threads', params: { messages: { in: 'body', required: true, type: [{ actor_type: 'agent', 'text?': 'string' }] },
    kind: { in: 'body', type: 'string' }, 'x-version': { in: 'header', type: '2026-06-12', required: true } } } } });

test('a literal type fits only its value, at the top level, inside an object and in each list element; a type name stays a type', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  const api = client(fixed, { token: 'k', fetch: fake.fetch });
  await api.messages.create({ drafts: { send: true, subject: 'Hi' } });
  await api.threads.create({ messages: [{ actor_type: 'agent', text: 'a' }, { actor_type: 'agent' }], kind: 'x', 'x-version': '2026-06-12' });
  await api.threads.create({ messages: [], 'x-version': '2026-06-12' });
  expect(wire(fake)).toEqual([['POST', `${BASE}/drafts`, '{"drafts":{"send":true,"subject":"Hi"}}'],
    ['POST', `${BASE}/threads`, '{"messages":[{"actor_type":"agent","text":"a"},{"actor_type":"agent"}],"kind":"x"}'],
    ['POST', `${BASE}/threads`, '{"messages":[]}']]);
  expect(fake.calls.map(call => call.headers['x-version'])).toEqual([undefined, '2026-06-12', '2026-06-12']);
});

test('hostile: a value beside a literal is refused before anything is sent: false, missing, the string "true", a padded string', async () => {
  const fake = fakeFetch([]);
  const api = client(fixed, { token: 'k', fetch: fake.fetch });
  for (const drafts of [{ send: false }, {}, { send: 'true' }, { send: 1 }, { subject: 'Hi' }]) {
    await expect(untyped(api.messages.create)({ drafts })).rejects.toThrow(new TypeError('param_invalid: drafts'));
  }
  for (const messages of [[{ actor_type: 'agent' }, { actor_type: 'user' }], [{ actor_type: 'agent ' }], [{}], ['agent']]) {
    await expect(untyped(api.threads.create)({ messages, 'x-version': '2026-06-12' })).rejects.toThrow(new TypeError('param_invalid: messages'));
  }
  for (const version of ['2026-06-13', ' 2026-06-12', 20260612]) {
    await expect(untyped(api.threads.create)({ messages: [], 'x-version': version })).rejects.toThrow(new TypeError('param_invalid: x-version'));
  }
  expect(fake.calls).toEqual([]);
});

test('a boolean literal goes where a boolean goes, sent as its text: in a query and in a header', async () => {
  const flagged = defineProvider({ id: 'flagged', name: 'Flagged', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, operations: {
    'items.list': { path: '/items', params: { inbox: { in: 'query', type: true, required: true }, 'x-flag': { in: 'header', type: false, required: true } } } } });
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  const api = client(flagged, { token: 'k', fetch: fake.fetch });
  await api.items.list({ inbox: true, 'x-flag': false });
  await expect(untyped(api.items.list)({ inbox: false, 'x-flag': false })).rejects.toThrow(new TypeError('param_invalid: inbox'));
  await expect(untyped(api.items.list)({ inbox: true, 'x-flag': 'false' })).rejects.toThrow(new TypeError('param_invalid: x-flag'));
  expect(fake.calls.map(call => [call.url, call.headers['x-flag']])).toEqual([[`${BASE}/items?inbox=true`, 'false']]);
});

test('hostile: a hole in a list is an element, checked as one: a literal element left out is refused', async () => {
  const fake = fakeFetch([]);
  const messages = new Array<{ actor_type: 'agent' }>(2);
  messages[1] = { actor_type: 'agent' };
  await expect(client(fixed, { token: 'k', fetch: fake.fetch }).threads.create({ messages, 'x-version': '2026-06-12' }))
    .rejects.toThrow(new TypeError('param_invalid: messages'));
  expect(fake.calls).toEqual([]);
});

test("Help Scout's create keeps a thread's `draft` as given, so a call that saves a draft never sends a reply", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  await client(helpscout, { token: 'k', fetch: fake.fetch }).conversations.create({ subject: 'Hi', type: 'email', mailboxId: 1,
    status: 'active', customer: { email: 'ana@example.test' }, threads: [{ type: 'reply', text: 'Hello', draft: true }] });
  expect(JSON.parse(fake.calls[0]?.body ?? '{}')).toMatchObject({ threads: [{ type: 'reply', text: 'Hello', draft: true }] });
});

test('hostile: an own `__proto__` key beside a literal is read by the declared keys only', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  await untyped(client(fixed, { token: 'k', fetch: fake.fetch }).messages.create)(
    { drafts: JSON.parse('{"__proto__":{"send":false,"to":"x"},"send":true}') as unknown });
  expect(wire(fake)).toEqual([['POST', `${BASE}/drafts`, '{"drafts":{"send":true}}']]);
});

test('an answer keeps its declared keys; a key? missing or null is absent; anything else out of shape is invalid_response', async () => {
  const { api } = setup(sequence(json({ id: 'x', count: 2, assignee: null, secret: 's' }), json({ id: 'x', count: 2.5 }), json({ count: 1 })));
  expect(await api.issues.get({ id: 'x' })).toStrictEqual({ id: 'x', count: 2 });
  await expect(api.issues.get({ id: 'x' })).rejects.toEqual(new ProviderHttpError('invalid_response', null));
  await expect(api.issues.get({ id: 'x' })).rejects.toEqual(new ProviderHttpError('invalid_response', null));
  // A required 'unknown' key takes any value, null included, but must be there.
  const raw = setup(sequence(json({ raw: null }), json({ raw: [1, { a: 2 }] }), json({})));
  expect(await raw.api.issues.raw()).toStrictEqual({ raw: null });
  expect(await raw.api.issues.raw()).toStrictEqual({ raw: [1, { a: 2 }] });
  await expect(raw.api.issues.raw()).rejects.toEqual(new ProviderHttpError('invalid_response', null));
});

const answered = (status: number, body: string | null = null) => () => new Response(body, { status });

test('an operation with no result answers null for any 2xx with an empty body: a 202, a 201, whitespace, a 204', async () => {
  const { fake, api } = setup(sequence(answered(202), answered(201), answered(200, '   \n'), answered(204), answered(204)));
  expect(await api.issues.create({ title: 'a' })).toBeNull();
  expect(await api.issues.create({ title: 'b' })).toBeNull();
  expect(await api.issues.rate({ score: 1 })).toBeNull();
  expect(await api.requests.list()).toBeNull();
  expect(await api.issues.delete({ id: 'x' })).toBeNull();
  expect(wire(fake).map(([method]) => method)).toEqual(['POST', 'POST', 'POST', 'GET', 'DELETE']);
});

test('a body that is no JSON, or an empty 2xx to an operation with a result, is invalid_response; an error status throws', async () => {
  const { api } = setup(sequence(answered(202, '<html>proxy</html>'), answered(202), answered(204), answered(403)));
  await expect(api.issues.create({ title: 'a' })).rejects.toMatchObject({ code: 'invalid_response', status: 202 });
  await expect(api.issues.archive()).rejects.toMatchObject({ code: 'invalid_response', status: 202 });
  await expect(api.issues.archive()).rejects.toMatchObject({ code: 'invalid_response', status: 204 });
  await expect(api.issues.delete({ id: 'x' })).rejects.toMatchObject({ code: 'rejected', status: 403 });
});

test("hostile: an empty 2xx the entry's errors.failed marks still throws; a paged list's empty page is invalid_response", async () => {
  const failing = defineProvider({ id: 'failing', name: 'Failing', auth: [{ kind: 'key' }], http: { baseUrl: BASE },
    errors: { failed: { status: 200 } }, operations: { 'mail.send': { method: 'POST', path: '/send' } } });
  const fake = fakeFetch([{ url: /https:/, respond: answered(200) }]);
  await expect(client(failing, { token: 'k', fetch: fake.fetch }).mail.send()).rejects.toMatchObject({ code: 'request_failed', status: 200 });
  const { api } = setup(answered(200));
  await expect(api.issues.list({ teamId: 'T' }).next()).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
});

test('notFound: null answers a 404 with null; any other operation keeps not_found', async () => {
  const { api } = setup(json({ message: 'nope' }, 404));
  expect(await api.issues.get({ id: 'x' })).toBeNull();
  await expect(api.issues.create({ title: 'x' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
});

test('a read is retried after a 429, a POST read included; a write never, a GET write included', async () => {
  const limited = () => sequence(json({}, 429), json({}));
  type Api = ReturnType<typeof setup>['api'];
  for (const call of [(api: Api) => api.issues.search({ q: 'x' }), (api: Api) => api.viewer(), (api: Api) => api.requests.list()]) {
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

test('a paged operation yields its records page by page and reports each page that skipped a bad one', async () => {
  const { fake, api } = setup(sequence(
    json({ data: { items: [{ id: 'i1', title: 'One', labels: null, extra: 1 }, { id: 'bad-1' }] }, meta: { next: 'c2' } }),
    json({ data: { items: [{ id: 'i3', title: 'Three' }] }, meta: { next: 'c3' } }),
    json({ data: { items: [{ id: 'i2', title: 'Two', labels: ['a'] }, { id: 9, title: 'Nine' }, 'junk'] }, meta: {} })));
  const seen: unknown[] = [];
  const skipped: (string | null)[][] = [];
  for await (const record of api.issues.list({ teamId: 'T 1', state: 'open', limit: 10 }, { onSkipped: ids => skipped.push(ids) })) {
    seen.push(record);
  }
  expect(seen).toStrictEqual([{ id: 'i1', title: 'One' }, { id: 'i3', title: 'Three' }, { id: 'i2', title: 'Two', labels: ['a'] }]);
  expect(skipped).toEqual([['bad-1'], ['9', null]]);
  expect(fake.calls.map(call => call.url)).toEqual([`${BASE}/teams/T%201/issues?state=open&limit=10`,
    `${BASE}/teams/T%201/issues?state=open&limit=10&cursor=c2`, `${BASE}/teams/T%201/issues?state=open&limit=10&cursor=c3`]);
  const { api: broken } = setup(json({ data: { items: 'none' }, meta: {} }));
  await expect(broken.issues.list({ teamId: 'T' }).next()).rejects.toEqual(new ProviderHttpError('invalid_response', null));
});

test('a paged operation without records yields each page whole, shaped by its result; a bad page fails', async () => {
  const { api } = setup(sequence(json({ next: `${BASE}/feed?page=2`, n: 1, extra: true }), json({ n: 2, next: null }), json({ n: 'three' })));
  const pages: unknown[] = [];
  for await (const page of api.feed()) pages.push(page);
  expect(pages).toStrictEqual([{ next: `${BASE}/feed?page=2`, n: 1 }, { n: 2 }]);
  await expect(api.feed().next()).rejects.toEqual(new ProviderHttpError('invalid_response', null));
});

test('a paged operation whose result is a list and that names no records yields its elements, skipping and reporting a bad one', async () => {
  const { fake, api } = setup(sequence(
    () => Response.json([{ id: 'b1', number: 1, extra: true }, { id: 7 }], { headers: { link: `<${BASE}/builds?page=2>; rel="next"` } }),
    json([{ id: 'b2' }, 'junk'])));
  const seen: unknown[] = [];
  const skipped: (string | null)[][] = [];
  for await (const build of api.builds.list({}, { onSkipped: ids => skipped.push(ids) })) seen.push(build);
  expect(seen).toStrictEqual([{ id: 'b1', number: 1 }, { id: 'b2' }]);
  expect(skipped).toEqual([['7'], [null]]);
  expect(fake.calls.map(call => call.url)).toEqual([`${BASE}/builds`, `${BASE}/builds?page=2`]);
  const { api: broken } = setup(json({ builds: [] }));
  await expect(broken.builds.list().next()).rejects.toEqual(new ProviderHttpError('invalid_response', null));
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

test('a string token and a function token send the same header; a missing or blank one is refused when a call needs it', async () => {
  const one = setup(json({}));
  const two = setup(json({}), { token: () => Promise.resolve('k') });
  await one.api.json('/x');
  await two.api.json('/x');
  expect(two.fake.calls[0]?.headers).toEqual(one.fake.calls[0]?.headers);
  for (const token of [undefined, '', ' ']) {
    const { fake, api } = setup(json({}), { token });
    await expect(api.issues.get({ id: 'x' })).rejects.toThrow(new TypeError('token_missing'));
    expect(fake.calls).toEqual([]);
  }
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

test('a base URL with a trailing slash sends and pages as one without', async () => {
  const sent: string[][] = [];
  for (const baseUrl of ['https://api.acme.test/v2', 'https://api.acme.test/v2/']) {
    const { fake, api } = setup(sequence(json({ id: 'x', count: 1 }), json({ next: 'https://api.acme.test/v2/feed?page=2' }), json({})),
      { baseUrl });
    await api.issues.get({ id: 'x' });
    const pages: unknown[] = [];
    for await (const page of api.paginate('link', '/feed')) pages.push(page);
    expect(pages).toHaveLength(2);
    sent.push(fake.calls.map(call => call.url));
  }
  expect(sent).toEqual(Array(2).fill(['https://api.acme.test/v2/issues/x', 'https://api.acme.test/v2/feed',
    'https://api.acme.test/v2/feed?page=2']));
});

test('a path that starts with neither / nor ? is refused before the token is read or anything is sent', async () => {
  const token = vi.fn(() => Promise.resolve('k'));
  const { fake, api } = setup(json({}), { token });
  await expect(api.json('users')).rejects.toThrow(new TypeError('url_path_relative'));
  const relative = client({ ...acme, operations: { users: { path: 'users' } } }, { token, fetch: fake.fetch });
  await expect(relative.users()).rejects.toThrow(new TypeError('url_path_relative'));
  expect([fake.calls, token.mock.calls]).toEqual([[], []]);
});

test('an operation id is nested by its dots beside the raw calls', () => {
  const { api } = setup(json({}));
  expect([typeof api.requests.list, typeof api.request, typeof api.issues.get]).toEqual(['function', 'function', 'function']);
});

test("an app's operation ids that would clash are refused before anything is built", () => {
  const entry = (operations: Record<string, unknown>) => ({ id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, operations }) as Entry;
  for (const [ids, clash] of [[['a', 'a.__proto__.__proto__.__proto__.polluted'], 'a'], [['a.b', 'a'], 'a'], [['a..b'], 'a..b'],
    [['.a'], '.a'], [['json'], 'json'], [['request.create'], 'request.create'], [['paginate'], 'paginate'], [['then'], 'then']] as const) {
    expect(() => client(entry(Object.fromEntries(ids.map(id => [id, { path: '/x' }]))), { token: 'k' }))
      .toThrow(new TypeError(`operation_clash: ${clash}`));
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.keys(client(entry({ thenable: { path: '/x' }, 'then.x': { path: '/y' } }), { token: 'k' }))).toContain('then');
});

test("an app's entry that would send a wrong request is refused when its client is built", () => {
  const entry = (op: object) => ({ id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, operations: { op },
    paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'c' } } } }) as Entry;
  for (const [op, message] of [
    [{ path: '/a', params: { id: { in: 'path', type: 'string' } } }, 'param_unplaced: op id'],
    [{ path: '/c', paging: 'none' }, 'paging_unknown: none'],
    [{ path: '/e', paging: 'cursor', records: 'items', result: { items: 'string' } }, 'records_unshaped: op'],
    [{ path: '/f', params: { q: { in: 'body', type: 'string' } } }, 'param_unplaced: op q'],
    [{ path: '/g', paging: 'cursor', notFound: 'null' }, 'not_found_paged: op'],
    [{ method: 'GET', path: '/f', params: { q: { in: 'body', type: 'string' } } }, 'param_unplaced: op q'],
    [{ path: '/f', params: { q: { in: 'form', type: 'string' } } }, 'param_unplaced: op q'],
    [{ method: 'POST', path: '/f', params: { q: { in: 'form', type: 'string' }, r: { in: 'body', type: 'string' } } }, 'param_unplaced: op q'],
    [{ method: 'POST', path: '/f', params: { r: { in: 'body', type: 'string' }, q: { in: 'form', type: 'string' } } }, 'param_unplaced: op r'],
    [{ graphql: 'query { a }', params: { q: { in: 'form', type: 'string' } } }, 'param_unplaced: op q'],
  ] as const) expect(() => client(entry(op), { token: 'k' })).toThrow(new TypeError(message));
});

test("an app's operation with a parameter in the place its paging shape's `send` writes is refused when built", () => {
  const entry = (shape: object, place: 'query' | 'body' | 'form') => ({ id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE },
    paging: { list: shape }, operations: { 'things.list': { method: 'POST', kind: 'read', path: '/things', paging: 'list',
      params: { at: { in: place, type: 'integer' } } } } }) as Entry;
  for (const [shape, place] of [[{ kind: 'page', send: { query: 'at' } }, 'query'], [{ kind: 'offset', send: { body: 'at' } }, 'body'],
    [{ kind: 'cursor', next: 'next', send: { query: 'at' } }, 'query'], [{ kind: 'last', next: 'cursor', send: { query: 'at' } }, 'query']] as const) {
    expect(() => client(entry(shape, place), { token: 'k' })).toThrow(new TypeError('param_paged: things.list at'));
  }
  // The same name in the other place is the caller's own.
  expect(() => client(entry({ kind: 'offset', send: { body: 'at' } }, 'query'), { token: 'k' })).not.toThrow();
  // A cursor written into a JSON body would replace a form's body from the second page on.
  const fake = fakeFetch([]);
  for (const shape of [{ kind: 'cursor', next: 'next', send: { body: 'offset' } }, { kind: 'last', next: 'id', send: { body: 'offset' } }]) {
    expect(() => client(entry(shape, 'form'), { token: 'k', fetch: fake.fetch })).toThrow(new TypeError('param_paged: things.list offset'));
  }
  expect(fake.calls).toEqual([]);
});

test('client() refuses an entry checkHosts refuses when it is built, before it reads the token it is given', () => {
  let reads = 0;
  const bent = { id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: 'https:///api.acme.test' } } as Entry;
  expect(() => client(bent, { get token() { reads++; return 'k'; } })).toThrow(new TypeError('base_host_refused: w'));
  expect(reads).toBe(0);
});

test("client() refuses an app's entry whose first sign-in declares its own part, before it reads the token or sends", async () => {
  let reads = 0;
  const fake = fakeFetch([{ url: /./u, respond: json({}) }]);
  for (const own of [{ http: { baseUrl: 'https://{host}/api', host: '*' } }, { fields: [] }, { identify: { request: { path: '/me' } } }]) {
    const first = { id: 'first', name: 'First', http: { baseUrl: BASE }, auth: [{ kind: 'key', ...own }] } as unknown as Entry;
    expect(() => client(first, { get token() { reads++; return 'k'; }, fetch: fake.fetch })).toThrow(new TypeError('sign_in_own_first: first'));
  }
  const later = { id: 'later', name: 'Later', http: { baseUrl: BASE }, operations: { me: { path: '/me' } },
    auth: [{ kind: 'oauth2', authorizeUrl: `${BASE}/a`, tokenUrl: `${BASE}/t` }, { kind: 'key', http: { baseUrl: 'https://{host}/api', host: '*' } }] } as Entry;
  // Used whole, a later sign-in's part is never read: a value only that part declares is refused, and nothing is sent.
  expect(() => client(later, { get token() { reads++; return 'k'; }, fetch: fake.fetch, values: { host: 'evil.test' } }))
    .toThrow(new TypeError('value_undeclared: later host'));
  await (client(later, { token: 'k', fetch: fake.fetch }) as unknown as { me: () => Promise<unknown> }).me();
  expect([reads, fake.calls.map(call => call.url)]).toEqual([0, [`${BASE}/me`]]);
});

test("an operation whose path's own query names the key its paging writes is refused when built; another key is the path's own", () => {
  const entry = (path: string) => ({ id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE },
    paging: { offset: { kind: 'offset', send: { query: 'offset' } } }, operations: { 'things.list': { path, paging: 'offset' } } }) as Entry;
  expect(() => client(entry('/things?offset=2'), { token: 'k' })).toThrow(new TypeError('param_paged: things.list offset'));
  // Read as the request reads it: a second `?` belongs to the first value, so `offset` is still a key.
  expect(() => client(entry('/things?q=a?b&offset=2'), { token: 'k' })).toThrow(new TypeError('param_paged: things.list offset'));
  expect(() => client(entry('/things?api-version=7.1'), { token: 'k' })).not.toThrow();
  // Read as the request builds it, the path appended to the base: `//` starts no authority.
  expect(() => client(entry('//catalog:archive/items?view=recent'), { token: 'k' })).not.toThrow();
  expect(() => client(entry('//x/items?offset=2'), { token: 'k' })).toThrow(new TypeError('param_paged: things.list offset'));
});

test("an app's operation on an `offset` or `last` shape whose `records` is not the shape's `list` is refused when built", () => {
  for (const shape of [{ kind: 'offset', send: { query: 'offset' }, list: 'items' }, { kind: 'last', next: 'id', send: { query: 'after' }, list: 'items' }]) {
    const entry = { id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, paging: { list: shape },
      operations: { 'things.list': { path: '/things', paging: 'list', records: 'data', result: { data: ['string'], items: ['string'] } } } } as Entry;
    expect(() => client(entry, { token: 'k' })).toThrow(new TypeError('records_unpaged: things.list'));
  }
});

test("an app's operation on a `page` shape reads its records at the shape's `list`, or is refused when built", async () => {
  const entry = (list: string | undefined, op: object) => ({ id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE },
    paging: { page: { kind: 'page', send: { query: 'page' }, ...(list === undefined ? {} : { list }) },
      cursor: { kind: 'cursor', next: 'next', send: { query: 'c' } } },
    operations: { 'things.list': { path: '/things', ...op } } }) as Entry;
  const things = async (built: Entry, ...pages: unknown[]) => {
    const fake = fakeFetch([{ url: /https:/, respond: sequence(...pages.map(page => json(page))) }]);
    const api = client(built, { token: 'k', fetch: fake.fetch }) as unknown as { things: { list: () => AsyncIterable<unknown> } };
    const seen: unknown[] = [];
    for await (const thing of api.things.list()) seen.push(thing);
    return seen;
  };
  expect(() => client(entry('items', { paging: 'page', records: 'data', result: { data: ['string'], items: ['string'] } }), { token: 'k' }))
    .toThrow(new TypeError('records_unpaged: things.list'));
  expect(() => client(entry(undefined, { paging: 'page', records: 'items', result: { items: ['string'] } }), { token: 'k' }))
    .toThrow(new TypeError('records_unpaged: things.list'));
  await expect(things(entry('items', { paging: 'page', records: 'items', result: { items: ['string'] } }), { items: ['a'] }, { items: [] }))
    .resolves.toEqual(['a']);
  await expect(things(entry(undefined, { paging: 'page', result: ['string'] }), ['a', 'b'], [])).resolves.toEqual(['a', 'b']);
  await expect(things(entry('items', { paging: 'cursor', records: 'data', result: { data: ['string'] } }), { data: ['a'] }))
    .resolves.toEqual(['a']);
});

test("a wrong argument to an app's entry is a TypeError when the call is made, before anything is sent", async () => {
  const wrong = { id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, operations: {
    lost: { path: '/b/{id}' }, flat: { path: '/d', params: { ids: { in: 'query', type: ['string'] } } } } } as const satisfies Entry;
  const fake = fakeFetch([]);
  const api = client(wrong as Entry, { token: 'k', fetch: fake.fetch }) as unknown as Record<string, (args?: object) => Promise<unknown>>;
  await expect(api.lost?.()).rejects.toThrow(new TypeError('param_missing: id'));
  await expect(api.flat?.({ ids: ['a'] })).rejects.toThrow(new TypeError('param_invalid: ids'));
  expect(fake.calls).toEqual([]);
});

test('an operation with `anyOf` sends a call that gives one set whole, and refuses one that gives none before anything is sent', async () => {
  const people = { id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE }, operations: {
    'people.get': { method: 'POST', path: '/people', anyOf: [['email'], ['phone', 'last_name'], ['contact.email']],
      params: { email: { in: 'body', type: 'string' }, phone: { in: 'body', type: 'string' }, last_name: { in: 'body', type: 'string' },
        contact: { in: 'body', type: { 'email?': 'string' }, nullable: true } } } } } as const satisfies Entry;
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  const get = untyped(client(people, { token: 'k', fetch: fake.fetch }).people.get);
  for (const args of [{}, { phone: '+1' }, { email: '' }, { email: '  ' }, { contact: null }, { contact: {} }, { contact: { email: ' ' } },
    { phone: '+1', last_name: '\t' }]) {
    await expect(get(args)).rejects.toThrow(new TypeError('param_group_missing: people.get'));
  }
  expect(fake.calls).toEqual([]);
  await get({ email: 'a@b.test' });
  await get({ phone: '+1', last_name: 'Ng' });
  await get({ contact: { email: 'a@b.test' } });
  expect(fake.calls.map(call => call.body)).toEqual(['{"email":"a@b.test"}', '{"phone":"+1","last_name":"Ng"}', '{"contact":{"email":"a@b.test"}}']);
  // Each argument is checked by its type first.
  await expect(get({ email: 7 })).rejects.toThrow(new TypeError('param_invalid: email'));
});

test("an app's `anyOf` path that names no declared argument is refused when its client is built", () => {
  const entry = (anyOf: readonly (readonly string[])[]) => ({ id: 'w', name: 'W', auth: [{ kind: 'key' }], http: { baseUrl: BASE },
    operations: { 'people.get': { method: 'POST', path: '/people', anyOf,
      params: { email: { in: 'body', type: 'string' }, input: { in: 'body', type: { 'company?': { 'domain?': 'string' } } } } } } }) as Entry;
  for (const path of ['emial', 'email.x', 'input.company.name', 'input.company?.domain', 'input.company.domain?', 'input.constructor', 'constructor', '']) {
    expect(() => client(entry([['email'], [path]]), { token: 'k' })).toThrow(new TypeError(`param_group_unknown: people.get ${path}`));
  }
  expect(() => client(entry([['email'], ['input.company.domain']]), { token: 'k' })).not.toThrow();
  for (const anyOf of [[['email'], []], []]) expect(() => client(entry(anyOf), { token: 'k' })).toThrow(new TypeError('param_group_unknown: people.get'));
});

/** Header parameters: an acting user the caller names, and a version one operation must send in place of the entry's. */
const headed = defineProvider({ id: 'headed', name: 'Headed', auth: [{ kind: 'key' }],
  http: { baseUrl: BASE, headers: { 'x-version': '1', accept: 'application/json' } },
  paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'cursor' } } },
  operations: {
    'incidents.create': { method: 'POST', path: '/incidents', params: { from: { in: 'header', type: 'string', required: true },
      title: { in: 'body', type: 'string' } } },
    'items.list': { path: '/items', paging: 'cursor', records: 'items', result: { items: ['string'], 'next?': 'string' },
      params: { 'x-version': { in: 'header', type: '2', required: true }, 'x-page': { in: 'header', type: 'integer' } } },
  } });

test('a header parameter is sent as a header: required, given, replacing the entry\'s and the app\'s, never the credential', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  const api = client(headed, { token: 'k', fetch: fake.fetch, headers: { from: 'app@acme.test', 'x-app': 'a' } });
  await expect(untyped(api.incidents.create)({ title: 'Fire' })).rejects.toThrow(new TypeError('param_missing: from'));
  expect(fake.calls).toEqual([]);
  await api.incidents.create({ from: 'ana@acme.test', title: 'Fire' });
  expect(fake.calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/incidents`, body: '{"title":"Fire"}',
    headers: { from: 'ana@acme.test', 'x-app': 'a', 'x-version': '1', accept: 'application/json', authorization: 'Bearer k' } });
});

test("a required literal header replaces the entry's and the app's of its name on every page; without it or another, nothing is sent", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(json({ items: ['a'], next: 'c2' }), json({ items: ['b'] })) }]);
  const api = client(headed, { token: 'k', fetch: fake.fetch, headers: { 'x-version': 'app' } });
  const list = (args: Record<string, unknown>) => untyped(api.items.list)(args) as AsyncGenerator<string>;
  await expect(list({}).next()).rejects.toThrow(new TypeError('param_missing: x-version'));
  await expect(list({ 'x-version': '9' }).next()).rejects.toThrow(new TypeError('param_invalid: x-version'));
  expect(fake.calls).toEqual([]);
  const seen = [];
  for await (const item of api.items.list({ 'x-version': '2', 'x-page': 3 })) seen.push(item);
  expect(seen).toEqual(['a', 'b']);
  // One `x-version` goes out, the operation's, on every page.
  expect(fake.calls.map(call => [call.url, call.headers['x-version'], call.headers['x-page']])).toEqual([
    [`${BASE}/items`, '2', '3'], [`${BASE}/items?cursor=c2`, '2', '3']]);
});

test('H: a header value with a CR, an LF, a NUL or a character past printable ASCII is param_invalid before anything is sent', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: json({}) }]);
  const create = untyped(client(headed, { token: 'k', fetch: fake.fetch }).incidents.create);
  for (const from of ['a\r\nx-evil: 1', 'a\nb', 'a\0b', 'é', 'a b', { a: 1 }, null]) {
    await expect(create({ from })).rejects.toThrow(new TypeError(from === null ? 'param_missing: from' : 'param_invalid: from'));
  }
  expect(fake.calls).toEqual([]);
  await create({ from: 'tab\tand ~ ok' });
  expect(fake.calls[0]?.headers.from).toBe('tab\tand ~ ok');
});

test("an app's header parameter that could not be sent as its own header is refused when its client is built", () => {
  const entry = (param: object, send?: object, op: object = { method: 'POST', path: '/a' }) => ({ id: 'w', name: 'W', http: { baseUrl: BASE },
    auth: [{ kind: 'key', ...send && { send } }], operations: { op: { ...op, params: param } } }) as unknown as Entry;
  for (const [param, send, op] of [
    [{ authorization: { in: 'header', type: 'string' } }], [{ Authorization: { in: 'header', type: 'string' } }],
    [{ 'content-type': { in: 'header', type: 'string' } }], [{ Host: { in: 'header', type: 'string' } }],
    [{ 'x-api-key': { in: 'header', type: 'string' } }, { header: 'X-Api-Key' }],
    [{ authorization: { in: 'header', type: 'string' } }, { basic: ['{token}', ''] }],
    [{ x: { in: 'header', type: 'string', nullable: true } }], [{ x: { in: 'header', type: { a: 'string' } } }],
    [{ x: { in: 'header', type: ['string'] } }], [{ x: { in: 'header', type: 'string' } }, undefined, { graphql: 'query { a }' }],
  ] as const) {
    const name = Object.keys(param)[0] ?? '';
    expect(() => client(entry(param, send, op), { token: 'k' })).toThrow(new TypeError(`param_unplaced: op ${name}`));
  }
  // Beside a credential sent in another header, `authorization` is the app's to name.
  expect(() => client(entry({ authorization: { in: 'header', type: 'string' } }, { header: 'x-api-key' }), { token: 'k' })).not.toThrow();
});
