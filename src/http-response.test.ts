import { expect, test } from 'vitest';
import { safeDetail } from './http-response.js';

test.each([
  ['usage_limit', [], 'usage_limit'],
  ['AUTH.AUTHENTICATION.API_KEY_INVALID', [], 'AUTH.AUTHENTICATION.API_KEY_INVALID'],
  ['provider/insufficient_permissions', [], 'provider.insufficient_permissions'],
  ['errors/disconnected_account', [], 'errors.disconnected_account'],
  ['x'.repeat(65), [], null], ['usage limit; email=a@b.test', [], null], ['', [], null], ['error\nprivate', [], null],
  ['xoxb_token', ['xoxb_token'], null], ['bad_code', ['', 'other'], 'bad_code'],
] as const)('safeDetail(%j, %j) is %j', (code, secrets, detail) => {
  expect(safeDetail(code, secrets)).toBe(detail);
});
