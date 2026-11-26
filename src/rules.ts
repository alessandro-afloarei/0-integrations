import type { Entry, Operation, Param, Path, Shape, Template, Values, When } from './catalogue.js';

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

/** Replaces each `{name}` with a string or a finite number; anything else throws, naming `where` and the key. */
export function fill(template: Template, lookup: (name: string) => unknown, where: string): string {
  return template.replaceAll(PLACEHOLDER, (_, name: string) => {
    const value = lookup(name);
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
    throw new TypeError(`template_missing: ${where} {${name}}`);
  });
}

/** A connection's plain value as templates read it: a non-blank string or a finite number, else the field's default,
 * else undefined. */
export function plainValue(entry: Pick<Entry, 'fields'>, values: Values, name: string): string | number | undefined {
  const usable = (value: unknown) => (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value));
  const value = values[name];
  const fallback = entry.fields?.find(field => field.name === name && field.secret !== true)?.default;
  return usable(value) ? value as string | number : usable(fallback) ? fallback : undefined;
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
