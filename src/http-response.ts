import type { Entry, Errors, Http, Retry, Wait } from './catalogue.js';
import { GrantRevoked, ProviderHttpError, type ProviderErrorCode } from './errors.js';
import type { ProviderResponse } from './http.js';
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
  // A secret is also matched as a detail reads and as a header sends it: trimmed, a slash read as a dot.
  const holdsSecret = secrets.flatMap(secret => [secret, secret.trim().replaceAll('/', '.')])
    .some(secret => secret.trim() !== '' && (code.includes(secret) || detail.includes(secret)));
  return /^[\w.-]{1,64}$/u.test(detail) && !holdsSecret ? detail : null;
}

/** The credentials each answer's request sent, so a code echoing one is never a detail; they never leave this library. */
const credentials = new WeakMap<ProviderResponse, readonly string[]>();

/** Records the credentials `response`'s request sent; only the HTTP client calls it. */
export function sentWith(response: ProviderResponse, sent: readonly string[]): ProviderResponse {
  credentials.set(response, sent);
  return response;
}

/** An answer as its data, or the error the entry's rules make of it; a 2xx without JSON is `invalid_response`. */
export function responseJson(entry: Pick<Entry, 'http' | 'errors'>, response: ProviderResponse): unknown {
  const error = classify(entry, response);
  if (error) throw error;
  if (response.data === undefined) {
    throw new ProviderHttpError('invalid_response', response.status, null, { retryAfterMs: retryAfterMs(response.headers, Date.now()) });
  }
  return response.data;
}

/** The provider's own code: the first of `detail`'s paths holding a non-empty string or a non-negative safe integer (read
 * as its digits), kept only if `allow` lists it. */
export function codeOf(errors: Errors | undefined, body: unknown): string | undefined {
  const paths = typeof errors?.detail === 'string' ? [errors.detail] : errors?.detail ?? [];
  const code = paths.map(path => readPath(body, path)).map(value => (Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : value))
    .find(value => typeof value === 'string' && value !== '');
  return typeof code === 'string' && (errors?.allow?.includes(code) ?? true) ? code : undefined;
}

/** The wait `wait` reads from an answer, in milliseconds from `now` (an instant already past is 0); `retryAfterMs`
 * checks its range, in milliseconds. The one reader of a declared wait, for the retry and for the error. */
export function waitOf(wait: Wait | undefined, { headers, body }: Pick<Answer, 'headers' | 'body'>, now: number): number | undefined {
  if (wait === undefined) return undefined;
  // A header holds a positive decimal number (the longest of those present counts), a body a number from 0.
  const read = 'path' in wait ? [readPath(body, wait.path)] : [wait.header].flat().map(name => headers.get(name) ?? '')
    .filter(text => /^\d+(?:\.\d+)?$/u.test(text)).map(Number).filter(value => value > 0);
  const values = read.filter((value): value is number => typeof value === 'number' && value >= 0);
  if (values.length === 0) return undefined;
  const ms = Math.max(...values) * (wait.unit === 's' || wait.unit === 'epochSeconds' ? 1000 : 1);
  return wait.unit === 's' || wait.unit === 'ms' ? ms : Math.max(0, ms - now);
}

/** The wait `retry.wait` states: a header's on a 429 alone (it rides on every answer), a body's on any; never 0. */
export const declaredWait = (wait: Wait | undefined, answer: Pick<Answer, 'status' | 'headers' | 'body'>, now: number) =>
  (wait && ('path' in wait || answer.status === 429) ? waitOf(wait, answer, now) || undefined : undefined);

/** A rate limit the entry declares beyond a 429: the first rule that holds, waiting its `wait`, else the default. */
function rateLimitOf(http: Http, answer: Answer, now: number): { waitMs: number | undefined } | undefined {
  const rule = http.rateLimit?.when.find(item => holds(item, answer));
  return rule && { waitMs: waitOf(rule.wait, answer, now) ?? http.rateLimit?.defaultWaitMs };
}

/** No `retry`: none. With one: a single retry, waits up to a minute, a second by default; a `limit` of 0 waits nothing. */
export function retryPolicy(retry: Retry | undefined): { limit: number; maxWaitMs: number; defaultWaitMs: number } {
  if (retry === undefined || retry.limit === 0) return { limit: 0, maxWaitMs: 0, defaultWaitMs: 0 };
  return { limit: retry.limit ?? 1, maxWaitMs: retry.maxWaitMs ?? 60_000, defaultWaitMs: retry.defaultWaitMs ?? 1000 };
}

/** The n-th retry's wait (n from 0) after a 408, a 5xx or a network failure: full jitter, uniform below one second
 * doubled n times, capped by `maxWaitMs`. Never from `defaultWaitMs`, which entries set for a rate limit (30 s). */
export function backoffMs(maxWaitMs: number, n: number): number {
  return Math.random() * Math.min(maxWaitMs, 1000 * 2 ** n);
}

/** An entry's answer as an error, or null: revoked codes, then `errors.rules`, then a declared rate limit, then the status. */
export function classify(entry: Pick<Entry, 'http' | 'errors'>, response: ProviderResponse, now = Date.now()): Error | null {
  const { status, headers, data: body } = response;
  const ok = status >= 200 && status < 300;
  const errors = entry.errors ?? {};
  const code = codeOf(errors, body);
  const answer = { status, headers, body, code };
  // Steps 1 to 3 read only an answer that is an error: outside 2xx, or a 2xx `failed` marks.
  if (ok && (errors.failed === undefined || !holds(errors.failed, answer))) return null;
  // Never a code holding a credential the request sent.
  const detail = code === undefined ? null : safeDetail(code, credentials.get(response) ?? []);
  if (code !== undefined && errors.revoked?.includes(code)) return new GrantRevoked(detail);
  const stated = declaredWait(entry.http.retry?.wait, answer, now);
  // An error a rule decides is no declared rate limit, so it never carries that limit's wait.
  const rule = errors.rules?.find(item => holds(item.when, answer));
  if (rule) return new ProviderHttpError(rule.code, status, rule.detail ?? detail, { retryAfterMs: retryAfterMs(headers, now, stated) });
  const limit = rateLimitOf(entry.http, answer, now);
  // The wait the retry read first (`statedWait`); the rate limit's only when the answer states none.
  const metadata = { retryAfterMs: retryAfterMs(headers, now, stated ?? limit?.waitMs) };
  if (limit) return new ProviderHttpError('rate_limited', status, detail, metadata);
  return new ProviderHttpError(ok ? 'request_failed' : statusCode(status), status, detail, metadata);
}
