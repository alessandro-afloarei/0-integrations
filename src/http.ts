import type { ReadableStreamDefaultReader } from 'node:stream/web';
import ky, { HTTPError, isNetworkError, isTimeoutError } from 'ky';
import type { Entry, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { bodyWaitOf, responseJson, retryPolicy, sentWith } from './http-response.js';
import { retryAfterMs } from './retry-after.js';
import { fill } from './rules.js';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Readonly<Record<string, string>>;
  json?: unknown;
  form?: Readonly<Record<string, string>>;
  idempotent?: boolean;
  signal?: AbortSignal;
};
export type ProviderResponse = { status: number; headers: Headers; data: unknown };
export type HttpClient = {
  json(path: string, options?: RequestOptions): Promise<unknown>;
  request(path: string, options?: RequestOptions): Promise<ProviderResponse>;
};

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

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

/** The header a request's credential travels in: Bearer by default, a header's bare token, or Basic from a template. */
function credentialOf(entry: Entry, token: string, values: Values): [header: string, value: string] {
  const [auth] = entry.auth;
  const send = 'send' in auth ? auth.send : undefined;
  if (send === undefined) return ['authorization', `Bearer ${token}`];
  if ('header' in send) return [send.header, token];
  const secret = entry.fields?.find(field => field.secret === true)?.name;
  const lookup = (name: string) => (name === 'token' || name === secret ? token : values[name]);
  const pair = `${fill(send.basic[0], lookup, entry.id)}:${fill(send.basic[1], lookup, entry.id)}`;
  return ['authorization', `Basic ${Buffer.from(pair).toString('base64')}`];
}

export function createClient(entry: Entry, input: {
  token: (rejected?: string) => Promise<string>; fetch: typeof fetch;
  /** The connection's plain values, for a credential built from them (Aircall's `{apiId}`). */
  values?: Values;
  baseUrl?: string; headers?: Readonly<Record<string, string>>; minIntervalMs?: number;
  /** Runs once per call, before anything is sent (an app's metering); what it throws reaches the caller unchanged. */
  beforeRequest?: (url: URL) => void | Promise<void>;
}): HttpClient {
  const baseUrl = input.baseUrl ?? entry.http.baseUrl;
  const retry = retryPolicy(entry.http.retry);
  const timeoutMs = entry.http.timeoutMs ?? 30_000;
  const minIntervalMs = input.minIntervalMs ?? entry.http.minIntervalMs ?? 0;
  let nextSend = 0;
  let cachedToken: Promise<string> | undefined;
  const renewals = new Map<string, Promise<string>>();

  function token(): Promise<string> {
    cachedToken ??= input.token().catch((error: unknown) => { cachedToken = undefined; throw error; });
    return cachedToken;
  }

  /** Requests refused with the same token share one renewal. */
  function renew(rejected: string): Promise<string> {
    let renewal = renewals.get(rejected);
    if (!renewal) {
      renewal = input.token(rejected).catch((error: unknown) => { renewals.delete(rejected); cachedToken = undefined; throw error; });
      renewals.set(rejected, renewal);
      cachedToken = renewal;
    }
    return renewal;
  }

  /** Waits: a positive Retry-After, else the wait the body names, else the provider's default. */
  async function waitFor(response: Response): Promise<number> {
    const header = retryAfterMs(response.headers, Date.now());
    if (header !== null && header > 0) return header;
    const fromBody = bodyWaitOf(entry.http.retry, parse(await retryBody(response, timeoutMs)), Date.now());
    return fromBody !== undefined && Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : retry.defaultWaitMs;
  }

  async function pace(): Promise<void> {
    const wait = Math.max(0, nextSend - Date.now());
    nextSend = Math.max(nextSend, Date.now()) + minIntervalMs;
    if (wait > 0) await new Promise<void>(resolve => { setTimeout(resolve, wait); });
  }

  async function send(url: URL, [name, value]: [string, string], options: RequestOptions): Promise<ProviderResponse> {
    const method = options.method ?? 'GET';
    const limit = (method === 'GET' || options.idempotent) && !options.signal ? retry.limit : 0;
    let headers: Headers;
    try {
      headers = new Headers(entry.http.headers);
      for (const [key, header] of Object.entries(input.headers ?? {})) headers.set(key, header);
      headers.set(name, value);
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
        // Only a 429 is retried, by the hook below; ky's own status and network retries stay off.
        retry: { limit, statusCodes: [], shouldRetry: () => false },
        hooks: {
          beforeRequest: [pace], beforeRetry: [pace],
          afterResponse: [async ({ response, retryCount }) => {
            if (response.status !== 429 || retryCount >= limit) return;
            return ky.retry({ delay: Math.min(await waitFor(response), retry.maxWaitMs) });
          }],
        },
      });
      const response = await pending;
      return { status: response.status, headers: response.headers, data: parse(await pending.text()) };
    } catch (error) {
      if (error instanceof HTTPError) {
        return { status: error.response.status, headers: error.response.headers,
          data: typeof error.data === 'string' ? parse(error.data) : error.data };
      }
      if (isNetworkError(error) || isTimeoutError(error) || options.signal?.aborted) throw new ProviderHttpError('unavailable', null);
      throw error;
    }
  }

  async function follow(start: URL, bearer: string, credential: [string, string], options: RequestOptions): Promise<ProviderResponse> {
    const [, value] = credential;
    let url = start;
    for (let hop = 0; ; hop++) {
      const response = await send(url, credential, options);
      const next = hop < MAX_REDIRECTS ? redirectTarget(url, options.method ?? 'GET', response) : null;
      if (next === null) return sentWith(response, [bearer, value.slice(value.indexOf(' ') + 1)]);
      url = next;
    }
  }

  const request = async (path: string, options: RequestOptions = {}): Promise<ProviderResponse> => {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    await input.beforeRequest?.(new URL(url));
    const sendAs = (bearer: string) => follow(url, bearer, credentialOf(entry, bearer, input.values ?? {}), options);
    const bearer = await token();
    const response = await sendAs(bearer);
    if (response.status !== 401) return response;
    const renewed = await renew(bearer);
    return renewed === bearer ? response : sendAs(renewed);
  };

  return {
    request,
    async json(path, options) {
      return responseJson(entry, await request(path, options));
    },
  };
}
