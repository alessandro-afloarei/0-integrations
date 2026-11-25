import { GrantRevoked, ProviderHttpError } from './errors.js';
import { safeDetail } from './http-response.js';

/** OAuth and Web API refusals share classification and never expose credentials as error detail. */
export function oauthRefusal(code: string, revokedErrors: readonly string[] | undefined, status: number, secrets: readonly string[],
  retryAfterMs: number | null = null): Error {
  const detail = safeDetail(code, secrets);
  if (code === 'invalid_grant' || revokedErrors?.includes(code)) return new GrantRevoked(detail);
  return new ProviderHttpError('request_failed', status, detail, { retryAfterMs });
}
