import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineProvider, type Entry, type Retry } from './catalogue.js';
import { aircall } from './catalogue/aircall.js';
import { breakcold } from './catalogue/breakcold.js';
import { exa } from './catalogue/exa.js';
import { fireflies } from './catalogue/fireflies.js';
import { github } from './catalogue/github.js';
import { gitlab } from './catalogue/gitlab.js';
import { granola } from './catalogue/granola.js';
import { hubspot } from './catalogue/hubspot.js';
import { intercom } from './catalogue/intercom.js';
import { notion } from './catalogue/notion.js';
import { serpapi } from './catalogue/serpapi.js';
import { client } from './client.js';
import { finishConnect } from './connect.js';
import { ProviderHttpError } from './errors.js';
import { revokeGrant } from './oauth.js';
import * as guard from './guard.js';
import { callRequest, createClient, defaultFetch } from './http.js';
import { walk } from './paging.js';
import { fakeFetch, sequence } from './testing.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

function script(entry: Entry, ...responses: (() => Response)[]) {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(...responses) }]);
  const token = vi.fn<(rejected?: string) => Promise<string>>().mockResolvedValue('t');
  const client = createClient(entry, { token, fetch: fake.fetch, minIntervalMs: 0 });
  return { ...fake, token, client };
}
/** A key sent bare in a header, and the provider's code at `type`: a code that may echo the key. */
const headerKey = defineProvider({ id: 'header-key', name: 'Header key', auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.header-key.test/v2' }, errors: { detail: 'type' } });
const ok = () => Response.json({ ok: true });
const limited = () => Response.json({}, { status: 429 });

test('sends the token where the provider wants it', async () => {
  for (const [provider, header, value] of [[hubspot, 'authorization', 'Bearer t'], [exa, 'x-api-key', 't']] as const) {
    const fake = script(provider, ok);
    expect(await fake.client.json('/items?old=1', { query: { q: 'two' } })).toEqual({ ok: true });
    expect(fake.calls[0]?.headers[header]).toBe(value);
    expect(fake.calls[0]?.url).toBe(`${provider.http.baseUrl}/items?old=1&q=two`);
  }
});

test('retries a 429 after its Retry-After', async () => {
  const fake = script(hubspot, () => Response.json({}, { status: 429, headers: { 'Retry-After': '2' } }), ok);
  const result = fake.client.json('/items');
  await vi.advanceTimersByTimeAsync(1999);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ ok: true });
  expect(fake.calls).toHaveLength(2);
});

test("caps a long Retry-After at the provider's maxWaitMs", async () => {
  const fake = script(hubspot, () => Response.json({}, { status: 429, headers: { 'Retry-After': '3600' } }), ok);
  const result = fake.client.json('/items');
  await vi.advanceTimersByTimeAsync(9999);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ ok: true });
  expect(fake.calls).toHaveLength(2);
});

test('waits defaultWaitMs when the 429 names no wait', async () => {
  const fake = script(hubspot, limited, ok);
  const result = fake.client.json('/items');
  await vi.advanceTimersByTimeAsync(999);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ ok: true });
  expect(fake.calls).toHaveLength(2);
});

test('breakcold waits what its 429 body names', async () => {
  const fake = script(breakcold, () => Response.json({ error: { retryAfterMs: 1500 } }, { status: 429 }));
  const result = fake.client.json('/items').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(1499);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ code: 'rate_limited', status: 429 });
  expect(fake.calls).toHaveLength(2);
});

test('a second 429 past the limit is rate_limited', async () => {
  const fake = script(hubspot, limited);
  const result = fake.client.json('/items').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({ code: 'rate_limited', status: 429 });
  expect(fake.calls).toHaveLength(2);
});

test('a POST is retried only when idempotent', async () => {
  const once = script(hubspot, limited, ok);
  await expect(once.client.json('/search', { method: 'POST', json: { query: 'x' } }))
    .rejects.toMatchObject({ code: 'rate_limited' });
  expect(once.calls).toHaveLength(1);
  expect(once.calls[0]?.body).toBe('{"query":"x"}');
  const twice = script(hubspot, limited, ok);
  const result = twice.client.json('/search', { method: 'POST', form: { q: 'x' }, idempotent: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toEqual({ ok: true });
  expect(twice.calls).toHaveLength(2);
  expect(twice.calls[1]?.body).toBe('q=x');
});

test("a request with the caller's signal never waits", async () => {
  const fake = script(breakcold, () => Response.json({ error: { retryAfterMs: 1500 } }, { status: 429 }));
  await expect(fake.client.json('/items', { signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: 'rate_limited', status: 429 });
  expect(fake.calls).toHaveLength(1);
});

test('a 401 asks once for a fresh token', async () => {
  const fake = script(hubspot, () => Response.json({}, { status: 401 }), ok);
  fake.token.mockResolvedValueOnce('old').mockResolvedValue('new');
  expect(await fake.client.json('/items')).toEqual({ ok: true });
  expect(fake.token).toHaveBeenCalledTimes(2);
  expect(fake.token).toHaveBeenLastCalledWith('old');
  expect(fake.calls.map(call => call.headers.authorization)).toEqual(['Bearer old', 'Bearer new']);
  const rejected = script(hubspot, () => Response.json({}, { status: 401 }));
  rejected.token.mockResolvedValueOnce('old').mockResolvedValue('new');
  await expect(rejected.client.json('/items')).rejects.toMatchObject({ code: 'rejected', status: 401 });
  expect(rejected.calls).toHaveLength(2);
  const key = script(exa, () => Response.json({}, { status: 401 }));
  await expect(key.client.json('/items')).rejects.toMatchObject({ code: 'rejected' });
  expect(key.calls).toHaveLength(1);
});

test('403 is rejected, 404 not_found, 500 unavailable, 400 request_failed', async () => {
  for (const [status, code] of [[403, 'rejected'], [404, 'not_found'], [500, 'unavailable'], [400, 'request_failed'], [503, 'unavailable'], [408, 'unavailable']] as const) {
    const fake = script(headerKey, () => Response.json({}, { status }));
    await expect(fake.client.json('/items')).rejects.toMatchObject({ code, status });
    expect(fake.calls).toHaveLength(1);
  }
});

test("times out at the provider's timeoutMs", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Promise<Response>(() => {}) }]);
  const client = createClient(hubspot, { token: () => Promise.resolve('t'), fetch: fake.fetch });
  let settled = false;
  const result = client.json('/items').catch((e: unknown) => { settled = true; return e; });
  await vi.advanceTimersByTimeAsync(29999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ code: 'unavailable', status: null });
});

test('paces requests to minIntervalMs', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const client = createClient(granola, { token: () => Promise.resolve('t'), fetch: fake.fetch });
  const first = client.json('/notes');
  const second = client.json('/notes');
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(199);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
  expect(fake.calls).toHaveLength(2);
});

test('request hands back a 500 body for the caller to read', async () => {
  const fake = script(fireflies, () => Response.json({ errors: [{ code: 'auth_failed' }] }, { status: 500 }));
  const result = await fake.client.request('');
  expect(result.status).toBe(500);
  expect(result.data).toEqual({ errors: [{ code: 'auth_failed' }] });
});

test("uses the app's baseUrl and headers", async () => {
  const fake = fakeFetch([{ url: 'https://api1.header-key.test:13111/api/v1/users', respond: ok }]);
  const client = createClient(headerKey, { token: () => Promise.resolve('k'), fetch: fake.fetch,
    baseUrl: 'https://api1.header-key.test:13111/api/v1', headers: { 'user-agent': 'integrations-test' } });
  await client.json('/users');
  expect(fake.calls[0]?.url).toBe('https://api1.header-key.test:13111/api/v1/users');
  expect(fake.calls[0]?.headers).toMatchObject({ 'user-agent': 'integrations-test', 'x-api-key': 'k' });
});

test('invalid JSON is unavailable as data and invalid_response through json', async () => {
  const fake = script(exa, () => new Response('<html>no JSON</html>'));
  expect((await fake.client.request('/items')).data).toBeUndefined();
  await expect(fake.client.json('/items')).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
});

test('network failures and caller aborts are unavailable', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => { throw new TypeError('fetch failed'); } }]);
  const client = createClient(headerKey, { token: () => Promise.resolve('t'), fetch: fake.fetch });
  await expect(client.json('/items')).rejects.toMatchObject({ code: 'unavailable', status: null });
  const controller = new AbortController();
  controller.abort();
  await expect(client.json('/items', { signal: controller.signal })).rejects.toMatchObject({ code: 'unavailable', status: null });
});

test('asks for the token once across requests', async () => {
  const fake = script(hubspot, ok, ok, ok, () => Response.json({}, { status: 401 }), ok);
  fake.token.mockResolvedValueOnce('old').mockResolvedValue('new');
  await Promise.all([fake.client.json('/one'), fake.client.json('/two'), fake.client.json('/three')]);
  expect(fake.token).toHaveBeenCalledTimes(1);
  await fake.client.json('/four');
  await fake.client.json('/five');
  expect(fake.token).toHaveBeenCalledTimes(2);
  expect(fake.calls.slice(-2).map(call => call.headers.authorization)).toEqual(['Bearer new', 'Bearer new']);
});

test('invalid token headers fail without carrying the token', async () => {
  const secret = 'secret-token\nsecond-line';
  const fake = script(hubspot, ok);
  fake.token.mockResolvedValue(secret);
  const error: unknown = await fake.client.json('/items').catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: 'ProviderHttpError', code: 'request_failed', status: null });
  if (!(error instanceof Error)) throw new Error('expected_error');
  const encoded = JSON.stringify({ fields: Object.fromEntries(Object.entries(error)), message: error.message, cause: error.cause });
  expect(encoded).not.toContain('secret-token');
  expect(encoded).not.toContain('second-line');
  expect(error.cause).toBeUndefined();
  expect(fake.calls).toHaveLength(0);
});

test('a hanging 429 body times out and is cancelled', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(body, { status: 429 }) }]);
  const slow = { ...breakcold, http: { ...breakcold.http, timeoutMs: 20 } };
  const client = createClient(slow, { token: () => Promise.resolve('t'), fetch: fake.fetch });
  let settled = false;
  const result = client.json('/items').catch((error: unknown) => { settled = true; return error; });
  await vi.advanceTimersByTimeAsync(19);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  expect(await result).toMatchObject({ code: 'unavailable', status: null });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fake.calls).toHaveLength(1);
});

test("a Retry-After of 0 or not a number waits for the body's wait, else the provider's default", async () => {
  const cases = [
    { provider: hubspot, headers: { 'Retry-After': '0' }, body: {}, wait: 1000 },
    { provider: breakcold, headers: { 'Retry-After': '0' }, body: { error: { retryAfterMs: 1500 } }, wait: 1500 },
    { provider: exa, headers: { 'Retry-After': 'soon' }, body: {}, wait: 30_000 },
  ];
  for (const { provider, headers, body, wait } of cases) {
    const fake = script(provider, () => Response.json(body, { status: 429, headers }), ok);
    const result = fake.client.json('/items');
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
  }
});

test('never follows a redirect to another host', async () => {
  const redirects: string[] = [];
  const fake = fakeFetch([{ url: /https:/, respond: request => {
    redirects.push(request.redirect);
    return new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/steal' } });
  } }]);
  const client = createClient(exa, { token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search')).rejects.toMatchObject({ code: 'request_failed', status: 302 });
  expect(redirects).toEqual(['manual']);
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.exa.ai/search']);
});

test('follows a same-origin redirect with the credential, as Breakcold\'s universal endpoint answers', async () => {
  const fake = fakeFetch([
    { url: 'https://rest.breakcold.com/api/v1/crm/objects',
      respond: () => new Response(null, { status: 307, headers: { location: '/api/v1/eu/crm/objects?workspaceId=w' } }) },
    { url: 'https://rest.breakcold.com/api/v1/eu/crm/objects', respond: () => Response.json({ objects: [] }) },
  ]);
  const client = createClient(breakcold, { token: () => Promise.resolve('key'), fetch: fake.fetch });
  expect(await client.json('/crm/objects', { query: { workspaceId: 'w' } })).toEqual({ objects: [] });
  expect(fake.calls.map(call => [call.url, call.headers.authorization])).toEqual([
    ['https://rest.breakcold.com/api/v1/crm/objects?workspaceId=w', 'Bearer key'],
    ['https://rest.breakcold.com/api/v1/eu/crm/objects?workspaceId=w', 'Bearer key'],
  ]);
});

test('never follows a redirect that carries credentials in its address', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 307,
    headers: { location: 'https://u:p@api.exa.ai/search' } }) }]);
  const client = createClient(exa, { token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search')).rejects.toMatchObject({ code: 'request_failed', status: 307 });
  expect(fake.calls).toHaveLength(1);
});

test('never turns a write into a GET to follow a redirect', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 302, headers: { location: '/moved' } }) }]);
  const client = createClient(exa, { token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search', { method: 'POST', json: { query: 'q' } }))
    .rejects.toMatchObject({ code: 'request_failed', status: 302 });
  expect(fake.calls).toHaveLength(1);
});

test('stops following redirects after five hops', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 307, headers: { location: '/again' } }) }]);
  const client = createClient(exa, { token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search')).rejects.toMatchObject({ code: 'request_failed', status: 307 });
  expect(fake.calls).toHaveLength(6);
});

test('requests refused at once share one renewal', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: request => request.headers.get('authorization') === 'Bearer old'
    ? Response.json({}, { status: 401 }) : ok() }]);
  const token = vi.fn<(rejected?: string) => Promise<string>>()
    .mockResolvedValueOnce('old').mockResolvedValue('new');
  const client = createClient(hubspot, { token, fetch: fake.fetch, minIntervalMs: 0 });
  expect(await Promise.all([client.json('/a'), client.json('/b'), client.json('/c')])).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(token.mock.calls).toEqual([[], ['old']]);
});

test('beforeRequest runs once per call, with its address, before anything is sent', async () => {
  const seen: string[] = [];
  const fake = fakeFetch([{ url: /https:/, respond: sequence(limited, ok) }]);
  const quick = { ...breakcold, http: { ...breakcold.http, retry: { ...breakcold.http.retry, defaultWaitMs: 1 } } };
  const client = createClient(quick, { token: () => Promise.resolve('t'), fetch: fake.fetch, beforeRequest: url => { seen.push(url.toString()); } });
  const result = client.json('/records', { query: { limit: '100' } });
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toEqual({ ok: true });
  expect(seen).toEqual(['https://rest.breakcold.com/api/v1/records?limit=100']);
  expect(fake.calls).toHaveLength(2);
});

test('what beforeRequest throws reaches the caller unchanged, and nothing is sent', async () => {
  class Spent extends Error {}
  const spent = new Spent('budget');
  const fake = script(breakcold, ok);
  const client = createClient(breakcold, { token: () => Promise.resolve('t'), fetch: fake.fetch,
    beforeRequest: () => Promise.reject(spent) });
  await expect(client.json('/records')).rejects.toBe(spent);
  expect(fake.calls).toHaveLength(0);
});

test("a refusal carries the provider's own error code", async () => {
  const usage = script(breakcold, () => Response.json({ error: { code: 'usage_limit', message: 'm', requestId: 'r' } }, { status: 402 }));
  usage.token.mockResolvedValue('bk_test'); // 't' is in 'usage_limit', and a code holding the credential is no detail
  await expect(usage.client.json('/records')).rejects.toMatchObject({ code: 'request_failed', status: 402, detail: 'usage_limit' });
  const bare = script(breakcold, () => new Response('gateway', { status: 502 }));
  const gateway = bare.client.json('/records').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(1000); // its one retry, within a second's backoff
  expect(await gateway).toMatchObject({ code: 'unavailable', detail: null });
  const elsewhere = script(hubspot, () => Response.json({ error: { code: 'usage_limit' } }, { status: 402 }));
  await expect(elsewhere.client.json('/x')).rejects.toMatchObject({ detail: null });
});

test('beforeRequest reads a copy of the address, so metering never changes the request', async () => {
  const fake = script(breakcold, ok);
  const client = createClient(breakcold, { token: () => Promise.resolve('t'), fetch: fake.fetch,
    beforeRequest: url => { url.searchParams.delete('cursor'); url.pathname = '/elsewhere'; } });
  await client.json('/records', { query: { cursor: 'c2' } });
  expect(fake.calls[0]?.url).toBe('https://rest.breakcold.com/api/v1/records?cursor=c2');
});

test('a provider code that is not a short token is not carried', async () => {
  for (const code of ['x'.repeat(65), 'usage limit; email=a@b.test', '']) {
    const fake = script(breakcold, () => Response.json({ error: { code } }, { status: 402 }));
    await expect(fake.client.json('/records')).rejects.toMatchObject({ code: 'request_failed', detail: null });
  }
});

test('a provider code holding the credential the request sent is not carried', async () => {
  const key = 'uk_live.Abc-123';
  for (const [type, detail] of [[key, null], [`errors/${key}`, null], ['errors/disconnected_account', 'errors.disconnected_account']]) {
    const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ type }, { status: 403 }) }]);
    const client = createClient(headerKey, { token: () => Promise.resolve(key), fetch: fake.fetch });
    await expect(client.json('/accounts')).rejects.toMatchObject({ code: 'rejected', detail });
    expect(fake.calls[0]?.headers['x-api-key']).toBe(key);
  }
});

test('a credential is matched as a detail reads: trimmed as sent, a slash read as a dot', async () => {
  for (const [key, type, detail] of [['  uk_live.Abc-123  ', 'uk_live.Abc-123', null], ['abc/def', 'abc/def', null],
    ['  uk_live.Abc-123  ', 'errors/disconnected_account', 'errors.disconnected_account']] as const) {
    const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ type }, { status: 403 }) }]);
    const client = createClient(headerKey, { token: () => Promise.resolve(key), fetch: fake.fetch });
    await expect(client.json('/accounts')).rejects.toMatchObject({ code: 'rejected', detail });
    expect(fake.calls[0]?.headers['x-api-key']).toBe(key.trim());
  }
});

test('the retry waits an HTTP-date Retry-After, read as the error reads it', async () => {
  const fake = script(hubspot, () => Response.json({}, { status: 429,
    headers: { 'Retry-After': new Date(Date.now() + 3000).toUTCString() } }), ok);
  const result = fake.client.json('/items');
  await vi.advanceTimersByTimeAsync(2999);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ ok: true });
});

test("an entry's client sends its credential, its headers under the caller's, and its base", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await createClient(notion, { token: () => Promise.resolve('k'), fetch: fake.fetch, minIntervalMs: 0,
    headers: { 'user-agent': 'app' } }).json('/users/me');
  expect(fake.calls[0]).toMatchObject({ url: 'https://api.notion.com/v1/users/me',
    headers: { authorization: 'Bearer k', 'notion-version': '2026-03-11', 'user-agent': 'app' } });
  await createClient(notion, { token: () => Promise.resolve('k'), fetch: fake.fetch, minIntervalMs: 0,
    headers: { 'notion-version': 'x' } }).json('/users/me');
  expect(fake.calls[1]?.headers['notion-version']).toBe('x');
});

test('a code that echoes the renewed token is no detail', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({}, { status: 401 }),
    () => Response.json({ type: 'renewed_key' }, { status: 403 })) }]);
  const token = vi.fn<(rejected?: string) => Promise<string>>().mockResolvedValueOnce('old_key').mockResolvedValue('renewed_key');
  await expect(createClient(headerKey, { token, fetch: fake.fetch, minIntervalMs: 0 }).json('/x'))
    .rejects.toMatchObject({ code: 'rejected', status: 403, detail: null });
  expect(fake.calls.map(call => call.headers['x-api-key'])).toEqual(['old_key', 'renewed_key']);
});

test("Aircall's Basic credential is filled from a plain value and the secret, and a missing value sends nothing", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await createClient(aircall, { token: () => Promise.resolve('tok'), values: { apiId: 'id1' }, fetch: fake.fetch, minIntervalMs: 0 }).json('/company');
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('id1:tok').toString('base64')}`);
  await expect(createClient(aircall, { token: () => Promise.resolve('tok'), fetch: fake.fetch, minIntervalMs: 0 }).json('/company'))
    .rejects.toThrow('template_missing: aircall {apiId}');
  expect(fake.calls).toHaveLength(1);
});

/** A plain key and the secret token, both sent in the query. */
const queryKey = defineProvider({ id: 'querykey', name: 'Query key',
  fields: [{ name: 'apiKey', title: 'API key' }, { name: 'apiToken', title: 'Token', secret: true }],
  auth: [{ kind: 'key', send: { query: { key: '{apiKey}', token: '{apiToken}' } } }],
  http: { baseUrl: 'https://api.x.test' }, errors: { detail: 'error' } });
const queryClient = (fetch: typeof globalThis.fetch, beforeRequest?: (url: URL) => void) =>
  createClient(queryKey, { token: () => Promise.resolve('t'), values: { apiKey: 'k' }, fetch, minIntervalMs: 0,
    ...(beforeRequest ? { beforeRequest } : {}) });
const moved = (location: string) => () => new Response(null, { status: 307, headers: { location } });

test('a query send sets each parameter on the URL, after the caller\'s query, and adds no authorization header', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await queryClient(fake.fetch).json('/a');
  await queryClient(fake.fetch).json('/a', { query: { token: 'evil', q: 'x' } });
  expect(fake.calls.map(call => [call.url, call.headers.authorization])).toEqual([
    ['https://api.x.test/a?key=k&token=t', undefined], ['https://api.x.test/a?q=x&key=k&token=t', undefined]]);
});

test('a query credential is set again on every same-origin hop, replacing a Location\'s value', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(moved('/next'), moved('/last?token=x'), ok) }]);
  expect(await queryClient(fake.fetch).json('/a')).toEqual({ ok: true });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.x.test/a?key=k&token=t',
    'https://api.x.test/next?key=k&token=t', 'https://api.x.test/last?token=t&key=k']);
});

test("a query credential never reaches another origin's Location", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: moved('https://evil.test/steal') }]);
  await expect(queryClient(fake.fetch).json('/a')).rejects.toMatchObject({ code: 'request_failed', status: 307 });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.x.test/a?key=k&token=t']);
});

test("beforeRequest never sees a query send's credential", async () => {
  const seen: string[] = [];
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await queryClient(fake.fetch, url => { seen.push(url.toString()); }).json('/a', { query: { q: '1' } });
  expect(seen).toEqual(['https://api.x.test/a?q=1']);
});

test('a next link or a Location that echoes the query credential never shows it to beforeRequest', async () => {
  const seen: string[] = [];
  const fake = fakeFetch([{ url: /https:/, respond: sequence(() => Response.json({ next: 'https://api.x.test/a?page=2&token=t&key=k' }),
    moved('/b?token=t'), ok) }]);
  const pages = walk(queryClient(fake.fetch, url => { seen.push(url.toString()); }), { kind: 'nextUrl', next: 'next' }, '/a');
  for await (const page of pages) expect(page).toBeDefined();
  expect(seen).toEqual(['https://api.x.test/a', 'https://api.x.test/a?page=2']);
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.x.test/a?key=k&token=t',
    'https://api.x.test/a?page=2&key=k&token=t', 'https://api.x.test/b?token=t&key=k']);
});

test('a code that echoes any value a query send rendered (the plain key too) is no detail', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ error: 'k' }, { status: 400 }) }]);
  await expect(queryClient(fake.fetch).json('/a')).rejects.toMatchObject({ code: 'request_failed', detail: null });
  expect(fake.calls[0]?.url).toBe('https://api.x.test/a?key=k&token=t');
});

test('a base that holds a username or password, an app\'s own included, is refused before the token is read', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const token = vi.fn<() => Promise<string>>().mockResolvedValue('secret-key');
  const error: unknown = await client(serpapi, { baseUrl: 'https://u:p@serpapi.com', token, fetch: fake.fetch }).json('/account')
    .catch((caught: unknown) => caught);
  expect(error).toEqual(new TypeError('base_host_refused: serpapi'));
  expect(token).not.toHaveBeenCalled();
  expect(fake.calls).toHaveLength(0);
  if (!(error instanceof Error)) throw new Error('expected_error');
  expect(JSON.stringify({ fields: Object.fromEntries(Object.entries(error)), message: error.message })).not.toMatch(/secret-key|u:p@|serpapi\.com/u);
});

test('a base that does not parse is refused by entry id alone, its userinfo in no property of the error', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const token = vi.fn<() => Promise<string>>().mockResolvedValue('secret-key');
  const error: unknown = await client(serpapi, { baseUrl: 'https://user-x:pass-y@exa mple.com', token, fetch: fake.fetch })
    .json('/account').catch((caught: unknown) => caught);
  expect(error).toEqual(new TypeError('base_host_refused: serpapi'));
  expect(token).not.toHaveBeenCalled();
  expect(fake.calls).toHaveLength(0);
  if (!(error instanceof Error)) throw new Error('expected_error');
  expect(JSON.stringify({ fields: Object.fromEntries(Object.entries(error)), message: error.message, cause: String(error.cause) }))
    .not.toMatch(/user-x|pass-y|exa mple|secret-key/u);
});

test('a base is read without URL.parse, which Node 22.0 lacks', async () => {
  const parse = vi.spyOn(URL, 'parse').mockImplementation(() => { throw new Error('URL.parse is not a function'); });
  try {
    const fake = fakeFetch([{ url: /https:/, respond: ok }]);
    await client(serpapi, { token: 'k', fetch: fake.fetch }).json('/account');
    expect(fake.calls[0]?.url).toBe('https://serpapi.com/account?api_key=k');
  } finally { parse.mockRestore(); }
});

test('a code that is the token sent in the query is no detail', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ error: 't' }, { status: 400 }) }]);
  await expect(queryClient(fake.fetch).json('/a')).rejects.toMatchObject({ code: 'request_failed', detail: null });
});

test('no error thrown on a query send holds the URL or its credential', async () => {
  const failures = [() => { throw new TypeError('fetch failed'); }, () => new Promise<Response>(() => undefined)];
  for (const respond of failures) {
    const fake = fakeFetch([{ url: /https:/, respond }]);
    const result = createClient(queryKey, { token: () => Promise.resolve('secret-token'), values: { apiKey: 'k' }, fetch: fake.fetch })
      .json('/a').catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await result;
    expect(error).toMatchObject({ code: 'unavailable', status: null });
    if (!(error instanceof Error)) throw new Error('expected_error');
    const encoded = JSON.stringify({ fields: Object.fromEntries(Object.entries(error)), message: error.message, cause: String(error.cause) });
    expect(encoded).not.toContain('secret-token');
    expect(encoded).not.toContain('api.x.test');
  }
});

test('a blank plain value fills no template: nothing is sent; a number is', async () => {
  const basic = defineProvider({ id: 'basicpair', name: 'Basic pair',
    fields: [{ name: 'apiId', title: 'API ID' }, { name: 'apiToken', title: 'API token', secret: true }],
    auth: [{ kind: 'key', send: { basic: ['{apiId}', '{apiToken}'] } }], http: { baseUrl: 'https://api.basic.test' } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  for (const apiId of ['', '  ']) {
    await expect(createClient(basic, { token: () => Promise.resolve('t'), values: { apiId }, fetch: fake.fetch }).json('/a'))
      .rejects.toThrow(new TypeError('template_missing: basicpair {apiId}'));
  }
  expect(fake.calls).toHaveLength(0);
  await createClient(basic, { token: () => Promise.resolve('t'), values: { apiId: 7 }, fetch: fake.fetch }).json('/a');
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('7:t').toString('base64')}`);
});

test('a code that echoes the Basic header is no detail', async () => {
  const keyed = defineProvider({ id: 'keyed', name: 'Keyed', fields: [{ name: 'user', title: 'User' }, { name: 'key', title: 'Key', secret: true }],
    auth: [{ kind: 'key', send: { basic: ['{user}', '{key}'] } }], http: { baseUrl: 'https://api.keyed.test' }, errors: { detail: 'code' } });
  const header = Buffer.from('u:k').toString('base64'); // 'dTpr': no padding, so it passes the detail pattern
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ code: header }, { status: 400 }) }]);
  await expect(createClient(keyed, { token: () => Promise.resolve('k'), values: { user: 'u' }, fetch: fake.fetch, minIntervalMs: 0 }).json('/x'))
    .rejects.toMatchObject({ code: 'request_failed', detail: null });
});

test("GitHub's declared rate limits classify a 403", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ message: 'secondary rate limit' }, { status: 403 }) }]);
  await expect(createClient(github, { token: () => Promise.resolve('k'), fetch: fake.fetch, minIntervalMs: 0 }).json('/user'))
    .rejects.toMatchObject({ code: 'rate_limited', status: 403, retryAfterMs: 60_000 });
});

test('a request whose URL leaves the base\'s origin is refused before the token is read or anything is sent', async () => {
  for (const path of ['@evil.test/y', '.evil.test/y', 'https://evil.test/y']) {
    const fake = script(github, ok);
    await expect(fake.client.json(path)).rejects.toThrow(new TypeError('url_outside_origin'));
    expect(fake.calls).toHaveLength(0);
    expect(fake.token).not.toHaveBeenCalled();
  }
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const client = createClient(headerKey, { token: () => Promise.resolve('k'), fetch: fake.fetch, baseUrl: 'https://other.test' });
  await expect(client.json('@evil.test/y')).rejects.toThrow(new TypeError('url_outside_origin'));
  expect(fake.calls).toHaveLength(0);
});

test("a 429 is retried after the default wait without reading its body when the entry names no body wait", async () => {
  const endless = () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), { status: 429 });
  const fake = script(hubspot, endless, ok);
  const result = fake.client.json('/items');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fake.calls).toHaveLength(2);
  expect(await result).toEqual({ ok: true });
});

test('callRequest: a path call keeps its method and query and takes what the caller adds', () => {
  const signal = AbortSignal.timeout(1000);
  expect(callRequest({ method: 'DELETE', path: '/x', query: { a: '1' } }, { idempotent: true, signal, variables: { v: 1 } }))
    .toEqual(['/x', { method: 'DELETE', query: { a: '1' }, idempotent: true, signal }]);
  expect(callRequest({})).toEqual(['', { method: 'GET' }]);
});

test('callRequest: GraphQL is a POST of the query and its variables, none by default, to the base', () => {
  expect(callRequest({ graphql: 'query { me }' }, { variables: { first: 2 }, idempotent: true }))
    .toEqual(['', { method: 'POST', json: { query: 'query { me }', variables: { first: 2 } }, idempotent: true }]);
  expect(callRequest({ graphql: 'query { me }' })).toEqual(['', { method: 'POST', json: { query: 'query { me }', variables: {} } }]);
});

test('a token function that answers a blank token, at first or on renewal, sends nothing and is token_missing', async () => {
  for (const tokens of [[' '], ['t', '']]) {
    const fake = script(hubspot, () => Response.json({}, { status: 401 }), ok);
    for (const value of tokens) fake.token.mockResolvedValueOnce(value);
    await expect(fake.client.json('/x')).rejects.toThrow(new TypeError('token_missing'));
    expect(fake.calls).toHaveLength(tokens.length - 1);
  }
});

/** A base whose host part is a plain value, checked against a host pattern. */
const regional = defineProvider({ id: 'regional', name: 'Regional',
  fields: [{ name: 'sub', title: 'Subdomain' }, { name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key' }], http: { baseUrl: 'https://{sub}.example.com/v1', host: '*.example.com' } });
const filled = (entry: Entry, values: Record<string, unknown>) => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const token = vi.fn<() => Promise<string>>().mockResolvedValue('t');
  const before = vi.fn();
  return { ...fake, token, before, client: createClient(entry, { token, values, fetch: fake.fetch, minIntervalMs: 0, beforeRequest: before }) };
};

test("a base's host is filled from a plain value once, on the first request", async () => {
  const fake = filled(regional, { sub: 'eu' });
  await fake.client.json('/a');
  await fake.client.json('/b');
  expect(fake.calls.map(call => call.url)).toEqual(['https://eu.example.com/v1/a', 'https://eu.example.com/v1/b']);
  expect(fake.client.baseUrl).toBe('https://eu.example.com/v1');
});

test.each([['a.example.com@evil.test', 'base_value_invalid: regional {sub}'], ['evil.test/x', 'base_value_invalid: regional {sub}'],
  ['evil.test#', 'base_value_invalid: regional {sub}'], ['a b', 'base_value_invalid: regional {sub}'], ['x.', 'base_value_invalid: regional {sub}'],
  ['eu:8443', 'base_value_invalid: regional {sub}'], ['\u212A', 'base_value_invalid: regional {sub}'],
  ['\u017F', 'base_value_invalid: regional {sub}'], ['', 'template_missing: regional {sub}']])(
  "a hostile base value %j is refused before the token is read, beforeRequest runs or anything is sent", async (sub, message) => {
    const fake = filled(regional, { sub });
    await expect(fake.client.json('/a')).rejects.toThrow(new TypeError(message));
    expect(() => fake.client.baseUrl).toThrow(new TypeError(message));
    expect(fake.token).not.toHaveBeenCalled();
    expect(fake.before).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

test.each([['*.example.com', 'api.example.com', true], ['*.example.com', 'a.b.example.com', true], ['*.example.com', 'example.com', false],
  ['*.example.com', 'xexample.com', false], ['*.example.com', 'example.com.evil.test', false], ['*.example.com', 'evil.test', false],
  ['api.example.com', 'api.example.com', true], ['api.example.com', 'other.example.com', false], ['*', 'any.where.test', true],
  ['*.example.com', 'API.EXAMPLE.COM', true]])(
  'host %s takes %s: %s', async (host, h, accepted) => {
    const entry = defineProvider({ id: 'hosted', name: 'Hosted', fields: [{ name: 'h', title: 'Host' }, { name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://{h}', host } });
    const fake = filled(entry, { h });
    if (accepted) {
      await fake.client.json('/a');
      expect(new URL(fake.calls[0]?.url ?? '').hostname).toBe(h.toLowerCase());
    } else {
      await expect(fake.client.json('/a')).rejects.toThrow(new TypeError('base_host_refused: hosted'));
      expect(fake.token).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    }
  });

test.each(['api.intercom.io:8443', 'api.intercom.\u212Aio', 'api.intercom.io\u017F'])(
  "Intercom's client refuses %j before the token is read or anything is sent", async apiHost => {
    const fake = fakeFetch([{ url: /https:/, respond: ok }]);
    const token = vi.fn<() => Promise<string>>().mockResolvedValue('t');
    await expect(client(intercom, { token, values: { apiHost }, fetch: fake.fetch }).json('/me'))
      .rejects.toThrow(new TypeError('base_value_invalid: intercom {apiHost}'));
    expect(token).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

test("an app's templated base with no host pattern is refused", async () => {
  const entry = defineProvider({ id: 'loose', name: 'Loose', fields: [{ name: 'h', title: 'Host' }, { name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://{h}' } });
  await expect(filled(entry, { h: 'api.example.com' }).client.json('/a')).rejects.toThrow(new TypeError('base_host_refused: loose'));
});

test("a client never fills a base from a field's default: only finishConnect applies one", async () => {
  const defaulted = defineProvider({ ...regional, fields: [{ name: 'sub', title: 'Subdomain', default: 'us' }, regional.fields[1]] });
  for (const values of [{}, { sub: ' ' }]) {
    const fake = filled(defaulted, values);
    await expect(fake.client.json('/a')).rejects.toThrow(new TypeError('template_missing: regional {sub}'));
    expect(fake.token).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  }
  const fake = filled(defaulted, { sub: 'eu' });
  await fake.client.json('/a');
  expect(fake.calls[0]?.url).toBe('https://eu.example.com/v1/a');
});

test('a request revoke on a templated base, given no values, fails closed with nothing sent', async () => {
  const revoking = defineProvider({ ...regional, fields: [{ name: 'sub', title: 'Subdomain', default: 'us' }, regional.fields[1]],
    revoke: { request: { method: 'POST', path: '/revoke' } } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await expect(revokeGrant(revoking, { accessToken: 'a', fetch: fake.fetch })).rejects.toThrow(new TypeError('template_missing: regional {sub}'));
  expect(fake.calls).toHaveLength(0);
});

test('a templated base is not filled when the client is built, and an app\'s own base is used as given', async () => {
  const fake = filled(regional, {});
  const built = client(regional, { token: 't', fetch: fake.fetch });
  await expect(built.json('/a')).rejects.toThrow(new TypeError('template_missing: regional {sub}'));
  const own = createClient(regional, { token: () => Promise.resolve('t'), fetch: fake.fetch, baseUrl: 'https://proxy.test/regional/' });
  expect(own.baseUrl).toBe('https://proxy.test/regional');
  await own.json('/a');
  expect(fake.calls.map(call => call.url)).toEqual(['https://proxy.test/regional/a']);
});

test("the credential never leaves the filled base's origin", async () => {
  const bare = defineProvider({ id: 'bare', name: 'Bare', fields: [{ name: 'h', title: 'Host' }, { name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://{h}', host: '*.example.com' } });
  const fake = filled(bare, { h: 'api.example.com' });
  await expect(fake.client.json('@evil.test/y')).rejects.toThrow(new TypeError('url_outside_origin'));
  expect(fake.token).not.toHaveBeenCalled();
  expect(fake.calls).toHaveLength(0);
  const moved = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 307, headers: { location: 'https://us.example.com/v1/a' } }) }]);
  await expect(createClient(regional, { token: () => Promise.resolve('t'), values: { sub: 'eu' }, fetch: moved.fetch }).json('/a'))
    .rejects.toMatchObject({ code: 'request_failed', status: 307 });
  expect(moved.calls).toHaveLength(1);
});

const addressBlocked = new ProviderHttpError('request_failed', null, 'address_blocked');

test.each(['127.0.0.1', '2130706433', '0x7f.1', '169.254.169.254', '10.0.0.1'])(
  "a typed host that is a blocked address (%s) is refused before the token is read, whatever the app's fetch", async host => {
    const fake = filled(gitlab, { host });
    await expect(fake.client.json('/user')).rejects.toEqual(addressBlocked);
    expect(() => fake.client.baseUrl).toThrow(addressBlocked);
    expect(fake.token).not.toHaveBeenCalled();
    expect(fake.before).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

test("a typed host that is a name, or a public address, goes to the app's own fetch as it is", async () => {
  for (const host of ['gitlab.example.test', '8.8.8.8']) {
    const fake = filled(gitlab, { host });
    expect(await fake.client.json('/user')).toEqual({ ok: true });
    expect(fake.calls[0]?.url).toBe(`https://${host}/api/v4/user`);
    expect(fake.calls[0]?.headers['private-token']).toBe('t');
  }
});

test("an app's own base for a typed-host entry is used as given", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await createClient(gitlab, { token: () => Promise.resolve('t'), fetch: fake.fetch, baseUrl: 'https://10.0.0.1/api/v4' }).json('/user');
  expect(fake.calls[0]?.url).toBe('https://10.0.0.1/api/v4/user');
});

test('an entry whose host is typed defaults to guardedFetch; any other to the global fetch', () => {
  expect(defaultFetch(gitlab)).toBe(guard.guardedFetch);
  expect(defaultFetch(intercom)).toBe(globalThis.fetch);
});

test('client() and finishConnect on GitLab with no fetch send through guardedFetch', async () => {
  const guarded = vi.spyOn(guard, 'guardedFetch').mockRejectedValue(addressBlocked);
  try {
    const values = { host: 'gitlab.example.test' };
    await expect(client(gitlab, { token: 't', values }).json('/user')).rejects.toEqual(addressBlocked);
    await expect(finishConnect(gitlab, { secret: { accessToken: 't' }, values })).rejects.toEqual(addressBlocked);
    expect(guarded).toHaveBeenCalledTimes(2);
    expect(guarded.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input))))
      .toEqual(['https://gitlab.example.test/api/v4/user', 'https://gitlab.example.test/api/v4/user']);
  } finally { guarded.mockRestore(); }
});

/** An entry that declares `retry`, and an answer with a status and headers. */
const retrying = (retry: Retry, extra: Partial<Entry> = {}) => defineProvider({ id: 'retrying', name: 'Retrying',
  auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.retrying.test', retry }, ...extra });
const answer = (status: number, headers: Record<string, string> = {}) => () => Response.json({}, { status, headers });
const offline = () => { throw new TypeError('fetch failed'); };

describe('a read is retried after a 5xx, a 408 or a network failure, waiting with full jitter', () => {
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.5); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('503 then 200: two calls and the answer, after half the default wait', async () => {
    const fake = script(retrying({}), answer(503), ok);
    const result = fake.client.json('/a');
    await vi.advanceTimersByTimeAsync(499);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(2);
  });

  test.each([408, 500, 502, 503, 504])('%i is retried', async status => {
    const fake = script(retrying({}), answer(status), ok);
    const result = fake.client.json('/a');
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(2);
  });

  test('500 three times with limit 2: three calls, and the last answer is unavailable', async () => {
    const fake = script(retrying({ limit: 2 }), answer(500));
    const result = fake.client.json('/a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toMatchObject({ code: 'unavailable', status: 500 });
    expect(fake.calls).toHaveLength(3);
  });

  test('a network failure once, then 200: two calls; failing every time it is unavailable', async () => {
    const once = script(retrying({}), offline, ok);
    const result = once.client.json('/a');
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toEqual({ ok: true });
    expect(once.calls).toHaveLength(2);
    const always = script(retrying({}), offline);
    const failed = always.client.json('/a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await failed).toMatchObject({ code: 'unavailable', status: null });
    expect(always.calls).toHaveLength(2);
  });

  test('a positive Retry-After is waited, capped by maxWaitMs', async () => {
    for (const [retry, after, wait] of [[{}, '2', 2000], [{ maxWaitMs: 10_000 }, '120', 10_000]] as const) {
      const fake = script(retrying(retry), answer(503, { 'retry-after': after }), ok);
      const result = fake.client.json('/a');
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(fake.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({ ok: true });
    }
  });

  test('the n-th retry waits a random share of one second doubled n times, capped by maxWaitMs', async () => {
    const fake = script(retrying({ limit: 3, defaultWaitMs: 30_000, maxWaitMs: 3000 }), answer(500), answer(500), answer(500), ok);
    const result = fake.client.json('/a');
    await vi.advanceTimersByTimeAsync(500 + 1000);
    expect(fake.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fake.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(4);
  });

  test("the backoff starts from one second, never from the 429's defaultWaitMs", async () => {
    for (const defaultWaitMs of [30_000, 0]) {
      const fake = script(retrying({ defaultWaitMs, maxWaitMs: 60_000 }), answer(503), ok);
      const result = fake.client.json('/a');
      await vi.advanceTimersByTimeAsync(499);
      expect(fake.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({ ok: true });
    }
  });

  test('the backoff is capped by maxWaitMs below one second', async () => {
    const fake = script(retrying({ maxWaitMs: 400 }), answer(503), ok);
    const result = fake.client.json('/a');
    await vi.advanceTimersByTimeAsync(199);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: true });
  });

  test('a 429 still waits its default with no jitter, and shares the limit', async () => {
    const fake = script(retrying({ limit: 2 }), limited, answer(503), ok);
    const result = fake.client.json('/a');
    await vi.advanceTimersByTimeAsync(999);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.calls).toHaveLength(2);
    // The second retry: 0.5 × 1000 × 2.
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(3);
  });

  test('a timeout is never retried: one request, unavailable once the time budget is spent', async () => {
    const fake = fakeFetch([{ url: /https:/, respond: () => new Promise<Response>(() => undefined) }]);
    const client = createClient(retrying({ limit: 3 }), { token: () => Promise.resolve('t'), fetch: fake.fetch });
    const result = client.json('/a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ code: 'unavailable', status: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls).toHaveLength(1);
  });

  const failedOk = retrying({}, { errors: { failed: { path: 'ok', equals: false } } });
  test.each([
    ['a POST', retrying({}), answer(503), { method: 'POST' as const, json: {} }],
    ['a GET that is not idempotent', retrying({}), answer(503), { idempotent: false }],
    ["a GET with the caller's signal", retrying({}), answer(503), { signal: new AbortController().signal }],
    ['a limit of 0', retrying({ limit: 0 }), answer(503), {}],
    ['a 501', retrying({}), answer(501), {}],
    ['a 400', retrying({}), answer(400), {}],
    ['a 2xx that errors.failed marks', failedOk, () => Response.json({ ok: false }), {}],
    ['a network failure with no retry declared', headerKey, offline, {}],
  ])('%s is sent once', async (_name, entry, respond, options) => {
    const fake = script(entry, respond, ok);
    const result = fake.client.json('/a', options).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBeInstanceOf(ProviderHttpError);
    expect(fake.calls).toHaveLength(1);
  });

  test('an address_blocked refusal is never retried', async () => {
    const typed = { ...gitlab, http: { ...gitlab.http, retry: {} } };
    const refusing = vi.fn<typeof fetch>().mockRejectedValue(addressBlocked);
    const result = createClient(typed, { token: () => Promise.resolve('t'), values: { host: 'gitlab.example.test' }, fetch: refusing })
      .json('/user').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(addressBlocked);
    expect(refusing).toHaveBeenCalledTimes(1);
    const literal = filled(typed, { host: '127.0.0.1' });
    await expect(literal.client.json('/user')).rejects.toEqual(addressBlocked);
    expect(literal.calls).toHaveLength(0);
  });

  test('Fireflies (limit 0) on a 500 is sent once, unavailable by its rules', async () => {
    const fake = script(fireflies, answer(500), ok);
    const result = fake.client.json('').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ code: 'unavailable', status: 500 });
    expect(fake.calls).toHaveLength(1);
  });
});
