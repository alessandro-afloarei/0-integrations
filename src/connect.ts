import type { Entry } from './catalogue.js';
import { authorizeUrl, exchangeCode, pkcePair, type Grant, type OAuthClient } from './oauth.js';

export type ConnectField = { name: string; label: string; secret: boolean };
export type ConnectStart = { kind: 'redirect'; url: string; codeVerifier?: string }
  | { kind: 'form'; fields: readonly ConnectField[] } | { kind: 'hosted'; url: string };
export type ConnectIdentity<D> = { account: { id: string; name: string }; details: D };
export type ConnectResult<S, D> = ConnectIdentity<D> & { secret: S };
export type OAuthConnect<D> = {
  kind: 'oauth2'; provider: Entry; scopes: readonly string[];
  identify: (input: { grant: Grant; extras: Record<string, unknown>; fetch: typeof fetch }) => Promise<ConnectIdentity<D>>;
  /** finishConnect revokes after failed identity unless re-consent can return a live connection's token. */
  reusesGrant?: true;
  revoke: (input: { grant: Grant; client: OAuthClient; fetch: typeof fetch }) => Promise<void>;
};
export type DirectConnect<S, D> = ({ kind: 'form'; fields: readonly ConnectField[] }
  | { kind: 'hosted'; authorize: () => Promise<string> }) & { identify: (secret: S) => Promise<ConnectIdentity<D>> };

type OAuthStart = { clientId: string; redirectUri: string; state: string };
type OAuthFinish = { client: OAuthClient; code: string; redirectUri: string; codeVerifier?: string; fetch: typeof fetch;
  onRevokeFailed: (error: unknown) => void };

export function startConnect<D>(provider: OAuthConnect<D>, options: OAuthStart): Promise<ConnectStart>;
export function startConnect<S, D>(provider: DirectConnect<S, D>): Promise<ConnectStart>;
export async function startConnect<S, D>(provider: OAuthConnect<D> | DirectConnect<S, D>, options?: OAuthStart): Promise<ConnectStart> {
  if (provider.kind === 'form') return { kind: 'form', fields: provider.fields };
  if (provider.kind === 'hosted') return { kind: 'hosted', url: await provider.authorize() };
  if (!options) throw new TypeError('oauth_options_required');
  const [auth] = provider.provider.auth;
  const pkce = auth.kind === 'oauth2' && auth.pkce !== false ? await pkcePair() : undefined;
  return { kind: 'redirect', url: authorizeUrl(provider.provider, { ...options, scopes: provider.scopes,
    ...(pkce ? { codeChallenge: pkce.challenge } : {}) }).toString(), ...(pkce ? { codeVerifier: pkce.verifier } : {}) };
}

export function finishConnect<D>(provider: OAuthConnect<D>, input: OAuthFinish): Promise<ConnectResult<Grant, D>>;
export function finishConnect<S, D>(provider: DirectConnect<S, D>, input: { secret: S }): Promise<ConnectResult<S, D>>;
export async function finishConnect<S, D>(provider: OAuthConnect<D> | DirectConnect<S, D>,
  input: OAuthFinish | { secret: S }): Promise<ConnectResult<S | Grant, D>> {
  if (provider.kind !== 'oauth2') {
    if (!('secret' in input)) throw new TypeError('connect_secret_required');
    return { secret: input.secret, ...await provider.identify(input.secret) };
  }
  if (!('client' in input)) throw new TypeError('oauth_options_required');
  const exchanged = await exchangeCode(provider.provider, input.client, input);
  try {
    return { secret: exchanged.grant, ...await provider.identify({ ...exchanged, fetch: input.fetch }) };
  } catch (error) {
    // A reused grant may belong to a live connection; only the app can decide ownership.
    if (provider.reusesGrant) throw error;
    // Cleanup must not hide the original refusal.
    try {
      await provider.revoke({ grant: exchanged.grant, client: input.client, fetch: input.fetch });
    } catch (revokeError) { input.onRevokeFailed(revokeError); }
    throw error;
  }
}
