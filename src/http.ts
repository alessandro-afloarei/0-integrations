import type { ReadableStreamDefaultReader } from 'node:stream/web';
import ky, { HTTPError, isNetworkError, isTimeoutError } from 'ky';
import { ProviderHttpError } from './errors.js';
import { responseJson } from './http-response.js';
import type { ProviderDefinition } from './providers.js';
import { retryAfterMs } from './retry-after.js';

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

export function createClient(input: {
  provider: ProviderDefinition; token: (rejected?: string) => Promise<string>; fetch: typeof fetch;
  baseUrl?: string; headers?: Readonly<Record<string, string>>; minIntervalMs?: number;
  /** Runs once per call, before anything is sent (an app's metering); what it throws reaches the caller unchanged. */
  beforeRequest?: (url: URL) => void | Promise<void>;
}): HttpClient {
  const { provider } = input;
  const baseUrl = input.baseUrl ?? provider.baseUrl;
  if (!baseUrl) throw new TypeError('base_url_required');
  const auth = provider.auth ?? { header: 'authorization', prefix: 'Bearer ' };
  const minIntervalMs = input.minIntervalMs ?? provider.minIntervalMs;
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
    const fromBody = provider.retry.waitFromBody?.(parse(await retryBody(response, provider.timeoutMs)));
    return fromBody !== undefined && Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : provider.retry.defaultWaitMs;
  }

  async function pace(): Promise<void> {
    const wait = Math.max(0, nextSend - Date.now());
    nextSend = Math.max(nextSend, Date.now()) + minIntervalMs;
    if (wait > 0) await new Promise<void>(resolve => { setTimeout(resolve, wait); });
  }

  async function send(url: URL, bearer: string, options: RequestOptions): Promise<ProviderResponse> {
    const method = options.method ?? 'GET';
    const limit = (method === 'GET' || options.idempotent) && !options.signal ? provider.retry.limit : 0;
    let headers: Headers;
    try {
      headers = new Headers(input.headers);
      headers.set(auth.header, auth.prefix + bearer);
    } catch {
      throw new ProviderHttpError('request_failed', null);
    }
    try {
      const pending = ky(url, {
        // Redirects are followed by `follow`, which never sends the credential to another host.
        method, headers, timeout: provider.timeoutMs, fetch: input.fetch, redirect: 'manual',
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.json !== undefined ? { json: options.json } : {}),
        ...(options.form ? { body: new URLSearchParams(options.form) } : {}),
        // Only a 429 is retried, by the hook below; ky's own status and network retries stay off.
        retry: { limit, statusCodes: [], shouldRetry: () => false },
        hooks: {
          beforeRequest: [pace], beforeRetry: [pace],
          afterResponse: [async ({ response, retryCount }) => {
            if (response.status !== 429 || retryCount >= limit) return;
            return ky.retry({ delay: Math.min(await waitFor(response), provider.retry.maxWaitMs) });
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

  async function follow(start: URL, bearer: string, options: RequestOptions): Promise<ProviderResponse> {
    let url = start;
    for (let hop = 0; ; hop++) {
      const response = await send(url, bearer, options);
      const next = hop < MAX_REDIRECTS ? redirectTarget(url, options.method ?? 'GET', response) : null;
      if (next === null) return response;
      url = next;
    }
  }

  const request = async (path: string, options: RequestOptions = {}): Promise<ProviderResponse> => {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    await input.beforeRequest?.(new URL(url));
    const bearer = await token();
    const response = await follow(url, bearer, options);
    if (response.status !== 401) return response;
    const renewed = await renew(bearer);
    return renewed === bearer ? response : follow(url, renewed, options);
  };

  return {
    request,
    async json(path, options) {
      return responseJson(provider, await request(path, options));
    },
  };
}
