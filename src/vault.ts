import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecretUnavailable } from './errors.js';

export type Sealed = {
  ciphertext: string; iv: string; authTag: string; kekVersion: number; dekVersion: number; format: 1 | 2;
};
export type KeySource = { current: number; writeFormat: 1 | 2; get(version: number): Promise<Uint8Array> };
export interface SecretStore {
  read(connectionId: string): Promise<{ tenantId: string; sealed: Sealed; version: number } | null>;
  replace(connectionId: string, sealed: Sealed, expected: number): Promise<boolean>;
}
export interface TenantKeyStore {
  read(tenantId: string): Promise<{ wrapped: Sealed; version: number } | null>;
  insert(tenantId: string, wrapped: Sealed): Promise<{ wrapped: Sealed; version: number }>;
  replace(tenantId: string, wrapped: Sealed, expected: number): Promise<boolean>;
}
export type Vault = {
  seal(tenantId: string, connectionId: string, value: unknown): Promise<Sealed>;
  open(tenantId: string, connectionId: string, sealed: Sealed): Promise<unknown>;
  rewrapTenantKey(tenantId: string): Promise<boolean>;
};

type Dek = { bytes: Buffer; wrapped: Sealed; at: number };

// Lenient on purpose: Postgres's encode(…, 'base64') breaks lines every 76 characters; GCM's tag proves the bytes.
const base64 = (value: string) => Buffer.from(value, 'base64');

function encrypt(key: Uint8Array, text: string, aad: string, metadata: Pick<Sealed, 'kekVersion' | 'dekVersion' | 'format'>): Sealed {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (metadata.format === 2) cipher.setAAD(Buffer.from(aad));
    return {
      ...metadata, iv: iv.toString('base64'),
      ciphertext: Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  } catch {
    throw new SecretUnavailable();
  }
}

function decrypt(key: Uint8Array, sealed: Sealed, aad: string): string {
  try {
    const iv = base64(sealed.iv);
    const tag = base64(sealed.authTag);
    if (iv.length !== 12 || tag.length !== 16) throw new SecretUnavailable();
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    if (sealed.format === 2) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(base64(sealed.ciphertext)), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretUnavailable();
  }
}

export function createVault({ tenantKeys, keys }: { tenantKeys: TenantKeyStore; keys: KeySource }): Vault {
  const cache = new Map<string, Dek>();

  async function unwrap(tenantId: string, wrapped: Sealed): Promise<Dek> {
    const kek = await keys.get(wrapped.kekVersion);
    const bytes = base64(decrypt(kek, wrapped, tenantId));
    if (bytes.length !== 32) throw new SecretUnavailable();
    return { bytes, wrapped, at: Date.now() };
  }

  async function load(tenantId: string, create: boolean): Promise<Dek> {
    const cached = cache.get(tenantId);
    cache.delete(tenantId);
    if (cached && Date.now() - cached.at < 5 * 60_000) {
      cache.set(tenantId, cached);
      return cached;
    }
    let row = await tenantKeys.read(tenantId);
    if (!row && create) {
      const kek = await keys.get(keys.current);
      const wrapped = encrypt(kek, randomBytes(32).toString('base64'), tenantId,
        { kekVersion: keys.current, dekVersion: 1, format: keys.writeFormat });
      row = await tenantKeys.insert(tenantId, wrapped);
    }
    if (!row) throw new SecretUnavailable();
    const dek = await unwrap(tenantId, row.wrapped);
    cache.set(tenantId, dek);
    const oldest = cache.keys().next().value;
    if (cache.size > 256 && oldest !== undefined) cache.delete(oldest);
    return dek;
  }

  return {
    async seal(tenantId, connectionId, value) {
      const dek = await load(tenantId, true);
      let text: string;
      try {
        text = JSON.stringify(value);
      } catch {
        throw new SecretUnavailable();
      }
      return encrypt(dek.bytes, text, `${tenantId}:${connectionId}`, {
        kekVersion: dek.wrapped.kekVersion, dekVersion: dek.wrapped.dekVersion, format: keys.writeFormat,
      });
    },
    async open(tenantId, connectionId, sealed) {
      let dek = await load(tenantId, false);
      if (dek.wrapped.dekVersion !== sealed.dekVersion) {
        cache.delete(tenantId);
        dek = await load(tenantId, false);
      }
      if (dek.wrapped.dekVersion !== sealed.dekVersion) throw new SecretUnavailable();
      try {
        return JSON.parse(decrypt(dek.bytes, sealed, `${tenantId}:${connectionId}`)) as unknown;
      } catch {
        throw new SecretUnavailable();
      }
    },
    async rewrapTenantKey(tenantId) {
      const row = await tenantKeys.read(tenantId);
      if (!row) throw new SecretUnavailable();
      if (row.wrapped.kekVersion === keys.current && row.wrapped.format === keys.writeFormat) return false;
      const dek = await unwrap(tenantId, row.wrapped);
      const kek = await keys.get(keys.current);
      const wrapped = encrypt(kek, dek.bytes.toString('base64'), tenantId,
        { kekVersion: keys.current, dekVersion: row.wrapped.dekVersion, format: keys.writeFormat });
      const wrote = await tenantKeys.replace(tenantId, wrapped, row.version);
      cache.delete(tenantId);
      return wrote;
    },
  };
}
