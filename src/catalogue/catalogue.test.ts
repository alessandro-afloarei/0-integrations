import { globSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { identifyAccount, lookupNames, sendCall } from '../account.js';
import { defineProvider, type Entry } from '../catalogue.js';
import { finishConnect } from '../connect.js';
import { createClient } from '../http.js';
import { BAD_KEY, GOOD_KEY, replay, type Exchange, type Recording } from '../kit.test-support.js';
import { placeholders } from '../rules.js';
import { tierOf } from '../tier.js';

/** Every entry in this folder: no list to edit when one is added. */
const FILES = globSync('src/catalogue/*.ts').filter(file => !file.endsWith('.test.ts')).sort();
const entries: [string, Entry][] = await Promise.all(FILES.map(async file => {
  const id = basename(file, '.ts');
  const found = Object.values(await import(pathToFileURL(file).href) as Record<string, unknown>)
    .find(value => typeof value === 'object' && value !== null && 'id' in value && value.id === id);
  if (!found) throw new Error(`${file} exports no entry whose id is ${id}`);
  return [id, found as Entry];
}));

/** Every recording in this folder, by its file name: `<id>.recording.json` or `<id>.<part>.recording.json`. */
const recordings = globSync('src/catalogue/*.recording.json').sort()
  .map(file => ({ file: basename(file), ...JSON.parse(readFileSync(file, 'utf8')) as Recording }));

/** A key entry's plain fields, each `kit-<name>`. */
const kitValues = (entry: Entry) =>
  Object.fromEntries((entry.fields ?? []).filter(field => field.secret !== true).map(field => [field.name, `kit-${field.name}`]));

/** Signs in with a key: a key entry through `finishConnect`, an OAuth entry's token through `identifyAccount`. */
function signIn(entry: Entry, key: string, fetch: typeof globalThis.fetch) {
  if (entry.auth[0].kind === 'oauth2') return identifyAccount(entry, { token: key, fetch });
  const secret = (entry.fields ?? []).find(field => field.secret === true)?.name ?? '';
  return finishConnect(entry, { secret: { [secret]: key }, values: kitValues(entry), fetch });
}

/** The entry's recordings as one, and which keys answer its identify request there; or why it cannot be replayed. */
async function identifyReplay(entry: Entry): Promise<{ recording: Recording; keys: Exchange['key'][] } | string> {
  const request = entry.identify?.request;
  if (request === undefined) return 'it sends no identify request';
  const own = recordings.filter(({ file }) => file.startsWith(`${entry.id}.`));
  const [first] = own;
  if (first === undefined) return 'no recording sits beside it';
  // The request as the engine sends it, read off a stand-in wire.
  let sent = new Request('https://unsent.test');
  const wire: typeof fetch = (input, init) => { sent = new Request(input, init); return Promise.resolve(Response.json({})); };
  await sendCall(createClient(entry, { token: () => Promise.resolve(GOOD_KEY), fetch: wire, values: kitValues(entry) }), request);
  const exchanges = own.flatMap(recording => recording.exchanges);
  const keys = (['good', 'bad'] as const).filter(key =>
    exchanges.some(item => item.key === key && item.method === sent.method && item.url === sent.url));
  if (!keys.includes('good')) return `its recordings hold no good-key answer for ${sent.method} ${sent.url}`;
  return { recording: { ...first, provider: entry.id, exchanges }, keys };
}
const replays = new Map(await Promise.all(entries.map(async ([id, entry]) => [id, await identifyReplay(entry)] as const)));

const https = z.string().startsWith('https://');
const template = z.string();
const whenObject = z.strictObject({ status: z.union([z.number().int(), z.literal('error')]).optional(), header: z.string().optional(),
  path: z.string().optional(), detail: z.union([z.string(), z.literal(true)]).optional(),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(), in: z.array(z.string()).optional(),
  startsWith: z.string().optional(), contains: z.string().optional() });
type Selects = { header?: string | undefined; path?: string | undefined; equals?: unknown; in?: unknown;
  startsWith?: unknown; contains?: unknown };
/** `header` or `path`, never both; a comparison needs one of them; a header's value is a string, so `equals` must be one. */
const selectsOne = (item: Selects) => !(item.header !== undefined && item.path !== undefined)
  && (item.header !== undefined || item.path !== undefined
    || [item.equals, item.in, item.startsWith, item.contains].every(part => part === undefined))
  && (item.header === undefined || item.equals === undefined || typeof item.equals === 'string');
const condition = <T extends Selects>(schema: z.ZodType<T>) =>
  schema.refine(selectsOne, 'a condition compares one header or one path, and a header only to a string');
const when = condition(whenObject);
const send = z.union([z.strictObject({ header: z.string() }), z.strictObject({ basic: z.tuple([template, template]) })]);
const value = z.union([z.string(), z.array(z.string())]);
const request = z.strictObject({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(), path: template.optional(),
  query: z.record(z.string(), z.string()).optional(), graphql: z.string().optional() });
/** The entry types as a schema. Tests only: no published declaration may name zod. Operations join it when they join the types. */
const entrySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/u), name: z.string().min(1),
  fields: z.array(z.strictObject({ name: z.string(), title: z.string(), secret: z.literal(true).optional() })).optional(),
  auth: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('key'), send: send.optional() }),
    z.strictObject({ kind: z.literal('oauth2'), authorizeUrl: https, tokenUrl: https, pkce: z.literal(false).optional(),
      clientAuth: z.literal('basic').optional(), scopeSeparator: z.literal(',').optional(),
      authorizeParams: z.record(z.string(), z.string()).optional(), tokenTypes: z.array(z.string()).optional(),
      failed: when.optional(), reusesGrant: z.literal(true).optional() }),
  ])).length(1), // one sign-in each until a provider needs two
  scopes: z.strictObject({ default: z.array(z.string()), requireGranted: z.literal(true).optional() }).optional(),
  identify: z.strictObject({ request: request.optional(), id: value.optional(), name: value.optional(),
    lowercase: z.literal(true).optional(),
    rejectWhen: z.array(condition(whenObject.extend({ detail: z.string().optional() }))).optional() }).optional(),
  save: z.record(z.string(), value).optional(),
  revoke: z.union([z.strictObject({ url: https, token: z.array(z.enum(['refresh', 'access'])), goneErrors: z.array(z.string()).optional() }),
    z.strictObject({ request, goneErrors: z.array(z.string()).optional() })]).optional(),
  http: z.strictObject({ baseUrl: https, bases: z.record(z.string(), https).optional(), headers: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(), minIntervalMs: z.number().int().nonnegative().optional(),
    retry: z.strictObject({ limit: z.number().int().nonnegative().optional(), maxWaitMs: z.number().int().nonnegative().optional(),
      defaultWaitMs: z.number().int().nonnegative().optional(),
      waitFromBody: z.strictObject({ path: z.string(), unit: z.enum(['ms', 'epochMs']) }).optional() }).optional(),
    rateLimit: z.strictObject({
      when: z.array(condition(whenObject.extend({ resetAt: z.strictObject({ header: z.string(), unit: z.literal('epochSeconds') }).optional() }))),
      defaultWaitMs: z.number().int().nonnegative().optional() }).optional() }),
  errors: z.strictObject({ detail: value.optional(), allow: z.array(z.string()).optional(), failed: when.optional(),
    revoked: z.array(z.string()).optional(),
    rules: z.array(z.strictObject({ when, code: z.enum(['rejected', 'rate_limited', 'unavailable', 'not_found', 'request_failed', 'invalid_response']),
      detail: z.string().optional() })).optional() }).optional(),
  webhook: z.strictObject({ kind: z.literal('hmac'), header: z.string(), signed: template.optional(), prefix: z.string().optional(),
    encoding: z.literal('base64').optional(), timestamp: z.strictObject({ header: z.string(), toleranceSeconds: z.number().int().positive().optional() }).optional(),
    deliveryId: z.union([z.strictObject({ header: z.string() }), z.strictObject({ body: z.array(z.string()).min(1) })]).optional() }).optional(),
  paging: z.record(z.string(), z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('cursor'), next: z.string(), more: z.string().optional(),
      send: z.union([z.strictObject({ query: z.string() }), z.strictObject({ body: z.string() })]) }),
    // A prefix is a whole directory (`/me/`), so `/meetings` is not under `/me`.
    z.strictObject({ kind: z.literal('nextUrl'), next: z.string(), pathPrefix: z.string().regex(/^\/(?:.*\/)?$/u).optional() }),
  ])).optional(),
});

/** Every function anywhere in a value, by its path. */
function functionsIn(value: unknown, at = ''): string[] {
  if (typeof value === 'function') return [at || '(root)'];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => functionsIn(item, at ? `${at}.${key}` : key));
}

/** What the engine cannot run, each a rule every entry passes. */
const reads = (entry: Entry, prefix: string) => lookupNames(entry).filter(name => name.startsWith(prefix));
const runnable = {
  // The engine sends only that field as `{token}`.
  'one secret field, the only one a key entry has': (entry: Entry) => {
    const secrets = (entry.fields ?? []).filter(field => field.secret === true).length;
    return entry.auth[0].kind === 'key' ? secrets === 1 : secrets <= 1;
  },
  // No silent GET to the base URL.
  "a request when a value reads identify's answer": (entry: Entry) => entry.identify?.request !== undefined
    || lookupNames(entry).every(name => name.startsWith('tokenAnswer.') || name.startsWith('connection.')),
  'no token answer, scopes or RFC 7009 revoke on a key entry': (entry: Entry) => entry.auth[0].kind !== 'key'
    || (reads(entry, 'tokenAnswer.').length === 0 && entry.scopes === undefined && !(entry.revoke !== undefined && 'url' in entry.revoke)),
  'scopes on an oauth2 entry': (entry: Entry) => entry.auth[0].kind !== 'oauth2' || entry.scopes !== undefined,
};
type Rule = keyof typeof runnable;

describe.each(entries)('%s', (id, entry) => {
  test('matches the entry types', () => { expect(entrySchema.safeParse(entry).error).toBeUndefined(); });
  test('holds no function', () => { expect(functionsIn(entry)).toEqual([]); });
  test('prints to JSON as it is', () => { expect(JSON.parse(JSON.stringify(entry))).toEqual(entry); });
  test.each(Object.keys(runnable) as Rule[])('declares %s', rule => { expect(runnable[rule](entry)).toBe(true); });
  test('names only what each place allows in its templates', () => {
    const fields = (entry.fields ?? []).map(field => field.name);
    const auth = entry.auth[0];
    // auth.send: every field by its name, and the token.
    if ('send' in auth && 'basic' in auth.send) for (const name of auth.send.basic.flatMap(placeholders)) expect([...fields, 'token']).toContain(name);
    // identify and save read one lookup: the id found, the token answer, a connection value (a plain field the user
    // entered, or a value `save` keeps), or a path into the identify answer. A value without braces is itself a path.
    const connection = [...(entry.fields ?? []).filter(field => field.secret !== true).map(field => field.name),
      ...Object.keys(entry.save ?? {})].map(name => `connection.${name}`);
    for (const name of lookupNames(entry)) {
      if (name.startsWith('connection.')) expect(connection).toContain(name);
      else expect(name).toMatch(/^[\w@$-]+(\.[\w@$-]+)*$/u);
    }
    // identify's request path holds none until a provider needs one.
    expect(placeholders(entry.identify?.request?.path ?? '')).toEqual([]);
    for (const name of placeholders(entry.webhook?.signed ?? '')) expect(['body', 'timestamp', 'method', 'url']).toContain(name);
  });

  const signInReplay = replays.get(id);
  if (typeof signInReplay !== 'object') {
    test.skip(`signs in on its recording: skipped, ${signInReplay ?? 'unknown'}`, () => undefined);
    return;
  }
  // An identify sends its request at most once: a key is proved with one call.
  const counted = (key: Exchange['key']) => {
    const answer = replay(signInReplay.recording, key);
    let calls = 0;
    const fetch: typeof globalThis.fetch = (input, init) => { calls += 1; return answer(input, init); };
    return { fetch, calls: () => calls };
  };
  test('signs in with a good key on its recording, sending identify once', async () => {
    const { fetch, calls } = counted('good');
    await expect(signIn(entry, GOOD_KEY, fetch)).resolves.toBeDefined();
    expect(calls()).toBe(1);
  });
  if (signInReplay.keys.includes('bad')) {
    test('refuses a bad key on its recording as rejected, sending identify once', async () => {
      const { fetch, calls } = counted('bad');
      await expect(signIn(entry, BAD_KEY, fetch)).rejects.toMatchObject({ code: 'rejected' });
      expect(calls()).toBe(1);
    });
  }
});

test("ids are unique and the folder's entries are found", () => {
  expect(entries.length).toBeGreaterThanOrEqual(17);
  expect(new Set(entries.map(([id]) => id)).size).toBe(entries.length);
});

test("catalogue.json's tier: every entry declared today; a real recording makes its own entry recorded, no other", () => {
  expect(entries.map(([id]) => tierOf(id, recordings))).toEqual(entries.map(() => 'declared'));
  const real = [{ file: 'acme.mail.recording.json', synthetic: false }];
  expect([tierOf('acme', real), tierOf('acme-two', real), tierOf('acm', real)]).toEqual(['recorded', 'declared', 'declared']);
});

test.each([
  ['states both header and path', { header: 'x-error', path: 'error' }],
  ['compares with neither header nor path', { equals: 'denied' }],
  ['wants a header to equal a non-string', { header: 'x-ratelimit-remaining', equals: 0 }],
])('a condition that %s fails the schema', (_, bad) => { expect(when.safeParse(bad).success).toBe(false); });

test.each([
  ['compares a header to a string', { header: 'x-ratelimit-remaining', equals: '0' }],
  ['compares a path to a boolean', { path: 'active', equals: false }],
])('a condition that %s matches the schema', (_, good) => { expect(when.safeParse(good).success).toBe(true); });

const key = { id: 'k', name: 'K', http: { baseUrl: 'https://api.k.test' } } as const;
const oauth2 = { ...key, auth: [{ kind: 'oauth2', authorizeUrl: 'https://k.test/authorize', tokenUrl: 'https://k.test/token' }] } as const;
const secret = { name: 'apiKey', title: 'API key', secret: true } as const;
test.each<[Rule, Entry]>([
  ['one secret field, the only one a key entry has', defineProvider({ ...key, auth: [{ kind: 'key' }] })],
  ['one secret field, the only one a key entry has', defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'other', title: 'Other', secret: true }] })],
  ['one secret field, the only one a key entry has', defineProvider({ ...oauth2, scopes: { default: [] },
    fields: [secret, { name: 'other', title: 'Other', secret: true }] })],
  ["a request when a value reads identify's answer", defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { id: 'workspace_id' } })],
  ["a request when a value reads identify's answer", defineProvider({ ...oauth2, scopes: { default: [] },
    identify: { id: 'tokenAnswer.team.id' }, save: { region: 'Region {region}' } })],
  ['no token answer, scopes or RFC 7009 revoke on a key entry', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { id: 'tokenAnswer.team.id' } })],
  ['no token answer, scopes or RFC 7009 revoke on a key entry', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    scopes: { default: ['read'] } })],
  ['no token answer, scopes or RFC 7009 revoke on a key entry', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    revoke: { url: 'https://k.test/revoke', token: ['access'] } })],
  ['scopes on an oauth2 entry', defineProvider(oauth2)],
])('an entry without %s is refused', (rule, bad) => { expect(runnable[rule](bad)).toBe(false); });
