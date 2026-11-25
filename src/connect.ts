import { identifyAccount, type Account } from './account.js';
import type { Entry, Field, Value, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { authorizeUrl, exchangeCode, pkcePair, revokeGrant, type Grant, type OAuthClient } from './oauth.js';

export type ConnectStart = { kind: 'redirect'; url: string; codeVerifier?: string } | { kind: 'form'; fields: readonly Field[] };
type Kind<E extends Entry> = E['auth'][0]['kind'];
/** A finished sign-in: the secret to seal, the plain values to keep, and the account. */
export type Connected<E extends Entry = Entry> = {
  secret: [Kind<E>] extends ['oauth2'] ? Grant : [Kind<E>] extends ['key'] ? Readonly<Record<string, string>>
    : Grant | Readonly<Record<string, string>>;
  values: Values;
  account: E['identify'] extends { id: Value } ? Account : Account | null;
};
type OAuthStart = { clientId: string; redirectUri: string; state: string };
type OAuthFinish = { client: OAuthClient; code: string; redirectUri: string; codeVerifier?: string; fetch: typeof fetch;
  onRevokeFailed: (error: unknown) => void };
type FormFinish = { secret: Readonly<Record<string, string>>; values?: Values; fetch: typeof fetch };

/** A form of the entry's fields, or the provider's authorization URL (with the PKCE verifier for the app to keep). */
export async function startConnect(entry: Entry, options?: OAuthStart): Promise<ConnectStart> {
  const [auth] = entry.auth;
  if (auth.kind === 'key') return { kind: 'form', fields: entry.fields ?? [] };
  if (!options) throw new TypeError('oauth_options_required');
  const pkce = auth.pkce === false ? undefined : await pkcePair();
  return { kind: 'redirect', url: authorizeUrl(entry, { ...options, scopes: entry.scopes?.default ?? [],
    ...(pkce ? { codeChallenge: pkce.challenge } : {}) }).toString(), ...(pkce ? { codeVerifier: pkce.verifier } : {}) };
}

export function finishConnect<const E extends Entry>(entry: E, input: [Kind<E>] extends ['oauth2'] ? OAuthFinish : FormFinish):
  Promise<Connected<E>>;
export async function finishConnect(entry: Entry, input: OAuthFinish | FormFinish): Promise<Connected> {
  const [auth] = entry.auth;
  if (auth.kind === 'key') {
    const secret = 'secret' in input ? input.secret : {};
    const values = 'values' in input ? input.values ?? {} : {};
    // Every declared field, before anything is sent: an entry's templates read them.
    for (const field of entry.fields ?? []) {
      const value = field.secret ? secret[field.name] : values[field.name];
      if (typeof value !== 'string' || value === '') {
        throw new TypeError(field.secret ? 'connect_secret_required' : `connect_field_required: ${field.name}`);
      }
    }
    const name = entry.fields?.find(field => field.secret)?.name;
    const token = name === undefined ? undefined : secret[name];
    if (token === undefined) throw new TypeError('connect_secret_required');
    return { secret, ...await identifyAccount(entry, { fetch: input.fetch, token, values }) };
  }
  if (!('code' in input)) throw new TypeError('oauth_options_required');
  const { grant, extras } = await exchangeCode(entry, input.client, input);
  try {
    const granted = new Set(typeof extras.scope === 'string' ? extras.scope.split(' ') : []);
    if (entry.scopes?.requireGranted && !entry.scopes.default.every(scope => granted.has(scope))) {
      throw new ProviderHttpError('rejected', null, 'scope_missing');
    }
    return { secret: grant, ...await identifyAccount(entry, { fetch: input.fetch, token: grant.accessToken, tokenAnswer: extras }) };
  } catch (error) {
    // A reused grant may belong to a live connection; only the app can decide ownership.
    if (auth.reusesGrant) throw error;
    // Cleanup must not hide the original refusal. The OAuth app goes only to an RFC 7009 revoke, which sends it.
    try {
      await revokeGrant(entry, { ...grant, fetch: input.fetch,
        ...(entry.revoke !== undefined && 'url' in entry.revoke ? { client: input.client } : {}) });
    } catch (revokeError) { input.onRevokeFailed(revokeError); }
    throw error;
  }
}
