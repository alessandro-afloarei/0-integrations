import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProviderHttpError } from './errors.js';
import type { Entry } from './catalogue.js';
import { breakcold } from './catalogue/breakcold.js';
import { hubspot } from './catalogue/hubspot.js';
import { slack } from './catalogue/slack.js';
import { createClient } from './http.js';
import { revokeGrant } from './oauth.js';
import { firefliesClient } from './fireflies/fireflies.js';
import { hubspotClient } from './hubspot/hubspot.js';
import { slackClient } from './slack/slack.js';
import { fakeFetch, sequence } from './testing.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

function scripted(...responses: (() => Response)[]) {
  return fakeFetch([{ url: /https:/u, respond: sequence(...responses) }]);
}

function http(entry: Entry, fetch: typeof globalThis.fetch) {
  return createClient(entry, { token: () => Promise.resolve('fixture-key'), fetch, minIntervalMs: 0 });
}

describe('provider wait metadata', () => {
  test('preserves the three-argument error contract and an explicitly supplied wait', () => {
    expect(new ProviderHttpError('rate_limited', 429, 'quota')).toMatchObject({
      message: 'rate_limited', status: 429, detail: 'quota', retryAfterMs: null,
    });
    expect(new ProviderHttpError('rate_limited', 429, 'quota', { retryAfterMs: 2000 })).toMatchObject({
      message: 'rate_limited', status: 429, detail: 'quota', retryAfterMs: 2000,
    });
  });

  test.each([
    ['2', 2000], ['0', 0], ['0002', 2000],
    ['Sun, 01 Nov 2026 12:00:03 GMT', 3000], ['Sun, 01 Nov 2026 11:59:59 GMT', 0],
    ['Sunday, 01-Nov-26 12:00:03 GMT', 3000], ['Sun Nov  1 12:00:03 2026', 3000],
    ['Tuesday, 02-Nov-76 12:00:00 GMT', 0],
    ['9007199254740', 9_007_199_254_740_000], ['9007199254741', Number.MAX_SAFE_INTEGER],
    [undefined, null], ['', null], [' ', null], ['later', null], ['-1', null], ['Infinity', null],
    ['NaN', null], ['1.5', 1500], ['+2', null], ['2e3', null], ['0x10', null],
    ['2026-11-02', null], ['Sun, 99 Nov 2026 12:00:03 GMT', null],
    ['Sundayy, 01-Nov-26 12:00:03 GMT', null], ['Sun, 01-Nov-26 12:00:03 GMT', null],
  ] as const)('retains only a valid Retry-After header %j as %j milliseconds without a retry', async (value, retryAfterMs) => {
    const headers = value === undefined ? {} : { 'Retry-After': value };
    const fake = scripted(() => Response.json({}, { status: 429, headers }));
    await expect(http(hubspot, fake.fetch).json('/items', { method: 'POST' }))
      .rejects.toMatchObject({ message: 'rate_limited', code: 'rate_limited', status: 429, retryAfterMs });
    expect(fake.calls).toHaveLength(1);
  });

  test.each([[0, null], [12.1, 13], [1500, 1500], [-1, null], ['1500', null], [null, null], [Infinity, null],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER]])('keeps a valid Breakcold body delay %j as %j milliseconds', async (wait, retryAfterMs) => {
    const fake = scripted(() => Response.json({ error: { code: 'usage_limit', retryAfterMs: wait } }, { status: 429 }));
    await expect(http(breakcold, fake.fetch).json('/items', { method: 'POST' }))
      .rejects.toMatchObject({ code: 'rate_limited', detail: 'usage_limit', retryAfterMs });
    expect(fake.calls).toHaveLength(1);
  });

  test.each([['0', 1500], ['2', 2000], ['invalid', 1500], ['-1', 1500], ['', 1500]] as const)
  ('prefers a positive header %j over the body, otherwise falls back to the body', async (value, retryAfterMs) => {
    const fake = scripted(() => Response.json({ error: { retryAfterMs: 1500 } }, { status: 429, headers: { 'Retry-After': value } }));
    await expect(http(breakcold, fake.fetch).json('/items', { method: 'POST' })).rejects.toMatchObject({ retryAfterMs });
  });

  test('exposes the final response wait after the existing retry without waiting again', async () => {
    const fake = scripted(
      () => Response.json({}, { status: 429, headers: { 'Retry-After': '1' } }),
      () => Response.json({}, { status: 429, headers: { 'Retry-After': '7' } }),
    );
    const result = http(hubspot, fake.fetch).json('/items').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(999);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ code: 'rate_limited', retryAfterMs: 7000 });
    expect(fake.calls).toHaveLength(2);
    expect(Date.now()).toBe(NOW + 1000);
  });

  test('carries a retry hint on a non-rate-limit HTTP error without changing its code', async () => {
    // 501 is never retried, so the hint is the error's to carry.
    const fake = scripted(() => Response.json({}, { status: 501, headers: { 'Retry-After': '2' } }));
    await expect(http(hubspot, fake.fetch).json('/items')).rejects.toMatchObject({ code: 'unavailable', status: 501, retryAfterMs: 2000 });
    expect(fake.calls).toHaveLength(1);
  });
});

describe('Fireflies retry hints', () => {
  test.each([
    [200, 'too_many_requests', 'rate_limited'], [429, undefined, 'rate_limited'],
    [500, 'auth_failed', 'rejected'], [408, 'timeout', 'request_failed'],
    [404, 'object_not_found', 'not_found'], [503, undefined, 'unavailable'],
  ] as const)('keeps code precedence on HTTP %i / %j and carries the selected error timestamp', async (status, code, expected) => {
    const fake = scripted(() => Response.json({ errors: [{ code, message: 'fixture-private-message',
      extensions: { code, metadata: { retryAfter: NOW + 4000, token: 'fixture-private-token' } } }] }, { status }));
    // A caller's signal: a call with one is never retried, so the case tests the error alone, whatever the entry's retry.
    const signal = new AbortController().signal;
    const error: unknown = await firefliesClient({ apiKey: 'fixture-key', fetch: fake.fetch, signal }).user().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ code: expected, status, detail: code ?? null, retryAfterMs: 4000 });
    expect(JSON.stringify(error)).not.toContain('fixture-private');
    expect(JSON.stringify(error)).not.toContain('fixture-key');
    expect(fake.calls).toHaveLength(1);
  });

  test.each([[NOW - 1, null], [NOW, null], [NOW + 0.5, 1], ['1720651545066', null], [null, null],
    [-1, null], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1 - NOW]])('validates the epoch-ms timestamp %j before deriving its wait', async (timestamp, retryAfterMs) => {
    const fake = scripted(() => Response.json({ errors: [{ extensions: { code: 'too_many_requests', metadata: { retryAfter: timestamp } } }] }));
    await expect(firefliesClient({ apiKey: 'fixture-key', fetch: fake.fetch }).user()).rejects.toMatchObject({ retryAfterMs });
  });

  test.each([['2', 2000], ['0', 4000], ['invalid', 4000]] as const)('prefers a positive header %j over the Fireflies timestamp', async (value, retryAfterMs) => {
    const fake = scripted(() => Response.json({ errors: [{ code: 'too_many_requests',
      extensions: { metadata: { retryAfter: NOW + 4000 } } }] }, { headers: { 'Retry-After': value } }));
    await expect(firefliesClient({ apiKey: 'fixture-key', fetch: fake.fetch }).user()).rejects.toMatchObject({ retryAfterMs });
  });

  test('does not attach a different GraphQL error\'s wait to the selected failure', async () => {
    const fake = scripted(() => Response.json({ errors: [{ code: 'auth_failed' },
      { code: 'too_many_requests', extensions: { metadata: { retryAfter: NOW + 4000 } } }] }));
    await expect(firefliesClient({ apiKey: 'fixture-key', fetch: fake.fetch }).user())
      .rejects.toMatchObject({ code: 'rejected', detail: 'auth_failed', retryAfterMs: null });
  });
});

describe('HubSpot category metadata', () => {
  test.each([
    [403, 'MISSING_SCOPES', 'MISSING_SCOPES', 'rejected'],
    [400, 'VALIDATION_ERROR', 'VALIDATION_ERROR', 'request_failed'],
    [403, undefined, null, 'rejected'], [403, 'read contacts permission required', null, 'rejected'],
    [403, 'fixture-private-token', null, 'rejected'], [403, 'UNKNOWN_CATEGORY', null, 'rejected'],
    [403, { category: 'MISSING_SCOPES' }, null, 'rejected'], [403, 'x'.repeat(65), null, 'rejected'],
  ] as const)('retains only an admitted category on HTTP %i: %j', async (status, category, detail, code) => {
    const fake = scripted(() => Response.json({ status: 'error', category, message: 'fixture-private-message',
      correlationId: 'fixture-private-id', context: { token: 'fixture-private-token' } }, { status, headers: { 'Retry-After': '2' } }));
    const error: unknown = await hubspotClient({ token: () => Promise.resolve('fixture-private-token'), fetch: fake.fetch, minIntervalMs: 0 })
      .search('companies', { since: null, properties: ['name'] }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ message: code, code, status, detail, retryAfterMs: 2000 });
    expect(JSON.stringify(error)).not.toContain('fixture-private');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('Slack retry hints', () => {
  test.each([200, 429])('keeps a Retry-After on an HTTP %i post refusal without another send', async status => {
    const fake = scripted(() => Response.json({ ok: false, error: 'ratelimited' }, { status, headers: { 'Retry-After': '2' } }));
    await expect(slackClient({ token: 'fixture-key', fetch: fake.fetch }).postMessage({ channel: 'C1', text: 'hi' }))
      .rejects.toMatchObject({ code: status === 200 ? 'request_failed' : 'rate_limited', status, detail: 'ratelimited', retryAfterMs: 2000 });
    expect(fake.calls).toHaveLength(1);
  });

  test.each(['channels', 'revoke'] as const)('retains a hint on Slack %s without changing the refusal', async operation => {
    const fake = scripted(() => Response.json({ ok: false, error: 'ratelimited' }, { headers: { 'Retry-After': '2' } }));
    const run = operation === 'channels' ? slackClient({ token: 'fixture-key', fetch: fake.fetch }).channels()
      : revokeGrant(slack, { accessToken: 'fixture-key', fetch: fake.fetch, values: { domain: 'slack.com' } });
    await expect(run)
      .rejects.toMatchObject({ code: 'request_failed', status: 200, detail: 'ratelimited', retryAfterMs: 2000 });
    expect(fake.calls).toHaveLength(1);
  });
});
