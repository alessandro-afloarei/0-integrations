import type { Entry, Operation, Shape, TypeOf } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { callRequest, createClient, type HttpOptions, type ProviderResponse, type RequestOptions } from './http.js';
import { responseJson } from './http-response.js';
import { walk } from './paging.js';
import { parseAnswer, parseEntries } from './parse.js';
import { clashing, fill, placed, readPath, shapeAt } from './rules.js';

export type { ProviderResponse, RequestOptions };

/** An argument's type: one of its `enum`, else its shape's, and `null` when it is `nullable`. */
type ArgOf<P> = (P extends { enum: readonly (infer E)[] } ? E : P extends { type: infer S } ? TypeOf<S> : never)
  | (P extends { nullable: true } ? null : never);
/** An operation's arguments: the required ones required, the rest optional. */
type Args<O> = O extends { params: infer Ps }
  ? { -readonly [K in keyof Ps as Ps[K] extends { required: true } ? K : never]: ArgOf<Ps[K]> }
    & { -readonly [K in keyof Ps as Ps[K] extends { required: true } ? never : K]?: ArgOf<Ps[K]> }
  : Record<string, never>;
/** A paged operation's own option: called once for each page that skipped a record, with what it skipped. */
type Paged = { onSkipped?: (ids: (string | null)[]) => void };
/** A call's arguments and options; the arguments may be left out when none is required. */
type CallArgs<O> = [args: Args<O>, options?: Pick<RequestOptions, 'signal'> & (O extends { paging: string } ? Paged : unknown)];
/** The type at a dotted path of object keys, the whole rest tried as one key first, as `readPath` reads keys. */
type Get<T, P> = P extends keyof T ? T[P] : P extends `${infer H}.${infer R}` ? H extends keyof T ? Get<T[H], R> : never : never;
/** An operation's answer: its `result`'s type, else unknown. */
type Result<O> = O extends { result: infer S } ? TypeOf<S> : unknown;
/** One record of a paged operation: an element of the list at `records`. */
type Item<O> = O extends { records: infer P } ? Get<Result<O>, P> extends readonly (infer E)[] ? E : unknown : unknown;
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
 * and the global `fetch` by default. */
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
  const at = { path: bare(), query: bare(), body: bare(), variables: bare() };
  for (const [name, param] of Object.entries(op.params ?? {})) {
    const value = Object.hasOwn(args, name) ? args[name] : undefined;
    if (value === undefined || (value === null && param.nullable !== true)) {
      if (param.required) refuse(`param_missing: ${name}`);
      continue;
    }
    const checked = value === null ? null : shaped(param.type, value);
    const scalar = typeof checked === 'string' || typeof checked === 'number' || typeof checked === 'boolean';
    // A path value is one segment: never empty or a dot segment, which the URL would resolve away.
    if (checked === INVALID || (checked !== null && param.enum !== undefined && !(typeof checked === 'string' && param.enum.includes(checked)))
      || (param.in === 'path' || param.in === 'query') && !scalar
      || (param.in === 'path' && ['', '.', '..'].includes(String(checked)))) refuse(`param_invalid: ${name}`);
    at[param.in][name] = param.in === 'body' || param.in === 'variables' ? checked
      : param.in === 'path' ? encodeURIComponent(String(checked)) : String(checked);
  }
  // A read is what the engine retries: a GET unless `kind` says otherwise (GraphQL is a POST, so a write by default).
  const read = op.kind === undefined ? !('graphql' in op) && (op.method ?? 'GET') === 'GET' : op.kind === 'read';
  return callRequest('graphql' in op ? { graphql: op.graphql }
    : { method: op.method ?? 'GET', path: fill(op.path, name => at.path[name] ?? refuse(`param_missing: ${name}`), id) }, {
    ...(Object.keys(at.query).length > 0 ? { query: at.query as Record<string, string> } : {}),
    ...(Object.keys(at.body).length > 0 ? { json: at.body } : {}),
    variables: at.variables, idempotent: read, ...(signal ? { signal } : {}) });
}

/** The client of an entry: its operations, nested by id, and `json`, `request` and `paginate` for raw calls. A wrong
 * entry throws here, as the table test refuses one of this library's; a wrong argument throws when it is called. */
export function client<const E extends Entry>(entry: E, options: ClientOptions): Client<E> {
  const { token } = options;
  const operations = Object.entries(entry.operations ?? {});
  const clash = clashing(operations.map(([id]) => id));
  if (clash !== undefined) refuse(`operation_clash: ${clash}`);
  const http = createClient(entry, { ...options, token: typeof token === 'function' ? token : () => Promise.resolve(token ?? ''),
    fetch: options.fetch ?? globalThis.fetch });
  const pagingOf = (name: string) => (entry.paging !== undefined && Object.hasOwn(entry.paging, name) ? entry.paging[name] : undefined)
    ?? refuse(`paging_unknown: ${name}`);

  function operation(id: string, op: Operation) {
    const { paging, records, result } = op;
    for (const [name, param] of Object.entries(op.params ?? {})) if (!placed(op, name, param)) refuse(`param_unplaced: ${id} ${name}`);
    if (paging === undefined) {
      return async (args: Given = {}, { signal }: Pick<RequestOptions, 'signal'> = {}) => {
        try {
          const response = await http.request(...operationRequest(id, op, args, signal));
          // A 204 answers null when no result is declared; any other answer without JSON is `invalid_response`.
          if (result === undefined && response.status === 204) return null;
          const answer = responseJson(entry, response);
          return result === undefined ? answer : parseAnswer(schemaOf(result), answer);
        } catch (error) {
          if (op.notFound === 'null' && error instanceof ProviderHttpError && error.code === 'not_found') return null;
          throw error;
        }
      };
    }
    const shape = pagingOf(paging);
    const list = records === undefined || result === undefined ? ['unknown'] as const : shapeAt(result, records);
    const item = Array.isArray(list) ? (list as readonly [Shape])[0] : refuse(`records_unshaped: ${id}`);
    // Each page's records, a bad one skipped and reported; without `records`, each page's whole answer.
    return async function* (args: Given = {}, { signal, onSkipped }: Pick<RequestOptions, 'signal'> & Paged = {}) {
      for await (const answer of walk(http, shape, ...operationRequest(id, op, args, signal))) {
        if (records === undefined) { yield result === undefined ? answer : parseAnswer(schemaOf(result), answer); continue; }
        const found = readPath(answer, records);
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
