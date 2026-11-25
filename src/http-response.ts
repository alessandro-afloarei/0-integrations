import { ProviderHttpError, type ProviderErrorCode } from './errors.js';
import type { ProviderDefinition } from './providers.js';
import { retryAfterMs } from './retry-after.js';

function errorCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'rejected';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status >= 500) return 'unavailable';
  return 'request_failed';
}

/** A provider's error code as a short token (a slash read as a dot), or null when it could carry a body or a secret. */
export function safeDetail(code: string, secrets: readonly string[] = []): string | null {
  const detail = code.replaceAll('/', '.');
  return /^[\w.-]{1,64}$/u.test(detail) && !secrets.some(secret => secret.length > 0 && code.includes(secret)) ? detail : null;
}

/** Shared by json() and providers which must also read headers on HTTP-successful error responses. */
export function responseJson(provider: ProviderDefinition, response: { status: number; headers: Headers; data: unknown }): unknown {
  const { status, headers, data } = response;
  if (status < 200 || status >= 300) {
    const detail = provider.errorDetail?.(data);
    const limit = provider.rateLimit?.(status, headers, data);
    throw new ProviderHttpError(limit ? 'rate_limited' : errorCode(status), status,
      detail === undefined ? null : safeDetail(detail),
      { retryAfterMs: retryAfterMs(headers, Date.now(), limit?.waitMs ?? provider.retry.waitFromBody?.(data)) });
  }
  if (data === undefined) throw new ProviderHttpError('invalid_response', status, null,
    { retryAfterMs: retryAfterMs(headers, Date.now()) });
  return data;
}
