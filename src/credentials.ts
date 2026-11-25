import type { Entry } from './catalogue.js';
import { GrantRevoked, RefreshBusy, SecretUnavailable } from './errors.js';
import type { Grant } from './oauth.js';
import type { SecretStore, Vault } from './vault.js';

const REFRESH_REREAD_INTERVAL_MS = 500;
const REFRESH_REREAD_WINDOW_MS = 5000;
const REFRESH_MARGIN_MS = 15 * 60_000;

export type WithLock = <T>(key: string, ttlSeconds: number, work: () => Promise<T>) => Promise<T | 'busy'>;

type SecretInput = { connectionId: string; secrets: SecretStore; vault: Vault };

export async function readSecret(input: SecretInput): Promise<{ value: unknown; tenantId: string; version: number }> {
  const row = await input.secrets.read(input.connectionId);
  if (!row) throw new SecretUnavailable();
  return { value: await input.vault.open(row.tenantId, input.connectionId, row.sealed), tenantId: row.tenantId, version: row.version };
}

function grant(value: unknown): Grant {
  if (typeof value !== 'object' || value === null
    || !('accessToken' in value) || typeof value.accessToken !== 'string' || !value.accessToken
    || !('refreshToken' in value) || !(value.refreshToken === null || (typeof value.refreshToken === 'string' && value.refreshToken.length > 0))
    || !('expiresAt' in value) || !(value.expiresAt === null || typeof value.expiresAt === 'string')) throw new SecretUnavailable();
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt };
}

export async function accessToken(input: SecretInput & {
  provider: Entry; withLock: WithLock; refresh: (refreshToken: string) => Promise<Grant>; rejected?: string;
}): Promise<string> {
  const usable = (value: Grant, marginMs: number) => value.accessToken !== input.rejected
    && (value.expiresAt === null || Date.parse(value.expiresAt) > Date.now() + marginMs);
  const read = async () => {
    const row = await readSecret(input);
    return { ...row, grant: grant(row.value) };
  };
  const winner = async () => {
    const row = await read();
    if (!usable(row.grant, 0)) throw new RefreshBusy();
    return row.grant.accessToken;
  };

  const initial = await read();
  if (usable(initial.grant, REFRESH_MARGIN_MS)) return initial.grant.accessToken;
  const result = await input.withLock(`${input.provider.id}:refresh:${input.connectionId}`, 30, async () => {
    const latest = await read();
    if (usable(latest.grant, REFRESH_MARGIN_MS)) return latest.grant.accessToken;
    if (latest.grant.refreshToken === null) throw new GrantRevoked();
    let refreshed: Grant;
    try {
      refreshed = await input.refresh(latest.grant.refreshToken);
    } catch (error) {
      if (!(error instanceof GrantRevoked)) throw error;
      let reread = await read();
      // Covers a lock lost to a failover while the winner is still saving.
      for (let elapsed = 0; reread.version === latest.version && elapsed < REFRESH_REREAD_WINDOW_MS; elapsed += REFRESH_REREAD_INTERVAL_MS) {
        await new Promise<void>(resolve => { setTimeout(resolve, REFRESH_REREAD_INTERVAL_MS); });
        reread = await read();
      }
      if (reread.version === latest.version) throw error;
      if (!usable(reread.grant, 0)) throw new RefreshBusy();
      return reread.grant.accessToken;
    }
    const sealed = await input.vault.seal(latest.tenantId, input.connectionId, refreshed);
    // The provider may already have spent the old refresh token: a save that throws gets one more try.
    const save = () => input.secrets.replace(input.connectionId, sealed, latest.version);
    if (await save().catch(save)) return refreshed.accessToken;
    return winner();
  });
  return result === 'busy' ? winner() : result;
}
