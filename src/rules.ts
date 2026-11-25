import type { Path, Template, When } from './catalogue.js';

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

/** The first value found that is neither undefined nor null. */
export function firstPresent(value: unknown, paths: Path | readonly Path[]): unknown {
  for (const path of typeof paths === 'string' ? [paths] : paths) {
    const found = readPath(value, path);
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

/** Replaces each `{name}` with a string or a finite number; anything else throws, naming `where` and the key. */
export function fill(template: Template, lookup: (name: string) => unknown, where: string): string {
  return template.replaceAll(/\{([^{}]+)\}/gu, (_, name: string) => {
    const value = lookup(name);
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
    throw new TypeError(`template_missing: ${where} {${name}}`);
  });
}

export type Answer = { status: number; headers: Headers; body: unknown; code?: string | undefined };

/** Whether every part `when` states holds for the answer. */
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
