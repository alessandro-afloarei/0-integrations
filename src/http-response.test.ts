import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defineProvider, type Entry } from './catalogue.js';
import { breakcold } from './catalogue/breakcold.js';
import { fireflies } from './catalogue/fireflies.js';
import { github } from './catalogue/github.js';
import { google } from './catalogue/google.js';
import { hubspot } from './catalogue/hubspot.js';
import { lusha } from './catalogue/lusha.js';
import { slack } from './catalogue/slack.js';
import { GrantRevoked, ProviderHttpError } from './errors.js';
import { classify, codeOf, retryPolicy, safeDetail, waitOf } from './http-response.js';
import { createClient } from './http.js';
import { fakeFetch } from './testing.js';

test.each([
  ['usage_limit', [], 'usage_limit'],
  ['AUTH.AUTHENTICATION.API_KEY_INVALID', [], 'AUTH.AUTHENTICATION.API_KEY_INVALID'],
  ['provider/insufficient_permissions', [], 'provider.insufficient_permissions'],
  ['errors/disconnected_account', [], 'errors.disconnected_account'],
  ['x'.repeat(65), [], null], ['usage limit; email=a@b.test', [], null], ['', [], null], ['error\nprivate', [], null],
  ['xoxb_token', ['xoxb_token'], null], ['bad_code', ['', 'other'], 'bad_code'], ['fixture/key', ['fixture.key'], null],
  ['abc.def', ['abc/def'], null], ['key', [' key '], null], ['a_code', ['  '], 'a_code'],
] as const)('safeDetail(%j, %j) is %j', (code, secrets, detail) => {
  expect(safeDetail(code, secrets)).toBe(detail);
});

const NOW = Date.parse('2026-11-01T12:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());
type Rules = Pick<Entry, 'http' | 'errors'>;
const BASE = { baseUrl: 'https://api.acme.test' };
const response = (status: number, data: unknown, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers), data });
const fail = (entry: Rules, status: number, data: unknown, headers?: Record<string, string>) => {
  const error = classify(entry, response(status, data, headers));
  return error instanceof ProviderHttpError
    ? { code: error.code, status: error.status, detail: error.detail, retryAfterMs: error.retryAfterMs } : error;
};

/** Codes before statuses, a 2xx that `failed` marks, and a wait in the body as an epoch in milliseconds. */
const graph: Rules = {
  http: { ...BASE, retry: { limit: 0, wait: { path: 'errors.0.wait', unit: 'epochMs' } } },
  errors: { detail: ['errors.0.code', 'errors.0.ext.code'], failed: { path: 'errors.0' }, rules: [
    { when: { detail: 'denied' }, code: 'rejected' }, { when: { detail: 'slow_down' }, code: 'rate_limited' },
    { when: { detail: true }, code: 'request_failed' }, { when: { status: 'error' }, code: 'unavailable' },
  ] },
};

test.each([
  [500, 'denied', 'rejected'], [429, 'denied', 'rejected'], [200, 'slow_down', 'rate_limited'],
  [404, 'other', 'request_failed'], [503, undefined, 'unavailable'],
] as const)('rules in order, a code before the status: %i with %j is %s', (status, code, expected) => {
  for (const error of [{ code }, { ext: { code } }]) {
    expect(fail(graph, status, { errors: [error] })).toMatchObject({ code: expected, status, detail: code ?? null });
  }
});

test('a 2xx is an error only where `failed` holds, and one with no code is request_failed', () => {
  for (const error of [null, { message: 'private' }]) {
    expect(fail(graph, 200, { errors: [error] })).toEqual({ code: 'request_failed', status: 200, detail: null, retryAfterMs: null });
  }
  expect(classify(graph, response(200, { errors: [] }))).toBeNull();
  expect(classify(graph, response(200, {}))).toBeNull();
});

test("the body's epoch wait, after Retry-After, read from the first error only", () => {
  const limited = (wait: unknown) => ({ errors: [{ code: 'slow_down', wait }] });
  expect(fail(graph, 200, limited(NOW + 4000))).toMatchObject({ retryAfterMs: 4000 });
  expect(fail(graph, 200, limited(NOW + 4000), { 'Retry-After': '2' })).toMatchObject({ retryAfterMs: 2000 });
  expect(fail(graph, 200, { errors: [{ code: 'denied' }, { wait: NOW + 4000 }] })).toMatchObject({ retryAfterMs: null });
  for (const [wait, ms] of [[NOW - 1, null], [NOW, null], [NOW + 0.5, 1], [String(NOW), null], [-1, null]] as const) {
    expect(fail(graph, 200, limited(wait))).toMatchObject({ retryAfterMs: ms });
  }
});

test('a wait too large is measured in milliseconds: carried while it is a safe number of them, else the largest', () => {
  // An instant past the safe integers in its own unit can still be a safe number of milliseconds away.
  const far = Number.MAX_SAFE_INTEGER + 1;
  expect(fail(graph, 200, { errors: [{ code: 'slow_down', wait: far }] })).toMatchObject({ retryAfterMs: far - NOW });
  const reset: Rules = { http: { ...BASE, retry: { wait: { header: 'ratelimit-reset', unit: 's' } } } };
  expect(fail(reset, 429, {}, { 'ratelimit-reset': String(Number.MAX_SAFE_INTEGER) })).toMatchObject({ retryAfterMs: Number.MAX_SAFE_INTEGER });
});

/** A rate limit without a 429: by a header with a reset, by a message, by the provider's code. */
const limits: Rules = {
  http: { ...BASE, rateLimit: { defaultWaitMs: 60_000, when: [
    { status: 403, header: 'x-left', equals: '0', wait: { header: 'x-reset', unit: 'epochSeconds' } },
    { status: 403, path: 'message', contains: 'slow down' }, { status: 403, detail: 'quota' },
  ] } },
  errors: { detail: 'error.code' },
};

test('a declared rate limit waits its reset, Retry-After first, else the default', () => {
  const reset = String(NOW / 1000 + 90);
  expect(fail(limits, 403, {}, { 'x-left': '0', 'x-reset': reset })).toMatchObject({ code: 'rate_limited', retryAfterMs: 90_000 });
  expect(fail(limits, 403, {}, { 'x-left': '0', 'x-reset': 'soon' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 60_000 });
  expect(fail(limits, 403, {}, { 'x-left': '0', 'x-reset': reset, 'Retry-After': '30' })).toMatchObject({ retryAfterMs: 30_000 });
  expect(fail(limits, 403, { message: 'Please SLOW DOWN' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 60_000 });
  expect(fail(limits, 403, { error: { code: 'quota' } })).toMatchObject({ code: 'rate_limited', detail: 'quota', retryAfterMs: 60_000 });
  expect(fail(limits, 403, { error: { code: 403 } })).toMatchObject({ code: 'rejected', detail: null, retryAfterMs: null });
  expect(fail(limits, 429, {})).toMatchObject({ code: 'rate_limited', retryAfterMs: null });
  expect(fail(limits, 403, {})).toMatchObject({ code: 'rejected', retryAfterMs: null });
});

test("a declared rate limit's error carries the stated wait first: Retry-After, else retry.wait, else the rule's", () => {
  const both: Rules = { http: { ...BASE, retry: { limit: 0, wait: { path: 'waitMs', unit: 'ms' } },
    rateLimit: { when: [{ status: 429, wait: { header: 'x-reset', unit: 's' } }] } } };
  expect(fail(both, 429, { waitMs: 5000 }, { 'x-reset': '9' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 5000 });
  expect(fail(both, 429, {}, { 'x-reset': '9' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 9000 });
  expect(fail(both, 429, { waitMs: 5000 }, { 'x-reset': '9', 'Retry-After': '2' })).toMatchObject({ retryAfterMs: 2000 });
});

test('a rule with no status holds on any status and names its own detail', () => {
  const plan: Rules = { http: BASE, errors: { rules: [{ when: { path: 'message', startsWith: 'Feature off' },
    code: 'request_failed', detail: 'feature_off' }] } };
  expect(fail(plan, 403, { message: 'Feature off for this plan' })).toMatchObject({ code: 'request_failed', status: 403, detail: 'feature_off' });
  expect(fail(plan, 401, { message: 'Feature off' })).toMatchObject({ code: 'request_failed', status: 401, detail: 'feature_off' });
  expect(fail(plan, 403, { message: 'Inactive' })).toMatchObject({ code: 'rejected', detail: null });
});

test('a revoked code is GrantRevoked, a slash becomes a dot, a body wait in milliseconds', () => {
  const chat: Rules = { http: { ...BASE, retry: { defaultWaitMs: 0, wait: { path: 'error.waitMs', unit: 'ms' } } },
    errors: { detail: 'error.code', failed: { path: 'ok', equals: false }, revoked: ['gone'] } };
  const gone = classify(chat, response(200, { ok: false, error: { code: 'gone' } }));
  expect(gone).toBeInstanceOf(GrantRevoked);
  expect(gone).toMatchObject({ detail: 'gone' });
  expect(fail(chat, 200, { ok: false, error: { code: 'busy' } })).toMatchObject({ code: 'request_failed', status: 200, detail: 'busy' });
  expect(classify(chat, response(200, { ok: true }))).toBeNull();
  expect(fail(chat, 429, { error: { code: 'kind/limit', waitMs: 12.1 } }))
    .toMatchObject({ code: 'rate_limited', detail: 'kind.limit', retryAfterMs: 13 });
});

test('codeOf, waitOf and retryPolicy', () => {
  expect(codeOf({ detail: ['a', 'b'] }, { a: 7, b: 'x' })).toBe('x');
  expect(codeOf({ detail: ['a', 'b'] }, { a: '', b: 'x' })).toBe('x');
  expect(codeOf({ detail: 'a' }, { a: { a: 'x' } })).toBeUndefined();
  expect(codeOf({ detail: 'a', allow: ['KNOWN'] }, { a: 'OTHER' })).toBeUndefined();
  expect(codeOf({ detail: 'a', allow: ['KNOWN'] }, { a: 'KNOWN' })).toBe('KNOWN');
  expect(codeOf(undefined, { error: 'x' })).toBeUndefined();
  expect(waitOf({ path: 'w', unit: 'ms' }, { headers: new Headers(), body: { w: '1' } }, NOW)).toBeUndefined();
  expect(waitOf({ header: ['a', 'b'], unit: 's' }, { headers: new Headers({ a: '2', b: '1.5' }), body: {} }, NOW)).toBe(2000);
  expect(waitOf({ header: 'a', unit: 'epochMs' }, { headers: new Headers({ a: String(NOW + 40) }), body: {} }, NOW)).toBe(40);
  expect(waitOf({ path: 'w', unit: 'epochSeconds' }, { headers: new Headers(), body: { w: NOW / 1000 + 2 } }, NOW)).toBe(2000);
  for (const value of ['-1', '1e3', '0x10', '', '0']) expect(waitOf({ header: 'a', unit: 's' }, { headers: new Headers({ a: value }), body: {} }, NOW)).toBeUndefined();
  expect(retryPolicy(undefined)).toEqual({ limit: 0, maxWaitMs: 0, defaultWaitMs: 0 });
  expect(retryPolicy({})).toEqual({ limit: 1, maxWaitMs: 60_000, defaultWaitMs: 1000 });
  expect(retryPolicy({ limit: 0, wait: { path: 'w', unit: 'epochMs' } })).toEqual({ limit: 0, maxWaitMs: 0, defaultWaitMs: 0 });
  expect(retryPolicy({ limit: 3, defaultWaitMs: 30_000 })).toEqual({ limit: 3, maxWaitMs: 60_000, defaultWaitMs: 30_000 });
});

test.each([
  [500, 'auth_failed', 'rejected'], [429, 'auth_failed', 'rejected'], [401, 'too_many_requests', 'rejected'],
  [500, 'too_many_requests', 'rate_limited'], [200, 'too_many_requests', 'rate_limited'], [429, undefined, 'rate_limited'],
  [200, 'object_not_found', 'not_found'], [429, 'object_not_found', 'rate_limited'], [404, 'object_not_found', 'not_found'],
  [500, 'query_too_big', 'request_failed'], [408, 'timeout', 'request_failed'], [503, undefined, 'unavailable'],
] as const)('Fireflies: GraphQL codes before statuses, HTTP %i with %j is %s', (status, code, expected) => {
  for (const error of [{ code }, { extensions: { code } }]) {
    expect(fail(fireflies, status, { errors: [error] })).toMatchObject({ code: expected, status, detail: code ?? null });
  }
});

test('Fireflies: a codeless error inside a 200 is request_failed, an empty list is success', () => {
  for (const error of [null, { message: 'private' }, { extensions: {} }]) {
    expect(fail(fireflies, 200, { errors: [error], data: {} })).toEqual({ code: 'request_failed', status: 200, detail: null, retryAfterMs: null });
  }
  expect(classify(fireflies, response(200, { errors: [], data: {} }))).toBeNull();
  expect(classify(fireflies, response(200, {}))).toBeNull();
});

test("Fireflies: the first error's epoch-ms wait, the header first", () => {
  const limited = { errors: [{ code: 'too_many_requests', extensions: { metadata: { retryAfter: NOW + 4000 } } }] };
  expect(fail(fireflies, 200, limited)).toMatchObject({ retryAfterMs: 4000 });
  expect(fail(fireflies, 200, limited, { 'Retry-After': '2' })).toMatchObject({ retryAfterMs: 2000 });
  expect(fail(fireflies, 200, { errors: [{ code: 'auth_failed' }, { code: 'x', extensions: { metadata: { retryAfter: NOW + 4000 } } }] }))
    .toMatchObject({ code: 'rejected', retryAfterMs: null });
});

test('GitHub: three 403 rules, the reset only when none remain', () => {
  const reset = String(NOW / 1000 + 90);
  expect(fail(github, 403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })).toMatchObject({ code: 'rate_limited', retryAfterMs: 90_000 });
  expect(fail(github, 429, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })).toMatchObject({ code: 'rate_limited', retryAfterMs: 90_000 });
  expect(fail(github, 403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' })).toMatchObject({ retryAfterMs: 60_000 });
  expect(fail(github, 403, {}, { 'retry-after': '30' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 30_000 });
  expect(fail(github, 403, { message: 'You have exceeded a secondary rate limit' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 60_000 });
  expect(fail(github, 429, {})).toMatchObject({ code: 'rate_limited', retryAfterMs: 60_000 });
  expect(fail(github, 403, { message: 'Resource not accessible' })).toMatchObject({ code: 'rejected', retryAfterMs: null });
});

test('Lusha: the v3 message is request_failed, any other 403 rejected', () => {
  expect(fail(lusha, 403, { message: 'V3 API access is not enabled for this account' })).toMatchObject({ code: 'request_failed', status: 403, detail: 'v3_not_enabled' });
  expect(fail(lusha, 403, { message: 'Account inactive' })).toMatchObject({ code: 'rejected', detail: null });
});

/** A key sent bare in a header, and the provider's code at `type` (`provider/insufficient_permissions`). */
const headerKey = defineProvider({ id: 'header-key', name: 'Header key', auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: BASE, errors: { detail: 'type' } });

test("Breakcold's body wait in milliseconds and code at error.code; a slash in a code made a dot", () => {
  expect(fail(breakcold, 429, { error: { code: 'usage_limit', retryAfterMs: 12.1 } })).toMatchObject({ code: 'rate_limited', detail: 'usage_limit', retryAfterMs: 13 });
  expect(fail(breakcold, 402, { error: { code: 7 } })).toMatchObject({ code: 'request_failed', detail: null });
  expect(fail(headerKey, 403, { type: 'provider/insufficient_permissions' })).toMatchObject({ code: 'rejected', detail: 'provider.insufficient_permissions' });
});

test("an answer's code holding the credential its request sent is no detail", async () => {
  const key = 'uk_live.Abc-123';
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ type: key }, { status: 403 }) }]);
  const client = createClient(headerKey, { token: () => Promise.resolve(key), fetch: fake.fetch });
  const answer = await client.request('/accounts');
  expect(classify(headerKey, answer)).toMatchObject({ code: 'rejected', detail: null });
  expect(fail(headerKey, 403, { type: key })).toMatchObject({ code: 'rejected', detail: key });
});

test('Google: a numeric error.code is no code, so the reason decides', () => {
  expect(fail(google, 403, { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'userRateLimitExceeded' }] } }))
    .toMatchObject({ code: 'rate_limited', detail: 'userRateLimitExceeded', retryAfterMs: 60_000 });
  expect(fail(google, 403, { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } }))
    .toMatchObject({ code: 'rejected', detail: 'insufficientPermissions', retryAfterMs: null });
  expect(fail(google, 401, { error: { status: 'UNAUTHENTICATED' } })).toMatchObject({ code: 'rejected', detail: 'UNAUTHENTICATED' });
});

test('HubSpot: only an allowed category is a detail', () => {
  expect(fail(hubspot, 403, { category: 'MISSING_SCOPES' })).toMatchObject({ code: 'rejected', detail: 'MISSING_SCOPES' });
  expect(fail(hubspot, 403, { category: 'UNKNOWN_CATEGORY' })).toMatchObject({ detail: null });
  expect(fail(hubspot, 403, { category: { category: 'MISSING_SCOPES' } })).toMatchObject({ detail: null });
});

test('Slack: ok:false inside a 200 is request_failed, a gone token is GrantRevoked', () => {
  expect(fail(slack, 200, { ok: false, error: 'channel_not_found' })).toMatchObject({ code: 'request_failed', status: 200, detail: 'channel_not_found' });
  const gone = classify(slack, response(200, { ok: false, error: 'token_revoked' }));
  expect(gone).toBeInstanceOf(GrantRevoked);
  expect(gone).toMatchObject({ detail: 'token_revoked' });
  expect(classify(slack, response(200, { ok: true }))).toBeNull();
});

test('a `failed` condition reads the provider code: `detail: true` marks a 200 that names one', () => {
  const coded: Rules = { http: BASE, errors: { detail: 'error', failed: { detail: true } } };
  expect(fail(coded, 200, { error: 'stale' })).toEqual({ code: 'request_failed', status: 200, detail: 'stale', retryAfterMs: null });
  expect(classify(coded, response(200, {}))).toBeNull();
});

test("an error a rule decides carries Retry-After, never the declared rate limit's wait", () => {
  const both: Rules = { http: { ...BASE, rateLimit: { defaultWaitMs: 60_000, when: [{ status: 403 }] } },
    errors: { rules: [{ when: { status: 403 }, code: 'rejected' }] } };
  expect(fail(both, 403, {})).toMatchObject({ code: 'rejected', retryAfterMs: null });
  expect(fail(both, 403, {}, { 'Retry-After': '30' })).toMatchObject({ code: 'rejected', retryAfterMs: 30_000 });
});

test.each(['a b', 'a@b.test', 'error\nprivate', 'x'.repeat(65)])('an unsafe provider code %j is no detail', code => {
  expect(fail({ http: BASE, errors: { detail: 'error' } }, 400, { error: code })).toMatchObject({ code: 'request_failed', detail: null });
  const gone = classify({ http: BASE, errors: { detail: 'error', revoked: [code] } }, response(400, { error: code }));
  expect(gone).toBeInstanceOf(GrantRevoked);
  expect(gone).toMatchObject({ detail: null });
});

test('a reset already past waits 0; one beyond the safe range once in milliseconds the largest; a negative body wait none', () => {
  expect(fail(limits, 403, {}, { 'x-left': '0', 'x-reset': String(NOW / 1000 - 10) })).toMatchObject({ code: 'rate_limited', retryAfterMs: 0 });
  expect(fail(limits, 403, {}, { 'x-left': '0', 'x-reset': String(Number.MAX_SAFE_INTEGER) }))
    .toMatchObject({ code: 'rate_limited', retryAfterMs: Number.MAX_SAFE_INTEGER });
  const chat: Rules = { http: { ...BASE, retry: { wait: { path: 'waitMs', unit: 'ms' } } } };
  expect(fail(chat, 429, { waitMs: -5 })).toMatchObject({ code: 'rate_limited', retryAfterMs: null });
});

test('codeOf: an earlier code that `allow` refuses hides a later allowed one', () => {
  expect(codeOf({ detail: ['a', 'b'], allow: ['KNOWN'] }, { a: 'OTHER', b: 'KNOWN' })).toBeUndefined();
  expect(codeOf({ detail: ['a', 'b'], allow: ['KNOWN'] }, { a: '', b: 'KNOWN' })).toBe('KNOWN');
  expect(codeOf({ detail: ['a', 'b'], allow: ['KNOWN'] }, { b: 'KNOWN' })).toBe('KNOWN');
});

test("a declared header wait is a 429's alone, Retry-After first", () => {
  const reset: Rules = { http: { ...BASE, retry: { wait: { header: 'ratelimit-reset', unit: 's' } } } };
  expect(fail(reset, 429, {}, { 'ratelimit-reset': '3' })).toMatchObject({ code: 'rate_limited', retryAfterMs: 3000 });
  expect(fail(reset, 404, {}, { 'ratelimit-reset': '3' })).toMatchObject({ code: 'not_found', retryAfterMs: null });
  expect(fail(reset, 503, {}, { 'ratelimit-reset': '3' })).toMatchObject({ code: 'unavailable', retryAfterMs: null });
  expect(fail(reset, 503, {}, { 'ratelimit-reset': '3', 'Retry-After': '7' })).toMatchObject({ code: 'unavailable', retryAfterMs: 7000 });
});
