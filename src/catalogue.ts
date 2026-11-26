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
export type Field = { name: string; title: string; secret?: true };
/** How the credential travels. None: `authorization: Bearer {token}`. A header alone: the bare `{token}`. */
export type Send = { header: string } | { basic: readonly [Template, Template] };
export type Auth =
  | { kind: 'key'; send?: Send }
  | { kind: 'oauth2'; authorizeUrl: string; tokenUrl: string; pkce?: false; clientAuth?: 'basic'; scopeSeparator?: ',';
    authorizeParams?: Readonly<Record<string, string>>; tokenTypes?: readonly string[]; failed?: When; reusesGrant?: true };
export type Call = { method?: Method; path?: Template; query?: Readonly<Record<string, string>>; graphql?: string };
/** A path, the first present of several paths, or a template (a string with braces) over the same lookup. */
export type Value = Path | readonly Path[];
export type Identify = { request?: Call; id?: Value; name?: Value; lowercase?: true;
  /** Answers that mean a bad credential whatever their status; `detail` is the detail the error reports. */
  rejectWhen?: readonly (Omit<When, 'detail'> & { detail?: string })[] };
export type Revoke = ({ url: string; token: readonly ('refresh' | 'access')[] } | { request: Call })
  & { goneErrors?: readonly string[] };
export type Retry = { limit?: number; maxWaitMs?: number; defaultWaitMs?: number;
  waitFromBody?: { path: Path; unit: 'ms' | 'epochMs' } };
export type RateLimit = { when: readonly (When & { resetAt?: { header: string; unit: 'epochSeconds' } })[];
  defaultWaitMs?: number };
export type Http = { baseUrl: string; bases?: Readonly<Record<string, string>>; headers?: Readonly<Record<string, string>>;
  timeoutMs?: number; minIntervalMs?: number; retry?: Retry; rateLimit?: RateLimit };
export type Errors = { detail?: Path | readonly Path[]; allow?: readonly string[]; failed?: When;
  revoked?: readonly string[]; rules?: readonly { when: When; code: ProviderErrorCode; detail?: string }[] };
export type Webhook = { kind: 'hmac'; header: string; signed?: Template; prefix?: string; encoding?: 'base64';
  timestamp?: { header: string; toleranceSeconds?: number };
  deliveryId?: { header: string } | { body: readonly Path[] } };
export type Where = { query: string } | { body: string };
export type Paging = { kind: 'cursor'; next: Path; more?: Path; send: Where } | { kind: 'nextUrl'; next: Path;
  /** A whole directory after the base's path, starting and ending with `/` (`/me/`). */
  pathPrefix?: string };
/** A value's declared type. In an object, a key ending in `?` may be missing or null, and is read as absent. */
export type Shape = 'string' | 'integer' | 'number' | 'boolean' | 'unknown' | readonly [Shape] | { readonly [key: string]: Shape };
/** An operation's argument and where it is sent; `nullable` lets it be sent as JSON `null`. */
export type Param = { in: 'path' | 'query' | 'body' | 'variables'; type: Shape; required?: true; nullable?: true;
  enum?: readonly string[]; description?: string };
/** A named read or write. `kind` defaults from the method; `paging` names an entry's shape, `records` the list in a page. */
export type Operation = ({ method?: Method; path: Template } | { graphql: string }) & {
  kind?: 'read' | 'write' | 'delete'; params?: Readonly<Record<string, Param>>; result?: Shape; records?: Path;
  paging?: string; notFound?: 'null' };
/** What an entry declares. Only `id`, `name`, `auth` and `http.baseUrl` are required. */
export type Entry = { id: string; name: string; fields?: readonly Field[]; auth: readonly [Auth, ...Auth[]];
  scopes?: { default: readonly string[]; requireGranted?: true }; identify?: Identify;
  save?: Readonly<Record<string, Value>>; revoke?: Revoke; http: Http; errors?: Errors; webhook?: Webhook;
  paging?: Readonly<Record<string, Paging>>; operations?: Readonly<Record<string, Operation>> };

/** The scalar each shape name stands for. */
type Scalars = { string: string; integer: number; number: number; boolean: boolean; unknown: unknown };
/** An optional shape key without its `?`; never for a required one. */
type OptionalKey<K> = K extends `${infer N}?` ? N : never;
/** A required shape key; never for an optional one. */
type RequiredKey<K> = K extends `${string}?` ? never : K;
/** The TypeScript type a shape declares: a `key?` is optional, never null (a null is read as absent). */
export type TypeOf<S> = S extends keyof Scalars ? Scalars[S] : S extends readonly [infer E] ? TypeOf<E>[]
  : { -readonly [K in keyof S as RequiredKey<K>]: TypeOf<S[K]> } & { -readonly [K in keyof S as OptionalKey<K>]?: TypeOf<S[K]> };
/** An operation id's first dot-separated segment: `'issues'` of `'issues.list'`. */
export type Head<K> = K extends `${infer H}.${string}` ? H : K;
/** The client's own calls: an operation id whose first segment EQUALS one is refused (`'requests.create'` is fine). */
type Reserved = 'json' | 'request' | 'paginate';
type Unreserved<Ops> = { [K in keyof Ops]: Head<K & string> extends Reserved ? never : Ops[K] };
/** The `{name}`s of a path template. */
type PathParams<P> = P extends `${string}{${infer N}}${infer R}` ? N | PathParams<R> : never;
/** Each `{name}` of an operation's path must be a required `path` parameter. */
type PathsDeclared<Ops> = { [K in keyof Ops]: Ops[K] extends { path: infer P } ? [PathParams<P>] extends [never] ? unknown
  : { params: { [N in PathParams<P> & string]: { in: 'path'; required: true } } } : unknown };

/** One provider, as plain data. The literal's type is kept, so a client's types are inferred from it. */
export function defineProvider<const D extends Entry>(
  data: D & { operations?: Unreserved<D['operations']> & PathsDeclared<D['operations']> }): D { return data; }
