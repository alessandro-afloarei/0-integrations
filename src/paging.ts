import type { Paging, Where } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import type { HttpClient, RequestOptions } from './http.js';
import { paginate } from './paginate.js';
import { readPath } from './rules.js';

type Cursor = Extract<Paging, { kind: 'cursor' }>;
type NextUrl = Extract<Paging, { kind: 'nextUrl' }>;

/** The next cursor, or null on the last page: with `more`, a falsy one ends the list and a truthy one needs a cursor;
 * without it, a blank cursor ends the list. */
export function nextCursor(shape: Cursor, answer: unknown): string | null {
  const next = readPath(answer, shape.next);
  const cursor = typeof next === 'string' && next !== '' ? next : null;
  if (shape.more === undefined) return cursor;
  if (!readPath(answer, shape.more)) return null;
  if (cursor === null) throw new ProviderHttpError('invalid_response', null, 'cursor_missing');
  return cursor;
}

/** An address on the base's origin, under the base's path as a whole segment and under `pathPrefix` (or, with no
 * `pathPrefix`, the base's path itself), read as it resolves (dot segments, `%2e%2e`), as the path after the base with
 * its search; null for any other. */
export function ownPath(shape: NextUrl, baseUrl: string, address: string): string | null {
  if (!URL.canParse(address)) return null;
  const base = new URL(baseUrl);
  const root = base.pathname.replace(/\/$/u, ''); // an origin-only base's path is `/`
  const url = new URL(address);
  const rest = url.pathname.slice(root.length);
  const under = rest.startsWith('/') ? rest.startsWith(shape.pathPrefix ?? '/') : rest === '' && shape.pathPrefix === undefined;
  return url.origin === base.origin && url.pathname.startsWith(root) && under ? rest + url.search : null;
}

/** The next page's path after the base, or null when the answer names none; a link that leaves is `next_link_foreign`. */
export function nextLink(shape: NextUrl, baseUrl: string, answer: unknown): string | null {
  const next = readPath(answer, shape.next);
  if (next === undefined || next === null) return null;
  const path = typeof next === 'string' ? ownPath(shape, baseUrl, next) : null;
  if (path === null) throw new ProviderHttpError('invalid_response', null, 'next_link_foreign');
  return path;
}

function withCursor(where: Where, options: RequestOptions, cursor: string): RequestOptions {
  if ('query' in where) return { ...options, query: { ...options.query, [where.query]: cursor } };
  const body = typeof options.json === 'object' && options.json !== null ? options.json : {};
  return { ...options, json: { ...body, [where.body]: cursor } };
}

/** Every page's answer, in order, until the shape names no next page; a cursor that comes back is `cursor_repeated`. */
export async function* walk(http: HttpClient, shape: Paging, path: string, options: RequestOptions = {}): AsyncGenerator<unknown, void, undefined> {
  const load = shape.kind === 'cursor'
    ? async (cursor: string | undefined) => {
      const answer = await http.json(path, cursor === undefined ? options : withCursor(shape.send, options, cursor));
      return { items: [answer], skipped: [], cursor: nextCursor(shape, answer) };
    }
    : async (link: string | undefined) => {
      const answer = await http.json(link ?? path, link === undefined ? options : { ...options, query: {} });
      return { items: [answer], skipped: [], cursor: nextLink(shape, http.baseUrl, answer) };
    };
  for await (const page of paginate(load)) yield* page.items;
}
