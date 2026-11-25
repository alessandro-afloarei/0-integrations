import { GrantRevoked, ProviderHttpError } from './errors.js';

/** OAuth and Web API refusals share classification and never expose credentials as error detail. */
export function oauthRefusal(code: string, revokedErrors: readonly string[] | undefined, status: number, secrets: readonly string[],
  retryAfterMs: number | null = null): Error {
  const detail = /^[a-z][a-z0-9_]{0,63}$/iu.test(code)
    && !secrets.some(secret => secret.length > 0 && code.includes(secret)) ? code : null;
  if (code === 'invalid_grant' || revokedErrors?.includes(code)) return new GrantRevoked(detail);
  return new ProviderHttpError('request_failed', status, detail, { retryAfterMs });
}
