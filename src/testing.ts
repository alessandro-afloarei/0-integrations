import { isDeepStrictEqual } from 'node:util';
import type { WithLock } from './credentials.js';
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
