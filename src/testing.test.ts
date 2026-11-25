import { expect, test } from 'vitest';
import { checkCredentialStore, fakeFetch, memoryStores, respondFrom, sequence } from './testing.js';
import type { Sealed } from './vault.js';

test('respondFrom matches a route whose url is a predicate', async () => {
  const respond = respondFrom([{ method: 'GET', url: url => url.host === 'a.test' && url.pathname.startsWith('/items/'),
    respond: () => new Response('item') }]);
  expect(await (await respond(new Request('https://a.test/items/7?full=1')))?.text()).toBe('item');
  expect(await respond(new Request('https://a.test/other'))).toBeNull();
});

test('respondFrom is null for a request no route matches', async () => {
  const respond = respondFrom([{ url: 'https://a.test/x', respond: () => new Response('a') }]);
  expect(await respond(new Request('https://b.test/x'))).toBeNull();
});

test('answers the first matching route and records the call', async () => {
  const fake = fakeFetch([
    { method: 'POST', url: 'https://api.test/items', respond: () => new Response('first') },
    { url: /api\.test/, respond: () => new Response('second') },
  ]);
  const response = await fake.fetch('https://api.test/items?q=one', {
    method: 'POST', headers: { 'X-Api-Key': 'k' }, body: 'body',
  });
  expect(await response.text()).toBe('first');
  expect(fake.calls).toEqual([{
    method: 'POST', url: 'https://api.test/items?q=one',
    headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-api-key': 'k' }, body: 'body',
  }]);
  expect(await (await fake.fetch(new Request('https://api.test/other?q=two'))).text()).toBe('second');
});

test('an unknown route throws and names it', async () => {
  await expect(fakeFetch([]).fetch('https://api.test/missing'))
    .rejects.toThrow('fakeFetch: no route for GET https://api.test/missing');
});

test('sequence repeats its last response', async () => {
  const next = sequence(() => new Response('a'), () => new Response('b'));
  expect(await next().text()).toBe('a');
  expect(await next().text()).toBe('b');
  expect(await next().text()).toBe('b');
});

const original: Sealed = { ciphertext: 'b3JpZ2luYWw=', iv: 'AAAAAAAAAAAAAAAA', authTag: 'AAAAAAAAAAAAAAAAAAAAAA==', kekVersion: 1, dekVersion: 1, format: 1 };
function storeFixture() {
  const stores = memoryStores();
  stores.secrets.put('connection', 'tenant', original);
  return { ...stores, connectionId: 'connection', freshTenantId: 'fresh-tenant' };
}

test('passes on the memory stores', async () => {
  const input = storeFixture();
  await expect(checkCredentialStore(input)).resolves.toBeUndefined();
  expect((await input.secrets.read('connection'))?.sealed).toEqual(original);
});

test('catches a store that ignores the expected version', async () => {
  const input = storeFixture();
  const secrets = { ...input.secrets, replace(id: string, sealed: Sealed) {
    input.secrets.put(id, 'tenant', sealed);
    return Promise.resolve(true);
  } };
  await expect(checkCredentialStore({ ...input, secrets }))
    .rejects.toThrow('checkCredentialStore: a replace at an old version was accepted');
  expect((await input.secrets.read('connection'))?.sealed).toEqual(original);
});

test('catches a store that drops the format', async () => {
  const input = storeFixture();
  const secrets = { ...input.secrets, async read(id: string) {
    const row = await input.secrets.read(id);
    return row ? { ...row, sealed: { ...row.sealed, format: 1 as const } } : null;
  } };
  await expect(checkCredentialStore({ ...input, secrets })).rejects.toThrow(/checkCredentialStore: .*round trip/);
});

test('catches two inserts that both win', async () => {
  const input = storeFixture();
  const tenantKeys = { ...input.tenantKeys, insert(_id: string, wrapped: Sealed) {
    return Promise.resolve({ wrapped, version: 1 });
  } };
  await expect(checkCredentialStore({ ...input, tenantKeys })).rejects.toThrow('checkCredentialStore: two inserts returned different keys');
});

test('catches tenant keys that ignore the expected version', async () => {
  const input = storeFixture();
  const tenantKeys = { ...input.tenantKeys, async replace(id: string, wrapped: Sealed) {
    const current = await input.tenantKeys.read(id);
    return current ? input.tenantKeys.replace(id, wrapped, current.version) : false;
  } };
  await expect(checkCredentialStore({ ...input, tenantKeys }))
    .rejects.toThrow('checkCredentialStore: a tenant-key replace at an old version was accepted');
});

test('regular expression routes match repeated requests with stateful flags', async () => {
  const route = /https:/g;
  const fake = fakeFetch([{ url: route, respond: () => new Response('ok') }]);
  expect(await (await fake.fetch('https://api.test/items')).text()).toBe('ok');
  expect(await (await fake.fetch('https://api.test/items')).text()).toBe('ok');
  expect(route.lastIndex).toBe(0);
});

test('passes on stores that normalize base64 through bytes', async () => {
  const input = storeFixture();
  function normalized(sealed: Sealed): Sealed {
    const iv = Buffer.from(sealed.iv, 'base64');
    const tag = Buffer.from(sealed.authTag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid_test_envelope');
    return { ...sealed, ciphertext: Buffer.from(sealed.ciphertext, 'base64').toString('base64'),
      iv: iv.toString('base64'), authTag: tag.toString('base64') };
  }
  const secrets = { ...input.secrets, replace(id: string, sealed: Sealed, expected: number) {
    return input.secrets.replace(id, normalized(sealed), expected);
  } };
  const tenantKeys = { ...input.tenantKeys,
    insert(id: string, wrapped: Sealed) { return input.tenantKeys.insert(id, normalized(wrapped)); },
    replace(id: string, wrapped: Sealed, expected: number) { return input.tenantKeys.replace(id, normalized(wrapped), expected); },
  };
  await expect(checkCredentialStore({ ...input, secrets, tenantKeys })).resolves.toBeUndefined();
});

test('catches tenant-key inserts that corrupt the winning candidate', async () => {
  const input = storeFixture();
  const tenantKeys = { ...input.tenantKeys, insert(id: string, wrapped: Sealed) {
    return input.tenantKeys.insert(id, { ...wrapped, format: 1 });
  } };
  await expect(checkCredentialStore({ ...input, tenantKeys }))
    .rejects.toThrow('checkCredentialStore: the winning tenant key did not match an inserted candidate');
});

test('names the scenario that failed, not the restore that followed', async () => {
  const input = storeFixture();
  const secrets = { ...input.secrets, replace: () => Promise.resolve(false) };
  await expect(checkCredentialStore({ ...input, secrets }))
    .rejects.toThrow('checkCredentialStore: a replace at the current version was refused');
});
