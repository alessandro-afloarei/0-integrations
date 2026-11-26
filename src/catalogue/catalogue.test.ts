import { globSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { identifyAccount, lookupNames } from '../account.js';
import { defineProvider, type Entry, type Shape } from '../catalogue.js';
import { finishConnect } from '../connect.js';
import { BAD_KEY, GOOD_KEY, replay, type Recording } from '../kit.test-support.js';
import { clashing, placed, placeholders, shapeAt } from '../rules.js';
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

/** Every recording in this folder, by its file name: `<id>.recording.json` or `<id>.<part>.recording.json`. Read as the build
 * reads it: only `synthetic: false` is a real recording. */
const recordings = globSync('src/catalogue/*.recording.json').sort().map(file => {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Omit<Recording, 'synthetic'> & { synthetic?: unknown };
  return { ...json, file: basename(file), synthetic: json.synthetic !== false };
});
/** Whether a recording's file name names one of the entries: `<id>.` starts it. */
const besideAnEntry = (file: string, ids: readonly string[]) => ids.some(id => file.startsWith(`${id}.`));

/** A key entry's plain fields, each `kit-<name>`. */
const kitValues = (entry: Entry) =>
  Object.fromEntries((entry.fields ?? []).filter(field => field.secret !== true).map(field => [field.name, `kit-${field.name}`]));

/** Signs in with a key: a key entry through `finishConnect`, an OAuth entry's token through `identifyAccount`. */
function signIn(entry: Entry, key: string, fetch: typeof globalThis.fetch) {
  if (entry.auth[0].kind === 'oauth2') return identifyAccount(entry, { token: key, fetch });
  const secret = (entry.fields ?? []).find(field => field.secret === true)?.name ?? '';
  return finishConnect(entry, { secret: { [secret]: key }, values: kitValues(entry), fetch });
}

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
const send = z.union([z.strictObject({ header: z.string() }), z.strictObject({ basic: z.tuple([template, template]) }),
  z.strictObject({ query: z.record(z.string(), template) })])
  .refine(item => !('query' in item) || Object.keys(item.query).length > 0, 'a query send names at least one parameter');
const value = z.union([z.string(), z.array(z.string())]);
const method = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const request = z.strictObject({ method: method.optional(), path: template.optional(),
  query: z.record(z.string(), z.string()).optional(), graphql: z.string().optional() });
const shape: z.ZodType<Shape> = z.lazy(() =>
  z.union([z.enum(['string', 'integer', 'number', 'boolean', 'unknown']), z.tuple([shape]), z.record(z.string(), shape)]));
const operationParts = { kind: z.enum(['read', 'write', 'delete']).optional(),
  params: z.record(z.string(), z.strictObject({ in: z.enum(['path', 'query', 'body', 'variables']), type: shape,
    required: z.literal(true).optional(), nullable: z.literal(true).optional(), enum: z.array(z.string()).optional(),
    description: z.string().optional() })).optional(),
  result: shape.optional(), records: z.string().optional(), paging: z.string().optional(), notFound: z.literal('null').optional() };
/** The entry types as a schema. Tests only: no published declaration may name zod. */
const entrySchema = z.strictObject({
  // An id is the name its file exports it under, so it holds no `-`.
  id: z.string().regex(/^[a-z][a-z0-9]*$/u), name: z.string().min(1), docs: z.string().optional(),
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
  operations: z.record(z.string(), z.union([z.strictObject({ method: method.optional(), path: template, ...operationParts }),
    z.strictObject({ graphql: z.string(), ...operationParts })])).optional(),
});

/** Every function anywhere in a value, by its path. */
function functionsIn(value: unknown, at = ''): string[] {
  if (typeof value === 'function') return [at || '(root)'];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => functionsIn(item, at ? `${at}.${key}` : key));
}

/** What the engine cannot run, each a rule every entry passes. */
const reads = (entry: Entry, prefix: string) => lookupNames(entry).filter(name => name.startsWith(prefix));
const operations = (entry: Entry) => Object.values(entry.operations ?? {});
const params = (entry: Entry) => operations(entry).flatMap(op => Object.values(op.params ?? {}));
const runnable = {
  // Every claim an entry makes is checked against the provider's own page.
  'an https docs page': (entry: Entry) => entry.docs?.startsWith('https://') === true,
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
  'a declared paging shape for every paged operation': (entry: Entry) =>
    operations(entry).every(op => op.paging === undefined || Object.hasOwn(entry.paging ?? {}, op.paging)),
  "a required path parameter for every {name} in an operation's path": (entry: Entry) => operations(entry).every(op =>
    !('path' in op) || placeholders(op.path).every(name => op.params?.[name]?.in === 'path' && op.params[name].required === true)),
  // The rule `client()` applies: `pages` and `pages.markdown` would be one property of the client, `a..b` none, and
  // `json` or `then` would hide one of the client's own.
  'operation ids a client can hold': (entry: Entry) => clashing(Object.keys(entry.operations ?? {})) === undefined,
  // A parameter with no place in the request would be left off it silently.
  'a place in the request for every parameter': (entry: Entry) => operations(entry).every(op =>
    Object.entries(op.params ?? {}).every(([name, param]) => placed(op, name, param))),
  // The client checks an argument against its enum as a string.
  'an enum only on a string parameter': (entry: Entry) => params(entry).every(param => param.enum === undefined || param.type === 'string'),
  // A path segment and a query value are one string each: never null, a list or an object.
  'only a scalar, non-nullable parameter in a path or a query': (entry: Entry) => params(entry).every(param =>
    (param.in !== 'path' && param.in !== 'query') || (param.nullable === undefined && typeof param.type === 'string')),
  // A paged operation yields its records: a 404 is no record to answer null for.
  'notFound only on an unpaged operation': (entry: Entry) => operations(entry).every(op => op.paging === undefined || op.notFound === undefined),
  // A saved value would replace the field the person entered, which `Connected` types as a string.
  "save keys apart from the fields' names": (entry: Entry) =>
    Object.keys(entry.save ?? {}).every(name => !(entry.fields ?? []).some(field => field.name === name)),
  // Otherwise the records are typed `unknown`.
  "a records path to a list in the operation's result": (entry: Entry) => operations(entry).every(op =>
    op.records === undefined || op.result === undefined || Array.isArray(shapeAt(op.result, op.records))),
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
    const sent = !('send' in auth) || 'header' in auth.send ? []
      : 'basic' in auth.send ? auth.send.basic : Object.values(auth.send.query);
    for (const name of sent.flatMap(placeholders)) expect([...fields, 'token']).toContain(name);
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

  // With a recording beside it, identify replays a good and a bad key on its recordings' exchanges merged, sending its
  // request once; a missing exchange fails with the request it wanted. The account names what the recording holds.
  const [first, ...rest] = recordings.filter(({ file }) => file.startsWith(`${id}.`));
  if (entry.identify?.request === undefined || first === undefined) return;
  const recording = { ...first, provider: id, exchanges: [first, ...rest].flatMap(item => item.exchanges) };
  const recorded = JSON.stringify([recording.exchanges.filter(item => item.key === 'good').map(item => item.response), kitValues(entry)]);
  test.each(['good', 'bad'] as const)('signs in on its recording with a %s key, sending identify once', async key => {
    const fetch = vi.fn(replay(recording, key));
    const signedIn = signIn(entry, key === 'good' ? GOOD_KEY : BAD_KEY, fetch);
    if (key === 'bad') await expect(signedIn).rejects.toMatchObject({ code: 'rejected' });
    else {
      // No account only when the entry declares no id: identify is then a credential check.
      const { account } = await signedIn;
      if (account === null) expect(entry.identify?.id).toBeUndefined();
      else expect(recorded.toLowerCase()).toContain(account.id.toLowerCase());
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

test("ids are unique and the folder's entries are found", () => {
  expect(entries.length).toBeGreaterThan(0);
  expect(new Set(entries.map(([id]) => id)).size).toBe(entries.length);
});

test("catalogue.json's tier: a real recording makes its own entry recorded, no other", () => {
  const real = [{ file: 'acme.mail.recording.json', synthetic: false }];
  expect([tierOf('acme', real), tierOf('acme-two', real), tierOf('acm', real)]).toEqual(['recorded', 'declared', 'declared']);
});

test('every recording sits beside an entry', () => {
  const ids = entries.map(([id]) => id);
  expect(recordings.map(({ file }) => file).filter(file => !besideAnEntry(file, ids))).toEqual([]);
});

test.each([['acme.mail.recording.json', true], ['acme-two.recording.json', false], ['acm.recording.json', false]])(
  'a recording named %s sits beside the entry acme: %s', (file, beside) => { expect(besideAnEntry(file, ['acme'])).toBe(beside); });

test.each([
  ['states both header and path', { header: 'x-error', path: 'error' }],
  ['compares with neither header nor path', { equals: 'denied' }],
  ['wants a header to equal a non-string', { header: 'x-ratelimit-remaining', equals: 0 }],
])('a condition that %s fails the schema', (_, bad) => { expect(when.safeParse(bad).success).toBe(false); });

test.each([
  ['compares a header to a string', { header: 'x-ratelimit-remaining', equals: '0' }],
  ['compares a path to a boolean', { path: 'active', equals: false }],
])('a condition that %s matches the schema', (_, good) => { expect(when.safeParse(good).success).toBe(true); });

const key = { id: 'k', name: 'K', docs: 'https://k.test/docs', http: { baseUrl: 'https://api.k.test' } } as const;
const oauth2 = { ...key, auth: [{ kind: 'oauth2', authorizeUrl: 'https://k.test/authorize', tokenUrl: 'https://k.test/token' }] } as const;
const secret = { name: 'apiKey', title: 'API key', secret: true } as const;
test.each<[Rule, Entry]>([
  ['an https docs page', defineProvider({ id: 'k', name: 'K', http: key.http, auth: [{ kind: 'key' }], fields: [secret] })],
  ['an https docs page', defineProvider({ ...key, docs: 'http://k.test/docs', auth: [{ kind: 'key' }], fields: [secret] })],
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
  ["save keys apart from the fields' names", defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'region', title: 'Region' }], identify: { request: { path: '/me' } }, save: { region: 'region' } })],
  ...([
    ['operation ids a client can hold', { pages: { path: '/pages' }, 'pages.markdown': { path: '/md' } }],
    ['operation ids a client can hold', { '': { path: '/a' } }],
    ['operation ids a client can hold', { 'a..b': { path: '/a' } }],
    ['a place in the request for every parameter', { get: { path: '/items', params: { id: { in: 'path', type: 'string', required: true } } } }],
    ['a place in the request for every parameter', { get: { path: '/items', params: { first: { in: 'variables', type: 'integer' } } } }],
    ['a place in the request for every parameter', { get: { path: '/items', params: { q: { in: 'body', type: 'string' } } } }],
    ['a place in the request for every parameter', { me: { graphql: 'query { me { id } }', params: { id: { in: 'query', type: 'string' } } } }],
    ['notFound only on an unpaged operation', { list: { path: '/items', paging: 'cursor', notFound: 'null' } }],
    ["a records path to a list in the operation's result", { list: { path: '/items', records: 'data.itemz', result: { data: { items: ['string'] } } } }],
    ["a records path to a list in the operation's result", { list: { path: '/items', records: 'data', result: { data: { items: ['string'] } } } }],
    ['an enum only on a string parameter', { list: { path: '/items', params: { n: { in: 'query', type: 'integer', enum: ['1'] } } } }],
    ['only a scalar, non-nullable parameter in a path or a query', { list: { path: '/items', params: { q: { in: 'query', type: 'string', nullable: true } } } }],
    ['only a scalar, non-nullable parameter in a path or a query', { list: { path: '/items', params: { q: { in: 'query', type: ['string'] } } } }],
    ['only a scalar, non-nullable parameter in a path or a query', { get: { path: '/items/{id}', params: { id: { in: 'path', type: { a: 'string' }, required: true } } } }],
  ] as const).map(([rule, operations]): [Rule, Entry] => [rule, defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], operations })]),
  // The compiler refuses these through `defineProvider`; they are entries read as data.
  ['a declared paging shape for every paged operation', { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { list: { path: '/items', paging: 'cursor' } } }],
  ["a required path parameter for every {name} in an operation's path", { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { get: { path: '/items/{id}', params: { id: { in: 'query', type: 'string', required: true } } } } }],
  ["a required path parameter for every {name} in an operation's path", { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { get: { path: '/items/{id}', params: { id: { in: 'path', type: 'string' } } } } }],
  ['operation ids a client can hold', { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { 'request.create': { method: 'POST', path: '/requests' } } }],
  ['operation ids a client can hold', { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { then: { path: '/then' } } }],
])('an entry without %s is refused', (rule, bad) => { expect(runnable[rule](bad)).toBe(false); });

test('a query send that names no parameter fails the schema, with what to fix', () => {
  const bad = { ...key, auth: [{ kind: 'key', send: { query: {} } }], fields: [secret] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(['a query send names at least one parameter']);
});

test('an entry whose operations keep every rule passes them all', () => {
  const good = defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'cursor' } } },
    operations: {
      'pages.list': { path: '/pages/{space}', paging: 'cursor', records: 'data.items',
        params: { space: { in: 'path', type: 'string', required: true }, q: { in: 'query', type: 'string' } },
        result: { data: { items: [{ id: 'string' }] }, 'next?': 'string' } },
      'pages.events': { path: '/events', paging: 'cursor', records: 'a.b', result: { 'a.b': ['string'], a: { b: 'string' } } },
      'requests.create': { method: 'POST', path: '/requests', params: { title: { in: 'body', type: 'string', required: true },
        state: { in: 'query', type: 'string', enum: ['open'] }, parent: { in: 'body', type: { id: 'string' }, nullable: true } } },
      'then.later': { path: '/later' },
      me: { graphql: 'query Me($first: Int) { me { id } }', params: { first: { in: 'variables', type: 'integer' } } },
    } });
  expect(Object.keys(runnable).filter(rule => !runnable[rule as Rule](good))).toEqual([]);
  expect(entrySchema.safeParse(good).error).toBeUndefined();
});

test.each([['json', true], ['request.create', true], ['paginate.all', true], ['then', true],
  ['requests.create', false], ['pages.markdown', false], ['jsonish', false], ['then.later', false], ['thenable', false]])('operation id %s alone is refused: %s', (id, taken) => {
  expect(clashing([id]) !== undefined).toBe(taken);
});
