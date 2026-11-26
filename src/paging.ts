import type { Paging, Where } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import type { HttpClient, RequestOptions } from './http.js';
import { paginate } from './paginate.js';
import { readPath } from './rules.js';

type Cursor = Extract<Paging, { kind: 'cursor' }>;
type Linked = Extract<Paging, { kind: 'linkHeader' | 'nextUrl' }>;
type PageNumber = Extract<Paging, { kind: 'page' }>;

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
 * its search; null for any other. A path (one `/`, never `//` or `/\`, which name a host) is read on the base's origin. */
export function ownPath(shape: Linked, baseUrl: string, address: string): string | null {
  const base = new URL(baseUrl);
  const absolute = /^\/(?![/\\])/u.test(address) ? base.origin + address : address;
  if (!URL.canParse(absolute)) return null;
  const root = base.pathname.replace(/\/$/u, ''); // an origin-only base's path is `/`
  const url = new URL(absolute);
  const rest = url.pathname.slice(root.length);
  const under = rest.startsWith('/') ? rest.startsWith(shape.pathPrefix ?? '/') : rest === '' && shape.pathPrefix === undefined;
  return url.origin === base.origin && url.pathname.startsWith(root) && under ? rest + url.search : null;
}

/** The path after the base a next link names, or null with none; a link that leaves is `next_link_foreign`. */
export function followed(shape: Linked, baseUrl: string, next: unknown): string | null {
  if (next === undefined || next === null) return null;
  const path = typeof next === 'string' ? ownPath(shape, baseUrl, next) : null;
  if (path === null) throw new ProviderHttpError('invalid_response', null, 'next_link_foreign');
  return path;
}

/** A link-value's parameters: each `;`, its name, and a value quoted (RFC 8288 quoted-string) or bare. */
const PARAM = /\s*;\s*([^\s;,=]+)\s*(?:=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s;,"]*)))?/gu;
/** The target of the `Link` header's link-value whose `rel` (split on spaces) holds `next`. A quoted value is read
 * whole, so a `<`, `,` or `; rel=next` inside one is neither a link nor a `rel`. */
function relNext(header: string | null): string | undefined {
  for (const [, target, params = ''] of (header ?? '').matchAll(new RegExp(`<([^>]*)>((?:${PARAM.source})*)`, 'gu'))) {
    const rel = [...params.matchAll(PARAM)].find(([, name = '']) => name.toLowerCase() === 'rel');
    if ((rel?.[2] ?? rel?.[3] ?? '').toLowerCase().split(/\s+/u).includes('next')) return target;
  }
  return undefined;
}

function withCursor(where: Where, options: RequestOptions, cursor: string | number): RequestOptions {
  if ('query' in where) return { ...options, query: { ...options.query, [where.query]: String(cursor) } };
  const body = typeof options.json === 'object' && options.json !== null ? options.json : {};
  return { ...options, json: { ...body, [where.body]: cursor } };
}

/** A page-number list's loader: no number first, then each next one, until `more` is falsy or the list is empty. A
 * missing list, or one that is no list, is `invalid_response`: a malformed answer never reads as an empty list. A list
 * equal to the page before's is `page_repeated`: the provider ignores the number, and would never end. */
function numbered(http: HttpClient, shape: PageNumber, path: string, options: RequestOptions) {
  let previous: string | undefined;
  return async (page: string | undefined) => {
    const answer = await http.json(path, page === undefined ? options : withCursor(shape.send, options, Number(page)));
    const list = shape.list === undefined ? answer : readPath(answer, shape.list);
    if (!Array.isArray(list)) throw new ProviderHttpError('invalid_response', null, 'missing_fields');
    const seen = JSON.stringify(list);
    if (previous !== undefined && seen === previous) throw new ProviderHttpError('invalid_response', null, 'page_repeated');
    previous = seen;
    const last = list.length === 0 || (shape.more !== undefined && !readPath(answer, shape.more));
    return { items: [answer], skipped: [], cursor: last ? null : String(Number(page ?? (shape.zeroBased ? 0 : 1)) + 1) };
  };
}

/** Every page's answer, in order, until the shape names no next page; a cursor that comes back is `cursor_repeated`. */
export async function* walk(http: HttpClient, shape: Paging, path: string, options: RequestOptions = {}): AsyncGenerator<unknown, void, undefined> {
  const load = shape.kind === 'cursor'
    ? async (cursor: string | undefined) => {
      const answer = await http.json(path, cursor === undefined ? options : withCursor(shape.send, options, cursor));
      return { items: [answer], skipped: [], cursor: nextCursor(shape, answer) };
    }
    : shape.kind === 'page' ? numbered(http, shape, path, options)
    : async (link: string | undefined) => {
      const { data, headers } = await http.answer(link ?? path, link === undefined ? options : { ...options, query: {} });
      const next = shape.kind === 'linkHeader' ? relNext(headers.get('link')) : readPath(data, shape.next);
      return { items: [data], skipped: [], cursor: followed(shape, http.baseUrl, next) };
    };
  for await (const page of paginate(load)) yield* page.items;
}
