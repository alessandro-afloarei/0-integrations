import type { ReadableStreamDefaultReader } from 'node:stream/web';
import ky, { HTTPError, isNetworkError, isTimeoutError } from 'ky';
import type { Call, Entry, Method, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { blockedHost, guardedFetch, refusal } from './guard.js';
import { backoffMs, classify, declaredLimit, declaredWait, emptyAnswers, responseJson, retryPolicy, sentWith } from './http-response.js';
import { retryAfterMs } from './retry-after.js';
import { checkHosts, fill, hostPart, namedHosts, parseJson, placeholders, plainValue } from './rules.js';

/** A call holds one body at most: a JSON one or a form. */
export type RequestOptions = {
  method?: Method;
  query?: Readonly<Record<string, string>>;
  /** Over the entry's and the app's, under the credential and a form's type. */
  headers?: Readonly<Record<string, string>>;
  idempotent?: boolean;
  signal?: AbortSignal;
} & ({ json?: unknown; form?: undefined } | { form: Readonly<Record<string, string>>; json?: undefined });
export type ProviderResponse = { status: number; headers: Headers; data: unknown };

/** The request a declared call makes, with what the caller adds: GraphQL is a POST of the query and its variables to
 * the base. The one rule for every declared call (identify, a request revoke, an operation, a paged operation). */
export function callRequest(call: Call, extra: RequestOptions & { variables?: Values } = {}): [path: string, options: RequestOptions] {
  const { variables = {}, ...options } = extra;
  return call.graphql === undefined
    ? [call.path ?? '', { method: call.method ?? 'GET', ...(call.query ? { query: call.query } : {}), ...options }]
    : ['', { method: 'POST', json: { query: call.graphql, variables }, ...options, form: undefined }];
}
export type HttpClient = {
  /** The base every path is read after: the entry's, or the one the client was built with. */
  readonly baseUrl: string;
  json(path: string, options?: RequestOptions): Promise<unknown>;
  /** `json`'s answer with the response's headers (a `Link` header). */
  answer(path: string, options?: RequestOptions): Promise<{ data: unknown; headers: Headers }>;
  request(path: string, options?: RequestOptions): Promise<ProviderResponse>;
};

/** The body of an answer the retry reads, or null when it does not arrive within `timeoutMs`. */
async function retryBody(response: Response, timeoutMs: number): Promise<string | null> {
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => { resolve(null); }, timeoutMs);
  });
  const body = (async () => {
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString('utf8');
      chunks.push(value);
    }
  })().catch(() => ''); // a body that fails as it is read states no wait, and its error is the provider's, never ours
  try {
    return await Promise.race([body, timeout]);
  } finally {
    clearTimeout(timer);
    // A cloned stream can wait for its sibling to cancel, so disposal must not block the timeout.
    void reader.cancel().catch(() => undefined);
  }
}

const MAX_REDIRECTS = 5;
/** The statuses a read is retried after: a 429, a 408 (the server's request timeout) and the passing server failures
 * (never 501). */
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

/** What a request's credential adds: a header, or query parameters set on every hop; `taken`, each value its templates
 * took, which a provider code may echo. */
type Credential = { header?: [name: string, value: string]; query?: [name: string, value: string][]; taken?: string[] };

/** Bearer by default, a header's bare token or its `value` filled, Basic from a template, or the query's parameters from
 * templates. */
export function credentialOf(entry: Entry, token: string, values: Values): Credential {
  const [auth] = entry.auth;
  const send = 'send' in auth ? auth.send : undefined;
  if (send === undefined) return { header: ['authorization', `Bearer ${token}`] };
  const secret = entry.fields?.find(field => field.secret === true)?.name;
  // Only a key entry's secret field is its credential: any other kind's never goes with a call, whatever `values` holds.
  const taken: string[] = [];
  const lookup = (name: string) => {
    const value = name === 'token' ? token : name === secret ? (auth.kind === 'key' ? token : undefined) : plainValue(values, name);
    if (value !== undefined) taken.push(String(value));
    return value;
  };
  if ('header' in send) return { header: [send.header, fill(send.value ?? '{token}', lookup, entry.id)], taken };
  if ('query' in send) return { query: Object.entries(send.query).map(([name, template]) => [name, fill(template, lookup, entry.id)]), taken };
  const pair = `${fill(send.basic[0], lookup, entry.id)}:${fill(send.basic[1], lookup, entry.id)}`;
  return { header: ['authorization', `Basic ${Buffer.from(pair).toString('base64')}`], taken };
}

/** A value a base's placeholder takes: a host name's ASCII labels. Never a port (`http.host` checks the name alone), a
 * `/`, `@`, `#`, space or empty label; no `i` flag, which would let the Kelvin sign and the long s pass as `k` and `s`. */
const BASE_VALUE = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/u;

/** The one check of every URL the library sends to (an entry's base, an app's own, a token URL): it parses, is https and
 * holds no username or password. Refused by entry id alone: Node's own errors name the URL (`ERR_INVALID_URL` keeps it
 * in `input`) and its query key. No `URL.parse`: Node 22.1+. */
function sendable(entry: Entry, url: string): URL {
  const parsed = URL.canParse(url) ? new URL(url) : undefined;
  if (parsed?.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError(`base_host_refused: ${entry.id}`);
  }
  return parsed;
}

/** The entry's base (or another URL of it: a token request's), its placeholders filled from plain or saved values: one
 * in the host a host name, one in the path one encoded segment; a URL with none is used as written. A `sendable` URL,
 * its host, when templated, matching `http.host` or one of its list (equal, `*.d` a name ending in `.d`; `*` alone any,
 * in a list none). Throws before anything is read or sent. */
export function filledBase(entry: Entry, values: Values, baseUrl = entry.http.baseUrl): string {
  const { host = '' } = entry.http;
  const head = hostPart(baseUrl);
  if (head === undefined) throw new TypeError(`base_host_refused: ${entry.id}`);
  const tail = baseUrl.slice(head.length);
  const invalid = (name: string) => new TypeError(`base_value_invalid: ${entry.id} {${name}}`);
  const filled = fill(head, name => {
    const given = plainValue(values, name);
    // A named host may be an https origin (Pipedrive's `api_domain`): its host, checked as a typed one, is the rest.
    const value = Object.hasOwn(namedHosts(entry), name) && typeof given === 'string' ? /^https:\/\/([^/]*)\/?$/u.exec(given)?.[1] ?? given : given;
    if (value !== undefined && !BASE_VALUE.test(String(value))) throw invalid(name);
    return value;
  }, entry.id) + fill(tail, name => {
    const value = plainValue(values, name);
    if (value === undefined) return value;
    // A lone surrogate is no well-formed Unicode: `encodeURIComponent` would throw a raw URIError.
    if (value === '.' || value === '..' || !String(value).isWellFormed()) throw invalid(name);
    return encodeURIComponent(value);
  }, entry.id);
  const url = sendable(entry, filled);
  const hosted = placeholders(head).length === 0 || host === '*' || [host].flat().some(pattern => url.hostname === pattern
    || (pattern.startsWith('*.') && url.hostname.endsWith(pattern.slice(1))));
  if (!hosted) throw new TypeError(`base_host_refused: ${entry.id}`);
  // A typed host that is an address is checked here too, since an app's own fetch cannot be seen to dial; a name is
  // only checked by guardedFetch.
  if (host === '*' && blockedHost(url.hostname)) throw refusal();
  return filled;
}

/** The base a declared call names (`Call.base`), as an app's own base: one of `http.bases`, used as written, so one with a
 * placeholder is refused; the client checks every declared URL before it sends (`checkHosts`). */
export function callBase(entry: Entry, { base }: Call): { baseUrl?: string } {
  if (base === undefined) return {};
  const baseUrl = Object.hasOwn(entry.http.bases ?? {}, base) ? entry.http.bases?.[base] : undefined;
  if (baseUrl === undefined) throw new TypeError(`base_unknown: ${base}`);
  if (placeholders(baseUrl).length > 0) throw new TypeError(`base_templated: ${base}`);
  return { baseUrl };
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
    checkHosts(entry, input.values); // every declared URL well formed, the hosts one: before an own base or a named one is used
    const url = (input.baseUrl ?? filledBase(entry, input.values ?? {})).replace(/\/+$/u, '');
    // An app's own base passes the same check as the entry's; on a typed host it may move the path, never the origin.
    const origin = sendable(entry, url).origin;
    const authority = hostPart(entry.http.baseUrl) ?? ''; // well formed: `checkHosts` ran
    if (input.baseUrl !== undefined && placeholders(authority).length > 0
      && origin !== new URL(filledBase(entry, input.values ?? {}, authority)).origin) throw new TypeError(`base_host_refused: ${entry.id}`);
    return (base = { url, origin });
  };
  const [auth] = entry.auth;
  const queried = 'send' in auth && 'query' in auth.send ? Object.keys(auth.send.query) : [];
  const retry = retryPolicy(entry.http.retry);
  const onlyStated = entry.http.retry?.onlyStated === true;
  const wait = entry.http.retry?.wait;
  const limits = entry.http.rateLimit?.when ?? [];
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
      for (const [key, header] of [...Object.entries(input.headers ?? {}), ...Object.entries(options.headers ?? {})]) headers.set(key, header);
      if (credential) headers.set(...credential);
      // A form's type over the entry's and the app's.
      if (options.form) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
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
        retry: { limit, methods: [method], statusCodes: [], delay: attempt => backoffMs(retry.maxWaitMs, attempt - 1),
          shouldRetry: ({ error }) => isNetworkError(error) && !onlyStated },
        hooks: {
          beforeRequest: [pace], beforeRetry: [pace],
          afterResponse: [async ({ response, retryCount }) => {
            const { status, headers } = response;
            // A rate limit the entry declares on another status (a 403, a 529) is retried as a 429 is. The body is read
            // only when a rule may hold for the status, or for a body wait past no positive Retry-After.
            const mayLimit = status >= 400 && limits.some(rule => [undefined, 'error', status].includes(rule.status));
            if ((!RETRIED.includes(status) && !mayLimit) || retryCount >= limit) return;
            const now = Date.now();
            const read = mayLimit || (wait !== undefined && 'path' in wait && !retryAfterMs(headers, now));
            const text = read ? await retryBody(response, timeoutMs) : '';
            // A body that never arrives is not retried: the answer is classified by its status and headers.
            if (text === null) return;
            const body = parseJson(text);
            const declared = mayLimit ? declaredLimit(classify(entry, { status, headers, data: body }, now)) : undefined;
            const limited = status === 429 || declared !== undefined;
            if (!limited && !RETRIED.includes(status)) return;
            // The stated wait (Retry-After, else `retry.wait`, a header's on a rate limit alone); none with `onlyStated`
            // is not retried. Never before it or the rule's own wait, the later of the two: past the cap, reported.
            const stated = retryAfterMs(headers, now, declaredWait(wait, { status: limited ? 429 : status, headers, body }, now)) || undefined;
            const own = Math.ceil(declared?.own ?? 0);
            if ((stated === undefined ? onlyStated : stated > retry.maxWaitMs) || own > retry.maxWaitMs) return;
            // Without a stated wait, a rate limit waits the provider's default, no jitter; another status the backoff.
            const fallback = limited ? retry.defaultWaitMs : backoffMs(retry.maxWaitMs, retryCount);
            return ky.retry({ delay: Math.min(Math.max(stated ?? fallback, own), retry.maxWaitMs) });
          }],
        },
      });
      const response = await pending;
      const text = await pending.text();
      const answer = { status: response.status, headers: response.headers, data: parseJson(text) };
      if (text.trim() === '') emptyAnswers.add(answer);
      return answer;
    } catch (error) {
      if (error instanceof HTTPError) {
        return { status: error.response.status, headers: error.response.headers,
          data: typeof error.data === 'string' ? parseJson(error.data) : error.data };
      }
      if (isNetworkError(error) || isTimeoutError(error) || options.signal?.aborted) throw new ProviderHttpError('unavailable', null);
      throw error;
    }
  }

  async function follow(start: URL, bearer: string, { header, query = [], taken = [] }: Credential, options: RequestOptions): Promise<ProviderResponse> {
    // Every value the credential rendered (the token, each value a template took, a header's value, each query value): a
    // code echoing one is no detail. A header's value is kept after its first space (`Bot `, `Basic `): a detail never
    // holds a space.
    const rendered = [bearer, ...taken, ...query.map(([, value]) => value), ...header ? [header[1].slice(header[1].indexOf(' ') + 1)] : []];
    let url = start;
    for (let hop = 0; ; hop++) {
      // Set on each hop's copy, replacing the caller's or a Location's value; `start` never holds it.
      const sent = new URL(url);
      for (const [name, value] of query) sent.searchParams.set(name, value);
      const response = await send(sent, header, options);
      const next = hop < MAX_REDIRECTS ? redirectTarget(url, options.method ?? 'GET', response) : null;
      if (next === null) return sentWith(response, rendered);
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
    // A call holds one body: an untyped caller's second would go out under the other's type.
    if ([options.json, options.form].every(body => body !== undefined)) throw new ProviderHttpError('request_failed', null);
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

  const answer = async (path: string, options?: RequestOptions) => {
    const response = await request(path, options);
    return { data: responseJson(entry, response), headers: response.headers };
  };
  return {
    get baseUrl() { return based().url; },
    request,
    answer,
    async json(path, options) { return (await answer(path, options)).data; },
  };
}
