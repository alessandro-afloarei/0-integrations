import type { ReadableStreamDefaultReader } from 'node:stream/web';
import ky, { HTTPError, isNetworkError, isTimeoutError } from 'ky';
import type { Call, Entry, Method, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { blockedHost, guardedFetch } from './guard.js';
import { backoffMs, bodyWaitOf, responseJson, retryPolicy, sentWith } from './http-response.js';
import { retryAfterMs } from './retry-after.js';
import { fill, parseJson, placeholders, plainValue } from './rules.js';

export type RequestOptions = {
  method?: Method;
  query?: Readonly<Record<string, string>>;
  json?: unknown;
  form?: Readonly<Record<string, string>>;
  idempotent?: boolean;
  signal?: AbortSignal;
};
export type ProviderResponse = { status: number; headers: Headers; data: unknown };

/** The request a declared call makes, with what the caller adds: GraphQL is a POST of the query and its variables to
 * the base. The one rule for every declared call (identify, a request revoke, an operation, a paged operation). */
export function callRequest(call: Call, extra: RequestOptions & { variables?: Values } = {}): [path: string, options: RequestOptions] {
  const { variables = {}, ...options } = extra;
  return call.graphql === undefined
    ? [call.path ?? '', { method: call.method ?? 'GET', ...(call.query ? { query: call.query } : {}), ...options }]
    : ['', { method: 'POST', json: { query: call.graphql, variables }, ...options }];
}
export type HttpClient = {
  /** The base every path is read after: the entry's, or the one the client was built with. */
  readonly baseUrl: string;
  json(path: string, options?: RequestOptions): Promise<unknown>;
  request(path: string, options?: RequestOptions): Promise<ProviderResponse>;
};

async function retryBody(response: Response, timeoutMs: number): Promise<string> {
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new ProviderHttpError('unavailable', null)); }, timeoutMs);
  });
  const body = (async () => {
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString('utf8');
      chunks.push(value);
    }
  })();
  try {
    return await Promise.race([body, timeout]);
  } finally {
    clearTimeout(timer);
    // A cloned stream can wait for its sibling to cancel, so disposal must not block the timeout.
    void reader.cancel().catch(() => undefined);
  }
}

const MAX_REDIRECTS = 5;
/** The statuses a read is retried after: a rate limit, a timeout and the passing server failures (never 501). */
const RETRIED = [408, 429, 500, 502, 503, 504];

/**
 * The redirect to follow, as fetch would: only to the same origin, since the credential must not reach another host,
 * and only when it keeps the request as it was (307/308, or 301–303 for a GET). Breakcold's universal endpoint
 * redirects a signed-in request to its region this way.
 */
function redirectTarget(url: URL, method: string, response: ProviderResponse): URL | null {
  const keepsRequest = response.status === 307 || response.status === 308
    || (method === 'GET' && (response.status === 301 || response.status === 302 || response.status === 303));
  const location = response.headers.get('location');
  if (!keepsRequest || location === null) return null;
  try {
    const next = new URL(location, url);
    return next.origin === url.origin && next.username === '' && next.password === '' ? next : null;
  } catch {
    return null;
  }
}

/** What a request's credential adds: a header, or query parameters set on every hop. */
type Credential = { header?: [name: string, value: string]; query?: [name: string, value: string][] };

/** Bearer by default, a header's bare token, Basic from a template, or the query's parameters from templates. */
function credentialOf(entry: Entry, token: string, values: Values): Credential {
  const [auth] = entry.auth;
  const send = 'send' in auth ? auth.send : undefined;
  if (send === undefined) return { header: ['authorization', `Bearer ${token}`] };
  if ('header' in send) return { header: [send.header, token] };
  const secret = entry.fields?.find(field => field.secret === true)?.name;
  const lookup = (name: string) => (name === 'token' || name === secret ? token : plainValue(values, name));
  if ('query' in send) return { query: Object.entries(send.query).map(([name, template]) => [name, fill(template, lookup, entry.id)]) };
  const pair = `${fill(send.basic[0], lookup, entry.id)}:${fill(send.basic[1], lookup, entry.id)}`;
  return { header: ['authorization', `Basic ${Buffer.from(pair).toString('base64')}`] };
}

/** A value a base's placeholder takes: a host name's ASCII labels. Never a port (`http.host` checks the name alone), a
 * `/`, `@`, `#`, space or empty label; no `i` flag, which would let the Kelvin sign and the long s pass as `k` and `s`. */
const BASE_VALUE = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/u;

/** The entry's base, its placeholders filled from plain values: an https URL with no user, its host matching `http.host`
 * (equal, `*.d` a name ending in `.d`, `*` any). Throws before anything is read or sent. */
function filledBase(entry: Entry, values: Values): string {
  const { baseUrl, host = '' } = entry.http;
  if (placeholders(baseUrl).length === 0) return baseUrl;
  const filled = fill(baseUrl, name => {
    const value = plainValue(values, name);
    if (value !== undefined && !BASE_VALUE.test(String(value))) throw new TypeError(`base_value_invalid: ${entry.id} {${name}}`);
    return value;
  }, entry.id);
  const url = URL.canParse(filled) ? new URL(filled) : undefined;
  const hosted = url !== undefined && (host === '*' || url.hostname === host || (host.startsWith('*.') && url.hostname.endsWith(host.slice(1))));
  if (!hosted || url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new TypeError(`base_host_refused: ${entry.id}`);
  // A typed host that is an address is checked here too, since an app's own fetch cannot be seen to dial; a name is
  // only checked by guardedFetch.
  if (host === '*' && blockedHost(url.hostname)) throw new ProviderHttpError('request_failed', null, 'address_blocked');
  return filled;
}

/** The fetch an entry uses when the app passes none: guardedFetch for `http.host: '*'`, else the global one. */
export function defaultFetch(entry: Entry): typeof fetch {
  return entry.http.host === '*' ? guardedFetch : globalThis.fetch;
}

export type HttpOptions = {
  token: (rejected?: string) => Promise<string>; fetch: typeof fetch;
  /** The connection's plain values, for a credential or a base built from them (Aircall's `{apiId}`, Intercom's `{apiHost}`). */
  values?: Values;
  baseUrl?: string; headers?: Readonly<Record<string, string>>; minIntervalMs?: number;
  /** Runs once per call, before anything is sent (an app's metering); what it throws reaches the caller unchanged. */
  beforeRequest?: (url: URL) => void | Promise<void>;
};

export function createClient(entry: Entry, input: HttpOptions): HttpClient {
  // Filled once, on the first read: a wrong value throws before it is sent, never when the client is built. An app's
  // own base is used as given. Read without a trailing slash, so a path after it never makes `//` (`https://x/v1/` + `/a`).
  let base: { url: string; origin: string } | undefined;
  const based = () => {
    if (base) return base;
    const url = (input.baseUrl ?? filledBase(entry, input.values ?? {})).replace(/\/+$/u, '');
    return (base = { url, origin: new URL(url).origin });
  };
  const [auth] = entry.auth;
  const queried = 'send' in auth && 'query' in auth.send ? Object.keys(auth.send.query) : [];
  const retry = retryPolicy(entry.http.retry);
  const timeoutMs = entry.http.timeoutMs ?? 30_000;
  const minIntervalMs = input.minIntervalMs ?? entry.http.minIntervalMs ?? 0;
  let nextSend = 0;
  let cachedToken: Promise<string> | undefined;
  const renewals = new Map<string, Promise<string>>();

  /** A blank token is never sent: it would be an empty credential. */
  const nonBlank = (value: string) => {
    if (value.trim() === '') throw new TypeError('token_missing');
    return value;
  };

  function token(): Promise<string> {
    cachedToken ??= input.token().then(nonBlank).catch((error: unknown) => { cachedToken = undefined; throw error; });
    return cachedToken;
  }

  /** Requests refused with the same token share one renewal. */
  function renew(rejected: string): Promise<string> {
    let renewal = renewals.get(rejected);
    if (!renewal) {
      renewal = input.token(rejected).then(nonBlank).catch((error: unknown) => { renewals.delete(rejected); cachedToken = undefined; throw error; });
      renewals.set(rejected, renewal);
      cachedToken = renewal;
    }
    return renewal;
  }

  /** A 429's wait: a positive Retry-After, else the wait the body names, else the provider's default, with no jitter. A
   * 408's or a 5xx's: a positive Retry-After, else the backoff. */
  async function waitFor(response: Response, retryCount: number): Promise<number> {
    const header = retryAfterMs(response.headers, Date.now());
    if (header !== null && header > 0) return header;
    if (response.status !== 429) return backoffMs(retry, retryCount);
    // The body is read only for a wait the entry says it names: a slow body must not hold up the retry.
    const fromBody = entry.http.retry?.waitFromBody === undefined ? undefined
      : bodyWaitOf(entry.http.retry, parseJson(await retryBody(response, timeoutMs)), Date.now());
    return fromBody !== undefined && Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : retry.defaultWaitMs;
  }

  async function pace(): Promise<void> {
    const wait = Math.max(0, nextSend - Date.now());
    nextSend = Math.max(nextSend, Date.now()) + minIntervalMs;
    if (wait > 0) await new Promise<void>(resolve => { setTimeout(resolve, wait); });
  }

  async function send(url: URL, credential: [string, string] | undefined, options: RequestOptions): Promise<ProviderResponse> {
    const method = options.method ?? 'GET';
    // A GET is a read unless the caller says otherwise (an operation declared a write).
    const limit = (options.idempotent ?? method === 'GET') && !options.signal ? retry.limit : 0;
    let headers: Headers;
    try {
      headers = new Headers(entry.http.headers);
      for (const [key, header] of Object.entries(input.headers ?? {})) headers.set(key, header);
      if (credential) headers.set(...credential);
    } catch {
      throw new ProviderHttpError('request_failed', null);
    }
    try {
      const pending = ky(url, {
        // Redirects are followed by `follow`, which never sends the credential to another host.
        method, headers, timeout: timeoutMs, fetch: input.fetch, redirect: 'manual',
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
        ...(options.form ? { body: new URLSearchParams(options.form) } : {}),
        // A status is retried by the hook below; ky retries only a network failure, after the backoff, on the request's
        // own method (`limit` already says whether it is a read). A timeout has spent the time budget: never retried.
        retry: { limit, methods: [method], statusCodes: [], delay: attempt => backoffMs(retry, attempt - 1),
          shouldRetry: ({ error }) => isNetworkError(error) },
        hooks: {
          beforeRequest: [pace], beforeRetry: [pace],
          afterResponse: [async ({ response, retryCount }) => {
            if (!RETRIED.includes(response.status) || retryCount >= limit) return;
            return ky.retry({ delay: Math.min(await waitFor(response, retryCount), retry.maxWaitMs) });
          }],
        },
      });
      const response = await pending;
      return { status: response.status, headers: response.headers, data: parseJson(await pending.text()) };
    } catch (error) {
      if (error instanceof HTTPError) {
        return { status: error.response.status, headers: error.response.headers,
          data: typeof error.data === 'string' ? parseJson(error.data) : error.data };
      }
      if (isNetworkError(error) || isTimeoutError(error) || options.signal?.aborted) throw new ProviderHttpError('unavailable', null);
      throw error;
    }
  }

  async function follow(start: URL, bearer: string, { header, query = [] }: Credential, options: RequestOptions): Promise<ProviderResponse> {
    let url = start;
    for (let hop = 0; ; hop++) {
      // Set on each hop's copy, replacing the caller's or a Location's value; `start` never holds it.
      const sent = new URL(url);
      for (const [name, value] of query) sent.searchParams.set(name, value);
      const response = await send(sent, header, options);
      const next = hop < MAX_REDIRECTS ? redirectTarget(url, options.method ?? 'GET', response) : null;
      if (next === null) return sentWith(response, header ? [bearer, header[1].slice(header[1].indexOf(' ') + 1)] : [bearer]);
      url = next;
    }
  }

  const request = async (path: string, options: RequestOptions = {}): Promise<ProviderResponse> => {
    const { url: baseUrl, origin } = based();
    const url = new URL(baseUrl + path);
    // The credential never leaves the base's origin, the first request included (`https://api.x.test` + `@evil.test`).
    if (url.origin !== origin) throw new TypeError('url_outside_origin');
    // A path is read after the base, so one without its `/` would run into the base's last segment (`/v1users`).
    if (path !== '' && !path.startsWith('/') && !path.startsWith('?')) throw new TypeError('url_path_relative');
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    // A next link may echo a query credential: `beforeRequest` never sees one.
    for (const name of queried) url.searchParams.delete(name);
    await input.beforeRequest?.(new URL(url));
    const sendAs = (bearer: string) => follow(url, bearer, credentialOf(entry, bearer, input.values ?? {}), options);
    const bearer = await token();
    const response = await sendAs(bearer);
    if (response.status !== 401) return response;
    const renewed = await renew(bearer);
    return renewed === bearer ? response : sendAs(renewed);
  };

  return {
    get baseUrl() { return based().url; },
    request,
    async json(path, options) {
      return responseJson(entry, await request(path, options));
    },
  };
}
