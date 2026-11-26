import type { Entry, TypeOf } from './catalogue.js';
import type { ProviderResponse, RequestOptions } from './http.js';

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
