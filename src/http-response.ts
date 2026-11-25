import type { Entry, Errors, Http, Retry } from './catalogue.js';
import { GrantRevoked, ProviderHttpError, type ProviderErrorCode } from './errors.js';
import type { ProviderResponse } from './http.js';
import type { ProviderDefinition } from './providers.js';
import { retryAfterMs } from './retry-after.js';
import { holds, readPath, type Answer } from './rules.js';

function statusCode(status: number): ProviderErrorCode {
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
    throw new ProviderHttpError(limit ? 'rate_limited' : statusCode(status), status,
      detail === undefined ? null : safeDetail(detail),
      { retryAfterMs: retryAfterMs(headers, Date.now(), limit?.waitMs ?? provider.retry.waitFromBody?.(data)) });
  }
  if (data === undefined) throw new ProviderHttpError('invalid_response', status, null,
    { retryAfterMs: retryAfterMs(headers, Date.now()) });
  return data;
}

/** The provider's own code: the first of `detail`'s paths holding a non-empty string, kept only if `allow` lists it. */
export function codeOf(errors: Errors | undefined, body: unknown): string | undefined {
  const paths = typeof errors?.detail === 'string' ? [errors.detail] : errors?.detail ?? [];
  const code = paths.map(path => readPath(body, path)).find(value => typeof value === 'string' && value !== '');
  return typeof code === 'string' && (errors?.allow?.includes(code) ?? true) ? code : undefined;
}

/** The wait the body names, in milliseconds from `now`; `retryAfterMs` validates it as it does today. */
export function bodyWaitOf(retry: Retry | undefined, body: unknown, now: number): number | undefined {
  if (retry?.waitFromBody === undefined) return undefined;
  const value = readPath(body, retry.waitFromBody.path);
  if (typeof value !== 'number') return undefined;
  if (retry.waitFromBody.unit === 'ms') return value;
  return value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.max(0, value - now) : undefined;
}

/** A rate limit the entry declares beyond a 429: the first rule that holds, waiting its reset, else the default. */
export function rateLimitOf(http: Http, answer: Answer, now: number): { waitMs: number | undefined } | undefined {
  const rule = http.rateLimit?.when.find(item => holds(item, answer));
  if (rule === undefined) return undefined;
  const reset = rule.resetAt === undefined ? Number.NaN : Number(answer.headers.get(rule.resetAt.header));
  return { waitMs: Number.isSafeInteger(reset) && reset > 0 ? Math.max(0, reset * 1000 - now) : http.rateLimit?.defaultWaitMs };
}

/** No `retry`: none. With one: a single retry, waits up to a minute, a second by default; a `limit` of 0 waits nothing. */
export function retryPolicy(retry: Retry | undefined): { limit: number; maxWaitMs: number; defaultWaitMs: number } {
  if (retry === undefined || retry.limit === 0) return { limit: 0, maxWaitMs: 0, defaultWaitMs: 0 };
  return { limit: retry.limit ?? 1, maxWaitMs: retry.maxWaitMs ?? 60_000, defaultWaitMs: retry.defaultWaitMs ?? 1000 };
}

/** An entry's answer as an error, or null: revoked codes, then `errors.rules`, then a declared rate limit, then the status. */
export function classify(entry: Pick<Entry, 'http' | 'errors'>, response: ProviderResponse, now = Date.now()): Error | null {
  const { status, headers, data: body } = response;
  const ok = status >= 200 && status < 300;
  const errors = entry.errors ?? {};
  // Steps 1 to 3 read only an answer that is an error: outside 2xx, or a 2xx `failed` marks.
  const failed = ok && errors.failed !== undefined && holds(errors.failed, { status, headers, body });
  if (ok && !failed) return null;
  const code = codeOf(errors, body);
  const answer = { status, headers, body, code };
  const detail = code === undefined ? null : safeDetail(code);
  if (code !== undefined && errors.revoked?.includes(code)) return new GrantRevoked(detail);
  const limit = rateLimitOf(entry.http, answer, now);
  const metadata = { retryAfterMs: retryAfterMs(headers, now, limit?.waitMs ?? bodyWaitOf(entry.http.retry, body, now)) };
  const rule = errors.rules?.find(item => holds(item.when, answer));
  if (rule) return new ProviderHttpError(rule.code, status, rule.detail ?? detail, metadata);
  if (limit) return new ProviderHttpError('rate_limited', status, detail, metadata);
  return new ProviderHttpError(ok ? 'request_failed' : statusCode(status), status, detail, metadata);
}
