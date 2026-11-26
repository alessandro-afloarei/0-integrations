import { once } from 'node:events';
import type { AgentOptions } from 'node:https';
import { createRequire } from 'node:module';
import { createServer as createHttpServer, type IncomingMessage, type RequestOptions, type ServerResponse } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineProvider } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { blockedAddress, guardedFetch, guardedLookup } from './guard.js';
import { createClient } from './http.js';
import { refreshGrant, revokeGrant } from './oauth.js';

// No test here queries DNS or leaves this machine. `node:dns` answers from `answers`. `node:https` is the real one,
// through a seam in this file only, for two names: `stand-in.test` is a TLS-free stand-in over `node:http` that dials
// the local server and reports a public remote address, so fetch's behaviour can be read; `rebind.test` is real TLS
// dialling 127.0.0.1 behind the guard's lookup, as a name rebound after its check would be.
const { answers, lookup } = vi.hoisted(() => {
  const answers = new Map<string, { address: string; family: number }[]>();
  const lookup = vi.fn((host: string, _options: unknown, callback: (error: Error | null, addresses?: unknown) => void) => {
    const answer = answers.get(host);
    if (answer) callback(null, answer);
    else callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }));
  });
  return { answers, lookup };
});
vi.mock('node:dns', () => ({ lookup }));
vi.mock('node:https', async () => {
  const https = await vi.importActual<typeof import('node:https')>('node:https');
  const http = await vi.importActual<typeof import('node:http')>('node:http');
  return { Agent: https.Agent, request(url: URL, options: RequestOptions) {
    if (url.hostname === 'rebind.test') {
      return https.request(url, { ...options, lookup: (_host, all, callback) => {
        if (all.all === true) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      } });
    }
    if (url.hostname !== 'stand-in.test') return https.request(url, options);
    const outgoing = http.request({ ...options, agent: undefined, host: '127.0.0.1', port: url.port, path: url.pathname + url.search });
    outgoing.on('socket', socket => Object.defineProperty(socket, 'remoteAddress', { get: () => '8.8.8.8', configurable: true }));
    return outgoing;
  } };
});

const blocked = new ProviderHttpError('request_failed', null, 'address_blocked');

/** A TCP server that must see nothing: each case counts its connections and the bytes they sent. */
const seen = { connections: 0, bytes: 0 };
const silent = createServer((socket: Socket) => { seen.connections++; socket.on('data', chunk => { seen.bytes += chunk.length; }); });
/** The stand-in's server: what each test makes it answer. */
let answer: (request: IncomingMessage, response: ServerResponse, body: string) => void = (_request, response) => { response.end(); };
let hits = 0;
const server = createHttpServer((request, response) => {
  hits++;
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => { answer(request, response, Buffer.concat(chunks).toString('utf8')); });
});
let silentPort = 0;
let at = '';
beforeAll(async () => {
  silent.listen(0, '127.0.0.1');
  server.listen(0, '127.0.0.1');
  await Promise.all([once(silent, 'listening'), once(server, 'listening')]);
  silentPort = (silent.address() as AddressInfo).port;
  at = `https://stand-in.test:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => { silent.close(); server.closeAllConnections(); server.close(); });
beforeEach(() => {
  seen.connections = 0;
  seen.bytes = 0;
  hits = 0;
  answers.clear();
  lookup.mockClear();
});
const settled = () => new Promise(resolve => { setTimeout(resolve, 30); });

test.each([['127.0.0.1', true], ['169.254.169.254', true], ['10.1.2.3', true], ['100.100.100.200', true], ['0.0.0.0', true],
  ['255.255.255.255', true], ['::1', true], ['::', true], ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['::127.0.0.1', true],
  ['fd00:ec2::254', true], ['fe80::1', true], ['64:ff9b::7f00:1', true], ['2002:7f00:1::', true], ['not-an-ip', true],
  ['8.8.8.8', false], ['1.1.1.1', false], ['2606:4700:4700::1111', false], ['2001:4860:4860::8888', false]])(
  'blockedAddress(%s) is %s', (ip, refused) => { expect(blockedAddress(ip)).toBe(refused); });

describe('guardedFetch refuses, before any connection', () => {
  test.each(['https://127.0.0.1:PORT/', 'https://localhost:PORT/', 'https://[::1]:PORT/', 'https://[::ffff:127.0.0.1]:PORT/',
    'https://2130706433:PORT/', 'https://0x7f.1:PORT/', 'http://example.test/'])('%s', async template => {
    answers.set('localhost', [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]);
    await expect(guardedFetch(template.replace('PORT', String(silentPort)))).rejects.toEqual(blocked);
    await settled();
    expect(seen.connections).toBe(0);
  });

  test('a name that resolves to a public and a private address', async () => {
    answers.set('mixed.test', [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await expect(guardedFetch(`https://mixed.test:${String(silentPort)}/`)).rejects.toEqual(blocked);
    expect(lookup).toHaveBeenCalledOnce();
  });

  test('an already aborted signal, with its reason', async () => {
    const reason = new Error('stop');
    await expect(guardedFetch(`${at}/`, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(hits).toBe(0);
  });
});

test('a name rebound after the lookup is refused on connect, before a byte is written, TLS hello included', async () => {
  await expect(guardedFetch(`https://rebind.test:${String(silentPort)}/secret`, { method: 'POST', body: 'token=t',
    headers: { authorization: 'Bearer t' } })).rejects.toEqual(blocked);
  await settled();
  expect(seen.connections).toBe(1);
  expect(seen.bytes).toBe(0);
});

test("a proxy the global agent follows (HTTPS_PROXY with NODE_USE_ENV_PROXY) never sees the guard's requests", async () => {
  // What `NODE_USE_ENV_PROXY=1` gives at start: a global agent with the proxy environment. The guard has its own agent.
  const proxied = { connections: 0 };
  const proxy = createServer(socket => { proxied.connections++; socket.destroy(); });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const https = createRequire(import.meta.url)('node:https') as typeof import('node:https');
  const global = https.globalAgent;
  const env = { HTTPS_PROXY: `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`, NODE_USE_ENV_PROXY: '1' };
  vi.stubEnv('HTTPS_PROXY', env.HTTPS_PROXY);
  vi.stubEnv('NODE_USE_ENV_PROXY', env.NODE_USE_ENV_PROXY);
  // `proxyEnv` (Node 22.21) is not in the installed @types/node yet.
  https.globalAgent = new https.Agent({ proxyEnv: env } as AgentOptions);
  try {
    answers.set('proxied.test', [{ address: '10.0.0.1', family: 4 }]);
    await expect(guardedFetch('https://proxied.test/')).rejects.toEqual(blocked);
    expect(lookup).toHaveBeenCalledOnce();
    await settled();
    expect(proxied.connections).toBe(0);
  } finally {
    https.globalAgent = global;
    vi.unstubAllEnvs();
    proxy.close();
  }
});

describe('guardedLookup', () => {
  const ask = (options: { all?: boolean; family?: number }) => new Promise<unknown[]>(resolve => {
    guardedLookup('host.test', options, (...result: unknown[]) => { resolve(result); });
  });

  test('passes an answer that is all public, in both forms', async () => {
    answers.set('host.test', [{ address: '8.8.8.8', family: 4 }]);
    expect(await ask({ all: true })).toEqual([null, [{ address: '8.8.8.8', family: 4 }]]);
    expect(await ask({ family: 0 })).toEqual([null, '8.8.8.8', 4]);
    expect(lookup).toHaveBeenLastCalledWith('host.test', { family: 0, all: true }, expect.any(Function));
  });

  test.each([[[{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]], [[]]])('refuses %j', async addresses => {
    answers.set('host.test', addresses);
    const [error] = await ask({ all: true });
    expect(error).toEqual(blocked);
  });

  test('passes a DNS error through as it is', async () => {
    const [error] = await ask({});
    expect(error).toMatchObject({ code: 'ENOTFOUND' });
  });
});

describe('guardedFetch is fetch for what the engine sends', () => {
  test('a URL with init: the method, the headers and a body', async () => {
    answer = (request, response, body) => {
      response.end(JSON.stringify({ method: request.method, type: request.headers['content-type'],
        length: request.headers['content-length'], key: request.headers['x-key'], body }));
    };
    const response = await guardedFetch(new URL(`${at}/echo?q=1`), { method: 'POST', headers: { 'x-key': 'k' },
      body: new URLSearchParams({ a: 'b' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ method: 'POST', type: 'application/x-www-form-urlencoded;charset=UTF-8',
      length: '3', key: 'k', body: 'a=b' });
  });

  test("a caller's accept-encoding is replaced by identity, whatever its case, and every other header is sent", async () => {
    answer = (request, response) => {
      response.end(JSON.stringify({ encoding: request.headers['accept-encoding'], other: request.headers['x-other'] }));
    };
    const headers = { 'Accept-Encoding': 'gzip, br', 'x-other': '1' };
    const caller = new Request(`${at}/echo`, { headers });
    for (const response of [await guardedFetch(new URL(`${at}/echo`), { headers }), await guardedFetch(caller)]) {
      expect(await response.json()).toEqual({ encoding: 'identity', other: '1' });
    }
    expect(caller.headers.get('accept-encoding')).toBe('gzip, br');
  });

  test('a Request, as ky sends one, with a JSON body', async () => {
    answer = (request, response, body) => { response.end(`${request.method ?? ''} ${request.url ?? ''} ${body}`); };
    const response = await guardedFetch(new Request(`${at}/items`, { method: 'PUT', body: JSON.stringify({ a: 1 }) }));
    expect(await response.text()).toBe('PUT /items {"a":1}');
  });

  test('a redirect is answered, never followed', async () => {
    answer = (_request, response) => { response.writeHead(307, { location: '/next' }).end(); };
    const response = await guardedFetch(`${at}/first`, { redirect: 'manual' });
    expect([response.status, response.headers.get('location'), hits]).toEqual([307, '/next', 1]);
  });

  test('repeated headers are appended; a 204, a 304 and a HEAD answer no body', async () => {
    answer = (_request, response) => { response.writeHead(200, [['x-many', 'a'], ['x-many', 'b']]).end('x'); };
    expect((await guardedFetch(`${at}/`)).headers.get('x-many')).toBe('a, b');
    for (const [method, status] of [['GET', 204], ['GET', 304], ['HEAD', 200]] as const) {
      answer = (_request, response) => { response.writeHead(status).end(); };
      expect((await guardedFetch(`${at}/`, { method })).body).toBeNull();
    }
  });

  test('the body streams: the answer arrives before its body ends', async () => {
    let finish = () => undefined as unknown;
    answer = (_request, response) => { response.write('first'); finish = () => response.end('last'); };
    const response = await guardedFetch(`${at}/stream`);
    const reader = response.body?.getReader();
    expect(Buffer.from((await reader?.read())?.value ?? []).toString()).toBe('first');
    finish();
    expect(Buffer.from((await reader?.read())?.value ?? []).toString()).toBe('last');
    expect((await reader?.read())?.done).toBe(true);
  });

  test("the caller's signal aborts a pending request and a body being read", async () => {
    answer = () => undefined;
    const waiting = new AbortController();
    const pending = guardedFetch(`${at}/hang`, { signal: waiting.signal });
    await vi.waitFor(() => { expect(hits).toBe(1); });
    waiting.abort(new Error('caller'));
    await expect(pending).rejects.toThrow('caller');

    answer = (_request, response) => { response.write('first'); };
    const reading = new AbortController();
    const response = await guardedFetch(`${at}/half`, { signal: reading.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    reading.abort();
    await expect(reader?.read()).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a body dropped midway fails as the global fetch does: terminated', async () => {
    answer = (_request, response) => { response.write('{"a":'); setTimeout(() => response.socket?.resetAndDestroy(), 10); };
    const response = await guardedFetch(`${at}/half`);
    await expect(response.text()).rejects.toThrow(new TypeError('terminated'));
  });

  test('a failed connection is fetch failed, as the global fetch says', async () => {
    const closed = createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const port = (closed.address() as AddressInfo).port;
    closed.close();
    const error = await guardedFetch(`https://stand-in.test:${String(port)}/`).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('fetch failed');
  });

  describe('through the engine', () => {
    const standIn = () => defineProvider({ id: 'standin', name: 'Stand-in', auth: [{ kind: 'key' }],
      fields: [{ name: 'apiKey', title: 'API key', secret: true }], http: { baseUrl: at, timeoutMs: 200, retry: {} } });

    test('a read, a JSON write and a same-origin redirect', async () => {
      answer = (request, response, body) => {
        if (request.url === '/old') response.writeHead(308, { location: '/new' }).end();
        else response.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ url: request.url, body, auth: request.headers.authorization }));
      };
      const http = createClient(standIn(), { token: () => Promise.resolve('t'), fetch: guardedFetch });
      expect(await http.json('/old')).toEqual({ url: '/new', body: '', auth: 'Bearer t' });
      expect(await http.json('/w', { method: 'POST', json: { a: 1 } })).toEqual({ url: '/w', body: '{"a":1}', auth: 'Bearer t' });
    });

    test('a body dropped midway is unavailable; the body is read after the retry loop, so it is sent once', async () => {
      answer = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' }).write('{"a":');
        setTimeout(() => response.socket?.resetAndDestroy(), 10);
      };
      const http = createClient(standIn(), { token: () => Promise.resolve('t'), fetch: guardedFetch });
      await expect(http.json('/half')).rejects.toEqual(new ProviderHttpError('unavailable', null));
      expect(hits).toBe(1);
    });

    test('the entry timeout aborts a hanging request as unavailable', async () => {
      answer = () => undefined;
      const http = createClient(standIn(), { token: () => Promise.resolve('t'), fetch: guardedFetch });
      await expect(http.json('/hang', { method: 'POST' })).rejects.toEqual(new ProviderHttpError('unavailable', null));
    });

    test('an address_blocked refusal passes through unchanged and is never retried, on a read with retry', async () => {
      const fetch = vi.fn(guardedFetch);
      const entry = defineProvider({ ...standIn(), http: { baseUrl: 'https://127.0.0.1', retry: {} } });
      const http = createClient(entry, { token: () => Promise.resolve('t'), fetch });
      const error = await http.json('/x').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(error).toEqual(blocked);
      expect(fetch).toHaveBeenCalledOnce();
    });
  });
});

test("an OAuth 2 refresh and revoke on a typed host go through the guard when the app passes no fetch: a name resolving to a private address is refused", async () => {
  const typed = defineProvider({ id: 'typed', name: 'Typed', fields: [{ name: 'host', title: 'Host' }],
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/oauth/authorize', tokenUrl: 'https://{host}/oauth/access_token' }],
    scopes: { default: [] }, revoke: { url: 'https://{host}/oauth/revoke', token: ['refresh'] }, http: { baseUrl: 'https://{host}/api/v4', host: '*' } });
  answers.set('chat.k.test', [{ address: '10.0.0.1', family: 4 }]);
  // The global fetch would reach the name unchecked: it must never be the one used.
  const unguarded = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', unguarded);
  try {
    const client = { clientId: 'id', clientSecret: 'private-client-secret' };
    await expect(refreshGrant(typed, client, 'r', { values: { host: 'chat.k.test' } })).rejects.toEqual(blocked);
    await expect(revokeGrant(typed, { refreshToken: 'r', client, values: { host: 'chat.k.test' } })).rejects.toEqual(blocked);
  } finally { vi.unstubAllGlobals(); }
  expect(unguarded).not.toHaveBeenCalled();
  expect(lookup.mock.calls.map(([host]) => host)).toEqual(['chat.k.test', 'chat.k.test']);
  expect(seen.bytes).toBe(0);
});

test("an OAuth 2 request revoke on a typed host goes through the guard when the app passes no fetch", async () => {
  const typed = defineProvider({ id: 'typed', name: 'Typed', fields: [{ name: 'host', title: 'Host' }],
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/oauth/authorize', tokenUrl: 'https://{host}/oauth/access_token' }],
    scopes: { default: [] }, revoke: { request: { method: 'POST', path: '/oauth/revoke' } }, http: { baseUrl: 'https://{host}/api/v4', host: '*' } });
  answers.set('chat.k.test', [{ address: '10.0.0.1', family: 4 }]);
  const unguarded = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', unguarded);
  try {
    await expect(revokeGrant(typed, { accessToken: 'a', values: { host: 'chat.k.test' } })).rejects.toEqual(blocked);
  } finally { vi.unstubAllGlobals(); }
  expect(unguarded).not.toHaveBeenCalled();
  expect(lookup.mock.calls.map(([host]) => host)).toEqual(['chat.k.test']);
  expect(seen.bytes).toBe(0);
});
