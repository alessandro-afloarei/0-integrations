import type { Call, Entry, Identify, Value, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { createClient, type HttpClient, type ProviderResponse, type RequestOptions } from './http.js';
import { responseJson } from './http-response.js';
import { fill, holds, placeholders, readPath } from './rules.js';

export type Account = { id: string; name: string };
type Read = (name: string) => Promise<unknown>;

/** The names `identify` and `save` read from the lookup: each path, and each template's placeholders but `{id}` (the id
 * already found). */
export function lookupNames(entry: Pick<Entry, 'identify' | 'save'>): string[] {
  const values = [entry.identify?.id, entry.identify?.name, ...Object.values(entry.save ?? {})].flat().filter(value => value !== undefined);
  return values.flatMap(value => (value.includes('{') ? placeholders(value).filter(name => name !== 'id') : [value]));
}

/** A value: the first present of its paths, or a template (a string with braces) over the same lookup, where `{id}` is
 * the id already found (a bare path `id` reads the answer: GitHub's, Notion's and Microsoft's id). */
async function valueOf(value: Value, read: Read, where: string, id?: string): Promise<unknown> {
  if (typeof value === 'string' && value.includes('{')) {
    const found = new Map<string, unknown>();
    for (const name of placeholders(value)) found.set(name, name === 'id' ? id : await read(name));
    return fill(value, name => found.get(name), where);
  }
  for (const path of typeof value === 'string' ? [value] : value) {
    const found = await read(path);
    if (found !== undefined && found !== null) return found;
  }
  return undefined;
}

/** The request a declared call makes, with what the caller adds: GraphQL is a POST of the query and its variables to
 * the base. The one rule for every declared call (identify, a request revoke, an operation, a paged operation). */
export function callRequest(call: Call, extra: RequestOptions & { variables?: Values } = {}): [path: string, options: RequestOptions] {
  const { variables = {}, ...options } = extra;
  return call.graphql === undefined
    ? [call.path ?? '', { method: call.method ?? 'GET', ...(call.query ? { query: call.query } : {}), ...options }]
    : ['', { method: 'POST', json: { query: call.graphql, variables }, ...options }];
}

/** Sends a declared call. */
export function sendCall(http: HttpClient, call: Call): Promise<ProviderResponse> {
  return http.request(...callRequest(call));
}

/** The identify request's answer. A `rejectWhen` rule that holds is a bad credential. */
async function ask(entry: Entry, http: HttpClient, identify: Identify): Promise<{ status: number; body: unknown }> {
  const response = await sendCall(http, identify.request ?? {});
  const answer = { status: response.status, headers: response.headers, body: response.data };
  for (const { detail, ...when } of identify.rejectWhen ?? []) {
    if (holds(when, answer)) throw new ProviderHttpError('rejected', response.status, detail ?? null);
  }
  return { status: response.status, body: responseJson(entry, response) };
}

/** An id: a string that is not blank, or a positive integer. */
const isId = (value: unknown): value is string | number => (typeof value === 'string' && value.trim() !== '')
  || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);

/** The account an entry's `identify` names and the values its `save` keeps. The request is sent at most once: when a
 * value reads its answer, or at once when no `id` or `name` is declared (a credential check). */
export async function identifyAccount(entry: Entry, input: { fetch: typeof fetch; token: string; values?: Values;
  tokenAnswer?: Values }): Promise<{ account: Account | null; values: Values }> {
  const { identify = {}, save = {} } = entry;
  const values = input.values ?? {};
  const http = createClient(entry, { token: () => Promise.resolve(input.token), fetch: input.fetch, values });
  let answer: Promise<{ status: number; body: unknown }> | undefined;
  const answered = () => (answer ??= ask(entry, http, identify));
  let id: string | undefined;
  const read: Read = async name => {
    if (name.startsWith('tokenAnswer.')) return readPath(input.tokenAnswer, name.slice('tokenAnswer.'.length));
    if (name.startsWith('connection.')) return values[name.slice('connection.'.length)];
    return readPath((await answered()).body, name);
  };
  if (identify.request !== undefined && identify.id === undefined && identify.name === undefined) await answered();
  const text = (value: unknown) => (identify.lowercase && typeof value === 'string' ? value.trim().toLowerCase() : value);
  if (identify.id !== undefined) {
    const found = text(await valueOf(identify.id, read, entry.id));
    if (!isId(found)) {
      throw new ProviderHttpError('invalid_response', (await answer)?.status ?? (input.tokenAnswer ? 200 : null), 'missing_fields');
    }
    id = String(found);
  }
  const name = identify.name === undefined ? undefined : text(await valueOf(identify.name, read, entry.id, id));
  const saved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(save)) {
    const found = await valueOf(value, read, entry.id, id);
    if (found !== undefined && found !== null) saved[key] = found;
  }
  return { account: id === undefined ? null : { id, name: typeof name === 'string' && name.trim() !== '' ? name : id },
    values: { ...values, ...saved } };
}
