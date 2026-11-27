import type { Entry, Operation, Shape, TypeOf } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { callRequest, createClient, defaultFetch, type HttpOptions, type ProviderResponse, type RequestOptions } from './http.js';
import { classify, emptyAnswers, responseJson } from './http-response.js';
import { walk } from './paging.js';
import { parseAnswer, parseEntries } from './parse.js';
import { argumentShape, checkHosts, clashing, fill, pagedParam, pagedRecords, placed, readPath, shapeAt } from './rules.js';

export type { ProviderResponse, RequestOptions };
export { guardedFetch } from './guard.js';

/** An argument's type: one of its `enum`, else its shape's, and `null` when it is `nullable`. */
type ArgOf<P> = (P extends { enum: readonly (infer E)[] } ? E : P extends { type: infer S } ? TypeOf<S> : never)
  | (P extends { nullable: true } ? null : never);
/** An operation's arguments: the required ones required, the rest optional; one with a fixed `value` is none. */
type Args<O> = O extends { params: infer Ps } ? ArgsOf<{ [K in keyof Ps as Ps[K] extends { value: unknown } ? never : K]: Ps[K] }>
  : Record<string, never>;
type ArgsOf<Ps> = [keyof Ps] extends [never] ? Record<string, never>
  : { -readonly [K in keyof Ps as Ps[K] extends { required: true } ? K : never]: ArgOf<Ps[K]> }
    & { -readonly [K in keyof Ps as Ps[K] extends { required: true } ? never : K]?: ArgOf<Ps[K]> };
/** A paged operation's own option: called once for each page that skipped a record, with what it skipped. */
type Paged = { onSkipped?: (ids: (string | null)[]) => void };
/** A call's arguments and options; the arguments may be left out when none is required. */
type CallArgs<O> = [args: Args<O>, options?: Pick<RequestOptions, 'signal'> & (O extends { paging: string } ? Paged : unknown)];
/** The type at a dotted path of object keys, the whole rest tried as one key first, as `readPath` reads keys. */
type Get<T, P> = P extends keyof T ? T[P] : P extends `${infer H}.${infer R}` ? H extends keyof T ? Get<T[H], R> : never : never;
/** An operation's answer: its `result`'s type, else unknown. */
type Result<O> = O extends { result: infer S } ? TypeOf<S> : unknown;
/** What a paged operation yields: an element of the list at `records`, else of a list `result`, else each page's whole
 * answer. */
type Item<O> = O extends { records: infer P } ? Get<Result<O>, P> extends readonly (infer E)[] ? E : unknown
  : O extends { result: readonly [infer S] } ? TypeOf<S> : Result<O>;
/** An operation as a method: a paged one yields its records. */
type MethodOf<O> = (...call: Record<string, never> extends Args<O> ? Partial<CallArgs<O>> : CallArgs<O>) => O extends { paging: string }
  ? AsyncGenerator<Item<O>, void, undefined> : Promise<Result<O> | (O extends { notFound: 'null' } ? null : never)>;
/** Dotted ids as nested objects, by each id's first segment: `'issues.list'` is `issues.list`. */
type Nest<T> = { [K in keyof T as K extends `${infer H}.${string}` ? H : K]: K extends `${infer H}.${string}`
  ? Nest<{ [J in keyof T as J extends `${H}.${infer R}` ? R : never]: T[J] }> : T[K] };

/** The typed client of an entry: its operations, nested by id, and the raw calls. */
export type Client<E extends Entry> = Nest<{ [K in keyof E['operations']]: MethodOf<E['operations'][K]> }> & {
  json(path: string, options?: RequestOptions): Promise<unknown>;
  request(path: string, options?: RequestOptions): Promise<ProviderResponse>;
  paginate(paging: keyof NonNullable<E['paging']> & string, path: string, options?: RequestOptions): AsyncGenerator<unknown, void, undefined> };

/** `createClient`'s options, with `token` also a plain string (a missing or blank one is refused when a request needs it)
 * and `fetch` by default the global one, or `guardedFetch` for an entry whose host is typed (`http.host: '*'`). */
export type ClientOptions = Omit<HttpOptions, 'token' | 'fetch'> & { token: string | undefined | HttpOptions['token']; fetch?: typeof fetch };
type Given = Readonly<Record<string, unknown>>;

const INVALID = Symbol('invalid');
/** A value read by its shape: declared keys only, a `key?` missing or null left out; INVALID when it does not fit. */
function shaped(shape: Shape, value: unknown): unknown {
  if (typeof shape === 'string') {
    const fits = shape === 'integer' ? Number.isSafeInteger(value) : shape === 'number' ? Number.isFinite(value) : typeof value === shape;
    return shape === 'unknown' || fits ? value : INVALID;
  }
  if (Array.isArray(shape)) {
    const items = Array.isArray(value) ? value.map(item => shaped((shape as readonly [Shape])[0], item)) : [INVALID];
    return items.includes(INVALID) ? INVALID : items;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return INVALID;
  const kept: [string, unknown][] = [];
  for (const [key, inner] of Object.entries(shape)) {
    const name = key.endsWith('?') ? key.slice(0, -1) : key;
    const found = Object.hasOwn(value, name) ? (value as Given)[name] : undefined;
    if (name !== key && (found === undefined || found === null)) continue;
    const read = Object.hasOwn(value, name) ? shaped(inner, found) : INVALID;
    if (read === INVALID) return INVALID;
    kept.push([name, read]);
  }
  return Object.fromEntries(kept);
}
const schemaOf = (shape: Shape) => ({ safeParse(data: unknown) {
  const value = shaped(shape, data);
  return value === INVALID ? { success: false as const } : { success: true as const, data: value };
} });

function refuse(cause: string): never { throw new TypeError(cause); }
/** A record with no prototype, so a key such as `__proto__` stays an own key. */
const bare = () => Object.create(null) as Record<string, unknown>;

/** The request an operation's arguments make: each declared one checked by its shape and sent in its place. */
function operationRequest(id: string, op: Operation, args: Given, signal?: AbortSignal): [string, RequestOptions] {
  const at = { path: bare(), query: bare(), body: bare(), form: bare(), variables: bare(), header: bare() };
  const given = bare(); // each argument as checked, for `anyOf`
  for (const [name, param] of Object.entries(op.params ?? {})) {
    // A fixed value is checked and sent as an argument is; the caller's own of that name is not read.
    const value = param.value ?? (Object.hasOwn(args, name) ? args[name] : undefined);
    if (value === undefined || (value === null && param.nullable !== true)) {
      if (param.required) refuse(`param_missing: ${name}`);
      continue;
    }
    const checked = value === null ? null : shaped(param.type, value);
    const scalar = typeof checked === 'string' || typeof checked === 'number' || typeof checked === 'boolean';
    // A path value is one segment: never empty or a dot segment, which the URL would resolve away. A header value is
    // printable ASCII, space and tab: a CR or an LF would end the header.
    if (checked === INVALID || (checked !== null && param.enum !== undefined && !(typeof checked === 'string' && param.enum.includes(checked)))
      || (param.in === 'path' || param.in === 'query' || param.in === 'form' || param.in === 'header') && !scalar
      || (param.in === 'header' && !/^[\t\x20-\x7e]*$/u.test(String(checked)))
      || (param.in === 'path' && ['', '.', '..'].includes(String(checked)))) refuse(`param_invalid: ${name}`);
    given[name] = checked;
    at[param.in][name] = param.in === 'body' || param.in === 'variables' ? checked
      : param.in === 'path' ? encodeURIComponent(String(checked)) : String(checked);
  }
  const blank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  if (op.anyOf !== undefined && !op.anyOf.some(set => set.every(path => !blank(readPath(given, path))))) refuse(`param_group_missing: ${id}`);
  // A read is what the engine retries: a GET unless `kind` says otherwise (GraphQL is a POST, so a write by default).
  const read = op.kind === undefined ? !('graphql' in op) && (op.method ?? 'GET') === 'GET' : op.kind === 'read';
  return callRequest('graphql' in op ? { graphql: op.graphql }
    : { method: op.method ?? 'GET', path: fill(op.path, name => at.path[name] ?? refuse(`param_missing: ${name}`), id) }, {
    ...(Object.keys(at.query).length > 0 ? { query: at.query as Record<string, string> } : {}),
    ...(Object.keys(at.header).length > 0 ? { headers: at.header as Record<string, string> } : {}),
    // A provider may require a JSON body whose every field is optional: an operation with a body parameter always sends one.
    // One operation never declares both (`param_unplaced`).
    ...(Object.values(op.params ?? {}).some(param => param.in === 'body') ? { json: at.body }
      : Object.values(op.params ?? {}).some(param => param.in === 'form') ? { form: at.form as Record<string, string> } : {}),
    variables: at.variables, idempotent: read, ...(signal ? { signal } : {}) });
}

/** The client of an entry: its operations, nested by id, and `json`, `request` and `paginate` for raw calls. A wrong
 * entry throws here, as the table test refuses one of this library's; a wrong argument throws when it is called. */
export function client<const E extends Entry>(entry: E, options: ClientOptions): Client<E> {
  checkHosts(entry, options.values); // before the token is read
  const { token } = options;
  const operations = Object.entries(entry.operations ?? {});
  const clash = clashing(operations.map(([id]) => id));
  if (clash !== undefined) refuse(`operation_clash: ${clash}`);
  const http = createClient(entry, { ...options, token: typeof token === 'function' ? token : () => Promise.resolve(token ?? ''),
    fetch: options.fetch ?? defaultFetch(entry) });
  const pagingOf = (name: string) => (entry.paging !== undefined && Object.hasOwn(entry.paging, name) ? entry.paging[name] : undefined)
    ?? refuse(`paging_unknown: ${name}`);

  function operation(id: string, op: Operation) {
    const { paging, records, result } = op;
    for (const [name, param] of Object.entries(op.params ?? {})) if (!placed(entry, op, name, param)) refuse(`param_unplaced: ${id} ${name}`);
    for (const path of op.anyOf?.flat() ?? []) if (argumentShape(op, path) === undefined) refuse(`param_group_unknown: ${id} ${path}`);
    // An empty set is always given whole, so it would let every call through.
    if (op.anyOf?.length === 0 || op.anyOf?.some(set => set.length === 0)) refuse(`param_group_unknown: ${id}`);
    if (paging === undefined) {
      return async (args: Given = {}, { signal }: Pick<RequestOptions, 'signal'> = {}) => {
        try {
          const response = await http.request(...operationRequest(id, op, args, signal));
          // An empty 2xx answers null when no result is declared; any other answer without JSON is `invalid_response`.
          if (result === undefined && emptyAnswers.has(response) && classify(entry, response) === null) return null;
          const answer = responseJson(entry, response);
          return result === undefined ? answer : parseAnswer(schemaOf(result), answer);
        } catch (error) {
          if (op.notFound === 'null' && error instanceof ProviderHttpError && error.code === 'not_found') return null;
          throw error;
        }
      };
    }
    const shape = op.notFound === undefined ? pagingOf(paging) : refuse(`not_found_paged: ${id}`);
    if (!pagedRecords(op, shape)) refuse(`records_unpaged: ${id}`);
    const sent = pagedParam(op, shape);
    if (sent !== undefined) refuse(`param_paged: ${id} ${sent}`);
    // The records: the list at `records`, or a list `result` itself (a list at the answer's top level).
    const list = records === undefined ? result : result === undefined ? ['unknown'] as const : shapeAt(result, records);
    const item = Array.isArray(list) ? (list as readonly [Shape])[0] : records === undefined ? undefined : refuse(`records_unshaped: ${id}`);
    // Each page's records, a bad one skipped and reported; with none, each page's whole answer.
    return async function* (args: Given = {}, { signal, onSkipped }: Pick<RequestOptions, 'signal'> & Paged = {}) {
      for await (const answer of walk(http, shape, ...operationRequest(id, op, args, signal))) {
        if (item === undefined) { yield result === undefined ? answer : parseAnswer(schemaOf(result), answer); continue; }
        const found = records === undefined ? answer : readPath(answer, records);
        if (!Array.isArray(found)) throw new ProviderHttpError('invalid_response', null);
        const page = parseEntries(schemaOf(item), found);
        if (page.skipped.length > 0) onSkipped?.(page.skipped);
        yield* page.items;
      }
    };
  }

  // The ids passed `clashing`, so every container below is one this loop made; none has a prototype to climb.
  const api = bare();
  for (const [id, op] of operations) {
    const segments = id.split('.');
    const last = segments.pop() ?? id;
    let at = api;
    for (const segment of segments) at = (at[segment] ??= bare()) as Record<string, unknown>;
    at[last] = operation(id, op);
  }
  return Object.assign(api, { json: (path: string, options?: RequestOptions) => http.json(path, options),
    request: (path: string, options?: RequestOptions) => http.request(path, options),
    paginate: (name: string, path: string, options?: RequestOptions) => walk(http, pagingOf(name), path, options) }) as unknown as Client<E>;
}
