import { identifyAccount, type Account } from './account.js';
import type { Entered, Entry, Field, Kept, Plain, Secrets, Value, Values, ValuesOption } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { defaultFetch, filledBase } from './http.js';
import { authorizeUrl, exchangeCode, pkcePair, requestToken, revokeGrant, type Grant, type OAuthClient } from './oauth.js';
import { checkHosts, hostPart, namedHosts, placeholders, plainFields, plainValue, readPath } from './rules.js';

type Redirect<E extends Entry = Entry> = { kind: 'redirect'; url: string; codeVerifier?: string; values: Plain<E> };
type Form = { kind: 'form'; fields: readonly Field[] };
export type ConnectStart = Redirect | Form;
/** `OAuth` for an OAuth 2 entry, `Key` for a form entry (key or token), either for an entry whose kind is not known (a
 * union, `Entry`). */
type ByKind<E extends Entry, OAuth, Key> = [E['auth'][0]['kind']] extends ['oauth2'] ? OAuth
  : [E['auth'][0]['kind']] extends ['key' | 'token'] ? Key : OAuth | Key;
/** A finished sign-in: the secret to seal, the plain values to keep, and the account; one per entry of a union. */
export type Connected<E extends Entry = Entry> = E extends Entry ? {
  /** The grant, or a key or token entry's secret fields by name. */
  secret: ByKind<E, Grant, Secrets<E>>;
  /** The plain fields entered, by name, and what `save` kept (present only when the provider answered it). */
  values: Kept<E>;
  account: E['identify'] extends { id: Value } ? Account : Account | null;
} : never;
/** The plain fields an input takes: required unless each has a default, none for an entry that declares none. */
type ValuesIn<E extends Entry> = E extends Entry ? ValuesOption<Entered<E>> : never;
type OAuthStart<E extends Entry = Entry> = { clientId: string; redirectUri: string; state: string } & ValuesIn<E>;
type OAuthFinish<E extends Entry = Entry> = { client: OAuthClient; code: string; redirectUri: string; codeVerifier?: string | undefined;
  fetch?: typeof fetch; onRevokeFailed: (error: unknown) => void } & ValuesIn<E>;
/** A form entry's finish (key or token): its secret fields by name, and its plain fields; one per form member of a union,
 * none for an OAuth 2 member. */
type FormFinish<E extends Entry = Entry> = E extends Entry ? E['auth'][0]['kind'] extends 'oauth2' ? never
  : { secret: Secrets<E>; fetch?: typeof fetch } & ValuesIn<E> : never;

/** A declared field's value: own values only, a getter's included (an inherited `constructor` is none). Left out or blank
 * takes the default; another type is refused. */
function read(field: Field, source: Values): readonly [string, string] {
  const given: unknown = Object.hasOwn(source, field.name) ? source[field.name] : undefined;
  if (given !== undefined && typeof given !== 'string') throw new TypeError(`connect_field_invalid: ${field.name}`);
  const value = given !== undefined && given.trim() !== '' ? given : field.secret ? undefined : field.default;
  if (value === undefined) throw new TypeError(`connect_field_required: ${field.name}`);
  if (field.choices !== undefined && !field.choices.includes(value)) throw new TypeError(`connect_field_invalid: ${field.name}`);
  return [field.name, value];
}

/** The entry's plain fields, each read once: the values a connection keeps. */
const plainOf = (entry: Entry, given: Values): Record<string, string> =>
  Object.fromEntries(plainFields(entry).map(field => read(field, given)));

/** A form of the entry's fields, or the provider's authorization URL with the PKCE verifier and the plain values read,
 * every OAuth 2 URL but the refresh URL, and the base, filled and checked with them first. */
export function startConnect<const E extends Entry>(entry: E, ...options: ByKind<E, [options: OAuthStart<E>], []>):
  Promise<E extends Entry ? ByKind<E, Redirect<E>, Form> : never>;
export async function startConnect(entry: Entry, options?: OAuthStart): Promise<ConnectStart> {
  checkHosts(entry); // a form too: its fields are the sign-in's
  const [auth] = entry.auth;
  if (auth.kind !== 'oauth2') return { kind: 'form', fields: entry.fields ?? [] };
  if (!options) throw new TypeError('oauth_options_required');
  const values = plainOf(entry, options.values ?? {});
  const pkce = auth.pkce === false ? undefined : await pkcePair();
  const url = authorizeUrl(entry, { ...options, values, scopes: entry.scopes?.default ?? [], ...(pkce ? { codeChallenge: pkce.challenge } : {}) });
  // The base too, before the person leaves; a value it takes from `save` (Jira's `{cloudId}`) exists only after the exchange.
  if (!placeholders(entry.http.baseUrl).some(name => Object.hasOwn(entry.save ?? {}, name))) filledBase(entry, values);
  return { kind: 'redirect', url: url.toString(), ...(pkce ? { codeVerifier: pkce.verifier } : {}), values };
}

export function finishConnect<const E extends Entry>(entry: E, input: ByKind<E, OAuthFinish<E>, FormFinish<E>>): Promise<Connected<E>>;
export async function finishConnect(entry: Entry, input: OAuthFinish | FormFinish): Promise<Connected> {
  checkHosts(entry); // before a credential is read, for every kind: identify may send nothing to check it later
  const [auth] = entry.auth;
  const fetch = input.fetch ?? defaultFetch(entry);
  if (auth.kind !== 'oauth2') {
    const { secret: secrets = {}, values: plain = {} }: Partial<FormFinish> = 'secret' in input ? input : {};
    // Only the declared fields, each filled, all checked before anything is sent: an entry's templates read them. Each
    // field is read once, so identify is sent the very credential returned. The first secret field is the credential;
    // an app's own entry may declare none, its fault before the caller's.
    const [credential, ...others] = (entry.fields ?? []).filter(field => field.secret).map(field => read(field, secrets));
    if (credential === undefined) throw new TypeError(`connect_secret_field_missing: ${entry.id}`);
    const values = plainOf(entry, plain);
    const secret = Object.fromEntries([credential, ...others]);
    if (auth.kind === 'key') return { secret, ...await identifyAccount(entry, { fetch, token: credential[1], values }) };
    // The token request is the credential check, sent the very secret fields returned; only the answer's keys the entry
    // names reach identify, and no token is returned.
    const { token, extras } = await requestToken(entry, { secret, values, fetch });
    return { secret, ...await identifyAccount(entry, { fetch, token, values, tokenAnswer: extras }) };
  }
  if (!('code' in input)) throw new TypeError('oauth_options_required');
  // Read again, as a stored value is trusted no more than a typed one: the token URL is filled from these.
  const values = plainOf(entry, input.values ?? {});
  const { grant, extras } = await exchangeCode(entry, input.client, { ...input, values, fetch });
  // A host the token answer names (Wrike's data centre) is kept before identify, which sends to it; never a caller's.
  const named = Object.fromEntries(Object.entries(namedHosts(entry)).map(([name, path]) => [name, readPath({ tokenAnswer: extras }, path)]));
  try {
    if (Object.keys(named).some(name => plainValue(named, name) === undefined)) throw new ProviderHttpError('invalid_response', 200, 'missing_fields');
    filledBase(entry, { ...values, ...named }, hostPart(entry.http.baseUrl) ?? ''); // here too: identify may send nothing on the base
    // RFC 6749 §5.1: a token answer without `scope` granted the scopes requested.
    const granted = typeof extras.scope === 'string' ? new Set(extras.scope.split(auth.scopeSeparator ?? ' ')) : undefined;
    if (entry.scopes?.requireGranted && granted && !entry.scopes.default.every(scope => granted.has(scope))) {
      throw new ProviderHttpError('rejected', null, 'scope_missing');
    }
    return { secret: grant, ...await identifyAccount(entry, { fetch, token: grant.accessToken, values: { ...values, ...named }, tokenAnswer: extras }) };
  } catch (error) {
    // A reused grant may belong to a live connection; only the app can decide ownership.
    if (auth.reusesGrant) throw error;
    // Cleanup must not hide the original refusal.
    try {
      await revokeGrant(entry, { ...grant, client: input.client, values: { ...values, ...named }, fetch });
    } catch (revokeError) { input.onRevokeFailed(revokeError); }
    throw error;
  }
}
