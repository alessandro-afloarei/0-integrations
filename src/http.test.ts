import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createClient } from './http.js';
import { breakcold, exa, fireflies, granola, hubspot, unipile, type ProviderDefinition } from './providers.js';
import { fakeFetch, sequence } from './testing.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

function script(provider: ProviderDefinition, ...responses: (() => Response)[]) {
  const fake = fakeFetch([{ url: /https:/, respond: sequence(...responses) }]);
  const token = vi.fn<(rejected?: string) => Promise<string>>().mockResolvedValue('t');
  const client = createClient({ provider: { ...provider, minIntervalMs: 0 }, token, fetch: fake.fetch });
  return { ...fake, token, client };
}
const ok = () => Response.json({ ok: true });
const limited = () => Response.json({}, { status: 429 });

test('sends the token where the provider wants it', async () => {
  for (const [provider, header, value] of [[hubspot, 'authorization', 'Bearer t'], [exa, 'x-api-key', 't']] as const) {
    const fake = script(provider, ok);
    expect(await fake.client.json('/items?old=1', { query: { q: 'two' } })).toEqual({ ok: true });
    expect(fake.calls[0]?.headers[header]).toBe(value);
    expect(fake.calls[0]?.url).toBe(`${provider.baseUrl ?? ''}/items?old=1&q=two`);
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
    const fake = script(hubspot, () => Response.json({}, { status }));
    await expect(fake.client.json('/items')).rejects.toMatchObject({ code, status });
    expect(fake.calls).toHaveLength(1);
  }
});

test("times out at the provider's timeoutMs", async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Promise<Response>(() => {}) }]);
  const client = createClient({ provider: hubspot, token: () => Promise.resolve('t'), fetch: fake.fetch });
  let settled = false;
  const result = client.json('/items').catch((e: unknown) => { settled = true; return e; });
  await vi.advanceTimersByTimeAsync(29999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toMatchObject({ code: 'unavailable', status: null });
});

test('paces requests to minIntervalMs', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: ok }]);
  const client = createClient({ provider: granola, token: () => Promise.resolve('t'), fetch: fake.fetch });
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
  const fake = fakeFetch([{ url: 'https://api1.unipile.com:13111/api/v1/users', respond: ok }]);
  const client = createClient({ provider: unipile, token: () => Promise.resolve('k'), fetch: fake.fetch,
    baseUrl: 'https://api1.unipile.com:13111/api/v1', headers: { 'user-agent': 'integrations-test' } });
  await client.json('/users');
  expect(fake.calls[0]?.url).toBe('https://api1.unipile.com:13111/api/v1/users');
  expect(fake.calls[0]?.headers).toMatchObject({ 'user-agent': 'integrations-test', 'x-api-key': 'k' });
  const bare: ProviderDefinition = { id: 'bare', timeoutMs: 30000, minIntervalMs: 0, retry: unipile.retry };
  expect(() => createClient({ provider: bare, token: () => Promise.resolve('k'), fetch: fake.fetch })).toThrow('base_url_required');
});

test('invalid JSON is unavailable as data and invalid_response through json', async () => {
  const fake = script(exa, () => new Response('<html>no JSON</html>'));
  expect((await fake.client.request('/items')).data).toBeUndefined();
  await expect(fake.client.json('/items')).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
});

test('network failures and caller aborts are unavailable', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => { throw new TypeError('fetch failed'); } }]);
  const client = createClient({ provider: hubspot, token: () => Promise.resolve('t'), fetch: fake.fetch });
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
  const client = createClient({ provider: { ...breakcold, timeoutMs: 20 }, token: () => Promise.resolve('t'), fetch: fake.fetch });
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
  const client = createClient({ provider: exa, token: () => Promise.resolve('key'), fetch: fake.fetch });
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
  const client = createClient({ provider: breakcold, token: () => Promise.resolve('key'), fetch: fake.fetch });
  expect(await client.json('/crm/objects', { query: { workspaceId: 'w' } })).toEqual({ objects: [] });
  expect(fake.calls.map(call => [call.url, call.headers.authorization])).toEqual([
    ['https://rest.breakcold.com/api/v1/crm/objects?workspaceId=w', 'Bearer key'],
    ['https://rest.breakcold.com/api/v1/eu/crm/objects?workspaceId=w', 'Bearer key'],
  ]);
});

test('never follows a redirect that carries credentials in its address', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 307,
    headers: { location: 'https://u:p@api.exa.ai/search' } }) }]);
  const client = createClient({ provider: exa, token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search')).rejects.toMatchObject({ code: 'request_failed', status: 307 });
  expect(fake.calls).toHaveLength(1);
});

test('never turns a write into a GET to follow a redirect', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 302, headers: { location: '/moved' } }) }]);
  const client = createClient({ provider: exa, token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search', { method: 'POST', json: { query: 'q' } }))
    .rejects.toMatchObject({ code: 'request_failed', status: 302 });
  expect(fake.calls).toHaveLength(1);
});

test('stops following redirects after five hops', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 307, headers: { location: '/again' } }) }]);
  const client = createClient({ provider: exa, token: () => Promise.resolve('key'), fetch: fake.fetch });
  await expect(client.json('/search')).rejects.toMatchObject({ code: 'request_failed', status: 307 });
  expect(fake.calls).toHaveLength(6);
});

test('requests refused at once share one renewal', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: request => request.headers.get('authorization') === 'Bearer old'
    ? Response.json({}, { status: 401 }) : ok() }]);
  const token = vi.fn<(rejected?: string) => Promise<string>>()
    .mockResolvedValueOnce('old').mockResolvedValue('new');
  const client = createClient({ provider: { ...hubspot, minIntervalMs: 0 }, token, fetch: fake.fetch });
  expect(await Promise.all([client.json('/a'), client.json('/b'), client.json('/c')])).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(token.mock.calls).toEqual([[], ['old']]);
});

test('beforeRequest runs once per call, with its address, before anything is sent', async () => {
  const seen: string[] = [];
  const fake = fakeFetch([{ url: /https:/, respond: sequence(limited, ok) }]);
  const client = createClient({ provider: { ...breakcold, retry: { ...breakcold.retry, defaultWaitMs: 1 } },
    token: () => Promise.resolve('t'), fetch: fake.fetch, beforeRequest: url => { seen.push(url.toString()); } });
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
  const client = createClient({ provider: breakcold, token: () => Promise.resolve('t'), fetch: fake.fetch,
    beforeRequest: () => Promise.reject(spent) });
  await expect(client.json('/records')).rejects.toBe(spent);
  expect(fake.calls).toHaveLength(0);
});

test("a refusal carries the provider's own error code", async () => {
  const usage = script(breakcold, () => Response.json({ error: { code: 'usage_limit', message: 'm', requestId: 'r' } }, { status: 402 }));
  usage.token.mockResolvedValue('bk_test'); // 't' is in 'usage_limit', and a code holding the credential is no detail
  await expect(usage.client.json('/records')).rejects.toMatchObject({ code: 'request_failed', status: 402, detail: 'usage_limit' });
  const bare = script(breakcold, () => new Response('gateway', { status: 502 }));
  await expect(bare.client.json('/records')).rejects.toMatchObject({ code: 'unavailable', detail: null });
  const elsewhere = script(hubspot, () => Response.json({ error: { code: 'usage_limit' } }, { status: 402 }));
  await expect(elsewhere.client.json('/x')).rejects.toMatchObject({ detail: null });
});

test('beforeRequest reads a copy of the address, so metering never changes the request', async () => {
  const fake = script(breakcold, ok);
  const client = createClient({ provider: breakcold, token: () => Promise.resolve('t'), fetch: fake.fetch,
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
    const client = createClient({ provider: unipile, token: () => Promise.resolve(key), fetch: fake.fetch });
    await expect(client.json('/accounts')).rejects.toMatchObject({ code: 'rejected', detail });
    expect(fake.calls[0]?.headers['x-api-key']).toBe(key);
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
