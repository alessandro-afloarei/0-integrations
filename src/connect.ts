import { identifyAccount, type Account } from './account.js';
import type { Entry, Field, Value, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { authorizeUrl, exchangeCode, pkcePair, revokeGrant, type Grant, type OAuthClient } from './oauth.js';

type Redirect = { kind: 'redirect'; url: string; codeVerifier?: string };
type Form = { kind: 'form'; fields: readonly Field[] };
export type ConnectStart = Redirect | Form;
/** `OAuth` for an OAuth 2 entry, `Key` for a key entry, either for an entry whose kind is not known (a union, `Entry`). */
type ByKind<E extends Entry, OAuth, Key> = [E['auth'][0]['kind']] extends ['oauth2'] ? OAuth
  : [E['auth'][0]['kind']] extends ['key'] ? Key : OAuth | Key;
/** The entry's declared fields, one union member each. */
type Fields<E extends Entry> = NonNullable<E['fields']>[number];
/** A record keyed by `K`, or by any string when the entry is not a literal and its names are unknown. */
type Keyed<E extends Entry, K extends string, V> = string extends E['id'] ? Readonly<Record<string, V>> : Readonly<Record<K, V>>;
/** The names `save` keeps, when the entry declares any. */
type Saved<E extends Entry> = E extends { save: infer S } ? keyof S & string : never;
/** A key entry's secret fields, and its plain fields, by name. */
type Secrets<E extends Entry> = Keyed<E, Extract<Fields<E>, { secret: true }>['name'], string>;
type Plain<E extends Entry> = Keyed<E, Exclude<Fields<E>, { secret: true }>['name'], string>;
/** A finished sign-in: the secret to seal, the plain values to keep, and the account; one per entry of a union. */
export type Connected<E extends Entry = Entry> = E extends Entry ? {
  /** The grant, or a key entry's secret fields by name. */
  secret: ByKind<E, Grant, Secrets<E>>;
  /** The plain fields entered, by name, and what `save` kept (present only when the provider answered it). */
  values: string extends E['id'] ? Values : Plain<E> & { readonly [K in Saved<E>]?: unknown };
  account: E['identify'] extends { id: Value } ? Account : Account | null;
} : never;
type OAuthStart = { clientId: string; redirectUri: string; state: string };
type OAuthFinish = { client: OAuthClient; code: string; redirectUri: string; codeVerifier?: string; fetch: typeof fetch;
  onRevokeFailed: (error: unknown) => void };
/** A key entry's finish: its secret fields by name, and its plain fields, required when it has any. */
type FormFinish<E extends Entry = Entry> = E extends Entry ? { secret: Secrets<E>; fetch: typeof fetch } & (string extends E['id']
  ? { values?: Values } : Partial<Plain<E>> extends Plain<E> ? { values?: Plain<E> } : { values: Plain<E> }) : never;

/** A form of the entry's fields, or the provider's authorization URL (with the PKCE verifier for the app to keep). */
export function startConnect<const E extends Entry>(entry: E, ...options: ByKind<E, [options: OAuthStart], []>):
  Promise<ByKind<E, Redirect, Form>>;
export async function startConnect(entry: Entry, options?: OAuthStart): Promise<ConnectStart> {
  const [auth] = entry.auth;
  if (auth.kind === 'key') return { kind: 'form', fields: entry.fields ?? [] };
  if (!options) throw new TypeError('oauth_options_required');
  const pkce = auth.pkce === false ? undefined : await pkcePair();
  return { kind: 'redirect', url: authorizeUrl(entry, { ...options, scopes: entry.scopes?.default ?? [],
    ...(pkce ? { codeChallenge: pkce.challenge } : {}) }).toString(), ...(pkce ? { codeVerifier: pkce.verifier } : {}) };
}

export function finishConnect<const E extends Entry>(entry: E, input: ByKind<E, OAuthFinish, FormFinish<E>>): Promise<Connected<E>>;
export async function finishConnect(entry: Entry, input: OAuthFinish | FormFinish): Promise<Connected> {
  const [auth] = entry.auth;
  if (auth.kind === 'key') {
    const { secret: secrets = {}, values: plain = {} }: Partial<FormFinish> = 'secret' in input ? input : {};
    // Only the declared fields, each filled, all checked before anything is sent: an entry's templates read them.
    const fields = entry.fields ?? [];
    // The entry's only secret field is the credential; an app's own entry may declare none, its fault before the caller's.
    const credential = fields.find(field => field.secret);
    if (credential === undefined) throw new TypeError(`connect_secret_field_missing: ${entry.id}`);
    const read = (field: Field) => {
      const value = (field.secret ? secrets : plain)[field.name];
      if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`connect_field_required: ${field.name}`);
      return [field.name, value] as const;
    };
    const secret = Object.fromEntries(fields.filter(field => field.secret).map(read));
    const values = Object.fromEntries(fields.filter(field => !field.secret).map(read));
    return { secret, ...await identifyAccount(entry, { fetch: input.fetch, token: read(credential)[1], values }) };
  }
  if (!('code' in input)) throw new TypeError('oauth_options_required');
  const { grant, extras } = await exchangeCode(entry, input.client, input);
  try {
    // RFC 6749 §5.1: a token answer without `scope` granted the scopes requested.
    const granted = typeof extras.scope === 'string' ? new Set(extras.scope.split(auth.scopeSeparator ?? ' ')) : undefined;
    if (entry.scopes?.requireGranted && granted && !entry.scopes.default.every(scope => granted.has(scope))) {
      throw new ProviderHttpError('rejected', null, 'scope_missing');
    }
    return { secret: grant, ...await identifyAccount(entry, { fetch: input.fetch, token: grant.accessToken, tokenAnswer: extras }) };
  } catch (error) {
    // A reused grant may belong to a live connection; only the app can decide ownership.
    if (auth.reusesGrant) throw error;
    // Cleanup must not hide the original refusal.
    try {
      await revokeGrant(entry, { ...grant, client: input.client, fetch: input.fetch });
    } catch (revokeError) { input.onRevokeFailed(revokeError); }
    throw error;
  }
}
