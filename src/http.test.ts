import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineProvider, signInWith, type Entry, type Retry } from './catalogue.js';
import { aircall } from './catalogue/aircall.js';
import { breakcold } from './catalogue/breakcold.js';
import { discord } from './catalogue/discord.js';
import { exa } from './catalogue/exa.js';
import { fireflies } from './catalogue/fireflies.js';
import { github } from './catalogue/github.js';
import { gitlab as gitlabEntry } from './catalogue/gitlab.js';
import { hubspot } from './catalogue/hubspot.js';
import { intercom } from './catalogue/intercom.js';
import { jira } from './catalogue/jira.js';
import { notion } from './catalogue/notion.js';
import { serpapi } from './catalogue/serpapi.js';
import { smartsheet } from './catalogue/smartsheet.js';
import { trello } from './catalogue/trello.js';
import { client } from './client.js';
import { finishConnect, startConnect } from './connect.js';
import { ProviderHttpError } from './errors.js';
import * as guard from './guard.js';
import { callRequest, createClient, defaultFetch } from './http.js';
import { exchangeCode, refreshGrant, requestToken, revokeGrant, tokenSource } from './oauth.js';
import { fill, hostPart } from './rules.js';
import { walk } from './paging.js';
import { fakeFetch, sequence } from './testing.js';

/** GitLab's personal access token sign-in: these tests send `private-token`. */
const gitlab = signInWith(gitlabEntry, 'key');

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
/** Retries a read once and states no wait of its own: the engine's defaults, a one-second wait and a 60-second cap. */
const retriesOnce = defineProvider({ id: 'retries-once', name: 'Retries once', auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.retries-once.test/v1', retry: {} } });
/** Waits 30 seconds for a 429 that states no wait. */
const waitsThirty = defineProvider({ id: 'waits-thirty', name: 'Waits thirty', auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.waits-thirty.test/v1', retry: { defaultWaitMs: 30_000 } } });
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
  const fake = script(retriesOnce, () => Response.json({}, { status: 429, headers: { 'Retry-After': '2' } }), ok);
  const result = fake.client.json('/items');
  await vi.advanceTimersByTimeAsync(1999);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ ok: true });
  expect(fake.calls).toHaveLength(2);
});

test("a Retry-After longer than the provider's maxWaitMs is reported, never retried at the cap", async () => {
  const fake = script(retriesOnce, () => Response.json({}, { status: 429, headers: { 'Retry-After': '3600' } }), ok);
  const result = fake.client.json('/items').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(await result).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 3_600_000 });
  expect(fake.calls).toHaveLength(1);
});

test('waits defaultWaitMs when the 429 names no wait', async () => {
  const fake = script(retriesOnce, limited, ok);
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
  const fake = script(retriesOnce, limited);
  const result = fake.client.json('/items').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({ code: 'rate_limited', status: 429 });
  expect(fake.calls).toHaveLength(2);
});

test('a POST is retried only when idempotent', async () => {
  const once = script(retriesOnce, limited, ok);
  await expect(once.client.json('/search', { method: 'POST', json: { query: 'x' } }))
    .rejects.toMatchObject({ code: 'rate_limited' });
  expect(once.calls).toHaveLength(1);
  expect(once.calls[0]?.body).toBe('{"query":"x"}');
  const twice = script(retriesOnce, limited, ok);
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
  const paced = defineProvider({ id: 'paced', name: 'Paced', auth: [{ kind: 'key' }],
    http: { baseUrl: 'https://api.paced.test/v1', minIntervalMs: 200 } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const client = createClient(paced, { token: () => Promise.resolve('t'), fetch: fake.fetch });
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

test('a body wait that cannot be read states none: the error is sanitized, with no cause and no stream message', async () => {
  const broken = () => new Response(new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('stream-private reset')); } }),
    { status: 503 });
  const entry = defineProvider({ id: 'broken-body', name: 'Broken body', auth: [{ kind: 'key' }],
    http: { baseUrl: 'https://api.broken-body.test', retry: { wait: { path: 'waitMs', unit: 'ms' } } } });
  const fake = fakeFetch([{ url: /https:/, respond: broken }]);
  const result = createClient(entry, { token: () => Promise.resolve('t'), fetch: fake.fetch }).json('/a').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(60_000);
  const error = await result;
  expect(error).toBeInstanceOf(ProviderHttpError);
  expect(error).toMatchObject({ code: 'unavailable', status: 503 });
  expect((error as Error).cause).toBeUndefined();
  expect(JSON.stringify({ error, message: (error as Error).message })).not.toContain('stream-private');
  expect(fake.calls).toHaveLength(2);
});

test("a Retry-After of 0 or not a number waits for the body's wait, else the provider's default", async () => {
  const cases = [
    { provider: retriesOnce, headers: { 'Retry-After': '0' }, body: {}, wait: 1000 },
    { provider: breakcold, headers: { 'Retry-After': '0' }, body: { error: { retryAfterMs: 1500 } }, wait: 1500 },
    { provider: waitsThirty, headers: { 'Retry-After': 'soon' }, body: {}, wait: 30_000 },
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
  const fake = script(retriesOnce, () => Response.json({}, { status: 429,
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
  // Replaced whether or not this Node has it, and put back as it was.
  const parse = Object.getOwnPropertyDescriptor(URL, 'parse');
  Object.defineProperty(URL, 'parse', { configurable: true, value: () => { throw new Error('URL.parse is not a function'); } });
  try {
    const fake = fakeFetch([{ url: /https:/, respond: ok }]);
    await client(serpapi, { token: 'k', fetch: fake.fetch }).json('/account');
    expect(fake.calls[0]?.url).toBe('https://serpapi.com/account?api_key=k');
  } finally { if (parse) Object.defineProperty(URL, 'parse', parse); else Reflect.deleteProperty(URL, 'parse'); }
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

test("a header send's value is filled: Discord's `Bot {token}`, an inline `Token token={token}`", async () => {
  const tokenHeader = defineProvider({ id: 'tokenheader', name: 'Token header', fields: [{ name: 'key', title: 'Key', secret: true }],
    auth: [{ kind: 'key', send: { header: 'authorization', value: 'Token token={token}' } }], http: { baseUrl: 'https://api.th.test' } });
  for (const [entry, sent] of [[discord, 'Bot t'], [tokenHeader, 'Token token=t']] as const) {
    const fake = script(entry, ok);
    await fake.client.json('/me');
    expect(fake.calls[0]?.headers.authorization).toBe(sent);
  }
});

test("Trello's header carries the plain key and the secret token, and a missing key sends nothing", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await createClient(trello, { token: () => Promise.resolve('tok'), values: { apiKey: 'k1' }, fetch: fake.fetch }).json('/members/me');
  expect(fake.calls[0]).toMatchObject({ url: 'https://api.trello.com/1/members/me',
    headers: { authorization: 'OAuth oauth_consumer_key="k1", oauth_token="tok"' } });
  for (const values of [{}, { apiKey: ' ' }]) {
    await expect(createClient(trello, { token: () => Promise.resolve('tok'), values, fetch: fake.fetch }).json('/members/me'))
      .rejects.toThrow(new TypeError('template_missing: trello {apiKey}'));
  }
  expect(fake.calls).toHaveLength(1);
});

test('`{token}` is the token even when the secret field is named `token`', async () => {
  const named = defineProvider({ id: 'named-token', name: 'Named token', fields: [{ name: 'token', title: 'Token', secret: true }],
    auth: [{ kind: 'token', request: { url: 'https://nt.test/session', body: { password: '{token}' } }, send: { header: 'x-api-key' } }],
    http: { baseUrl: 'https://api.nt.test' } });
  const fake = script(named, ok);
  await fake.client.json('/me');
  expect(fake.calls[0]?.headers['x-api-key']).toBe('t');
});

test("a plain field that would split Trello's header is refused before anything is sent", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await expect(createClient(trello, { token: () => Promise.resolve('tok'), values: { apiKey: 'k\r\nX-Evil: 1' }, fetch: fake.fetch })
    .json('/members/me')).rejects.toMatchObject({ code: 'request_failed', detail: null });
  expect(fake.calls).toHaveLength(0);
});

test('a code that echoes any value a credential template took is no detail: a header value, Basic, a query', async () => {
  const queried = defineProvider({ id: 'queried', name: 'Queried', fields: [{ name: 'account', title: 'Account' }, { name: 'key', title: 'Key', secret: true }],
    auth: [{ kind: 'key', send: { query: { account: '{account}', key: '{token}' } } }], http: { baseUrl: 'https://api.q.test' } });
  for (const [entry, values, code] of [[trello, { apiKey: 'k1' }, 'k1'], [aircall, { apiId: 'id1' }, 'id1'], [queried, { account: 'acc1' }, 'acc1']] as const) {
    const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ code }, { status: 400 }) }]);
    const api = createClient({ ...entry, errors: { detail: 'code' } }, { token: () => Promise.resolve('tok'), values, fetch: fake.fetch });
    await expect(api.json('/me')).rejects.toMatchObject({ code: 'request_failed', detail: null });
  }
});

test("a code that echoes the filled header value or the token is no detail", async () => {
  const echoing = { ...discord, errors: { detail: 'code' } };
  for (const code of ['Bot t', 't']) {
    const fake = script(echoing, () => Response.json({ code }, { status: 400 }));
    await expect(fake.client.json('/me')).rejects.toMatchObject({ code: 'request_failed', detail: null });
  }
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
  const fake = script(retriesOnce, endless, ok);
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

const hostCases = [['*.example.com', 'api.example.com', true], ['*.example.com', 'a.b.example.com', true], ['*.example.com', 'example.com', false],
  ['*.example.com', 'xexample.com', false], ['*.example.com', 'example.com.evil.test', false], ['*.example.com', 'evil.test', false],
  ['api.example.com', 'api.example.com', true], ['api.example.com', 'other.example.com', false], ['*', 'any.where.test', true],
  ['*.example.com', 'API.EXAMPLE.COM', true]] as const;
test.each(hostCases)(
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

/** Where a key on `https://{h}` goes under `host`: the host sent to or the refusal, and how often the token was read
 * and a request sent. */
async function hostTaken(host: string | readonly string[], h: string) {
  const entry = defineProvider({ id: 'hosted', name: 'Hosted', fields: [{ name: 'h', title: 'Host' }, { name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://{h}', host } });
  const fake = filled(entry, { h });
  const sent = await fake.client.json('/a').then(() => new URL(fake.calls[0]?.url ?? '').hostname, (error: unknown) => error);
  return { sent, tokenRead: fake.token.mock.calls.length, requests: fake.calls.length };
}
const taken = (h: string) => ({ sent: h.toLowerCase(), tokenRead: 1, requests: 1 });
const hostRefused = { sent: new TypeError('base_host_refused: hosted'), tokenRead: 0, requests: 0 };

test.each(hostCases.filter(([host]) => host !== '*'))('a list of the one pattern %s takes %s as the pattern alone does: %s', async (host, h, accepted) => {
  expect(await hostTaken([host], h)).toEqual(accepted ? taken(h) : hostRefused);
});

test.each([['api.smartsheet.com', true], ['api.smartsheet.eu', true], ['API.SMARTSHEET.EU', true], ['evil.test', false],
  ['api.smartsheet.eu.evil.test', false], ['api.smartsheet.com.evil.test', false], ['evilsmartsheet.com', false],
  ['api.smartsheet.au', false], ['app.smartsheet.com', false], ['x.api.smartsheet.com', false], ['smartsheet.eu', false]] as const)(
  'a host list of two names takes %s: %s (a refusal before the token is read or anything is sent)', async (h, accepted) => {
    expect(await hostTaken(['api.smartsheet.com', 'api.smartsheet.eu'], h)).toEqual(accepted ? taken(h) : hostRefused);
  });

test.each([['a.d.test', true], ['a.b.d.test', true], ['x.test', true], ['d.test', false], ['evild.test', false],
  ['d.test.evil.test', false], ['a.x.test', false]] as const)(
  'a host list of `*.d.test` and `x.test` takes %s: %s (a refusal before the token is read or anything is sent)', async (h, accepted) => {
    expect(await hostTaken(['*.d.test', 'x.test'], h)).toEqual(accepted ? taken(h) : hostRefused);
  });

// The table refuses `'*'` in a list; an app's entry built without it reaches the engine, where `'*'` is no name.
test.each([['any.where.test', false], ['127.0.0.1', false], ['x.test', true]] as const)(
  "`'*'` in a host list matches no host: %s %s (a refusal before the token is read or anything is sent)", async (h, accepted) => {
    expect(await hostTaken(['*', 'x.test'], h)).toEqual(accepted ? taken(h) : hostRefused);
  });

test('a host list keeps the global fetch: every name in it is one the entry declares', () => {
  expect(defaultFetch(smartsheet)).toBe(globalThis.fetch);
  expect(defaultFetch({ ...regional, http: { baseUrl: 'https://{sub}', host: ['*', 'x.test'] } })).toBe(globalThis.fetch);
});

test.each(['api.smartsheet.com', 'api.smartsheetgov.com', 'api.smartsheet.eu', 'api.smartsheet.au'])(
  "Smartsheet's client sends to its region's host %s", async apiHost => {
    const fake = filled(smartsheet, { apiHost });
    await fake.client.json('/users/me');
    expect(fake.calls.map(call => call.url)).toEqual([`https://${apiHost}/2.0/users/me`]);
  });

test("a stored Smartsheet connection without `apiHost` is template_missing before anything is sent; a connect fills the default", async () => {
  const fake = filled(smartsheet, {});
  await expect(fake.client.json('/users/me')).rejects.toThrow(new TypeError('template_missing: smartsheet {apiHost}'));
  expect(fake.token).not.toHaveBeenCalled();
  expect(fake.calls).toHaveLength(0);
  const answer = fakeFetch([{ url: /https:/, respond: () => Response.json({ id: 1, email: 'a@example.test' }) }]);
  const { values } = await finishConnect(smartsheet, { secret: { accessToken: 't' }, fetch: answer.fetch });
  expect(values).toEqual({ apiHost: 'api.smartsheet.com' });
  expect(answer.calls.map(call => call.url)).toEqual(['https://api.smartsheet.com/2.0/users/me']);
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
  // @ts-expect-error the types refuse it too: the subdomain is required
  await expect(revokeGrant(revoking, { accessToken: 'a', fetch: fake.fetch })).rejects.toThrow(new TypeError('template_missing: regional {sub}'));
  expect(fake.calls).toHaveLength(0);
});

test('a templated base is not filled when the client is built', async () => {
  const fake = filled(regional, {});
  const built = client(regional, { token: 't', fetch: fake.fetch });
  await expect(built.json('/a')).rejects.toThrow(new TypeError('template_missing: regional {sub}'));
  expect(fake.calls).toEqual([]);
});

test("on a typed host an app's own base may move the path, never the origin: another origin is refused, nothing sent", async () => {
  const fake = filled(regional, {});
  const elsewhere = client(regional, { token: 't', values: { sub: 'eu' }, fetch: fake.fetch, baseUrl: 'https://proxy.test/regional/' });
  await expect(elsewhere.json('/a')).rejects.toThrow(new TypeError('base_host_refused: regional'));
  expect(fake.calls).toEqual([]);
  const moved = client(regional, { token: 't', values: { sub: 'eu' }, fetch: fake.fetch, baseUrl: 'https://eu.example.com/v2/' });
  await moved.json('/a');
  expect(fake.calls.map(call => call.url)).toEqual(['https://eu.example.com/v2/a']);
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

test("Jira's base takes the saved cloud id as one path segment", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  for (const [cloudId, url] of [['c1', 'https://api.atlassian.com/ex/jira/c1/rest/api/3/myself'],
    ['a/b', 'https://api.atlassian.com/ex/jira/a%2Fb/rest/api/3/myself'],
    ['../../oauth', 'https://api.atlassian.com/ex/jira/..%2F..%2Foauth/rest/api/3/myself']]) {
    await client(jira, { token: 't', values: { cloudId }, fetch: fake.fetch }).json('/rest/api/3/myself');
    expect(fake.calls.at(-1)?.url).toBe(url);
  }
});

// A lone surrogate is no well-formed Unicode: `encodeURIComponent` would throw a raw URIError.
test.each([['..', 'base_value_invalid: jira {cloudId}'], ['.', 'base_value_invalid: jira {cloudId}'], ['\uD800', 'base_value_invalid: jira {cloudId}'],
  ['a\uDFFFb', 'base_value_invalid: jira {cloudId}'], ['', 'template_missing: jira {cloudId}']])(
  "a hostile path value %j is refused before the token is read or anything is sent", async (cloudId, message) => {
    const fake = filled(jira, { cloudId });
    await expect(fake.client.json('/rest/api/3/myself')).rejects.toThrow(new TypeError(message));
    expect(fake.token).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

test('a request revoke on a second base goes there, the credential with it, needing no values', async () => {
  // The value in the base's path, as Jira's: a typed host beside a second base is `host_split` (below). Widened: the
  // types ask for every plain field the entry declares, though this revoke reads none.
  const revoking: Entry = defineProvider({ ...regional, http: { baseUrl: 'https://example.com/{sub}/v1', bases: { auth: 'https://auth.example.test/v2' } },
    revoke: { request: { base: 'auth', method: 'POST', path: '/revoke' } } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await revokeGrant(revoking, { accessToken: 'a', fetch: fake.fetch });
  expect(fake.calls.map(call => [call.method, call.url, call.headers.authorization])).toEqual([['POST', 'https://auth.example.test/v2/revoke', 'Bearer a']]);
  const unknown = defineProvider({ ...revoking, revoke: { request: { base: 'nope', path: '/revoke' } } });
  await expect(revokeGrant(unknown, { accessToken: 'a', fetch: fake.fetch })).rejects.toThrow(new TypeError('base_unknown: nope'));
  expect(fake.calls).toHaveLength(1);
});

test('a key on a typed host beside a fixed second base is host_split where a call chooses that base, nothing sent', async () => {
  const split = defineProvider({ ...regional, http: { ...regional.http, bases: { auth: 'https://auth.example.test/v2' } },
    identify: { request: { base: 'auth', path: '/me' } } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await expect(finishConnect(split, { secret: { apiKey: 'k' }, values: { sub: 'eu' }, fetch: fake.fetch }))
    .rejects.toThrow(new TypeError('host_split: regional'));
  expect(fake.calls).toEqual([]);
});

test('a named base with a placeholder is refused where a call chooses it: a named base is never filled', async () => {
  const templated = defineProvider({ ...regional, http: { ...regional.http, bases: { auth: 'https://{sub}.example.com/auth' } },
    revoke: { request: { base: 'auth', method: 'POST', path: '/revoke' } } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await expect(revokeGrant(templated, { accessToken: 'a', values: { sub: 'eu' }, fetch: fake.fetch }))
    .rejects.toThrow(new TypeError('base_templated: auth'));
  expect(fake.calls).toEqual([]);
});

test("a token sign-in whose token URL is fixed while the base is typed is host_split before a token is requested", async () => {
  const fake = fakeFetch([{ url: /./u, respond: () => Response.json({ access_token: 'cloud-token', id: '1' }) }]);
  const split = defineProvider({ id: 'tok', name: 'Tok', fields: [{ name: 'host', title: 'Host' }, { name: 'secret', title: 'Secret', secret: true }],
    auth: [{ kind: 'token', request: { url: 'https://auth.k.test/token', body: { s: '{secret}' } } }],
    http: { baseUrl: 'https://{host}/api', host: '*' }, identify: { request: { path: '/me' }, id: 'id' } });
  const refused = new TypeError('host_split: tok');
  await expect(requestToken(split, { secret: { secret: 's' }, values: { host: 'evil.k.test' }, fetch: fake.fetch })).rejects.toThrow(refused);
  await expect(finishConnect(split, { secret: { secret: 's' }, values: { host: 'evil.k.test' }, fetch: fake.fetch })).rejects.toThrow(refused);
  expect(fake.calls).toEqual([]);
});

test('a primary base that is not well formed refuses the entry on every path, before a named base, a token request or an own base sends', async () => {
  const fake = fakeFetch([{ url: /./u, respond: () => Response.json({ access_token: 't', id: '1' }) }]);
  const refused = new TypeError('base_host_refused: bent');
  const fields = [{ name: 'host', title: 'Host' }, { name: 'secret', title: 'Secret', secret: true }] as const;
  const http = { baseUrl: 'https://{host}?mode=1', host: '*', bases: { cloud: 'https://cloud.k.test' } } as const;
  const keyed = defineProvider({ id: 'bent', name: 'Bent', fields, auth: [{ kind: 'key' }], http, identify: { request: { base: 'cloud', path: '/me' } } });
  await expect(finishConnect(keyed, { secret: { secret: 'k' }, values: { host: 'a.k.test' }, fetch: fake.fetch })).rejects.toThrow(refused);
  const token = defineProvider({ id: 'bent', name: 'Bent', fields, http: { baseUrl: 'https://{host}?mode=1', host: '*' },
    auth: [{ kind: 'token', request: { url: 'https://auth.k.test/token', body: { s: '{secret}' } } }] });
  await expect(requestToken(token, { secret: { secret: 's' }, values: { host: 'a.k.test' }, fetch: fake.fetch })).rejects.toThrow(refused);
  await expect(createClient(keyed, { token: () => Promise.resolve('t'), values: { host: 'a.k.test' }, fetch: fake.fetch,
    baseUrl: 'https://other.k.test' }).json('/a')).rejects.toThrow(refused);
  expect(fake.calls).toEqual([]);
});

test('finishConnect refuses an entry checkHosts refuses before it reads a credential, even when identify sends nothing', async () => {
  const fake = fakeFetch([{ url: /./u, respond: ok }]);
  // A local id and no identify request: the client never sends, so only the finish can refuse the `http://` named base.
  const local = defineProvider({ id: 'local', name: 'Local', fields: [{ name: 'id', title: 'Id' }, { name: 'apiKey', title: 'Key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.k.test', bases: { other: 'http://other.k.test' } }, identify: { id: 'connection.id' } });
  let reads = 0;
  const secret = { get apiKey() { reads++; return 'k'; } };
  await expect(finishConnect(local, { secret, values: { id: 'u1' }, fetch: fake.fetch })).rejects.toThrow(new TypeError('base_host_refused: local'));
  expect(reads).toBe(0);
  expect(fake.calls).toEqual([]);
});

/** Every name the malformed templates below use, filled with a value the base rule accepts. */
const bentFields = ['host', 'user', 'port'].map(name => ({ name, title: name }));
const bentValues = { host: 'evil.k.test', user: 'u', port: '8443' };
test.each(['https:///{host}/api', 'https:\\\\{host}/api', 'https:/{host}/api', 'HTTPS://{host}/api', 'https://\t{host}/api',
  'https://{host}\n.k.test/api', 'https://{user}@k.test/api', 'https://k.test:{port}/api', 'https://{host}\\@k.test/api',
  'https://{host}?x/api', 'https://{host}#/api', 'https://k.test@{host}/api', 'https://{host} /api'])(
  'a URL template that is not well formed (%j) is base_host_refused wherever it is declared, nothing sent', async template => {
    const fake = fakeFetch([{ url: /./u, respond: () => Response.json({ access_token: 'a', token_type: 'bearer', id: '1' }) }]);
    const refused = new TypeError('base_host_refused: bent');
    const base = defineProvider({ id: 'bent', name: 'Bent', fields: [...bentFields, { name: 'apiKey', title: 'Key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: template, host: '*' } });
    await expect(createClient(base, { token: () => Promise.resolve('t'), values: bentValues, fetch: fake.fetch }).json('/a')).rejects.toThrow(refused);
    const oauth = defineProvider({ id: 'bent', name: 'Bent', fields: bentFields, http: { baseUrl: 'https://api.k.test' },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.k.test/authorize', tokenUrl: template, pkce: false }] });
    await expect(exchangeCode(oauth, { clientId: 'c', clientSecret: 's' }, { code: 'x', redirectUri: 'https://app.test/cb', values: bentValues,
      fetch: fake.fetch })).rejects.toThrow(refused);
    const token = defineProvider({ id: 'bent', name: 'Bent', fields: [...bentFields, { name: 'secret', title: 'Secret', secret: true }],
      auth: [{ kind: 'token', request: { url: template, body: { s: '{secret}' } } }], http: { baseUrl: 'https://api.k.test' } });
    await expect(requestToken(token, { secret: { secret: 's' }, values: bentValues, fetch: fake.fetch })).rejects.toThrow(refused);
    const named = defineProvider({ ...base, http: { baseUrl: 'https://api.k.test', bases: { other: template.replaceAll(/\{\w+\}/gu, 'evil.k.test') } },
      identify: { request: { base: 'other', path: '/me' } } });
    await expect(finishConnect(named, { secret: { apiKey: 'k' }, values: bentValues, fetch: fake.fetch })).rejects.toThrow(refused);
    expect(fake.calls).toEqual([]);
  });

test('whenever the engine sends, the host is the template\'s host part filled with the values: a probe of generated templates', async () => {
  let seed = 7;
  const pick = <T>(items: readonly T[]): T => { seed = (seed * 1103515245 + 12345) % 2147483648; return items[seed % items.length] as T; };
  // Mostly well formed, so many send; the rest are the shapes the URL parser reads differently.
  const schemes = ['https://', 'https://', 'https://', 'https://', 'https:///', 'https:\\\\', 'https:/', 'HTTPS://', 'https://\t'];
  const pieces = ['{a}', '{a}', '{b}', 'k.test', '.k.test', '{a}.k.test', '-', 'x', ':8443', '@', ':', '{a}@', ':{b}', '\\', '?', '#',
    '%2e', '\n', '[', '/'];
  const tails = ['', '/', '/api', '/{b}/api', '?q=1', '#f'];
  const values = ['evil.k.test', 'a', 'b.c', '127.0.0.1', '0x7f.1', '8443', 'x-y', 'a.k.test', '1'];
  let sent = 0;
  for (let at = 0; at < 6000; at++) {
    const template = pick(schemes) + Array.from({ length: 1 + (at % 3) }, () => pick(pieces)).join('') + pick(tails);
    const filled = { a: pick(values), b: pick(values) };
    const entry = defineProvider({ id: 'probe', name: 'Probe', fields: [{ name: 'a', title: 'A' }, { name: 'b', title: 'B' }],
      auth: [{ kind: 'key' }], http: { baseUrl: template, host: '*' } });
    const hosts: string[] = [];
    const fetch: typeof globalThis.fetch = input => { hosts.push(new Request(input).url); return Promise.resolve(Response.json({})); };
    if (hostPart(template) === undefined) {
      // Beside a fixed named base, and behind a fixed token URL, a base that is not well formed sends nothing.
      const named = defineProvider({ ...entry, fields: [...entry.fields, { name: 'k', title: 'K', secret: true }],
        http: { ...entry.http, bases: { cloud: 'https://cloud.k.test' } }, identify: { request: { base: 'cloud', path: '/me' } } });
      await finishConnect(named, { secret: { k: 'k' }, values: filled, fetch }).catch(() => undefined);
      const tokened = defineProvider({ ...named, auth: [{ kind: 'token', request: { url: 'https://auth.k.test/token', body: { k: '{k}' } } }] });
      await requestToken(tokened, { secret: { k: 'k' }, values: filled, fetch }).catch(() => undefined);
      expect(hosts, template).toEqual([]);
    }
    const answered = await createClient(entry, { token: () => Promise.resolve('t'), values: filled, fetch }).json('/x').then(() => true, () => false);
    if (!answered) { expect(hosts).toEqual([]); continue; }
    sent++;
    const part = hostPart(template);
    expect(part, template).toBeDefined();
    expect(new URL(hosts[0] ?? '').host, template).toBe(new URL(fill(part ?? '', name => filled[name as 'a' | 'b'], 'probe')).host);
  }
  expect(sent).toBeGreaterThan(300);
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

test("an own base is compared with the filled base's origin alone: a path value it discards is not needed", async () => {
  const tenanted = defineProvider({ id: 'ten', name: 'Ten', fields: [{ name: 'host', title: 'Host' }, { name: 'apiKey', title: 'Key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://{host}/tenants/{tenantId}', host: '*' } });
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await createClient(tenanted, { token: () => Promise.resolve('t'), values: { host: 'api.example.test' }, fetch: fake.fetch,
    baseUrl: 'https://api.example.test/v2' }).json('/a');
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.example.test/v2/a']);
});

test("an app's own base for a typed-host entry on another origin is refused, an address included, nothing sent", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  await expect(createClient(gitlab, { token: () => Promise.resolve('t'), values: { host: 'gitlab.example.com' }, fetch: fake.fetch,
    baseUrl: 'https://10.0.0.1/api/v4' }).json('/user')).rejects.toThrow(new TypeError('base_host_refused: gitlab'));
  expect(fake.calls).toEqual([]);
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
/** `first`, then 200: the retry is sent exactly `wait` milliseconds later. */
async function retriesAfter(entry: Entry, first: () => Response, wait: number) {
  const fake = script(entry, first, ok);
  const result = fake.client.json('/a');
  await vi.advanceTimersByTimeAsync(wait - 1);
  expect(fake.calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ ok: true });
  expect(fake.calls).toHaveLength(2);
}
/** `first` is the only request sent, however long the caller waits: the error it is classified as. */
async function sentOnce(entry: Entry, first: () => Response) {
  const fake = script(entry, first, ok);
  const result = fake.client.json('/a').catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(fake.calls).toHaveLength(1);
  return result;
}

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

  test('a positive Retry-After is waited', async () => {
    await retriesAfter(retrying({}), answer(503, { 'retry-after': '2' }), 2000);
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

  test('a limit of 0 on a 500 is sent once, unavailable by its rules', async () => {
    const fake = script(retrying({ limit: 0 }, { errors: { rules: [{ when: { status: 'error' }, code: 'unavailable' }] } }), answer(500), ok);
    const result = fake.client.json('').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ code: 'unavailable', status: 500 });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("a retry never comes before the provider's stated wait", () => {
  const reset = (unit: 's' | 'epochSeconds', extra: Retry = {}) => retrying({ ...extra, wait: { header: 'ratelimit-reset', unit } });

  test('a 429 whose Retry-After passes the default cap is sent once, rate_limited with that wait', async () => {
    expect(await sentOnce(retrying({}), answer(429, { 'retry-after': '120' })))
      .toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 120_000 });
  });

  test("any retried status whose Retry-After passes the cap is sent once: a 503's 90 s, 30 s past a 10 s maxWaitMs", async () => {
    expect(await sentOnce(retrying({}), answer(503, { 'retry-after': '90' }))).toMatchObject({ code: 'unavailable', retryAfterMs: 90_000 });
    expect(await sentOnce(retrying({ maxWaitMs: 10_000 }), answer(429, { 'retry-after': '30' })))
      .toMatchObject({ code: 'rate_limited', retryAfterMs: 30_000 });
  });

  test('onlyStated: an answer with no stated wait is sent once; one with a Retry-After waits it', async () => {
    expect(await sentOnce(retrying({ onlyStated: true }), limited)).toMatchObject({ code: 'rate_limited', retryAfterMs: null });
    await retriesAfter(retrying({ onlyStated: true }), answer(429, { 'retry-after': '2' }), 2000);
  });

  test('onlyStated: a network failure is tried once', async () => {
    const fake = script(retrying({ onlyStated: true }), offline, ok);
    const result = fake.client.json('/a').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ code: 'unavailable', status: null });
    expect(fake.calls).toHaveLength(1);
  });

  test('a declared header in seconds is waited; of several present, the longest', async () => {
    await retriesAfter(reset('s'), answer(429, { 'ratelimit-reset': '3' }), 3000);
    const both = retrying({ wait: { header: ['ratelimit-reset', 'ratelimit-user-reset'], unit: 's' } });
    await retriesAfter(both, answer(429, { 'ratelimit-reset': '2', 'ratelimit-user-reset': '5' }), 5000);
    await retriesAfter(both, answer(429, { 'ratelimit-user-reset': '2' }), 2000);
  });

  test('a declared header in epoch seconds waits until that instant', async () => {
    await retriesAfter(reset('epochSeconds'), answer(429, { 'ratelimit-reset': String(Date.now() / 1000 + 5) }), 5000);
  });

  test('a declared header past the cap is sent once with its wait; one not a number waits the default', async () => {
    expect(await sentOnce(reset('s'), answer(429, { 'ratelimit-reset': '61' }))).toMatchObject({ code: 'rate_limited', retryAfterMs: 61_000 });
    await retriesAfter(reset('s'), answer(429, { 'ratelimit-reset': 'soon' }), 1000);
  });

  test('a positive Retry-After wins over the declared wait', async () => {
    await retriesAfter(reset('s'), answer(429, { 'retry-after': '2', 'ratelimit-reset': '5' }), 2000);
  });

  test('a declared body path in seconds is waited', async () => {
    const todo = retrying({ wait: { path: 'error_extra.retry_after', unit: 's' } });
    await retriesAfter(todo, () => Response.json({ error_extra: { retry_after: 1.5 } }, { status: 429 }), 1500);
  });
  test('a Retry-After of 0 leaves the body wait that stopped the retry to the error: 61 s, sent once', async () => {
    const waitMs = retrying({ wait: { path: 'waitMs', unit: 'ms' } });
    expect(await sentOnce(waitMs, () => Response.json({ waitMs: 61_000 }, { status: 429, headers: { 'retry-after': '0' } })))
      .toMatchObject({ code: 'rate_limited', retryAfterMs: 61_000 });
  });

  test('a fractional wait is rounded up, never cut short: 1.0005 s retries at 1001 ms', async () => {
    const todo = retrying({ wait: { path: 'error_extra.retry_after', unit: 's' } });
    await retriesAfter(todo, () => Response.json({ error_extra: { retry_after: 1.0005 } }, { status: 429 }), 1001);
  });

  test('a wait too large to represent is the largest wait: sent once, carrying Number.MAX_SAFE_INTEGER', async () => {
    const huge = () => Response.json({ waitMs: 2 ** 53 }, { status: 429 });
    const largest = { code: 'rate_limited', retryAfterMs: Number.MAX_SAFE_INTEGER };
    expect(await sentOnce(retrying({ wait: { path: 'waitMs', unit: 'ms' } }), huge)).toMatchObject(largest);
    expect(await sentOnce(retrying({ onlyStated: true, wait: { path: 'waitMs', unit: 'ms' } }), huge)).toMatchObject(largest);
    expect(await sentOnce(retrying({}), answer(429, { 'retry-after': '9007199254740993' }))).toMatchObject(largest);
  });

  test("the error of a 429 carries the declared header's wait", async () => {
    expect(await sentOnce(reset('s', { limit: 0 }), answer(429, { 'ratelimit-reset': '3' })))
      .toMatchObject({ code: 'rate_limited', retryAfterMs: 3000 });
  });

  test("GitHub's 403 with no requests remaining carries its reset, as before", async () => {
    const at = String(Date.now() / 1000 + 90);
    const fake = fakeFetch([{ url: /https:/, respond: answer(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': at }) }]);
    await expect(createClient(github, { token: () => Promise.resolve('k'), fetch: fake.fetch, minIntervalMs: 0 }).json('/user'))
      .rejects.toMatchObject({ code: 'rate_limited', status: 403, retryAfterMs: 90_000 });
  });
});

describe('which answers state a declared wait', () => {
  const reset = (unit: 's' | 'epochSeconds', extra: Retry = {}) => retrying({ ...extra, wait: { header: 'ratelimit-reset', unit } });
  const todo = (extra: Retry = {}) => retrying({ ...extra, wait: { path: 'error_extra.retry_after', unit: 's' } });
  const body = (status: number, after: number) => () => Response.json({ error_extra: { retry_after: after } }, { status });

  test("a declared header is a 429's alone: a 404 and a 503 carrying it carry no wait", async () => {
    expect(await sentOnce(reset('s', { limit: 0 }), answer(404, { 'ratelimit-reset': '33' }))).toMatchObject({ code: 'not_found', retryAfterMs: null });
    expect(await sentOnce(reset('s', { limit: 0 }), answer(503, { 'ratelimit-reset': '33' }))).toMatchObject({ code: 'unavailable', retryAfterMs: null });
  });

  test('a 503 with only a reset header backs off as before', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try { await retriesAfter(reset('s'), answer(503, { 'ratelimit-reset': '3' }), 500); } finally { vi.restoreAllMocks(); }
  });

  test('a declared body wait counts on any retried status: a 503 waits its 10 s, and one of 120 s is sent once', async () => {
    await retriesAfter(todo(), body(503, 10), 10_000);
    expect(await sentOnce(todo(), body(503, 120))).toMatchObject({ code: 'unavailable', retryAfterMs: 120_000 });
  });

  test('a wait already past states none: with onlyStated and a limit of 5, one request and no wait carried', async () => {
    const past = String(Date.now() / 1000 - 10);
    expect(await sentOnce(reset('epochSeconds', { onlyStated: true, limit: 5 }), answer(429, { 'ratelimit-reset': past })))
      .toMatchObject({ code: 'rate_limited', retryAfterMs: null });
  });

  test('a body wait of 0 waits the default, and its error carries no wait', async () => {
    await retriesAfter(todo(), body(429, 0), 1000);
    expect(await sentOnce(todo({ limit: 0 }), body(429, 0))).toMatchObject({ code: 'rate_limited', retryAfterMs: null });
  });

  test('onlyStated on a 5xx: retried after its Retry-After, sent once without one', async () => {
    await retriesAfter(retrying({ onlyStated: true }), answer(503, { 'retry-after': '2' }), 2000);
    expect(await sentOnce(retrying({ onlyStated: true }), answer(503))).toMatchObject({ code: 'unavailable', retryAfterMs: null });
  });
});

/** Wrike's shape: fixed sign-in URLs; the base on the host the token answer names, under a declared domain. */
const named = defineProvider({ id: 'named', name: 'Named', scopes: { default: [] }, save: { host: 'tokenAnswer.host' },
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.named.test/authorize', tokenUrl: 'https://login.named.test/token' }],
  http: { baseUrl: 'https://{host}/api', host: '*.named.test' }, identify: { request: { path: '/me' }, id: 'id' } });

test.each([[{ host: 'a.named.test' }, 'https://a.named.test/api/me'], [{ host: 'https://a.named.test' }, 'https://a.named.test/api/me'],
  [{ host: 'https://a.named.test/' }, 'https://a.named.test/api/me']])("a client on a named host sends to the one kept: %j", async (values, url) => {
  const fake = filled(named, values);
  await fake.client.json('/me');
  expect(fake.calls.map(call => call.url)).toEqual([url]);
});

test("Pipedrive's shape: an origin the token answer names fills as its host", async () => {
  const origin = defineProvider({ ...named, save: { apiDomain: 'tokenAnswer.api_domain' }, http: { baseUrl: 'https://{apiDomain}/api/v1', host: '*.pipedrive.com' } });
  const fake = filled(origin, { apiDomain: 'https://x.pipedrive.com' });
  await fake.client.json('/users/me');
  expect(fake.calls.map(call => call.url)).toEqual(['https://x.pipedrive.com/api/v1/users/me']);
});

test.each([[{}, 'template_missing: named {host}'], [{ host: 'evil.test' }, 'base_host_refused: named'], [{ host: '127.0.0.1' }, 'base_host_refused: named'],
  [{ host: 'https://a.named.test@evil.test' }, 'base_value_invalid: named {host}'], [{ host: 'https://a.named.test/x' }, 'base_value_invalid: named {host}'],
  [{ host: 'http://a.named.test' }, 'base_value_invalid: named {host}'], [{ host: ['a.named.test'] }, 'template_missing: named {host}']])(
  'a client on a named host with the values %j is refused before the token is read, nothing sent', async (values, message) => {
    const fake = filled(named, values);
    await expect(fake.client.json('/me')).rejects.toThrow(new TypeError(message));
    expect([fake.token.mock.calls.length, fake.before.mock.calls.length, fake.calls.length]).toEqual([0, 0, 0]);
  });

/** A token sign-in whose base host is read from its token answer: a named host is OAuth 2's alone, so it is typed and split. */
const tokenSignIn = { kind: 'token', request: { url: 'https://login.named.test/token', body: { s: '{secret}' } } } as const;
const secretField = { name: 'secret', title: 'Secret', secret: true } as const;
test.each<[string, Entry]>([
  ['first', defineProvider({ id: 'named', name: 'Named', fields: [secretField], auth: [tokenSignIn], save: { host: 'tokenAnswer.host' },
    http: { baseUrl: 'https://{host}/api', host: '*.named.test' } })],
  ['later, with its own base', signInWith(defineProvider({ ...named, http: { baseUrl: 'https://api.named.test' },
    auth: [named.auth[0], { ...tokenSignIn, fields: [secretField], http: { baseUrl: 'https://{host}/api', host: '*.named.test' } }] }), 'token')],
])('a token sign-in, %s, whose base host its token answer names is host_split on every path, nothing sent', async (_, tokened) => {
  const fake = fakeFetch([{ url: /./u, respond: () => Response.json({ access_token: 'a', host: 'evil.test' }) }]);
  const refused = new TypeError('host_split: named');
  const values = { host: 'a.named.test' };
  await expect(finishConnect(tokened, { secret: { secret: 's' }, fetch: fake.fetch })).rejects.toThrow(refused);
  await expect(tokenSource(tokened, { secret: { secret: 's' }, values, fetch: fake.fetch })()).rejects.toThrow(refused);
  expect(() => client(tokened, { token: 't', values, fetch: fake.fetch })).toThrow(refused);
  expect(fake.calls).toEqual([]);
});

test.each<[string, Entry, string]>([
  ["`http.host: '*'`", { ...named, http: { ...named.http, host: '*' } }, 'base_host_refused: named'],
  ['no `http.host`', { ...named, http: { baseUrl: named.http.baseUrl } }, 'base_host_refused: named'],
  ['a typed host beside it', { ...named, fields: [{ name: 'region', title: 'Region' }], http: { ...named.http, baseUrl: 'https://{host}.{region}/api' } }, 'host_split: named'],
  ['a typed host beside it in every URL', { ...named, fields: [{ name: 'region', title: 'Region' }], http: { ...named.http, baseUrl: 'https://{host}.{region}/api' },
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}.{region}/authorize', tokenUrl: 'https://{host}.{region}/token' }] }, 'host_split: named'],
  // Typed, so split from the fixed sign-in URLs: a field of its name, or a value read from identify's answer.
  ['a field of its name', { ...named, fields: [{ name: 'host', title: 'Host' }] }, 'host_split: named'],
  ["its value read from identify's answer", { ...named, save: { host: 'host' } }, 'host_split: named'],
  ['a typed base with a named refresh URL', { ...named, fields: [{ name: 'site', title: 'Site' }], http: { ...named.http, baseUrl: 'https://{site}/api' },
    auth: [{ ...named.auth[0], refreshUrl: 'https://{host}/token' }] }, 'host_split: named'],
])('a named host with %s is refused on every path before anything is sent', async (_, entry, message) => {
  const fake = fakeFetch([{ url: /./u, respond: () => Response.json({ access_token: 'a', token_type: 'bearer', host: 'a.named.test', id: '1' }) }]);
  const refused = new TypeError(message);
  const values = { host: 'a.named.test', region: 'named.test', site: 'a.named.test' };
  const oauthClient = { clientId: 'c', clientSecret: 's' };
  await expect(startConnect(entry, { clientId: 'c', redirectUri: 'https://app.test/cb', state: 's', values })).rejects.toThrow(refused);
  await expect(finishConnect(entry, { client: oauthClient, code: 'c', redirectUri: 'https://app.test/cb', codeVerifier: 'v'.repeat(43), values,
    fetch: fake.fetch, onRevokeFailed: () => undefined })).rejects.toThrow(refused);
  expect(() => client(entry, { token: 't', values, fetch: fake.fetch })).toThrow(refused);
  await expect(refreshGrant(entry, oauthClient, 'r', { values, fetch: fake.fetch })).rejects.toThrow(refused);
  await expect(revokeGrant(entry, { accessToken: 'a', values, fetch: fake.fetch })).rejects.toThrow(refused);
  expect(fake.calls).toEqual([]);
});
