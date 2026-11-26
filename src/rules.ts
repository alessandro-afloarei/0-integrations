import type { Entry, Field, Operation, Paging, Param, Path, Shape, Template, Values, When } from './catalogue.js';

/** The text as JSON, or undefined when it is none. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads a dotted path; at each level the whole rest is tried as one own key first, so `@odata.nextLink` is one key. */
export function readPath(value: unknown, path: Path): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, path)) return record[path];
  const dot = path.indexOf('.');
  if (dot === -1) return undefined;
  const head = path.slice(0, dot);
  return Object.hasOwn(record, head) ? readPath(record[head], path.slice(dot + 1)) : undefined;
}

/** The shape at a dotted path through an object shape's keys, the whole rest tried as one key first, as `readPath` reads. */
export function shapeAt(shape: Shape | undefined, path: Path): Shape | undefined {
  if (typeof shape !== 'object' || Array.isArray(shape)) return undefined;
  const keys = shape as { readonly [key: string]: Shape }; // `isArray` does not narrow a readonly tuple away
  const dot = path.indexOf('.');
  return Object.hasOwn(keys, path) ? keys[path] : dot === -1 ? undefined : shapeAt(keys[path.slice(0, dot)], path.slice(dot + 1));
}

/** Whether a parameter has a place in its operation's request: GraphQL takes only variables; a path operation takes no
 * variables, a path parameter only where its path names it, and a body parameter only when it is not a GET. */
export function placed(op: Operation, name: string, param: Param): boolean {
  return 'graphql' in op ? param.in === 'variables'
    : param.in !== 'variables' && (param.in !== 'path' || placeholders(op.path).includes(name))
      && (param.in !== 'body' || (op.method ?? 'GET') !== 'GET');
}

/** Whether a paged operation reads its records where its shape walks: on a `page` or `offset` shape, at the shape's
 * `list` (both left out for a list at the answer's top level), else the walk and the records read two lists. */
export function pagedRecords(op: Operation, shape: Paging): boolean {
  return (shape.kind !== 'page' && shape.kind !== 'offset') || op.records === shape.list;
}

/** The parameter an operation declares in the place its paging shape's `send` writes, if any: the walk sends that value
 * itself, and a caller's would start the walk there and be overwritten after the first page. */
export function pagedParam(op: Operation, shape: Paging): string | undefined {
  const sent = 'send' in shape ? shape.send : undefined;
  // A literal query in the path (`/items?offset=2`) would start the walk there too.
  if (sent && 'query' in sent && 'path' in op && new URL(op.path, 'https://a.test').searchParams.has(sent.query)) return sent.query;
  return sent === undefined ? undefined
    : Object.entries(op.params ?? {}).find(([name, param]) => param.in in sent && sent[param.in as keyof typeof sent] === name)?.[0];
}

/** The first operation id a client cannot hold: one with an empty segment, a dotted prefix of another (`pages` beside
 * `pages.markdown`), one whose first segment is the client's own call, or `then`, which would make the client a thenable.
 * `Reserved` in catalogue.ts is the compiler's copy of these names. */
export function clashing(ids: readonly string[]): string | undefined {
  return ids.find(id => id.split('.').includes('') || ids.some(other => other.startsWith(`${id}.`))
    || ['json', 'request', 'paginate'].includes(id.split('.')[0] ?? '') || id === 'then');
}

/** A `{name}`: no braces inside, never empty. */
const PLACEHOLDER = /\{([^{}]+)\}/gu;

/** The names a template's placeholders hold, in order: the ones `fill` replaces. */
export function placeholders(template: Template): string[] {
  return [...template.matchAll(PLACEHOLDER)].map(match => match[1] ?? '');
}

/** The entry's fields that are not secret: what a connection keeps, and what fills a URL. */
export const plainFields = (entry: Entry): Field[] => (entry.fields ?? []).filter(field => !field.secret);

/** A well-formed URL template: `https://`, an authority of ASCII letters, digits, `.`, `-` and `{name}`s with an optional
 * literal port, then `/` or the end. The URL parser ends an authority at `/`, `\`, `?` or `#`, reads userinfo before `@`
 * and drops tabs and newlines: none can occur in it, so the host it parses is this authority, filled. */
const WELL_FORMED = /^https:\/\/((?:[A-Za-z0-9.-]|\{\w+\})+(?::\d+)?)(?:\/|$)/u;

/** A URL template's host part, its scheme included (`https://{host}`); none when the template is not well formed. */
export function hostPart(url: string): string | undefined {
  const authority = WELL_FORMED.exec(url)?.[1];
  return authority === undefined ? undefined : `https://${authority}`;
}

/** An OAuth 2 first sign-in's URLs as written: authorize, token, refresh (the token URL unless the entry names one) and
 * an RFC 7009 revoke; none for another sign-in. */
export function oauthUrls(entry: Entry): { authorize: string; token: string; refresh: string; revoke?: string } | undefined {
  const [auth] = entry.auth;
  if (auth.kind !== 'oauth2') return undefined;
  return { authorize: auth.authorizeUrl, token: auth.tokenUrl, refresh: auth.refreshUrl ?? auth.tokenUrl,
    ...(entry.revoke && 'url' in entry.revoke ? { revoke: entry.revoke.url } : {}) };
}

/** Whether the entry's base, its `http.bases`, an OAuth 2 sign-in's URLs and a token request's URL differ in their host
 * part when any of them takes its host from a value: on a typed host a credential goes only to that host, and a cloud's
 * never reaches it. */
export function hostSplit(entry: Entry): boolean {
  // One not well formed is kept whole: never equal to a host part, so it counts as another host.
  const hosts = declaredUrls(entry).map(url => hostPart(url) ?? url);
  return hosts.some(host => placeholders(host).length > 0) && new Set(hosts).size > 1;
}

/** Every URL an entry declares: the base, `http.bases`, the OAuth 2 URLs (an RFC 7009 revoke's too) and a token request's. */
export function declaredUrls(entry: Entry): string[] {
  const [auth] = entry.auth;
  return [entry.http.baseUrl, ...Object.values(entry.http.bases ?? {}), ...Object.values(oauthUrls(entry) ?? {}),
    ...auth.kind === 'token' ? [auth.request.url] : []];
}

/** The one refusal every send runs first: a declared URL that is not a well-formed template (`base_host_refused`), then
 * hosts that split (`host_split`), each before a host is compared or anything is sent. */
export function checkHosts(entry: Entry): void {
  if (declaredUrls(entry).some(url => hostPart(url) === undefined)) throw new TypeError(`base_host_refused: ${entry.id}`);
  if (hostSplit(entry)) throw new TypeError(`host_split: ${entry.id}`);
}

/** Replaces each `{name}` with a string or a finite number; anything else throws, naming `where` and the key. */
export function fill(template: Template, lookup: (name: string) => unknown, where: string): string {
  return template.replaceAll(PLACEHOLDER, (_, name: string) => {
    const value = lookup(name);
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
    throw new TypeError(`template_missing: ${where} {${name}}`);
  });
}

/** A connection's plain value as templates read it: a non-blank string or a finite number, else undefined. Never a
 * field's default: `finishConnect` applies it and returns it in `values`, which a client must be given. */
export function plainValue(values: Values, name: string): string | number | undefined {
  const value = values[name];
  return (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;
}

export type Answer = { status: number; headers: Headers; body: unknown; code?: string | undefined };

/** Whether every part `when` states holds for the answer; `header` or `path` (one of them, not both) selects the value compared. */
export function holds(when: When, answer: Answer): boolean {
  const { status, header, path, detail, equals, in: among, startsWith, contains } = when;
  if (status === 'error' ? answer.status >= 200 && answer.status < 300 : status !== undefined && status !== answer.status) {
    return false;
  }
  if (detail !== undefined && (detail === true ? answer.code === undefined : detail !== answer.code)) return false;
  const value = header !== undefined ? answer.headers.get(header) ?? undefined
    : path !== undefined ? readPath(answer.body, path) : undefined;
  const compared = equals !== undefined || among !== undefined || startsWith !== undefined || contains !== undefined;
  if (!compared) return (header === undefined && path === undefined) || value !== undefined;
  const text = typeof value === 'string' ? value : undefined;
  return (equals === undefined || value === equals)
    && (among === undefined || (text !== undefined && among.includes(text)))
    && (startsWith === undefined || (text?.startsWith(startsWith) ?? false))
    && (contains === undefined || (text?.toLowerCase().includes(contains.toLowerCase()) ?? false));
}
