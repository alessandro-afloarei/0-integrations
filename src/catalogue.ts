import type { ProviderErrorCode } from './errors.js';

/** A string with `{name}` placeholders. Which names it may use depends on where it is read: see the design. */
export type Template = string;
/** A dotted path into an answer (`data.user.id`, `errors.0.code`); at each level the whole rest is tried as one key first. */
export type Path = string;
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** A connection's plain values: JSON only. */
export type Values = Readonly<Record<string, unknown>>;
/** Every stated part must hold. `status: 'error'` is any answer outside 2xx. One of `header` or `path`, never both,
 * selects the value compared; a comparison (`equals`, `in`, `startsWith`, `contains`) needs one of them, and with no
 * comparison the value only has to be there. `detail` tests the provider's own code. */
export type When = { status?: number | 'error'; header?: string; path?: Path; detail?: string | true;
  equals?: string | number | boolean; in?: readonly string[]; startsWith?: string; contains?: string };
/** What a person enters. `choices` lists every value a plain field accepts; `default` fills it when left blank. */
export type Field = { name: string; title: string; secret?: true; default?: string; help?: string; choices?: readonly string[] };
/** How the credential travels. None: `authorization: Bearer {token}`. A header: its `value` filled (Discord's
 * `Bot {token}`), else the bare `{token}`. `query`: each parameter's template, set on the URL of every request and
 * redirect hop. */
export type Send = { header: string; value?: Template } | { basic: readonly [Template, Template] }
  | { query: Readonly<Record<string, Template>> };
/** One request that turns what the person entered into a short-lived token: client credentials, or a session sign-in.
 * Its body is a flat record of templates, sent as a form or, with `json`, as JSON; `token` is the token's path in the
 * answer (`access_token` by default), and a root `expires_in` (seconds) is its life. */
export type TokenRequest = { url: Template; body: Readonly<Record<string, Template>>; json?: true;
  basic?: readonly [Template, Template]; token?: Path };
/** `oauth2.refreshUrl`: where a refresh posts (else `tokenUrl`). `json`: the token endpoint, its refresh and an RFC 7009
 * revoke take the parameters as one JSON object instead of a form. `token`: one declared request gives the token. */
export type Auth =
  | { kind: 'key'; send?: Send }
  | { kind: 'oauth2'; authorizeUrl: string; tokenUrl: string; refreshUrl?: string; json?: true; pkce?: false;
    clientAuth?: 'basic'; scopeSeparator?: ','; authorizeParams?: Readonly<Record<string, string>>;
    tokenTypes?: readonly string[]; failed?: When; reusesGrant?: true }
  | { kind: 'token'; request: TokenRequest; send?: Send };
/** A declared request. `base` names one of `http.bases` to send it to instead of the entry's own base. */
export type Call = { method?: Method; path?: Template; query?: Readonly<Record<string, string>>; graphql?: string; base?: string };
/** A path, the first present of several paths, or a template (a string with braces) over the same lookup. */
export type Value = Path | readonly Path[];
export type Identify = { request?: Call; id?: Value; name?: Value; lowercase?: true;
  /** Answers that mean a bad credential whatever their status; `detail` is the detail the error reports. */
  rejectWhen?: readonly (Omit<When, 'detail'> & { detail?: string })[] };
export type Revoke = ({ url: string; token: readonly ('refresh' | 'access')[] } | { request: Call })
  & { goneErrors?: readonly string[] };
/** A wait an answer states: a header's positive decimal number (of several, the longest present) or a body's number, a
 * duration (`s`, `ms`) or an instant (`epochSeconds`, `epochMs`). */
export type Wait = ({ header: string | readonly string[] } | { path: Path }) & { unit: 's' | 'ms' | 'epochSeconds' | 'epochMs' };
/** `onlyStated`: an answer that states no wait, and a network failure, are not retried. */
export type Retry = { limit?: number; maxWaitMs?: number; defaultWaitMs?: number; onlyStated?: true; wait?: Wait };
export type RateLimit = { when: readonly (When & { wait?: Wait })[]; defaultWaitMs?: number };
export type Http = { baseUrl: Template;
  /** The host a base with a placeholder in its host must have once filled: a name, `*.` and a domain, a list of those
   * (one must match), or `*` (any) alone. */
  host?: string | readonly string[]; bases?: Readonly<Record<string, string>>; headers?: Readonly<Record<string, string>>;
  timeoutMs?: number; minIntervalMs?: number; retry?: Retry; rateLimit?: RateLimit };
export type Errors = { detail?: Path | readonly Path[]; allow?: readonly string[]; failed?: When;
  revoked?: readonly string[]; rules?: readonly { when: When; code: ProviderErrorCode; detail?: string }[] };
type Timestamp = { header: string; toleranceSeconds?: number };
/** How a delivery is signed. `hmac`: `hash: 'sha1'` is HMAC-SHA1 (else SHA-256); `secret`: the key is the secret's
 * exact `base64` or `hex` decoding (else its bytes); `part`: the header is a comma-separated list of `name=value`
 * pieces, each piece named `part` a signature, any of which may match; `timestamp.part` reads the timestamp from the
 * same list. `ed25519`: the header is the hex signature of `signed`, the secret the provider's public key in hex.
 * `token`: the header is the secret itself. `basic`: `authorization` is HTTP Basic of the secret, `user:password`.
 * `standard`: Standard Webhooks, the secret base64 after an optional `whsec_`. `deliveryId` is what an app dedupes on.
 * `challenge`: a handshake whose body `when` holds is answered `{ [echo]: <the body's value> }` (Slack's
 * `url_verification`, Discord's PING). */
export type Webhook = (
  | { kind: 'hmac'; header: string; signed?: Template; prefix?: string; encoding?: 'base64'; hash?: 'sha1';
    secret?: 'base64' | 'hex'; part?: string; timestamp?: Timestamp | { part: string; toleranceSeconds?: number } }
  | { kind: 'ed25519'; header: string; signed?: Template; timestamp?: Timestamp }
  | { kind: 'token'; header: string }
  | { kind: 'standard' }
  | { kind: 'basic' }
) & { deliveryId?: { header: string } | { body: readonly Path[] }; challenge?: { when: When; echo: string } };
export type Where = { query: string } | { body: string };
/** `page`: no number first, then 2, 3 (`zeroBased`: 1, 2) in `send`'s place, until `more` is falsy or `list` (the
 * answer when absent) is empty; a missing or non-list `list` is `invalid_response`. `offset`: as `page`, the next value
 * the offset sent (0 first) plus the entries in `list`. `linkHeader`, `nextUrl`: the `Link` header's `rel="next"`, or
 * the value at `next`, read on the base's origin when a path, and kept under the base's path and `pathPrefix`. */
export type Paging = { kind: 'cursor'; next: Path; more?: Path; send: Where }
  | { kind: 'page'; send: Where; list?: Path; more?: Path; zeroBased?: true }
  | { kind: 'offset'; send: Where; list?: Path; more?: Path }
  | { kind: 'linkHeader'; pathPrefix?: string } | { kind: 'nextUrl'; next: Path;
  /** A whole directory after the base's path, starting and ending with `/` (`/me/`). */
  pathPrefix?: string };
/** A value's declared type. In an object, a key ending in `?` may be missing or null, and is read as absent. */
export type Shape = 'string' | 'integer' | 'number' | 'boolean' | 'unknown' | readonly [Shape] | { readonly [key: string]: Shape };
/** An operation's argument and where it is sent: `body` in a JSON object, `form` in a form-encoded body (never beside a
 * `body` one); `nullable` lets it be sent as JSON `null`. */
export type Param = { in: 'path' | 'query' | 'body' | 'form' | 'variables'; type: Shape; required?: true; nullable?: true;
  enum?: readonly string[]; description?: string };
/** A named read or write. `kind` defaults from the method; `paging` names an entry's shape, `records` the list in a page.
 * `anyOf`: sets of argument paths (`email`, `contact.email`), of which a call gives every one of at least one set. */
export type Operation = ({ method?: Method; path: Template } | { graphql: string }) & { docs?: string;
  kind?: 'read' | 'write' | 'delete'; params?: Readonly<Record<string, Param>>; result?: Shape; records?: Path;
  paging?: string; notFound?: 'null'; anyOf?: readonly (readonly Path[])[] };
/** What a provider is for: a closed list of 20; a new value arrives with the first entry that needs it. */
export type Category = 'tasks' | 'docs' | 'chat' | 'code' | 'monitoring' | 'crm' | 'sales' | 'mail' | 'calendar' | 'meetings'
  | 'support' | 'marketing' | 'finance' | 'hr' | 'storage' | 'ecommerce' | 'phone' | 'design' | 'analytics' | 'search';
/** What a sign-in after the first may declare in place of the entry's; the first's part is the entry's top level. */
export type Own = { fields?: readonly Field[]; http?: Pick<Http, 'baseUrl' | 'host'>; identify?: Identify };
/** What an entry declares. Only `id`, `name`, `auth` and `http.baseUrl` are required. `categories`: the first is the main one. */
export type Entry = { id: string; name: string; docs?: string; categories?: readonly Category[];
  fields?: readonly Field[]; auth: readonly [Auth & { [K in keyof Own]?: never }, ...(Auth & Own)[]];
  scopes?: { default: readonly string[]; requireGranted?: true }; identify?: Identify;
  save?: Readonly<Record<string, Value>>; revoke?: Revoke; http: Http; errors?: Errors; webhook?: Webhook;
  paging?: Readonly<Record<string, Paging>>; operations?: Readonly<Record<string, Operation>> };

/** The scalar each shape name stands for. */
type Scalars = { string: string; integer: number; number: number; boolean: boolean; unknown: unknown };
/** An optional shape key without its `?`; never for a required one. */
type OptionalKey<K> = K extends `${infer N}?` ? N : never;
/** The TypeScript type a shape declares: a `key?` is optional, never null (a null is read as absent). */
export type TypeOf<S> = S extends keyof Scalars ? Scalars[S] : S extends readonly [infer E] ? TypeOf<E>[]
  : { -readonly [K in keyof S as Exclude<K, `${string}?`>]: TypeOf<S[K]> } & { -readonly [K in keyof S as OptionalKey<K>]?: TypeOf<S[K]> };
/** The client's own calls: an operation id whose first segment EQUALS one is refused (`'requests.create'` is fine), and
 * so is `then` itself, which would make the client a thenable. `clashing` in rules.ts is the run time's copy. */
type Reserved = 'json' | 'request' | 'paginate';
type Unreserved<Ops> = { [K in keyof Ops]: K extends Reserved | `${Reserved}.${string}` | 'then'
  ? "json, request, paginate and then are the client's own: rename this operation" : Ops[K] };
/** The `{name}`s of a path template. */
type PathParams<P> = P extends `${string}{${infer N}}${infer R}` ? N | PathParams<R> : never;
/** Each `{name}` of an operation's path is a required `path` parameter, and its `paging` a shape the entry declares. */
type Declared<Ops, Pagings> = { [K in keyof Ops]: (Ops[K] extends { path: infer P } ? [PathParams<P>] extends [never] ? unknown
  : { params: { [N in PathParams<P> & string]: { in: 'path'; required: true } } } : unknown)
  & (Ops[K] extends { paging: infer G } ? G extends keyof Pagings ? unknown : 'paging names no shape this entry declares' : unknown) };

/** One provider, as plain data. The literal's type is kept, so a client's types are inferred from it. */
export function defineProvider<const D extends Entry>(
  data: D & { operations?: Unreserved<D['operations']> & Declared<D['operations'], D['paging']> }): D { return data; }

/** The entry's declared fields, one union member each; none for an entry that declares none. */
type Fields<E extends Entry> = E extends { fields?: readonly (infer F)[] } ? F : never;
/** Whether the types do not know the entry's field names (a widened `Entry`, or fields typed `readonly Field[]`). */
type Unnamed<E extends Entry> = string extends Fields<E>['name'] ? true : false;
/** A record keyed by `K`, or by any string when the entry's field names are unknown. */
type Keyed<E extends Entry, K extends string, V> = Unnamed<E> extends true ? Readonly<Record<string, V>> : Readonly<Record<K, V>>;
/** The names `save` keeps, when the entry declares any. */
type Saved<E extends Entry> = E extends { save: infer S } ? keyof S & string : never;
/** A form entry's secret fields, and its plain fields, by name. */
export type Secrets<E extends Entry> = Keyed<E, Extract<Fields<E>, { secret: true }>['name'], string>;
type PlainFields<E extends Entry> = Exclude<Fields<E>, { secret: true }>;
export type Plain<E extends Entry> = E extends Entry ? Keyed<E, PlainFields<E>['name'], string> : never;
/** The plain values a finish takes: a field with a default may be left out. */
export type Entered<E extends Entry> = Unnamed<E> extends true ? Values : Keyed<E, Exclude<PlainFields<E>, { default: string }>['name'], string>
  & Partial<Keyed<E, Extract<PlainFields<E>, { default: string }>['name'], string>>;
export type Kept<E extends Entry> = E extends Entry ? Unnamed<E> extends true ? Values : Plain<E> & { readonly [K in Saved<E>]?: unknown } : never;
/** `values` as an input takes them: required when one is, optional when none is or the names are unknown, else empty. */
export type ValuesOption<V> = V extends unknown ? [keyof V] extends [never] ? { values?: Readonly<Record<string, never>> }
  : string extends keyof V ? { values?: V } : Partial<V> extends V ? { values?: V } : { values: V } : never;

type Kinds<E extends Entry> = E['auth'][number]['kind'];
/** An entry narrowed to one sign-in: `scopes` and `revoke` belong to OAuth 2 alone, so a key or token sign-in drops them,
 * and a later sign-in's own `fields`, `identify` and `http` base and host stand in place of the entry's. A union of kinds
 * gives a union of narrowings, each with what its sign-in has. */
export type SignIn<E extends Entry, K extends Kinds<E>> = K extends unknown ? Extract<E['auth'][number], { kind: K }> extends infer S
  ? Omit<E, 'auth' | 'http' | (keyof S & ('fields' | 'identify')) | (K extends 'oauth2' ? never : 'scopes' | 'revoke')>
    & Pick<S, keyof S & ('fields' | 'identify')>
    & { http: S extends { http: infer H } ? Omit<E['http'], 'baseUrl' | 'host'> & Pick<H, keyof H & ('baseUrl' | 'host')> : E['http'];
      auth: readonly [Omit<S, keyof Own>] }
  : never : never;

/** The entry with `auth` narrowed to its sign-in of that kind; every engine function reads the first sign-in. A later
 * sign-in's own part replaces the entry's; the first's is left in place, for `checkHosts` to refuse. */
export function signInWith<const E extends Entry, K extends Kinds<E>>(entry: E, kind: K): SignIn<E, K> {
  const auth = entry.auth.find(item => item.kind === kind);
  if (auth === undefined) throw new TypeError(`sign_in_unknown: ${entry.id} ${kind}`);
  const kept = Object.entries(entry).filter(([name]) => kind === 'oauth2' || (name !== 'scopes' && name !== 'revoke'));
  const { fields, http, identify, ...bare } = auth;
  // An own `http` gives only a base and its host pattern; the entry's headers, bases and retry stay.
  const shared = Object.fromEntries(Object.entries(entry.http).filter(([name]) => name !== 'host'));
  const based = http && { http: { ...shared, baseUrl: http.baseUrl, ...http.host && { host: http.host } } };
  const own = auth === entry.auth[0] ? { auth: [auth] } : { ...fields && { fields }, ...identify && { identify }, ...based, auth: [bare] };
  return { ...Object.fromEntries(kept), ...own } as unknown as SignIn<E, K>;
}
