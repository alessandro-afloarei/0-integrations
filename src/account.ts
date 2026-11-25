import type { Call, Entry, Identify, Value, Values } from './catalogue.js';
import { ProviderHttpError } from './errors.js';
import { createClient, type HttpClient } from './http.js';
import { responseJson } from './http-response.js';
import { fill, holds, placeholders, readPath } from './rules.js';

export type Account = { id: string; name: string };
type Read = (name: string) => Promise<unknown>;

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

/** The identify request: GraphQL is a POST of the query to the base. A `rejectWhen` rule that holds is a bad credential. */
async function ask(entry: Entry, http: HttpClient, call: Call, rejectWhen: NonNullable<Identify['rejectWhen']>):
Promise<{ status: number; body: unknown }> {
  const response = call.graphql === undefined
    ? await http.request(call.path ?? '', { method: call.method ?? 'GET', ...(call.query ? { query: call.query } : {}) })
    : await http.request('', { method: 'POST', json: { query: call.graphql, variables: {} } });
  const answer = { status: response.status, headers: response.headers, body: response.data };
  for (const { detail, ...when } of rejectWhen) {
    if (holds(when, answer)) throw new ProviderHttpError('rejected', response.status, detail ?? null);
  }
  return { status: response.status, body: responseJson(entry, response) };
}

/** The account an entry's `identify` names and the values its `save` keeps. The request is sent at most once: when a
 * value reads its answer, or at once when no `id` or `name` is declared (a credential check). */
export async function identifyAccount(entry: Entry, input: { fetch: typeof fetch; token: string; values?: Values;
  tokenAnswer?: Values }): Promise<{ account: Account | null; values: Values }> {
  const { identify = {}, save = {} } = entry;
  const values = input.values ?? {};
  const http = createClient(entry, { token: () => Promise.resolve(input.token), fetch: input.fetch, values });
  let answer: Promise<{ status: number; body: unknown }> | undefined;
  const answered = () => (answer ??= ask(entry, http, identify.request ?? {}, identify.rejectWhen ?? []));
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
    if (!(typeof found === 'string' && found !== '') && !(typeof found === 'number' && Number.isSafeInteger(found) && found > 0)) {
      const status = answer ? (await answer).status : input.tokenAnswer ? 200 : null;
      throw new ProviderHttpError('invalid_response', status, 'missing_fields');
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
