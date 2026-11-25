import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { safeDetail } from './http-response.js';
import * as derived from './providers.js';
import * as legacy from './providers.legacy.test-support.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-01T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

/** Grows to all 17 in Tasks 6 and 7. */
const IDS = ['exa', 'firecrawl', 'fathom', 'granola', 'attio', 'notion', 'aircall'] as const;
const data = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown; // drops the function fields
/** What reaches an error: today's code and the derived one both pass the one sanitiser. */
const detail = (code: string | undefined) => (code === undefined ? null : safeDetail(code));
const BODIES: unknown[] = [undefined, null, 'text', 7, {}, [], { error: 'usage_limit' }, { error: { code: 7 } },
  { error: { code: 'organization_moved', retryAfterMs: 1500 } }, { error: { retryAfterMs: '1' } },
  { error: { code: 'InvalidAuthenticationToken' } }, { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'userRateLimitExceeded' }] } },
  { error: { errors: [{ reason: 'insufficientPermissions' }] } }, { error: { status: 'UNAUTHENTICATED' } },
  { category: 'MISSING_SCOPES' }, { category: 'VALIDATION_ERROR' }, { category: 'UNKNOWN' }, { category: { category: 'MISSING_SCOPES' } },
  { error_details: { code: 'AUTH.AUTHENTICATION.API_KEY_INVALID' } }, { message: 'V3 API access is not enabled for this account' },
  { message: 'You have exceeded a secondary rate limit' }, { type: 'provider/insufficient_permissions' },
  { type: 'api/expired_authorization' }, { ok: false, error: 'token_revoked' },
  { errors: [{ code: 'auth_failed', extensions: { metadata: { retryAfter: 1793534400000 } } }] }];
const ANSWERS: [number, Record<string, string>][] = [[400, {}], [401, {}], [403, {}], [404, {}], [429, {}], [500, {}],
  [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793534490' }], [429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793534490' }],
  [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' }], [403, { 'retry-after': '30' }]];

test.each(IDS)("%s's definition is today's", id => {
  const now = derived[id];
  const then = legacy[id];
  expect(data(now)).toEqual(data(then));
  expect([typeof now.errorDetail, typeof now.rateLimit, typeof now.retry.waitFromBody])
    .toEqual([typeof then.errorDetail, typeof then.rateLimit, typeof then.retry.waitFromBody]);
  for (const body of BODIES) {
    expect(detail(now.errorDetail?.(body))).toBe(detail(then.errorDetail?.(body)));
    expect(now.retry.waitFromBody?.(body)).toBe(then.retry.waitFromBody?.(body));
    for (const [status, headers] of ANSWERS) {
      expect(now.rateLimit?.(status, new Headers(headers), body)).toEqual(then.rateLimit?.(status, new Headers(headers), body));
    }
  }
});
