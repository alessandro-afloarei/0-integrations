import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { accessToken, readSecret, type WithLock } from './credentials.js';
import { GrantRevoked, RefreshBusy, SecretUnavailable } from './errors.js';
import type { Grant } from './oauth.js';
import { hubspot } from './catalogue/hubspot.js';
import { memoryLock, memoryStores, openLock } from './testing.js';
import { createVault } from './vault.js';

const fresh: Grant = { accessToken: 'fresh', refreshToken: 'next-refresh', expiresAt: '2026-10-24T13:00:00Z' };
const old: Grant = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: '2026-10-24T12:10:00Z' };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

async function setup(value: unknown = old, withLock: WithLock = memoryLock()) {
  const stores = memoryStores();
  const vault = createVault({ tenantKeys: stores.tenantKeys,
    keys: { current: 1, writeFormat: 2, get: () => Promise.resolve(Buffer.alloc(32, 1)) } });
  stores.secrets.put('c1', 't1', await vault.seal('t1', 'c1', value));
  const refresh = vi.fn<(token: string) => Promise<Grant>>().mockResolvedValue(fresh);
  return { ...stores, vault, provider: hubspot, connectionId: 'c1', withLock, refresh };
}

test('memoryLock answers busy to a second holder and frees the key after', async () => {
  const lock = memoryLock();
  let release = () => {};
  const hold = new Promise<string>(resolve => { release = () => { resolve('done'); }; });
  const first = lock('key', 30, () => hold);
  expect(await lock('key', 30, () => Promise.resolve('other'))).toBe('busy');
  expect(await lock('other-key', 30, () => Promise.resolve('other'))).toBe('other');
  release();
  expect(await first).toBe('done');
  expect(await lock('key', 30, () => Promise.resolve('next'))).toBe('next');
  await expect(lock('key', 30, () => Promise.reject(new Error('failure')))).rejects.toThrow('failure');
  expect(await lock('key', 30, () => Promise.resolve('freed'))).toBe('freed');
});

test('openLock lets both in', async () => {
  const lock = openLock();
  let release = () => {};
  const first = lock('key', 30, () => new Promise<string>(resolve => { release = () => { resolve('first'); }; }));
  expect(await lock('key', 30, () => Promise.resolve('second'))).toBe('second');
  release();
  expect(await first).toBe('first');
});

test('returns a stored token that is good for 15 more minutes', async () => {
  const input = await setup(fresh);
  expect(await accessToken(input)).toBe('fresh');
  expect(input.refresh).not.toHaveBeenCalled();
});

test('refreshes inside the margin, seals the new grant and moves the version', async () => {
  const calls: [string, number][] = [];
  const lock = memoryLock();
  const input = await setup(old, (key, ttl, work) => { calls.push([key, ttl]); return lock(key, ttl, work); });
  expect(await accessToken(input)).toBe('fresh');
  expect(input.refresh).toHaveBeenCalledExactlyOnceWith('old-refresh');
  expect(calls).toEqual([['hubspot:refresh:c1', 30]]);
  expect(await readSecret(input)).toEqual({ value: fresh, tenantId: 't1', version: 2 });
});

test('two callers at once make one refresh', async () => {
  const input = await setup();
  const results = await Promise.all([accessToken(input), accessToken(input)]);
  expect(input.refresh).toHaveBeenCalledTimes(1);
  expect(results.every(token => token === 'fresh' || token === 'old')).toBe(true);
  expect(results).toContain('fresh');
});

test('busy with an expired token is RefreshBusy', async () => {
  const input = await setup({ ...old, expiresAt: '2026-10-24T11:59:59Z' }, () => Promise.resolve('busy'));
  await expect(accessToken(input)).rejects.toBeInstanceOf(RefreshBusy);
  expect(input.refresh).not.toHaveBeenCalled();
});

test('a token the provider refused is spent', async () => {
  const input = await setup(fresh);
  input.refresh.mockResolvedValue({ ...fresh, accessToken: 'replacement' });
  expect(await accessToken({ ...input, rejected: 'fresh' })).toBe('replacement');
  expect(input.refresh).toHaveBeenCalledTimes(1);
  await expect(accessToken({ ...await setup(fresh, () => Promise.resolve('busy')), rejected: 'fresh' }))
    .rejects.toBeInstanceOf(RefreshBusy);
});

test("a lost compare-and-swap returns the winner's grant", async () => {
  const input = await setup();
  vi.spyOn(input.secrets, 'replace').mockImplementation(async () => {
    input.secrets.put('c1', 't1', await input.vault.seal('t1', 'c1', { ...fresh, accessToken: 'winner' }));
    return false;
  });
  expect(await accessToken(input)).toBe('winner');
});

test('invalid_grant after another writer refreshed is not a revoked grant', async () => {
  const input = await setup();
  input.refresh.mockImplementation(async () => {
    input.secrets.put('c1', 't1', await input.vault.seal('t1', 'c1', fresh));
    throw new GrantRevoked();
  });
  expect(await accessToken(input)).toBe('fresh');
});

test('invalid_grant with the version unchanged is GrantRevoked', async () => {
  const input = await setup();
  const read = vi.spyOn(input.secrets, 'read');
  input.refresh.mockImplementation(() => {
    read.mockClear();
    return Promise.reject(new GrantRevoked());
  });
  let settled = false;
  const result = accessToken(input).catch((error: unknown) => { settled = true; return error; });
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBeInstanceOf(GrantRevoked);
  expect(read).toHaveBeenCalledTimes(11);
});

test('a broken lock still keeps one grant', async () => {
  const input = await setup(old, openLock());
  let refused = () => {};
  const refusal = new Promise<void>(resolve => { refused = resolve; });
  const replace = input.secrets.replace.bind(input.secrets);
  vi.spyOn(input.secrets, 'replace').mockImplementation(async (...args) => {
    await refusal;
    await new Promise<void>(resolve => { setTimeout(resolve, 1000); });
    return replace(...args);
  });
  let spent = false;
  input.refresh.mockImplementation(token => {
    expect(token).toBe('old-refresh');
    if (spent) {
      refused();
      return Promise.reject(new GrantRevoked());
    }
    spent = true;
    return Promise.resolve(fresh);
  });
  const result = Promise.all([accessToken(input), accessToken(input)]).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(999);
  expect((await input.secrets.read('c1'))?.version).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await input.secrets.read('c1'))?.version).toBe(2);
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toEqual(['fresh', 'fresh']);
  expect(input.refresh).toHaveBeenCalledTimes(2);
  expect(await readSecret(input)).toEqual({ value: fresh, tenantId: 't1', version: 2 });
});

test('a grant without a refresh token is GrantRevoked', async () => {
  await expect(accessToken(await setup({ ...old, refreshToken: null }))).rejects.toBeInstanceOf(GrantRevoked);
});

test('an API key stored as the secret is SecretUnavailable', async () => {
  await expect(accessToken(await setup({ apiKey: 'key' }))).rejects.toBeInstanceOf(SecretUnavailable);
});

test('readSecret of a missing row is SecretUnavailable', async () => {
  const input = await setup();
  await expect(readSecret({ ...input, connectionId: 'missing' })).rejects.toBeInstanceOf(SecretUnavailable);
});

test('the revocation window uses a moved grant with margin zero or reports RefreshBusy', async () => {
  for (const expiresAt of ['2026-10-24T12:05:00Z', '2026-10-24T11:59:00Z']) {
    const input = await setup();
    input.refresh.mockRejectedValue(new GrantRevoked());
    const result = accessToken(input).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    input.secrets.put('c1', 't1', await input.vault.seal('t1', 'c1', { ...fresh, expiresAt }));
    await vi.advanceTimersByTimeAsync(500);
    if (expiresAt === '2026-10-24T12:05:00Z') expect(await result).toBe('fresh');
    else expect(await result).toBeInstanceOf(RefreshBusy);
  }
});

test('a save that throws once is retried, so the refreshed grant is kept', async () => {
  const input = await setup();
  const replace = input.secrets.replace.bind(input.secrets);
  let failures = 1;
  const secrets = { read: input.secrets.read.bind(input.secrets),
    replace: (...args: Parameters<typeof replace>) => failures-- > 0 ? Promise.reject(new Error('db timeout')) : replace(...args) };
  expect(await accessToken({ ...input, secrets })).toBe('fresh');
  expect(input.refresh).toHaveBeenCalledOnce();
  expect((await readSecret(input)).value).toEqual(fresh);
});
