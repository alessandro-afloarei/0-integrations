import { globSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { identifyAccount, lookupNames } from '../account.js';
import { defineProvider, type Entry, type Field, type Shape } from '../catalogue.js';
import { finishConnect } from '../connect.js';
import { createClient } from '../http.js';
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
  query: z.record(z.string(), z.string()).optional(), graphql: z.string().optional(), base: z.string().optional() });
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
  fields: z.array(z.strictObject({ name: z.string(), title: z.string().min(1, "a field's title says what to enter: give it words"),
    secret: z.literal(true).optional(), default: z.string().optional(),
    help: z.string().min(1, "a field's help is a line a person reads: give it words, or leave it out").optional(),
    choices: z.array(z.string()).optional() })).optional(),
  auth: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('key'), send: send.optional() }),
    z.strictObject({ kind: z.literal('oauth2'), authorizeUrl: https, tokenUrl: https, refreshUrl: https.optional(),
      json: z.literal(true, '`json` is `true` or left out').optional(), pkce: z.literal(false).optional(),
      clientAuth: z.literal('basic').optional(), scopeSeparator: z.literal(',').optional(),
      authorizeParams: z.record(z.string(), z.string()).optional(), tokenTypes: z.array(z.string()).optional(),
      failed: when.optional(), reusesGrant: z.literal(true).optional() }),
    z.strictObject({ kind: z.literal('token'), send: send.optional(), request: z.strictObject({ url: https,
      body: z.record(z.string(), z.string("a token request's body is a flat record of templates")), json: z.literal(true).optional(), basic: z.tuple([template, template]).optional(),
      token: z.string().optional() }) }),
  ])).length(1), // one sign-in each until a provider needs two
  scopes: z.strictObject({ default: z.array(z.string()), requireGranted: z.literal(true).optional() }).optional(),
  identify: z.strictObject({ request: request.optional(), id: value.optional(), name: value.optional(),
    lowercase: z.literal(true).optional(),
    rejectWhen: z.array(condition(whenObject.extend({ detail: z.string().optional() }))).optional() }).optional(),
  save: z.record(z.string(), value).optional(),
  revoke: z.union([z.strictObject({ url: https, token: z.array(z.enum(['refresh', 'access'])), goneErrors: z.array(z.string()).optional() }),
    z.strictObject({ request, goneErrors: z.array(z.string()).optional() })]).optional(),
  http: z.strictObject({ baseUrl: https, host: z.string().optional(), bases: z.record(z.string(), https).optional(), headers: z.record(z.string(), z.string()).optional(),
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
/** A URL's host part: between `https://` and the first `/` after it. */
const hostOf = (url: string) => url.slice('https://'.length).split('/')[0] ?? '';
const baseHost = (entry: Entry) => hostOf(entry.http.baseUrl);
/** A token entry's request. */
const tokenRequest = (entry: Entry) => (entry.auth[0].kind === 'token' ? entry.auth[0].request : undefined);
const plainFields = (entry: Entry) => (entry.fields ?? []).filter(field => field.secret !== true).map(field => field.name);
/** The declared calls that may name a base: identify's request and a request revoke. */
const calls = (entry: Entry) => [entry.identify?.request, entry.revoke !== undefined && 'request' in entry.revoke ? entry.revoke.request : undefined];
const params = (entry: Entry) => operations(entry).flatMap(op => Object.values(op.params ?? {}));
/** The templates a Basic or query send fills, and the secret field's name. */
const sentTemplates = (entry: Entry) => {
  const auth = entry.auth[0];
  return !('send' in auth) || 'header' in auth.send ? [] : 'basic' in auth.send ? auth.send.basic : Object.values(auth.send.query);
};
const secretField = (entry: Entry) => (entry.fields ?? []).find(field => field.secret === true)?.name;
const runnable = {
  // A Basic or query send that names no secret would send a credential anyone could make.
  '`auth.send` basic or query: name the secret ({token}, or a key entry\'s secret field)': (entry: Entry) => sentTemplates(entry).length === 0
    || sentTemplates(entry).flatMap(placeholders).some(name => name === 'token' || (entry.auth[0].kind === 'key' && name === secretField(entry))),
  "`auth.send` templates: name only the entry's fields and {token}": (entry: Entry) => sentTemplates(entry).flatMap(placeholders)
    .every(name => name === 'token' || (entry.fields ?? []).some(field => field.name === name)),
  // The secret field goes only to the token request: a call carries the token it gave.
  "a `token` entry's `send`: name no secret field": (entry: Entry) => entry.auth[0].kind !== 'token'
    || !sentTemplates(entry).flatMap(placeholders).some(name => name === secretField(entry)),
  // Every claim an entry makes is checked against the provider's own page.
  'a `docs` link to the provider\'s page, https': (entry: Entry) => entry.docs?.startsWith('https://') === true,
  // A typed host is checked against a pattern before the token is read; a fixed one, or a value in the path, needs none.
  'an `http.host` pattern (a name, `*.` and a domain, or `*`) exactly when the base\'s host has a placeholder': (entry: Entry) => (placeholders(baseHost(entry)).length > 0
    ? /^(\*|(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+)$/u.test(entry.http.host ?? '') : entry.http.host === undefined),
  // Any host is allowed only where the person types the whole host, which is then address-guarded.
  "`http.host: '*'` only on a base whose whole host is one placeholder": (entry: Entry) => entry.http.host !== '*'
    || /^\{[^{}]+\}$/u.test(baseHost(entry)),
  // The token URL is filled by the base's rule, so a typed host there is checked against the same pattern.
  "a token request's `url` with a placeholder in its host only beside an `http.host` pattern": (entry: Entry) =>
    placeholders(hostOf(tokenRequest(entry)?.url ?? 'https://')).length === 0 || entry.http.host !== undefined,
  // A URL is filled from plain values, never a secret; the body and Basic from either.
  // What the engine cannot fill is `template_missing` at the first sign-in; a request that sends no secret proves nothing.
  "a `token` request the engine can run: only the entry's fields (a plain one in `url`), the secret field in `body` or `basic`, a non-empty `token` path": (entry: Entry) => {
    const request = tokenRequest(entry);
    if (request === undefined) return true;
    const sent = [...Object.values(request.body), ...request.basic ?? []].flatMap(placeholders);
    return placeholders(request.url).every(name => plainFields(entry).includes(name))
      && sent.every(name => (entry.fields ?? []).some(field => field.name === name))
      && sent.some(name => name === secretField(entry))
      && request.token?.trim() !== '';
  },
  'a plain field (not secret) or a `save` key for every `http.baseUrl` placeholder': (entry: Entry) => placeholders(entry.http.baseUrl)
    .every(name => (entry.fields ?? []).some(field => field.name === name && field.secret !== true) || Object.hasOwn(entry.save ?? {}, name)),
  // A named base is used as written: a `{name}` in it would send the token to a host spelt with braces.
  '`http.bases` written out in full, with no placeholder (none is ever filled)': (entry: Entry) =>
    Object.values(entry.http.bases ?? {}).every(base => placeholders(base).length === 0),
  // Otherwise the call is refused, `base_unknown`, when it is made.
  "a call's `base` one of `http.bases`": (entry: Entry) => calls(entry).every(call => call?.base === undefined
    || Object.hasOwn(entry.http.bases ?? {}, call.base)),
  // A choice the engine would refuse fails here, not when a person picks it.
  "`fields[].choices` and `default` that fill the base to a host `http.host` takes": (entry: Entry) => {
    const named = (entry.fields ?? []).filter(field => placeholders(entry.http.baseUrl).includes(field.name));
    // A saved value has no choices: a stand-in fills it.
    const saved = Object.keys(entry.save ?? {}).map((name): [string, string] => [name, 'x']);
    const first = (field: Field) => field.default ?? field.choices?.[0] ?? 'x';
    return named.every(field => [...field.choices ?? [], ...field.default === undefined ? [] : [field.default]].every(value => {
      const values = { ...Object.fromEntries([...saved, ...named.map((other): [string, string] => [other.name, first(other)])]), [field.name]: value };
      try {
        return createClient(entry, { token: () => Promise.resolve('t'), fetch: globalThis.fetch, values }).baseUrl !== '';
      } catch { return false; }
    }));
  },
  // A connect screen draws the choices; the default is what it shows first.
  '`fields[].choices` a non-empty list of unique values that holds the `default`': (entry: Entry) => (entry.fields ?? []).every(field =>
    field.choices === undefined || (field.choices.length > 0 && new Set(field.choices).size === field.choices.length
      && (field.default === undefined || field.choices.includes(field.default)))),
  // A secret is never shown or guessed.
  'no `default` or `choices` on a secret field': (entry: Entry) => (entry.fields ?? [])
    .every(field => field.secret !== true || (field.default === undefined && field.choices === undefined)),
  // The engine sends only that field as `{token}`.
  'at most one secret field in `fields`, exactly one on a key or token entry': (entry: Entry) => {
    const secrets = (entry.fields ?? []).filter(field => field.secret === true).length;
    return entry.auth[0].kind === 'oauth2' ? secrets <= 1 : secrets === 1;
  },
  // No silent GET to the base URL.
  "an `identify.request` whenever a value reads identify's answer": (entry: Entry) => entry.identify?.request !== undefined
    || lookupNames(entry).every(name => name.startsWith('tokenAnswer.') || name.startsWith('connection.')),
  // The engine withholds these keys; an entry naming one would read nothing where it meant the token.
  'no `identify` or `save` value that reads the token itself from `tokenAnswer.*` (it is never returned: read another key)': (entry: Entry) => {
    const auth = entry.auth[0];
    const own = auth.kind === 'token' ? [(auth.request.token ?? 'access_token').split('.')[0]] : ['access_token', 'refresh_token'];
    return reads(entry, 'tokenAnswer.').every(name => !own.includes(name.split('.')[1]));
  },
  'no `tokenAnswer.*` on a key entry': (entry: Entry) => entry.auth[0].kind !== 'key' || reads(entry, 'tokenAnswer.').length === 0,
  // A token entry asks no scopes and gives no OAuth grant to revoke.
  'no `scopes` or RFC 7009 `revoke` on a key or token entry': (entry: Entry) => entry.auth[0].kind === 'oauth2'
    || (entry.scopes === undefined && !(entry.revoke !== undefined && 'url' in entry.revoke)),
  '`scopes` on an oauth2 entry': (entry: Entry) => entry.auth[0].kind !== 'oauth2' || entry.scopes !== undefined,
  'an `operations[].paging` name declared in `paging`': (entry: Entry) =>
    operations(entry).every(op => op.paging === undefined || Object.hasOwn(entry.paging ?? {}, op.paging)),
  "a required `in: 'path'` parameter for every {name} in an operation's `path`": (entry: Entry) => operations(entry).every(op =>
    !('path' in op) || placeholders(op.path).every(name => op.params?.[name]?.in === 'path' && op.params[name].required === true)),
  // The rule `client()` applies: `pages` and `pages.markdown` would be one property of the client, `a..b` none, and
  // `json` or `then` would hide one of the client's own.
  '`operations` ids a client can hold (no empty segment, no dotted prefix of another, not json, request, paginate or then)': (entry: Entry) => clashing(Object.keys(entry.operations ?? {})) === undefined,
  // A parameter with no place in the request would be left off it silently.
  'a `params[].in` the operation\'s request has (a path parameter in its `path`, no body on a GET, only variables on GraphQL)': (entry: Entry) => operations(entry).every(op =>
    Object.entries(op.params ?? {}).every(([name, param]) => placed(op, name, param))),
  // The client checks an argument against its enum as a string.
  '`params[].enum` only on a `type: \'string\'` parameter': (entry: Entry) => params(entry).every(param => param.enum === undefined || param.type === 'string'),
  // A path segment and a query value are one string each: never null, a list or an object.
  'only a scalar, non-`nullable` parameter `in` a path or a query': (entry: Entry) => params(entry).every(param =>
    (param.in !== 'path' && param.in !== 'query') || (param.nullable === undefined && typeof param.type === 'string')),
  // A paged operation yields its records: a 404 is no record to answer null for.
  '`notFound` only on an operation with no `paging`': (entry: Entry) => operations(entry).every(op => op.paging === undefined || op.notFound === undefined),
  // A saved value would replace the field the person entered, which `Connected` types as a string.
  "`save` keys apart from the fields' names": (entry: Entry) =>
    Object.keys(entry.save ?? {}).every(name => !(entry.fields ?? []).some(field => field.name === name)),
  // Otherwise the records are typed `unknown`.
  "an `operations[].records` path to a list in the operation's `result`": (entry: Entry) => operations(entry).every(op =>
    op.records === undefined || op.result === undefined || Array.isArray(shapeAt(op.result, op.records))),
};
type Rule = keyof typeof runnable;

describe.each(entries)('%s', (id, entry) => {
  test('matches the entry types', () => { expect(entrySchema.safeParse(entry).error).toBeUndefined(); });
  test('holds no function', () => { expect(functionsIn(entry)).toEqual([]); });
  test('prints to JSON as it is', () => { expect(JSON.parse(JSON.stringify(entry))).toEqual(entry); });
  test.each(Object.keys(runnable) as Rule[])('declares %s', rule => { expect(runnable[rule](entry)).toBe(true); });
  test('names only what each place allows in its templates', () => {
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
/** A token entry with Zoom's shape: a plain client id, one secret, Basic client authentication. */
const tokened = { ...key, fields: [{ name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Client secret', secret: true }],
  auth: [{ kind: 'token', request: { url: 'https://k.test/token', body: { grant_type: 'client_credentials' },
    basic: ['{clientId}', '{clientSecret}'] } }] } as const;
test.each<[Rule, Entry]>([
  ['a `docs` link to the provider\'s page, https', defineProvider({ id: 'k', name: 'K', http: key.http, auth: [{ kind: 'key' }], fields: [secret] })],
  ['a `docs` link to the provider\'s page, https', defineProvider({ ...key, docs: 'http://k.test/docs', auth: [{ kind: 'key' }], fields: [secret] })],
  ['`auth.send` basic or query: name the secret ({token}, or a key entry\'s secret field)', defineProvider({ ...key, fields: [secret, { name: 'apiId', title: 'API ID' }],
    auth: [{ kind: 'key', send: { query: { id: '{apiId}' } } }] })],
  ['`auth.send` basic or query: name the secret ({token}, or a key entry\'s secret field)', defineProvider({ ...key, fields: [secret, { name: 'apiId', title: 'API ID' }],
    auth: [{ kind: 'key', send: { basic: ['{apiId}', ''] } }] })],
  ["`auth.send` templates: name only the entry's fields and {token}", defineProvider({ ...key, fields: [secret],
    auth: [{ kind: 'key', send: { query: { key: '{apiKey}', account: '{acount}' } } }] })],
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...key, auth: [{ kind: 'key' }] })],
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'other', title: 'Other', secret: true }] })],
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...oauth2, scopes: { default: [] },
    fields: [secret, { name: 'other', title: 'Other', secret: true }] })],
  ["an `identify.request` whenever a value reads identify's answer", defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { id: 'workspace_id' } })],
  ["an `identify.request` whenever a value reads identify's answer", defineProvider({ ...oauth2, scopes: { default: [] },
    identify: { id: 'tokenAnswer.team.id' }, save: { region: 'Region {region}' } })],
  ['no `tokenAnswer.*` on a key entry', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { id: 'tokenAnswer.team.id' } })],
  ['no `scopes` or RFC 7009 `revoke` on a key or token entry', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    scopes: { default: ['read'] } })],
  ['no `scopes` or RFC 7009 `revoke` on a key or token entry', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    revoke: { url: 'https://k.test/revoke', token: ['access'] } })],
  ['no `scopes` or RFC 7009 `revoke` on a key or token entry', defineProvider({ ...tokened, scopes: { default: ['read'] } })],
  ['no `scopes` or RFC 7009 `revoke` on a key or token entry', defineProvider({ ...tokened,
    revoke: { url: 'https://k.test/revoke', token: ['access'] } })],
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...tokened,
    fields: [...tokened.fields, { name: 'other', title: 'Other', secret: true }] })],
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...tokened, fields: [{ name: 'clientId', title: 'Client ID' }] })],
  // A token entry's call carries the token it gave: naming its secret field is no secret sent.
  ["`auth.send` basic or query: name the secret ({token}, or a key entry's secret field)", defineProvider({ ...tokened,
    auth: [{ ...tokened.auth[0], send: { query: { s: '{clientSecret}' } } }] })],
  ["a `token` entry's `send`: name no secret field", defineProvider({ ...tokened,
    auth: [{ ...tokened.auth[0], send: { basic: ['{clientId}', '{clientSecret}'] } }] })],
  ["a token request's `url` with a placeholder in its host only beside an `http.host` pattern", defineProvider({ ...tokened,
    fields: [...tokened.fields, { name: 'apiHost', title: 'Host' }], auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request,
      url: 'https://{apiHost}/token' } }] })],
  ...([{ url: 'https://k.test/{tenant}/token' }, { url: 'https://k.test/{clientSecret}/token' }, { body: { scope: '{scop}' } },
    { body: { a: '{nope}' } }, { basic: ['{clientld}', '{clientSecret}'] }, { basic: ['{clientId}', '{secret}'] },
    { basic: ['{clientId}', 'fixed'] }, { token: '' }] as const).map((part): [Rule, Entry] => [
    "a `token` request the engine can run: only the entry's fields (a plain one in `url`), the secret field in `body` or `basic`, a non-empty `token` path",
    defineProvider({ ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, ...part } }] })]),
  ...[defineProvider({ ...tokened, save: { t: 'tokenAnswer.access_token' } }),
    defineProvider({ ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, token: 'id' } }], identify: { id: 'tokenAnswer.id' } }),
    defineProvider({ ...oauth2, scopes: { default: [] }, identify: { id: 'tokenAnswer.refresh_token' } }),
    defineProvider({ ...oauth2, scopes: { default: [] }, save: { a: 'tokenAnswer.access_token.x' } })]
    .map((entry): [Rule, Entry] => ["no `identify` or `save` value that reads the token itself from `tokenAnswer.*` (it is never returned: read another key)", entry]),
  ['`scopes` on an oauth2 entry', defineProvider(oauth2)],
  ...([
    ['an `http.host` pattern (a name, `*.` and a domain, or `*`) exactly when the base\'s host has a placeholder', { baseUrl: 'https://{region}.k.test' }],
    ['an `http.host` pattern (a name, `*.` and a domain, or `*`) exactly when the base\'s host has a placeholder', { baseUrl: 'https://api.k.test', host: 'api.k.test' }],
    ['an `http.host` pattern (a name, `*.` and a domain, or `*`) exactly when the base\'s host has a placeholder', { baseUrl: 'https://{region}', host: 'example.com/x' }],
    ['an `http.host` pattern (a name, `*.` and a domain, or `*`) exactly when the base\'s host has a placeholder', { baseUrl: 'https://{region}', host: '*.com' }],
    ['an `http.host` pattern (a name, `*.` and a domain, or `*`) exactly when the base\'s host has a placeholder', { baseUrl: 'https://api.k.test/{region}', host: 'api.k.test' }],
    ["`http.host: '*'` only on a base whose whole host is one placeholder", { baseUrl: 'https://{region}.example.com', host: '*' }],
    ['a plain field (not secret) or a `save` key for every `http.baseUrl` placeholder', { baseUrl: 'https://{zone}.k.test', host: '*.k.test' }],
    ['a plain field (not secret) or a `save` key for every `http.baseUrl` placeholder', { baseUrl: 'https://api.k.test/{zone}' }],
    ['a plain field (not secret) or a `save` key for every `http.baseUrl` placeholder', { baseUrl: 'https://{apiKey}.k.test', host: '*.k.test' }],
  ] as const).map(([rule, http]): [Rule, Entry] => [rule, { ...key, http, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'region', title: 'Region' }] }]),
  ...([
    ['`fields[].choices` a non-empty list of unique values that holds the `default`', { choices: ['us', 'eu'], default: 'au' }],
    ['`fields[].choices` a non-empty list of unique values that holds the `default`', { choices: [] }],
    ['`fields[].choices` a non-empty list of unique values that holds the `default`', { choices: ['us', 'us'] }],
  ] as const).map(([rule, field]): [Rule, Entry] => [rule, defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'region', title: 'Region', ...field }] })]),
  ...([
    [{ choices: ['api.mailgun.net'] }, 'mailgun.net'],
    [{ choices: ['api.mailgun.net', 'api.eu.mailgun.com'] }, '*.mailgun.net'],
    [{ default: 'api.mailgun.net' }, '*.mailgun.com'],
  ] as const).map(([field, host]): [Rule, Entry] => ["`fields[].choices` and `default` that fill the base to a host `http.host` takes",
    defineProvider({ ...key, http: { baseUrl: 'https://{region}', host }, auth: [{ kind: 'key' }],
      fields: [secret, { name: 'region', title: 'Region', ...field }] })]),
  ['no `default` or `choices` on a secret field', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [{ ...secret, default: 'k' }] })],
  ['no `default` or `choices` on a secret field', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [{ ...secret, choices: ['k'] }] })],
  ["a call's `base` one of `http.bases`", defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    http: { ...key.http, bases: { api: 'https://other.k.test' } }, identify: { request: { base: 'nope', path: '/me' } } })],
  ["a call's `base` one of `http.bases`", defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    revoke: { request: { base: 'api', method: 'POST', path: '/revoke' } } })],
  ['`http.bases` written out in full, with no placeholder (none is ever filled)', defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'region', title: 'Region' }], http: { ...key.http, bases: { api: 'https://{region}.k.test' } } })],
  ["`save` keys apart from the fields' names", defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'region', title: 'Region' }], identify: { request: { path: '/me' } }, save: { region: 'region' } })],
  ...([
    ['`operations` ids a client can hold (no empty segment, no dotted prefix of another, not json, request, paginate or then)', { pages: { path: '/pages' }, 'pages.markdown': { path: '/md' } }],
    ['`operations` ids a client can hold (no empty segment, no dotted prefix of another, not json, request, paginate or then)', { '': { path: '/a' } }],
    ['`operations` ids a client can hold (no empty segment, no dotted prefix of another, not json, request, paginate or then)', { 'a..b': { path: '/a' } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body on a GET, only variables on GraphQL)', { get: { path: '/items', params: { id: { in: 'path', type: 'string', required: true } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body on a GET, only variables on GraphQL)', { get: { path: '/items', params: { first: { in: 'variables', type: 'integer' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body on a GET, only variables on GraphQL)', { get: { path: '/items', params: { q: { in: 'body', type: 'string' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body on a GET, only variables on GraphQL)', { me: { graphql: 'query { me { id } }', params: { id: { in: 'query', type: 'string' } } } }],
    ['`notFound` only on an operation with no `paging`', { list: { path: '/items', paging: 'cursor', notFound: 'null' } }],
    ["an `operations[].records` path to a list in the operation's `result`", { list: { path: '/items', records: 'data.itemz', result: { data: { items: ['string'] } } } }],
    ["an `operations[].records` path to a list in the operation's `result`", { list: { path: '/items', records: 'data', result: { data: { items: ['string'] } } } }],
    ['`params[].enum` only on a `type: \'string\'` parameter', { list: { path: '/items', params: { n: { in: 'query', type: 'integer', enum: ['1'] } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path or a query', { list: { path: '/items', params: { q: { in: 'query', type: 'string', nullable: true } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path or a query', { list: { path: '/items', params: { q: { in: 'query', type: ['string'] } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path or a query', { get: { path: '/items/{id}', params: { id: { in: 'path', type: { a: 'string' }, required: true } } } }],
  ] as const).map(([rule, operations]): [Rule, Entry] => [rule, defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], operations })]),
  // The compiler refuses these through `defineProvider`; they are entries read as data.
  ['an `operations[].paging` name declared in `paging`', { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { list: { path: '/items', paging: 'cursor' } } }],
  ["a required `in: 'path'` parameter for every {name} in an operation's `path`", { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { get: { path: '/items/{id}', params: { id: { in: 'query', type: 'string', required: true } } } } }],
  ["a required `in: 'path'` parameter for every {name} in an operation's `path`", { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { get: { path: '/items/{id}', params: { id: { in: 'path', type: 'string' } } } } }],
  ['`operations` ids a client can hold (no empty segment, no dotted prefix of another, not json, request, paginate or then)', { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { 'request.create': { method: 'POST', path: '/requests' } } }],
  ['`operations` ids a client can hold (no empty segment, no dotted prefix of another, not json, request, paginate or then)', { ...key, auth: [{ kind: 'key' }], fields: [secret],
    operations: { then: { path: '/then' } } }],
])('an entry without %s is refused', (rule, bad) => { expect(runnable[rule](bad)).toBe(false); });

test.each([[{ title: '' }, "a field's title says what to enter: give it words"],
  [{ help: '' }, "a field's help is a line a person reads: give it words, or leave it out"]])(
  'a field with %j fails the schema, with what to fix', (part, message) => {
    const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret, { name: 'region', title: 'Region', ...part }] };
    expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([message]);
  });

test.each([[{ refreshUrl: 'http://k.test/refresh' }, 'refreshUrl', 'Invalid string: must start with "https://"'],
  [{ json: false }, 'json', '`json` is `true` or left out']])(
  'an oauth2 sign-in with %j fails the schema, with what to fix', (part, key, message) => {
    const bad = { ...oauth2, scopes: { default: [] }, auth: [{ ...oauth2.auth[0], ...part }] };
    expect(entrySchema.safeParse(bad).error?.issues.map(issue => [issue.path.at(-1), issue.message])).toEqual([[key, message]]);
  });

test('a token request whose body holds an object fails the schema, with what to fix', () => {
  const bad = { ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, body: { grant: { type: 'x' } } } }] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(["a token request's body is a flat record of templates"]);
});

test('a query send that names no parameter fails the schema, with what to fix', () => {
  const bad = { ...key, auth: [{ kind: 'key', send: { query: {} } }], fields: [secret] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(['a query send names at least one parameter']);
});

test("a base with a host from a field's choices and a path segment from a saved value passes every rule", () => {
  const good = defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret, { name: 'region', title: 'Region', choices: ['eu.k.test'] }],
    http: { baseUrl: 'https://{region}/sites/{siteId}', host: '*.k.test' }, identify: { request: { path: '/me' } }, save: { siteId: 'id' } });
  expect(Object.keys(runnable).filter(rule => !runnable[rule as Rule](good))).toEqual([]);
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
