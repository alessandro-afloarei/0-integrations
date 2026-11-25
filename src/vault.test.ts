import { createCipheriv } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { SecretUnavailable } from './errors.js';
import { memoryStores } from './testing.js';
import { createVault, type KeySource, type Sealed } from './vault.js';

function keys(current: number, writeFormat: 1 | 2, versions: number[]): KeySource {
  return { current, writeFormat, get(version) {
    if (!versions.includes(version)) return Promise.reject(new SecretUnavailable());
    return Promise.resolve(Buffer.alloc(32, version));
  } };
}

function legacy(key: Uint8Array, text: string): Sealed {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return {
    ciphertext: Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64'),
    iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'),
    kekVersion: 1, dekVersion: 1, format: 1,
  };
}

afterEach(() => vi.useRealTimers());

test('seal then open gives the value back', async () => {
  for (const format of [1, 2] as const) {
    const stores = memoryStores();
    const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, format, [1]) });
    const sealed = await vault.seal('t1', 'c1', { apiKey: 'k' });
    expect(sealed.format).toBe(format);
    expect(await vault.open('t1', 'c1', sealed)).toEqual({ apiKey: 'k' });
  }
});

test('a format-2 secret does not open under another connection or tenant', async () => {
  const stores = memoryStores();
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  const sealed = await vault.seal('t1', 'c1', { apiKey: 'k' });
  const wrapped = await stores.tenantKeys.read('t1');
  if (!wrapped) throw new Error('missing_test_key');
  await stores.tenantKeys.insert('t2', wrapped.wrapped);
  await expect(vault.open('t1', 'c2', sealed)).rejects.toBeInstanceOf(SecretUnavailable);
  await expect(vault.open('t2', 'c1', sealed)).rejects.toBeInstanceOf(SecretUnavailable);
});

test("opens what format 1 sealed", async () => {
  const stores = memoryStores();
  const dek = Buffer.alloc(32, 7);
  await stores.tenantKeys.insert('t1', legacy(Buffer.alloc(32, 1), dek.toString('base64')));
  const sealed = legacy(dek, JSON.stringify({ apiKey: 'legacy' }));
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 1, [1]) });
  expect(await vault.open('t1', 'c1', sealed)).toEqual({ apiKey: 'legacy' });
});

test('tampered bytes do not open', async () => {
  const stores = memoryStores();
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  const sealed = await vault.seal('t1', 'c1', { apiKey: 'k' });
  for (const field of ['ciphertext', 'iv', 'authTag'] as const) {
    const bytes = Buffer.from(sealed[field], 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    await expect(vault.open('t1', 'c1', { ...sealed, [field]: bytes.toString('base64') }))
      .rejects.toBeInstanceOf(SecretUnavailable);
  }
  await expect(vault.open('t1', 'c1', { ...sealed, authTag: Buffer.alloc(15).toString('base64') }))
    .rejects.toBeInstanceOf(SecretUnavailable);
  await expect(vault.open('t1', 'c1', { ...sealed, ciphertext: 'bad base64!' }))
    .rejects.toBeInstanceOf(SecretUnavailable);
});

test('a DEK that is not 32 bytes does not open', async () => {
  const stores = memoryStores();
  await stores.tenantKeys.insert('t1', legacy(Buffer.alloc(32, 1), Buffer.alloc(31).toString('base64')));
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 1, [1]) });
  await expect(vault.open('t1', 'c1', legacy(Buffer.alloc(32), '{}'))).rejects.toBeInstanceOf(SecretUnavailable);
});

test('a sealed value naming another DEK version re-reads the key once', async () => {
  const stores = memoryStores();
  const read = vi.spyOn(stores.tenantKeys, 'read');
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  const sealed = await vault.seal('t1', 'c1', {});
  read.mockClear();
  await expect(vault.open('t1', 'c1', { ...sealed, dekVersion: 7 })).rejects.toBeInstanceOf(SecretUnavailable);
  expect(read).toHaveBeenCalledTimes(1);
});

test('two vaults sealing for a new tenant agree on one key', async () => {
  const stores = memoryStores();
  const input = { tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) };
  const a = createVault(input);
  const b = createVault(input);
  const [first, second] = await Promise.all([a.seal('t1', 'c1', 'a'), b.seal('t1', 'c2', 'b')]);
  expect(await a.open('t1', 'c2', second)).toBe('b');
  expect(await b.open('t1', 'c1', first)).toBe('a');
});

test('rotation', async () => {
  const stores = memoryStores();
  const old = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  const sealed = await old.seal('t1', 'c1', { apiKey: 'k' });
  const next = createVault({ tenantKeys: stores.tenantKeys, keys: keys(2, 2, [1, 2]) });
  expect(await next.open('t1', 'c1', sealed)).toEqual({ apiKey: 'k' });
  expect(await next.rewrapTenantKey('t1')).toBe(true);
  expect((await stores.tenantKeys.read('t1'))?.wrapped.kekVersion).toBe(2);
  expect(await next.rewrapTenantKey('t1')).toBe(false);
  const rotated = createVault({ tenantKeys: stores.tenantKeys, keys: keys(2, 2, [2]) });
  expect(await rotated.open('t1', 'c1', sealed)).toEqual({ apiKey: 'k' });
});

test('rewrap moves a format-1 key to format 2', async () => {
  const stores = memoryStores();
  const old = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 1, [1]) });
  const sealed = await old.seal('t1', 'c1', {});
  const next = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  expect(await next.rewrapTenantKey('t1')).toBe(true);
  expect((await stores.tenantKeys.read('t1'))?.wrapped.format).toBe(2);
  expect(await next.open('t1', 'c1', sealed)).toEqual({});
});

test('the DEK cache keeps a tenant for 5 minutes', async () => {
  vi.useFakeTimers();
  const stores = memoryStores();
  const write = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  const sealed = await write.seal('t1', 'c1', {});
  const read = vi.spyOn(stores.tenantKeys, 'read');
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  await vault.open('t1', 'c1', sealed);
  await vault.open('t1', 'c1', sealed);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  await vault.open('t1', 'c1', sealed);
  expect(read).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 257; i++) await vault.seal(`tenant-${String(i)}`, 'c1', {});
  read.mockClear();
  await vault.open('t1', 'c1', sealed);
  expect(read).toHaveBeenCalledTimes(1);
});

test('store and key-source failures pass through', async () => {
  const stores = memoryStores();
  const error = new Error('kms down');
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: { current: 1, writeFormat: 2, get: () => Promise.reject(error) } });
  await expect(vault.seal('t1', 'c1', {})).rejects.toBe(error);
  vi.spyOn(stores.tenantKeys, 'read').mockRejectedValue(error);
  await expect(vault.open('t1', 'c1', legacy(Buffer.alloc(32), '{}'))).rejects.toBe(error);
});

test('opens base64 broken into 76-character lines, as Postgres encodes it', async () => {
  const stores = memoryStores();
  const vault = createVault({ tenantKeys: stores.tenantKeys, keys: keys(1, 2, [1]) });
  const sealed = await vault.seal('t1', 'c1', { accessToken: 'a'.repeat(120) });
  const lines = (text: string) => text.replace(/(.{76})/g, '$1\n');
  expect(sealed.ciphertext.length).toBeGreaterThan(76);
  expect(await vault.open('t1', 'c1', { ...sealed, ciphertext: lines(sealed.ciphertext) })).toEqual({ accessToken: 'a'.repeat(120) });
});
