import { isDeepStrictEqual } from 'node:util';
import { lookupNames } from './account.js';
import type { Entry, Value, Values } from './catalogue.js';
import type { WithLock } from './credentials.js';
import { callBase, credentialOf, filledBase } from './http.js';
import { requestToken } from './oauth.js';
import { parseJson, placeholders, readPath } from './rules.js';
import type { Sealed, SecretStore, TenantKeyStore } from './vault.js';

export function memoryStores(): {
  secrets: SecretStore & { put(connectionId: string, tenantId: string, sealed: Sealed): void };
  tenantKeys: TenantKeyStore;
} {
  const secrets = new Map<string, { tenantId: string; sealed: Sealed; version: number }>();
  const tenantKeys = new Map<string, { wrapped: Sealed; version: number }>();
  return {
    secrets: {
      read: id => Promise.resolve(structuredClone(secrets.get(id) ?? null)),
      put(id, tenantId, sealed) {
        secrets.set(id, { tenantId, sealed: structuredClone(sealed), version: (secrets.get(id)?.version ?? 0) + 1 });
      },
      replace(id, sealed, expected) {
        const row = secrets.get(id);
        if (!row || row.version !== expected) return Promise.resolve(false);
        secrets.set(id, { ...row, sealed: structuredClone(sealed), version: row.version + 1 });
        return Promise.resolve(true);
      },
    },
    tenantKeys: {
      read: id => Promise.resolve(structuredClone(tenantKeys.get(id) ?? null)),
      insert(id, wrapped) {
        const winner = tenantKeys.get(id) ?? { wrapped: structuredClone(wrapped), version: 1 };
        tenantKeys.set(id, winner);
        return Promise.resolve(structuredClone(winner));
      },
      replace(id, wrapped, expected) {
        const row = tenantKeys.get(id);
        if (!row || row.version !== expected) return Promise.resolve(false);
        tenantKeys.set(id, { wrapped: structuredClone(wrapped), version: row.version + 1 });
        return Promise.resolve(true);
      },
    },
  };
}

export type Route = {
  method?: string;
  /** The address without its query, a pattern over the whole address, or a test of the parsed address. */
  url: string | RegExp | ((url: URL) => boolean);
  respond: (request: Request) => Response | Promise<Response>;
};
export type RecordedCall = { method: string; url: string; headers: Record<string, string>; body: string };

/** The first route matching a request answers it; none is null, so an app's fixture mode can try the next fake. */
export function respondFrom(routes: readonly Route[]): (request: Request) => Promise<Response | null> {
  return async request => {
    const url = new URL(request.url);
    const matches = (pattern: Route['url']) => {
      if (typeof pattern === 'function') return pattern(url);
      if (typeof pattern === 'string') return pattern === `${url.origin}${url.pathname}`;
      return new RegExp(pattern).test(request.url);
    };
    const route = routes.find(route => (!route.method || route.method.toUpperCase() === request.method) && matches(route.url));
    return route ? route.respond(request) : null;
  };
}

export function fakeFetch(routes: readonly Route[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = respondFrom(routes);
  return {
    calls,
    async fetch(input, init) {
      const request = new Request(input, init);
      calls.push({ method: request.method, url: request.url,
        headers: Object.fromEntries(request.headers), body: await request.clone().text() });
      const response = await respond(request);
      if (!response) throw new Error(`fakeFetch: no route for ${request.method} ${request.url}`);
      return response;
    },
  };
}

/** What a derived fake hands an operation's answer function: the request's path parameters, query and JSON body. */
export type FakeCall = { path: Readonly<Record<string, string>>; query: Readonly<Record<string, string>>; body: unknown };
type Answer = (call: FakeCall) => unknown;

/** A URL as a route compares it: no query, and no trailing `/` (a bare origin's included). */
const target = (url: URL) => `${url.origin}${url.pathname.replace(/\/$/u, '')}`;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
/** A path's literal part as a pattern: percent-encoded as a request's URL is, then escaped. Read after a `_`, so `URL`
 * never takes a part for a dot segment and drops it (`.` in `/files/{name}.{ext}`). */
const literal = (part: string) => escaped(new URL(`https://x/_${part}`).pathname.slice(2));
/** A template's segments, each literal (0) or holding a placeholder (1): of two routes, the one whose first differing
 * segment is literal is the more specific. */
const specificity = (template: string) => template.split('/').map(segment => (placeholders(segment).length > 0 ? 1 : 0));
const moreSpecific = (a: readonly number[], b: readonly number[]) => {
  const at = a.findIndex((segment, index) => segment !== b[index]);
  return at === -1 || at >= b.length ? a.length - b.length : (a[at] ?? 0) - (b[at] ?? 0);
};
/** `value` at a dotted path of `into`, the objects on the way made; never over a value already there. */
function put(into: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head = '', ...rest] = path.split('.');
  const inner = into[head];
  if (!Object.hasOwn(into, head)) into[head] = rest.length === 0 ? value : put({}, rest.join('.'), value);
  else if (rest.length > 0 && typeof inner === 'object' && inner !== null) put(inner as Record<string, unknown>, rest.join('.'), value);
  return into;
}
/** The paths a value reads from identify's answer, never the token answer or a connection value: each a template
 * reads, else the first of a list of fallbacks. */
const answerPaths = (value: Value | undefined) => {
  const paths = value === undefined ? [] : lookupNames({ identify: { id: value } })
    .filter(name => !name.startsWith('tokenAnswer.') && !name.startsWith('connection.'));
  return typeof value === 'string' && value.includes('{') ? paths : paths.slice(0, 1);
};

/** Routes that answer as the entry declares, for one credential: identify (by default an answer holding a kit account
 * at the entry's id and name paths), a token request for a `token` entry, and each declared operation the app answers.
 * A request without the credential the entry sends is 401. Of two routes that match, the one whose first differing
 * segment is literal answers. */
export function fakeProvider<const E extends Entry>(entry: E, data: { key: string; values?: Values; account?: unknown;
  operations?: E extends { operations: infer O } ? { [K in keyof O]?: Answer } : Record<string, never> }): Route[] {
  const { key, values = {} } = data;
  const operations = (data.operations ?? {}) as Readonly<Record<string, Answer | undefined>>;
  const [auth] = entry.auth;
  // The engine's own rules fill the base and the credential, so the fake and the engine never disagree.
  const { header, query = [] } = credentialOf(entry, auth.kind === 'token' ? 'kit-token' : key, values);
  const base = (url?: string) => target(new URL(filledBase(entry, values, url).replace(/\/+$/u, '')));
  /** A route for a path template under a base, each `{name}` one segment, and its specificity; an API route answers
   * 401 to a request without the credential. */
  const route = (method: string, at: string, path: string, answer: (call: FakeCall, sent: Request) => unknown, open = false): [number[], Route] => {
    // Compared as `target` reads a URL: no trailing `/`, so `/` on an origin is the origin.
    const template = (path.split('?')[0] ?? '').replace(/\/$/u, '');
    const pattern = new RegExp(`^${escaped(at)}${template.split(/\{[^{}]+\}/u).map(literal).join('([^/]+)')}$`, 'u');
    return [specificity(template), { method, url: url => pattern.test(target(url)), async respond(request) {
      const url = new URL(request.url);
      if (!open && !((header === undefined || request.headers.get(header[0]) === header[1])
        && query.every(([name, value]) => url.searchParams.get(name) === value))) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      for (const [name] of query) url.searchParams.delete(name);
      const params = pattern.exec(target(url))?.slice(1) ?? [];
      const value = await answer({ path: Object.fromEntries(placeholders(template).map((name, at) => [name, decodeURIComponent(params[at] ?? '')])),
        query: Object.fromEntries(url.searchParams), body: parseJson(await request.clone().text()) }, request);
      return value instanceof Response ? value : value === undefined ? Response.json({ error: 'not_found' }, { status: 404 }) : Response.json(value);
    } }];
  };
  const routes: [number[], Route][] = [];
  // GraphQL posts every query to its base; the app's answers come first, so an operation sharing identify's request answers it.
  const graphql: [at: string, query: string, answer: Answer][] = [];
  for (const [id, op] of Object.entries(entry.operations ?? {})) {
    const answer = operations[id];
    if (answer === undefined) continue;
    if ('graphql' in op) graphql.push([base(), op.graphql, answer]);
    else routes.push(route(op.method ?? 'GET', base(), op.path, answer));
  }
  const { request: identify, id, name } = entry.identify ?? {};
  if (identify !== undefined) {
    const at = base(callBase(entry, identify).baseUrl);
    const answer = () => data.account ?? [...answerPaths(id).map(path => [path, 'kit-account'] as const),
      ...answerPaths(name).map(path => [path, 'kit-name'] as const)].reduce((answer, [path, value]) => put(answer, path, value), {});
    if (identify.graphql === undefined) routes.push(route(identify.method ?? 'GET', at, identify.path ?? '', answer));
    else graphql.push([at, identify.graphql, answer]);
  }
  for (const at of new Set(graphql.map(([at]) => at))) {
    routes.push(route('POST', at, '', call => {
      const found = graphql.find(([where, text]) => where === at && text === readPath(call.body, 'query'));
      if (found === undefined) throw new Error(`fakeProvider: no answer for this GraphQL query at POST ${at}`);
      return found[2](call);
    }));
  }
  if (auth.kind === 'token') {
    const { request } = auth;
    const secret = entry.fields?.find(field => field.secret === true)?.name ?? '';
    // What the engine's own token request sends for the good key, its Basic and its body, captured once.
    let expected: Promise<[string | null, string]> | undefined;
    const capture = () => new Promise<[string | null, string]>((resolve, reject) => {
      requestToken(entry, { secret: { [secret]: key }, values, fetch: async (input, init) => {
        const sent = new Request(input, init);
        resolve([sent.headers.get('authorization'), await sent.text()]);
        throw new Error('captured');
      } }).catch(reject); // after a capture, a no-op
    });
    routes.push(route('POST', base(request.url), '', async (_call, sent) => {
      const [basic, body] = await (expected ??= capture());
      // RFC 6749 §5.2: a client whose Basic or body differs is refused.
      if (sent.headers.get('authorization') !== basic || await sent.text() !== body) return Response.json({ error: 'invalid_client' }, { status: 400 });
      return lookupNames(entry).filter(read => read.startsWith('tokenAnswer.')).map(read => read.slice('tokenAnswer.'.length))
        .reduce((answer, path) => put(answer, path, `kit-${path}`), put(put({}, request.token ?? 'access_token', 'kit-token'), 'expires_in', 3600));
    }, true));
  }
  // Stable: the more specific route first, and on a tie an operation beats identify.
  return routes.sort(([a], [b]) => moreSpecific(a, b)).map(([, route]) => route);
}

export function sequence(...responses: readonly (() => Response)[]): () => Response {
  let index = 0;
  return () => {
    const respond = responses[Math.min(index++, responses.length - 1)];
    if (!respond) throw new Error('sequence_empty');
    return respond();
  };
}

export function memoryLock(): WithLock {
  const held = new Set<string>();
  return async (key, _ttlSeconds, work) => {
    if (held.has(key)) return 'busy';
    held.add(key);
    try {
      return await work();
    } finally {
      held.delete(key);
    }
  };
}

export function openLock(): WithLock {
  return (_key, _ttlSeconds, work) => work();
}

function check(passed: unknown, message: string): asserts passed {
  if (!passed) throw new Error(`checkCredentialStore: ${message}`);
}

export async function checkCredentialStore(input: {
  secrets: SecretStore; tenantKeys: TenantKeyStore; connectionId: string; freshTenantId: string;
}): Promise<void> {
  const { secrets, tenantKeys, connectionId, freshTenantId } = input;
  const original = await secrets.read(connectionId);
  check(original, 'the connection row is missing');
  const sample: Sealed = { ciphertext: 'Y2hlY2stY2lwaGVydGV4dA==', iv: 'AQEBAQEBAQEBAQEB', authTag: 'AgICAgICAgICAgICAgICAg==',
    kekVersion: 2, dekVersion: 3, format: 2 };
  const restore = async () => {
    const current = await secrets.read(connectionId);
    check(current, 'the connection row is missing during restore');
    check(await secrets.replace(connectionId, original.sealed, current.version), 'the original secret could not be restored');
  };
  try {
    check(await secrets.replace(connectionId, sample, original.version), 'a replace at the current version was refused');
    const changed = await secrets.read(connectionId);
    check(changed, 'the connection row disappeared');
    check(changed.version > original.version, 'a replace did not move the version');
    check(changed.tenantId === original.tenantId && isDeepStrictEqual(changed.sealed, sample), 'the secret round trip changed a field');
    check(!await secrets.replace(connectionId, original.sealed, original.version), 'a replace at an old version was accepted');
    check(isDeepStrictEqual(await secrets.read(connectionId), changed), 'a stale replace changed the secret');
  } catch (error) {
    // The scenario that failed is the one to report; a restore failing after it would hide it.
    await restore().catch(() => undefined);
    throw error;
  }
  await restore();
  check(isDeepStrictEqual((await secrets.read(connectionId))?.sealed, original.sealed), 'the restored secret round trip changed a field');
  check(await tenantKeys.read(freshTenantId) === null, 'the fresh tenant already has a key');
  const alternative = { ...sample, ciphertext: 'b3RoZXItY2lwaGVydGV4dA==' };
  const [first, second] = await Promise.all([
    tenantKeys.insert(freshTenantId, sample), tenantKeys.insert(freshTenantId, alternative),
  ]);
  check(isDeepStrictEqual(first, second), 'two inserts returned different keys');
  check([sample, alternative].some(candidate => isDeepStrictEqual(first.wrapped, candidate)),
    'the winning tenant key did not match an inserted candidate');
  check(isDeepStrictEqual(await tenantKeys.read(freshTenantId), first), 'the inserted tenant-key round trip changed a field');
  const replacement = { ...sample, ciphertext: 'cmV3cmFwcGVkLWNpcGhlcnRleHQ=', kekVersion: 4 };
  check(await tenantKeys.replace(freshTenantId, replacement, first.version), 'a tenant-key replace at the current version was refused');
  const changed = await tenantKeys.read(freshTenantId);
  check(changed, 'the tenant key disappeared');
  check(changed.version > first.version, 'a tenant-key replace did not move the version');
  check(isDeepStrictEqual(changed.wrapped, replacement), 'the replaced tenant-key round trip changed a field');
  check(!await tenantKeys.replace(freshTenantId, sample, first.version), 'a tenant-key replace at an old version was accepted');
  check(isDeepStrictEqual(await tenantKeys.read(freshTenantId), changed), 'a stale replace changed the tenant key');
}
