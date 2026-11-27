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

/** A value as text: a non-empty string, or a non-negative safe integer as its digits; null for any other (a cursor, a code). */
export const textOf = (value: unknown) => typeof value === 'string' && value !== '' ? value : Number.isSafeInteger(value) && Number(value) >= 0 ? String(value) : null;

/** The shape at a dotted path through an object shape's keys, the whole rest tried as one key first, as `readPath` reads. */
export function shapeAt(shape: Shape | undefined, path: Path): Shape | undefined {
  if (typeof shape !== 'object' || Array.isArray(shape)) return undefined;
  const keys = shape as { readonly [key: string]: Shape }; // `isArray` does not narrow a readonly tuple away
  const dot = path.indexOf('.');
  return Object.hasOwn(keys, path) ? keys[path] : dot === -1 ? undefined : shapeAt(keys[path.slice(0, dot)], path.slice(dot + 1));
}

/** The declared shape an `anyOf` path names: a parameter's `type`, then at each dot a key of an object, a `key?` named without its `?`. */
export function argumentShape(op: Operation, path: Path): Shape | undefined {
  const own = (shape: Shape | undefined, key: string) => typeof shape === 'object' && !Array.isArray(shape) && Object.hasOwn(shape, key)
    ? (shape as { readonly [key: string]: Shape })[key] : undefined;
  const types: Shape = Object.fromEntries(Object.entries(op.params ?? {}).map(([name, param]) => [name, param.type]));
  return path.split('.').reduce<Shape | undefined>((shape, key) => key.endsWith('?') ? undefined : own(shape, key) ?? own(shape, `${key}?`), types);
}

/** Whether a parameter has a place in its operation's request: GraphQL takes only variables; a path operation takes no
 * variables, a path parameter only where its path names it, a body or form parameter only when it is not a GET and
 * the operation has no parameter of the other of the two, and a header one only as a scalar, never `nullable`, never
 * named `content-type`, `host` or a sign-in's credential header (`authorization` unless its `send` names another). */
export function placed(entry: Entry, op: Operation, name: string, param: Param): boolean {
  const credentials = entry.auth.map(auth => ('send' in auth && 'header' in auth.send ? auth.send.header : 'authorization').toLowerCase());
  if (param.in === 'header') return !('graphql' in op) && param.nullable === undefined && typeof param.type === 'string'
    && !['content-type', 'host', ...credentials].includes(name.toLowerCase());
  return 'graphql' in op ? param.in === 'variables'
    : param.in !== 'variables' && (param.in !== 'path' || placeholders(op.path).includes(name))
      && ((param.in !== 'body' && param.in !== 'form') || ((op.method ?? 'GET') !== 'GET'
        && !Object.values(op.params ?? {}).some(each => each.in === (param.in === 'body' ? 'form' : 'body'))));
}

/** Whether a paged operation reads its records where its shape walks: on a `page`, `offset` or `last` shape, at the
 * shape's `list` (both left out for a list at the answer's top level), else the walk and the records read two lists. */
export function pagedRecords(op: Operation, shape: Paging): boolean {
  return !(shape.kind === 'page' || shape.kind === 'offset' || shape.kind === 'last') || op.records === shape.list;
}

/** The parameter an operation declares in the place its paging shape's `send` writes, if any: the walk sends that value
 * itself, and a caller's would start the walk there and be overwritten after the first page. A body cursor beside a form
 * parameter is named too: from the second page its JSON would replace the form. */
export function pagedParam(op: Operation, shape: Paging): string | undefined {
  const sent = 'send' in shape ? shape.send : undefined;
  // A literal query in the path (`/items?offset=2`) would start the walk there too.
  if (sent && 'query' in sent && 'path' in op && new URL(`https://a.test${op.path}`).searchParams.has(sent.query)) return sent.query;
  if (sent && 'body' in sent && Object.values(op.params ?? {}).some(param => param.in === 'form')) return sent.body;
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

/** The base's named host by name, with its path: on an OAuth 2 sign-in, the base's whole host one placeholder, a `save`
 * key read from one `tokenAnswer.*` path, never a field. */
export function namedHosts(entry: Entry): Readonly<Record<string, Path>> {
  if (entry.auth[0].kind !== 'oauth2') return {};
  return Object.fromEntries((/^https:\/\/\{([^{}]+)\}$/u.exec(hostPart(entry.http.baseUrl) ?? '')?.slice(1) ?? []).flatMap(name => { const path = entry.save?.[name];
    return typeof path === 'string' && /^tokenAnswer\.[^{]+$/u.test(path) && !entry.fields?.some(field => field.name === name) ? [[name, path]] : []; }));
}

/** Whether the entry's base, its `http.bases`, an OAuth 2 sign-in's URLs and a token request's URL differ in their host
 * part when any of them takes its host from a typed value, or a typed host sits beside a named one: on a typed host a
 * credential goes only to that host, and a cloud's never reaches it. A named host, the whole host of each URL that names
 * it, beside fixed URLs is no split; composed into another host it is typed. */
export function hostSplit(entry: Entry): boolean {
  // One not well formed is kept whole: never equal to a host part, so it counts as another host.
  const hosts = declaredUrls(entry).map(url => hostPart(url) ?? url);
  const named = namedHosts(entry);
  const typed = hosts.some(host => placeholders(host).some(name => !Object.hasOwn(named, name) || host !== `https://{${name}}`));
  return typed && (new Set(hosts).size > 1 || Object.keys(named).length > 0);
}

/** Every URL an entry declares: the base, `http.bases`, the OAuth 2 URLs (an RFC 7009 revoke's too) and a token request's. */
export function declaredUrls(entry: Entry): string[] {
  const [auth] = entry.auth;
  return [entry.http.baseUrl, ...Object.values(entry.http.bases ?? {}), ...Object.values(oauthUrls(entry) ?? {}),
    ...auth.kind === 'token' ? [auth.request.url] : []];
}

/** The one refusal every send runs first: a first sign-in that declares its own part (`sign_in_own_first`: an app's entry
 * built without the types), a declared URL that is not a well-formed template or a named host with no domain to match
 * (`base_host_refused`), hosts that split (`host_split`), then a value that is neither a field nor a `save` key
 * (`value_undeclared`: a connection kept from another sign-in), each before a credential is read or anything is sent. */
export function checkHosts(entry: Entry, values: Values = {}): void {
  if (['fields', 'http', 'identify'].some(name => name in entry.auth[0])) throw new TypeError(`sign_in_own_first: ${entry.id}`);
  if (declaredUrls(entry).some(url => hostPart(url) === undefined)) throw new TypeError(`base_host_refused: ${entry.id}`);
  const domainless = [entry.http.host ?? '*'].flat().every(host => host === '*' || host === ''); // an app's `[]` or `['*']` too
  if (Object.keys(namedHosts(entry)).length > 0 && domainless) throw new TypeError(`base_host_refused: ${entry.id}`);
  if (hostSplit(entry)) throw new TypeError(`host_split: ${entry.id}`);
  const undeclared = Object.keys(values).find(name => !entry.fields?.some(field => field.name === name) && !Object.hasOwn(entry.save ?? {}, name));
  if (undeclared !== undefined) throw new TypeError(`value_undeclared: ${entry.id} ${undeclared}`);
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
