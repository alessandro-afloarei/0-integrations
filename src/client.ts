import { callRequest } from './account.js';
import type { Entry, Operation, Param, Shape, TypeOf } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { createClient, type HttpOptions, type ProviderResponse, type RequestOptions } from './http.js';
import { walk } from './paging.js';
import { parseAnswer, parseEntries } from './parse.js';
import { fill, placeholders, readPath, shapeAt } from './rules.js';

/** An argument's type: one of its `enum`, else its shape's, and `null` when it is `nullable`. */
type ArgOf<P> = (P extends { enum: readonly (infer E)[] } ? E : P extends { type: infer S } ? TypeOf<S> : never)
  | (P extends { nullable: true } ? null : never);
/** An operation's arguments: the required ones required, the rest optional. */
type Args<O> = O extends { params: infer Ps }
  ? { -readonly [K in keyof Ps as Ps[K] extends { required: true } ? K : never]: ArgOf<Ps[K]> }
    & { -readonly [K in keyof Ps as Ps[K] extends { required: true } ? never : K]?: ArgOf<Ps[K]> }
  : Record<string, never>;
/** A call's arguments and options; the arguments may be left out when none is required. */
type Call<O> = [args: Args<O>, options?: Pick<RequestOptions, 'signal'>];
/** The type at a dotted path of object keys, the whole rest tried as one key first, as `readPath` reads keys. */
type Get<T, P> = P extends keyof T ? T[P] : P extends `${infer H}.${infer R}` ? H extends keyof T ? Get<T[H], R> : never : never;
/** An operation's answer: its `result`'s type, else unknown. */
type Result<O> = O extends { result: infer S } ? TypeOf<S> : unknown;
/** One record of a paged operation: an element of the list at `records`. */
type Item<O> = O extends { records: infer P } ? Get<Result<O>, P> extends readonly (infer E)[] ? E : unknown : unknown;
/** An operation as a method: a paged one yields its records and returns the skipped records' ids. */
type MethodOf<O> = (...call: Record<string, never> extends Args<O> ? Partial<Call<O>> : Call<O>) => O extends { paging: string }
  ? AsyncGenerator<Item<O>, (string | null)[], undefined> : Promise<Result<O> | (O extends { notFound: 'null' } ? null : never)>;
/** An operation id's first dot-separated segment: `'issues'` of `'issues.list'`. */
type Head<K> = K extends `${infer H}.${string}` ? H : K;
/** Dotted ids as nested objects: `'issues.list'` is `issues.list`. */
type Nest<T> = { [K in keyof T as Head<K & string>]: K extends `${infer H}.${string}`
  ? Nest<{ [J in keyof T as J extends `${H}.${infer R}` ? R : never]: T[J] }> : T[K] };

/** The typed client of an entry: its operations, nested by id, and the raw calls. */
export type Client<E extends Entry> = Nest<{ [K in keyof E['operations']]: MethodOf<E['operations'][K]> }> & {
  json(path: string, options?: RequestOptions): Promise<unknown>;
  request(path: string, options?: RequestOptions): Promise<ProviderResponse>;
  paginate(paging: keyof NonNullable<E['paging']> & string, path: string, options?: RequestOptions): AsyncGenerator<unknown, void, undefined> };

/** `createClient`'s options, with `token` also a plain string (a missing or blank one is refused at once) and the global
 * `fetch` by default. */
export type ClientOptions = Omit<HttpOptions, 'token' | 'fetch'> & { token: string | undefined | HttpOptions['token']; fetch?: typeof fetch };
type Given = Readonly<Record<string, unknown>>;

const INVALID = Symbol('invalid');
/** A value read by its shape: declared keys only, a `key?` missing or null left out; INVALID when it does not fit. */
function shaped(shape: Shape, value: unknown): unknown {
  if (typeof shape === 'string') {
    return shape === 'unknown' || (shape === 'integer' ? Number.isSafeInteger(value) : typeof value === shape) ? value : INVALID;
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

/** The request an operation's arguments make: each declared one checked by its shape and sent in its place. */
function operationRequest(id: string, op: Operation, args: Given, signal?: AbortSignal): [string, RequestOptions] {
  const at: Record<Param['in'], [string, unknown][]> = { path: [], query: [], body: [], variables: [] };
  for (const [name, param] of Object.entries(op.params ?? {})) {
    if ('graphql' in op ? param.in !== 'variables' : param.in === 'variables' || (param.in === 'path' && !placeholders(op.path).includes(name))) {
      refuse(`param_unplaced: ${id} ${name}`);
    }
    const value = Object.hasOwn(args, name) ? args[name] : undefined;
    if (value === undefined || (value === null && param.nullable !== true)) {
      if (param.required) refuse(`param_missing: ${name}`);
      continue;
    }
    const checked = value === null ? null : shaped(param.type, value);
    const scalar = typeof checked === 'string' || typeof checked === 'number' || typeof checked === 'boolean';
    // A path value is one segment: never empty or a dot segment, which the URL would resolve away.
    if (checked === INVALID || (param.enum !== undefined && !(typeof checked === 'string' && param.enum.includes(checked)))
      || (param.in === 'path' || param.in === 'query') && !scalar
      || (param.in === 'path' && ['', '.', '..'].includes(String(checked)))) refuse(`param_invalid: ${name}`);
    at[param.in].push([name, checked]);
  }
  const inPath = new Map(at.path.map(([name, value]) => [name, encodeURIComponent(String(value))]));
  // A read is what the engine retries: a GET unless `kind` says otherwise (GraphQL is a POST, so a write by default).
  const read = op.kind === undefined ? !('graphql' in op) && (op.method ?? 'GET') === 'GET' : op.kind === 'read';
  return callRequest('graphql' in op ? { graphql: op.graphql }
    : { method: op.method ?? 'GET', path: fill(op.path, name => inPath.get(name) ?? refuse(`param_missing: ${name}`), id) }, {
    ...(at.query.length > 0 ? { query: Object.fromEntries(at.query.map(([name, value]) => [name, String(value)])) } : {}),
    ...(at.body.length > 0 ? { json: Object.fromEntries(at.body) } : {}),
    variables: Object.fromEntries(at.variables), idempotent: read, ...(signal ? { signal } : {}) });
}

/** The client of an entry: its operations, nested by id, and `json`, `request` and `paginate` for raw calls. */
export function client<const E extends Entry>(entry: E, options: ClientOptions): Client<E> {
  const { token } = options;
  if (token === undefined || (typeof token === 'string' && token.trim() === '')) refuse('token_missing');
  const http = createClient(entry, { ...options, token: typeof token === 'string' ? () => Promise.resolve(token) : token,
    fetch: options.fetch ?? globalThis.fetch });
  const pagingOf = (name: string) => (entry.paging !== undefined && Object.hasOwn(entry.paging, name) ? entry.paging[name] : undefined)
    ?? refuse(`paging_unknown: ${name}`);

  function operation(id: string, op: Operation) {
    const { paging, records, result } = op;
    if (paging === undefined) {
      return async (args: Given = {}, { signal }: Pick<RequestOptions, 'signal'> = {}) => {
        try {
          const answer = await http.json(...operationRequest(id, op, args, signal));
          return result === undefined ? answer : parseAnswer(schemaOf(result), answer);
        } catch (error) {
          if (op.notFound === 'null' && error instanceof ProviderHttpError && error.code === 'not_found') return null;
          throw error;
        }
      };
    }
    // Each page's records, a bad one skipped and its id reported; without `records`, each page's whole answer.
    return async function* (args: Given = {}, { signal }: Pick<RequestOptions, 'signal'> = {}) {
      const shape = pagingOf(paging);
      const list = records === undefined || result === undefined ? ['unknown'] as const : shapeAt(result, records);
      if (!Array.isArray(list)) refuse(`records_unshaped: ${id}`);
      const skipped: (string | null)[] = [];
      for await (const answer of walk(http, shape, ...operationRequest(id, op, args, signal))) {
        if (records === undefined) { yield result === undefined ? answer : parseAnswer(schemaOf(result), answer); continue; }
        const found = readPath(answer, records);
        if (!Array.isArray(found)) throw new ProviderHttpError('invalid_response', null);
        const page = parseEntries(schemaOf((list as readonly [Shape])[0]), found);
        skipped.push(...page.skipped);
        yield* page.items;
      }
      return skipped;
    };
  }

  // Containers without a prototype, so an id such as `__proto__.x` stays an own key.
  const api: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [id, op] of Object.entries(entry.operations ?? {})) {
    const segments = id.split('.');
    const last = segments.pop() ?? id;
    let at = api;
    for (const segment of segments) at = (at[segment] ??= Object.create(null)) as Record<string, unknown>;
    at[last] = operation(id, op);
  }
  return Object.assign(api, { json: (path: string, options?: RequestOptions) => http.json(path, options),
    request: (path: string, options?: RequestOptions) => http.request(path, options),
    paginate: (name: string, path: string, options?: RequestOptions) => walk(http, pagingOf(name), path, options) }) as unknown as Client<E>;
}
