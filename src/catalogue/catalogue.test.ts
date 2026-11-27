import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { lookupNames } from '../account.js';
import { defineProvider, signInWith, type Category, type Entry, type Field, type Shape, type Value } from '../catalogue.js';
import { finishConnect, startConnect } from '../connect.js';
import { GrantRevoked } from '../errors.js';
import { callBase, createClient, credentialOf, filledBase } from '../http.js';
import { refreshGrant, revokeGrant } from '../oauth.js';
import { retryPolicy } from '../http-response.js';
import { BAD_KEY, catalogueEntries, catalogueRecordings, GOOD_KEY, kitValues, recordedSignIn, replayProblem, signIn } from '../kit.test-support.js';
import { argumentShape, clashing, declaredUrls, hostPart, hostSplit, namedHosts, oauthUrls, pagedParam, pagedRecords, placed, placeholders, shapeAt } from '../rules.js';
import { fakeFetch, fakeProvider } from '../testing.js';
import { tierOf } from '../tier.js';

const entries = await catalogueEntries();
const recordings = catalogueRecordings();
/** Whether a recording's file name names one of the entries: `<id>.` starts it. */
const besideAnEntry = (file: string, ids: readonly string[]) => ids.some(id => file.startsWith(`${id}.`));

const https = z.string().startsWith('https://');
/** A header name as `Headers` takes it: one lowercase HTTP token (RFC 9110). `Headers.get('X Signature')` throws. */
const headerMessage = 'a header name is one lowercase HTTP token: no space, `:` or capital';
const headerName = z.string().regex(/^[a-z0-9!#$%&'*+.^_`|~-]+$/u, headerMessage);
const template = z.string();
const whenObject = z.strictObject({ status: z.union([z.number().int(), z.literal('error')]).optional(), header: headerName.optional(),
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
/** A wait an answer states: one header, or several (the longest present counts), or one body path. */
const wait = z.strictObject({ header: z.union([headerName, z.array(headerName).min(1)]).optional(), path: z.string().optional(),
  unit: z.enum(['s', 'ms', 'epochSeconds', 'epochMs'], { error: "a wait's `unit` is 's', 'ms', 'epochSeconds' or 'epochMs'" }) })
  .refine(item => (item.header === undefined) !== (item.path === undefined), 'a `wait` reads one `header` (or a list of headers) or one `path`');
const send = z.union([z.strictObject({ header: headerName, value: template.regex(/^\P{Cc}*$/u, 'a header `value` holds no control character').optional() }), z.strictObject({ basic: z.tuple([template, template]) }),
  z.strictObject({ query: z.record(z.string(), template) })])
  .refine(item => !('query' in item) || Object.keys(item.query).length > 0, 'a query send names at least one parameter');
const value = z.union([z.string(), z.array(z.string())]);
const method = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const request = z.strictObject({ method: method.optional(), path: template.optional(),
  query: z.record(z.string(), z.string()).optional(), graphql: z.string().optional(), base: z.string().optional() });
const shape: z.ZodType<Shape> = z.lazy(() =>
  z.union([z.enum(['string', 'integer', 'number', 'boolean', 'unknown']), z.tuple([shape]), z.record(z.string(), shape)]));
/** Every category once: the compiler refuses one missing from `Category` or not in it. */
const CATEGORIES: Record<Category, true> = { tasks: true, docs: true, chat: true, code: true, monitoring: true, crm: true,
  sales: true, mail: true, calendar: true, meetings: true, support: true, marketing: true, finance: true, hr: true,
  storage: true, ecommerce: true, phone: true, design: true, analytics: true, search: true };
const operationParts = { docs: https.optional(), kind: z.enum(['read', 'write', 'delete']).optional(),
  params: z.record(z.string(), z.strictObject({ in: z.enum(['path', 'query', 'body', 'form', 'variables']), type: shape,
    required: z.literal(true).optional(), nullable: z.literal(true).optional(), enum: z.array(z.string()).optional(),
    description: z.string().optional() })).optional(),
  result: shape.optional(), records: z.string().optional(), paging: z.string().optional(), notFound: z.literal('null').optional(),
  anyOf: z.array(z.array(z.string())).optional() };
const toleranceSeconds = z.number().int().positive().optional();
const timestamp = z.strictObject({ header: headerName, toleranceSeconds });
/** A piece's name in a `name=value,…` header: what splits the pieces never sits in it. */
const partName = z.string().regex(/^[^\s,=]+$/u, 'a `part` names one `name=value` piece: give it a name with no `,`, `=` or space');
/** What every webhook kind may declare. */
const webhookParts = { deliveryId: z.union([z.strictObject({ header: headerName }), z.strictObject({ body: z.array(z.string()).min(1) })]).optional(),
  challenge: z.strictObject({ when: when.refine(item => item.equals !== undefined || item.in !== undefined, 'a `challenge.when` compares a value: give `equals` or `in`').optional(),
    echo: z.union([z.string().min(1), z.strictObject({ query: z.string().min(1, 'a challenge `query` names its parameter: give the name') })]),
    text: z.literal(true).optional(), unsigned: z.literal(true).optional() })
    .refine(item => typeof item.echo === 'string' || item.text === true, 'a challenge read from a query is answered as text: give `text: true`').optional() };
const where = z.union([z.strictObject({ query: z.string() }), z.strictObject({ body: z.string() })]);
/** A next link's directory: a whole one (`/me/`), so `/meetings` is not under `/me`. */
const pathPrefix = z.string().regex(/^\/(?:.*\/)?$/u, '`pathPrefix` is a whole directory: start and end it with `/` (`/me/`)').optional();
const ONE_OF_EACH = 'at most one sign-in of each kind in `auth`: an app picks one by its kind';
const KEY_OR_TOKEN = 'a `key` or a `token` sign-in, never both: the key is the one the person enters';
const OAUTH_FIRST = 'OAuth 2 first, then the key or token: an entry used whole is its first sign-in, the one providers ask apps for other people to use';
const OWN_FIRST = "no own `fields`, `http` or `identify` on the first sign-in: its part is the entry's top level";
const CLIENT_AUTH = "`clientAuth` is `'basic'` or `'none'`, or left out (the client's id and secret in the body)";
const PUBLIC_PKCE = "a public client (`clientAuth: 'none'`) needs PKCE: leave `pkce` out";
const fields = z.array(z.strictObject({ name: z.string(), title: z.string().min(1, "a field's title says what to enter: give it words"),
  secret: z.literal(true).optional(), default: z.string().optional(),
  help: z.string().min(1, "a field's help is a line a person reads: give it words, or leave it out").optional(),
  choices: z.array(z.string()).optional() })).optional();
const identify = z.strictObject({ request: request.optional(), id: value.optional(), name: value.optional(),
  lowercase: z.literal(true).optional(),
  rejectWhen: z.array(condition(whenObject.extend({ detail: z.string().optional() }))).optional() }).optional();
/** What a later key or token sign-in may declare in place of the entry's: its fields, its base and host, its identify. */
const hostPatterns = z.union([z.string(), z.array(z.string())]).optional();
const own = { fields, http: z.strictObject({ baseUrl: https, host: hostPatterns }).optional(), identify };
/** The entry types as a schema. Tests only: no published declaration may name zod. */
const entrySchema = z.strictObject({
  // An id is the name its file exports it under, so it holds no `-`.
  id: z.string().regex(/^[a-z][a-z0-9]*$/u), name: z.string().min(1), docs: z.string().optional(),
  categories: z.array(z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]])).optional(),
  fields,
  auth: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('key'), send: send.optional(), ...own }),
    z.strictObject({ kind: z.literal('oauth2'), authorizeUrl: https, tokenUrl: https, refreshUrl: https.optional(),
      json: z.literal(true, '`json` is `true` or left out').optional(), pkce: z.literal(false).optional(),
      clientAuth: z.enum(['basic', 'none'], CLIENT_AUTH).optional(), scopeSeparator: z.literal(',').optional(),
      authorizeParams: z.record(z.string(), z.string()).optional(), tokenTypes: z.array(z.string()).optional(),
      failed: when.optional(), reusesGrant: z.literal(true).optional() })
      .refine(item => !(item.clientAuth === 'none' && item.pkce === false), PUBLIC_PKCE),
    z.strictObject({ kind: z.literal('token'), send: send.optional(), ...own, request: z.strictObject({ url: https,
      body: z.record(z.string(), z.string("a token request's body is a flat record of templates")), json: z.literal(true).optional(), basic: z.tuple([template, template]).optional(),
      token: z.string().regex(/\S/u, "a token request's `token` is the token's path in the answer: give it, or leave it out")
        .optional() }) }),
  ])).min(1).refine(auth => new Set(auth.map(item => item.kind)).size === auth.length, ONE_OF_EACH)
    .refine(auth => !(auth.some(item => item.kind === 'key') && auth.some(item => item.kind === 'token')), KEY_OR_TOKEN)
    .refine(auth => auth[0]?.kind === 'oauth2' || !auth.some(item => item.kind === 'oauth2'), OAUTH_FIRST)
    .refine(([first]) => !Object.keys(own).some(name => first !== undefined && name in first), OWN_FIRST),
  scopes: z.strictObject({ default: z.array(z.string()), requireGranted: z.literal(true).optional() }).optional(),
  identify,
  save: z.record(z.string(), value).optional(),
  revoke: z.union([z.strictObject({ url: https, token: z.array(z.enum(['refresh', 'access'])), goneErrors: z.array(z.string()).optional() }),
    z.strictObject({ request, goneErrors: z.array(z.string()).optional() })]).optional(),
  http: z.strictObject({ baseUrl: https, host: hostPatterns, bases: z.record(z.string(), https).optional(), headers: z.record(headerName, z.string(), { error: issue => (issue.code === 'invalid_key' ? headerMessage : undefined) }).optional(),
    timeoutMs: z.number().int().positive().optional(), minIntervalMs: z.number().int().nonnegative().optional(),
    retry: z.strictObject({ limit: z.number().int().nonnegative().optional(), maxWaitMs: z.number().int().nonnegative().optional(),
      defaultWaitMs: z.number().int().nonnegative().optional(), onlyStated: z.literal(true).optional(), wait: wait.optional() }).optional(),
    rateLimit: z.strictObject({
      when: z.array(condition(whenObject.extend({ wait: wait.optional() }))),
      defaultWaitMs: z.number().int().nonnegative().optional() }).optional() }),
  errors: z.strictObject({ detail: value.optional(), allow: z.array(z.string()).optional(), failed: when.optional(),
    revoked: z.array(z.string()).optional(),
    rules: z.array(z.strictObject({ when, code: z.enum(['rejected', 'rate_limited', 'unavailable', 'not_found', 'request_failed', 'invalid_response']),
      detail: z.string().optional() })).optional() }).optional(),
  webhook: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('hmac'), header: headerName, signed: template.optional(), prefix: z.string().optional(),
      encoding: z.literal('base64').optional(), hash: z.literal('sha1', "`hash` is 'sha1' or left out (SHA-256)").optional(),
      secret: z.enum(['base64', 'hex'], "`secret` is 'base64', 'hex' or left out (the key is the secret's own bytes)").optional(),
      part: partName.optional(),
      timestamp: z.union([timestamp, z.strictObject({ part: partName, toleranceSeconds })]).optional(),
      ...webhookParts }),
    // A signature checked with a public key: no digest to prefix, encode, hash or pick from a list.
    z.strictObject({ kind: z.literal('ed25519'), header: headerName, signed: template.optional(), timestamp: timestamp.optional(),
      ...webhookParts }, { error: issue => (issue.code === 'unrecognized_keys' && issue.keys.every(name => ['prefix', 'encoding', 'hash', 'part'].includes(name))
      ? 'an `ed25519` webhook takes no `prefix`, `encoding`, `hash` or `part`: leave them out' : undefined) }),
    // The header is compared whole: nothing is signed, so nothing to fill, prefix or time.
    z.strictObject({ kind: z.literal('token'), header: headerName, ...webhookParts }, { error: issue => (issue.code === 'unrecognized_keys'
      ? 'a `token` webhook takes only its `header` (and `deliveryId` and `challenge`): leave the rest out' : undefined) }),
    // The header is `authorization`, and nothing is signed.
    z.strictObject({ kind: z.literal('basic'), ...webhookParts }, { error: issue => (issue.code === 'unrecognized_keys'
      ? 'a `basic` webhook takes only `deliveryId` and `challenge`: its header is `authorization`, leave the rest out' : undefined) }),
    // The scheme fixes its headers, its signed content and its timestamp.
    z.strictObject({ kind: z.literal('standard'), ...webhookParts }, { error: issue => (issue.code === 'unrecognized_keys' && issue.keys.every(name => ['header', 'signed', 'timestamp', 'prefix', 'secret'].includes(name))
      ? 'a `standard` webhook takes no `header`, `signed`, `timestamp`, `prefix` or `secret`: Standard Webhooks fixes them' : undefined) }),
  ]).optional(),
  paging: z.record(z.string(), z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('cursor'), next: z.string(), more: z.string().optional(), send: where }),
    z.strictObject({ kind: z.literal('page'), send: where, list: z.string().optional(), more: z.string().optional(),
      zeroBased: z.literal(true, '`zeroBased` is `true` or left out (the first page is 1)').optional() }),
    z.strictObject({ kind: z.literal('offset'), send: where, list: z.string().optional(), more: z.string().optional() }),
    z.strictObject({ kind: z.literal('linkHeader'), pathPrefix }),
    z.strictObject({ kind: z.literal('nextUrl'), next: z.string(), pathPrefix }),
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

/** Every string anywhere in a value, keys included. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...stringsIn(item)]);
}
/** `pnpm new` writes a skeleton whose every unknown is `TODO`: it fails here until each is filled. */
const TODO_RULE = "no TODO left from pnpm new: replace each with the provider's documented value";

/** What the engine cannot run, each a rule every entry passes. */
const reads = (entry: Entry, prefix: string) => lookupNames(entry).filter(name => name.startsWith(prefix));
const operations = (entry: Entry) => Object.values(entry.operations ?? {});
/** A token entry's request. */
const tokenRequest = (entry: Entry) => (entry.auth[0].kind === 'token' ? entry.auth[0].request : undefined);
/** The names a token request's body and Basic fill. */
const tokenSent = (request: NonNullable<ReturnType<typeof tokenRequest>>) =>
  [...Object.values(request.body), ...request.basic ?? []].flatMap(placeholders);
const plainFields = (entry: Entry) => (entry.fields ?? []).filter(field => field.secret !== true).map(field => field.name);
/** The declared calls that may name a base: identify's request and a request revoke. */
const calls = (entry: Entry) => [entry.identify?.request, entry.revoke !== undefined && 'request' in entry.revoke ? entry.revoke.request : undefined];
const params = (entry: Entry) => operations(entry).flatMap(op => Object.values(op.params ?? {}));
/** The templates a send fills: Basic's pair, the query's values or a header's `value`. */
const sentTemplates = (entry: Entry) => {
  const auth = entry.auth[0];
  if (!('send' in auth)) return [];
  if ('header' in auth.send) return auth.send.value === undefined ? [] : [auth.send.value];
  return 'basic' in auth.send ? auth.send.basic : Object.values(auth.send.query);
};
/** An `hmac` webhook, the one kind with a digest's `prefix` and `part`. */
const hmac = (entry: Entry) => (entry.webhook?.kind === 'hmac' ? entry.webhook : undefined);
/** A webhook whose entry declares what is signed: `hmac` or `ed25519`. */
const signing = (entry: Entry) => (entry.webhook?.kind === 'hmac' || entry.webhook?.kind === 'ed25519' ? entry.webhook : undefined);
/** The plain fields an entry reads: in its base, or as `connection.*` in identify and `save`. */
const plainReads = (entry: Entry) => [...placeholders(entry.http.baseUrl), ...reads(entry, 'connection.')
  .map(name => name.slice('connection.'.length))].filter(name => plainFields(entry).includes(name));
const secretField = (entry: Entry) => (entry.fields ?? []).find(field => field.secret === true)?.name;
/** An OAuth 2 sign-in's URLs, as the engine reads them. */
const oauthUrlList = (entry: Entry) => Object.values(oauthUrls(entry) ?? {});
const RETRY_DEFAULT = '`http.retry.defaultWaitMs` at most its `maxWaitMs` (1 000 and 60 000 when left out): the cap would cut a longer default';
const RETRY_ONLY_STATED = "no `http.retry.defaultWaitMs` beside `onlyStated`: an answer that states no wait is not retried, so the default is never read";
const HOST_PATTERN = "an `http.host` pattern (a domain name, never an address; `*.` and a domain; a non-empty list of those; or `*` alone) exactly when a host (the base's, an OAuth 2 URL's, a token request's) has a placeholder";
const ANY_HOST = "`http.host: '*'` only on a base whose whole host is one placeholder a person types: a host the token answer names needs a domain";
const OAUTH_READS = 'every plain field read by an `oauth2` sign-in (in its URLs, the base, or `connection.*`): its connect asks the person for each';
const OAUTH_PLAIN_URLS = 'an `oauth2` URL that names only plain fields (no secret, and no saved value: none exists before the exchange); a refresh URL may name the host the token answer names';
const HOST_SPLIT = 'the base, `http.bases`, the OAuth 2 URLs and a token request\'s URL on one host when any of them is typed (`hostSplit`): on a typed host a credential goes only to that host';
const WELL_FORMED_URLS = 'every URL a well-formed template (`hostPart`): `https://`, then letters, digits, `.`, `-` and `{name}`s with an optional literal port, then `/` or the end';
const runnable = {
  // The host the URL parser reads is then the host part every other rule reads.
  [WELL_FORMED_URLS]: (entry: Entry) => declaredUrls(entry).every(url => hostPart(url) !== undefined),
  [TODO_RULE]: (entry: Entry) => !stringsIn(entry).some(text => text.includes('TODO')),
  // A Basic or query send that names no secret would send a credential anyone could make.
  '`auth.send` basic, query or header `value`: name the secret ({token}, or a key entry\'s secret field)': (entry: Entry) => sentTemplates(entry).length === 0
    || sentTemplates(entry).flatMap(placeholders).some(name => name === 'token' || (entry.auth[0].kind === 'key' && name === secretField(entry))),
  "`auth.send` templates: name only the entry's fields and {token}": (entry: Entry) => sentTemplates(entry).flatMap(placeholders)
    .every(name => name === 'token' || (entry.fields ?? []).some(field => field.name === name)),
  // `{token}` is the secret in a token request and the obtained token in `send`: a field of that name would mean both,
  // and a plain one could never be sent.
  "no field named `token` (name it for what it is, such as `apiToken`): `{token}` is the credential": (entry: Entry) =>
    !(entry.fields ?? []).some(field => field.name === 'token'),
  // The secret field goes only to the token request: a call carries the token it gave.
  "a `token` entry's `send`: name no secret field": (entry: Entry) => entry.auth[0].kind !== 'token'
    || !sentTemplates(entry).flatMap(placeholders).some(name => name === secretField(entry)),
  // Every claim an entry makes is checked against the provider's own page.
  'a `docs` link to the provider\'s page, https': (entry: Entry) => entry.docs?.startsWith('https://') === true,
  // A connect screen and the providers page group entries by their first category.
  '`categories`: one or two unique values of the `Category` type in src/catalogue.ts, the first the main one': (entry: Entry) => entry.categories !== undefined
    && entry.categories.length >= 1 && entry.categories.length <= 2 && new Set(entry.categories).size === entry.categories.length,
  'a `docs` page on every operation, https': (entry: Entry) => operations(entry).every(op => op.docs?.startsWith('https://') === true),
  [RETRY_DEFAULT]: ({ http: { retry } }: Entry) => { const { defaultWaitMs, maxWaitMs } = retryPolicy(retry); return defaultWaitMs <= maxWaitMs; },
  [RETRY_ONLY_STATED]: ({ http: { retry } }: Entry) => retry?.onlyStated !== true || retry.defaultWaitMs === undefined,
  // A typed host is checked against a pattern before the token is read; a fixed one, or a value in the path, needs none.
  // `*` stays alone, and a name's last label holds a letter: a list or a name takes the plain fetch, never the address guard.
  [HOST_PATTERN]: (entry: Entry) => {
    const patterns = [entry.http.host ?? []].flat();
    return declaredUrls(entry).some(url => placeholders(hostPart(url) ?? '').length > 0)
      ? entry.http.host === '*' || (patterns.length > 0 && patterns.every(host => /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]*[a-z][a-z0-9-]*$/u.test(host)))
      : entry.http.host === undefined;
  },
  // Any host is allowed only where the person types the whole host, which is then address-guarded.
  [ANY_HOST]: (entry: Entry) => entry.http.host !== '*'
    || (/^https:\/\/\{[^{}]+\}$/u.test(hostPart(entry.http.baseUrl) ?? '') && Object.keys(namedHosts(entry)).length === 0),
  // A URL is filled from plain values, never a secret; the body and Basic from either.
  // What the engine cannot fill is `template_missing` at the first sign-in.
  "a token request names only the entry's fields, a plain one in its `url`": (entry: Entry) => {
    const request = tokenRequest(entry);
    return request === undefined || (placeholders(request.url).every(name => plainFields(entry).includes(name))
      && tokenSent(request).every(name => (entry.fields ?? []).some(field => field.name === name)));
  },
  // A request that sends no secret proves nothing.
  "a token request sends the secret field in its body or Basic": (entry: Entry) => {
    const request = tokenRequest(entry);
    return request === undefined || tokenSent(request).some(name => name === secretField(entry));
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
  // A header with no `value` already sends the bare token, and no `send` sends `authorization: Bearer {token}`: one way to say each.
  "`auth.send` header `value` other than a default: not '{token}' (leave `value` out), not `authorization: Bearer {token}` (leave `send` out)": (entry: Entry) => {
    const auth = entry.auth[0];
    return !('send' in auth) || !('header' in auth.send) || !(auth.send.value === '{token}'
      || (auth.send.header === 'authorization' && auth.send.value === 'Bearer {token}'));
  },
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
  'no `identify` or `save` value that reads a token from `tokenAnswer.*`, its own or one nested (never returned: read another key)': (entry: Entry) => {
    const auth = entry.auth[0];
    const own = auth.kind === 'token' ? [(auth.request.token ?? 'access_token').split('.')[0]] : ['access_token', 'refresh_token'];
    const nested = ['access_token', 'refresh_token', 'id_token'];
    return reads(entry, 'tokenAnswer.').every(name => !own.includes(name.split('.')[1]) && !nested.includes(name.split('.').at(-1) ?? ''));
  },
  // A key has no token answer: the engine skips such a path in a list and reads the next (HubSpot's `hub_id`, then
  // `portalId`), which is worth writing only when another sign-in of the whole entry has a token answer.
  'no `tokenAnswer.*` on a key entry, except in an `id` or `name` list ending on a path of identify\'s requested answer, beside an OAuth 2 or token sign-in':
  (entry: Entry, whole: Entry = entry) => {
    // A literal path: inside a list, `{id}` is read as a path, never filled.
    const answered = (path = '') => /^[^{]+$/.test(path) && !path.startsWith('tokenAnswer.') && !path.startsWith('connection.');
    const answering = whole.auth.some(auth => auth.kind !== 'key') && entry.identify?.request !== undefined;
    const strict = (value: Value | undefined) => (answering && value !== undefined && typeof value !== 'string'
      && answered(value.at(-1)) ? [] : [value]);
    const values = [...strict(entry.identify?.id), ...strict(entry.identify?.name), ...Object.values(entry.save ?? {})];
    return entry.auth[0].kind !== 'key' || values.every(value => value === undefined
      || lookupNames({ identify: { id: value } }).every(name => !name.startsWith('tokenAnswer.')));
  },
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
  'a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)': (entry: Entry) => operations(entry).every(op =>
    Object.entries(op.params ?? {}).every(([name, param]) => placed(op, name, param))),
  // The client checks an argument against its enum as a string.
  '`params[].enum` only on a `type: \'string\'` parameter': (entry: Entry) => params(entry).every(param => param.enum === undefined || param.type === 'string'),
  // A path segment, a query value and a form value are one string each: never null, a list or an object.
  'only a scalar, non-`nullable` parameter `in` a path, a query or a form': (entry: Entry) => params(entry).every(param =>
    !['path', 'query', 'form'].includes(param.in) || (param.nullable === undefined && typeof param.type === 'string')),
  // The rule `client()` applies to each path, and a group worth the name: a required parameter is given anyway.
  '`anyOf`: two or more sets of one or more paths, each to a declared argument (a parameter, or a key of its object `type`), none a `required` parameter': (entry: Entry) =>
    operations(entry).every(op => op.anyOf === undefined || (op.anyOf.length > 1 && op.anyOf.every(set => set.length > 0
      && set.every(path => argumentShape(op, path) !== undefined && op.params?.[path]?.required !== true)))),
  // A paged operation yields its records: a 404 is no record to answer null for.
  '`notFound` only on an operation with no `paging`': (entry: Entry) => operations(entry).every(op => op.paging === undefined || op.notFound === undefined),
  // A saved value would replace the field the person entered, which `Connected` types as a string.
  "`save` keys apart from the fields' names": (entry: Entry) =>
    Object.keys(entry.save ?? {}).every(name => !(entry.fields ?? []).some(field => field.name === name)),
  // A part's value is the signature alone (Stripe's `v1=<hex>`): a prefix would never be compared.
  "no `webhook.prefix` beside `webhook.part`": (entry: Entry) => {
    const webhook = hmac(entry);
    return webhook?.part === undefined || webhook.prefix === undefined;
  },
  // The timestamp is read from the same header's pieces, which only `part` splits.
  "a `webhook.timestamp.part` only beside `webhook.part`": (entry: Entry) => {
    const webhook = hmac(entry);
    return webhook?.timestamp === undefined || !('part' in webhook.timestamp) || webhook.part !== undefined;
  },
  // Without a timestamp, `{timestamp}` signs an empty string and no tolerance is checked; a tolerance on a timestamp
  // that is not signed lets a replay pass with a fresh one.
  '`{timestamp}` in `webhook.signed` exactly when a `webhook.timestamp` is declared': (entry: Entry) => {
    const webhook = signing(entry);
    return (webhook?.timestamp !== undefined) === placeholders(webhook?.signed ?? '').includes('timestamp');
  },
  // A signature that does not cover the body lets a forged body through.
  '`{body}` in `webhook.signed` (left out, `signed` is the body)': (entry: Entry) => placeholders(signing(entry)?.signed ?? '{body}').includes('body'),
  // A timestamp read from the signature's own header or piece is the signature, not a time.
  "a `webhook.timestamp` read apart from the signature (another `part`, another header)": (entry: Entry) => {
    const webhook = signing(entry);
    const stamp = webhook?.timestamp;
    if (webhook === undefined || stamp === undefined) return true;
    return 'part' in stamp ? webhook.kind !== 'hmac' || stamp.part !== webhook.part : stamp.header !== webhook.header;
  },
  // A challenge has no answer status and no provider code; a body value counts only where the body says it is one.
  "a `webhook.challenge.when` with no `status` or `detail`, reading a body `path` when `echo` is one (a query may leave `when` out)": (entry: Entry) => {
    const challenge = entry.webhook?.challenge;
    if (challenge === undefined) return true;
    const { when, echo } = challenge;
    return when === undefined ? typeof echo !== 'string'
      : when.status === undefined && when.detail === undefined && (typeof echo !== 'string' || when.path !== undefined);
  },
  // The echoed value is the body's top-level key of that name.
  'a `webhook.challenge.echo` with no `.` (a top-level key of the body)': (entry: Entry) => {
    const echo = entry.webhook?.challenge?.echo;
    return typeof echo !== 'string' || !echo.includes('.');
  },
  // Otherwise the records are typed `unknown`.
  "an `operations[].records` path to a list in the operation's `result`": (entry: Entry) => operations(entry).every(op =>
    op.records === undefined || op.result === undefined || Array.isArray(shapeAt(op.result, op.records))),
  // OAuth 2's connect reads every plain field: one only the key reads would be asked for and never used.
  [OAUTH_READS]: (entry: Entry) => entry.auth[0].kind !== 'oauth2'
    || plainFields(entry).every(name => [...oauthUrlList(entry).flatMap(placeholders), ...plainReads(entry)].includes(name)),
  // What the engine cannot fill is `template_missing` at the start.
  [OAUTH_PLAIN_URLS]: (entry: Entry) => Object.entries(oauthUrls(entry) ?? {}).every(([which, url]) => placeholders(url)
    .every(name => plainFields(entry).includes(name) || (which === 'refresh' && Object.hasOwn(namedHosts(entry), name)))),
  // The rule the engine runs before every OAuth 2 request and every call on a named base.
  [HOST_SPLIT]: (entry: Entry) => !hostSplit(entry),
  // The walk stops on the shape's list; records read elsewhere would end the list after its first page, silently.
  "an operation on a `page` or `offset` shape whose `records` is the shape's `list` (both left out for a list at the answer's top level)": (entry: Entry) =>
    operations(entry).every(op => { const shape = op.paging === undefined ? undefined : entry.paging?.[op.paging];
      return shape === undefined || pagedRecords(op, shape); }),
  // The walk sets that parameter itself on every page after the first.
  "no `operations[].params` entry in the place its paging shape's `send` writes (the walk sends it), and no `form` one beside a `send.body`": (entry: Entry) => operations(entry).every(op => {
    const shape = op.paging === undefined ? undefined : entry.paging?.[op.paging];
    return shape === undefined || pagedParam(op, shape) === undefined;
  }),
};
type Rule = keyof typeof runnable;

/** An entry as each of its sign-ins: an entry with one sign-in as it is, one with several narrowed to each. */
const signIns = (entry: Entry): [kind: string, one: Entry][] => entry.auth.map(({ kind }) =>
  [kind, entry.auth.length > 1 ? signInWith(entry, kind) : entry]);
/** The rules an entry breaks, each with the sign-in it breaks them in. */
const broken = (entry: Entry) => signIns(entry).flatMap(([kind, one]) =>
  (Object.keys(runnable) as Rule[]).filter(rule => !runnable[rule](one, entry)).map(rule => `${rule} (${kind})`));

describe.each(entries)('%s', (id, entry) => {
  test('matches the entry types', () => { expect(entrySchema.safeParse(entry).error).toBeUndefined(); });
  test('holds no function', () => { expect(functionsIn(entry)).toEqual([]); });
  test('prints to JSON as it is', () => { expect(JSON.parse(JSON.stringify(entry))).toEqual(entry); });
  // Each sign-in is an entry of its own once an app picks it: every rule and the derived fake run on each, named by its
  // kind when there are several.
  for (const [kind, one] of signIns(entry)) {
    const named = entry.auth.length > 1 ? ` (${kind})` : '';
    test.each(Object.keys(runnable) as Rule[])(`declares %s${named}`, rule => { expect(runnable[rule](one, entry)).toBe(true); });
    // Every sign-in that sends identify, and every token sign-in, signs in on the fake derived from it: no recording needed.
    if (one.identify?.request !== undefined || one.auth[0].kind === 'token') {
      test.each(['good', 'bad'] as const)(`signs in on its derived fake with a %s key${named}`, async key => {
        const { fetch } = fakeFetch(fakeProvider(one, { key: GOOD_KEY, values: kitValues(one) }));
        const signedIn = signIn(one, key === 'good' ? GOOD_KEY : BAD_KEY, fetch);
        if (key === 'bad') await expect(signedIn).rejects.toMatchObject({ code: 'rejected' });
        else expect((await signedIn).account === null).toBe(one.identify?.id === undefined);
      });
    }
    // Every OAuth 2 sign-in connects on its derived fake (the kit's client, the consent's code and verifier), keeps the
    // grant and each `save` value the fake answered, then refreshes, and revokes where the entry declares a revoke.
    if (one.auth[0].kind === 'oauth2') {
      test.each(['good', 'bad'] as const)(`connects on its derived fake with a %s code${named}`, async code => {
        const { fetch, calls } = fakeFetch(fakeProvider(one, { key: GOOD_KEY, values: kitValues(one) }));
        const client = { clientId: 'kit-client', clientSecret: 'kit-secret' };
        const redirectUri = 'https://app.example.test/callback';
        const start = await startConnect(one, { clientId: 'kit-client', redirectUri, state: 'kit-state', values: kitValues(one) });
        if (start.kind !== 'redirect') throw new Error('an OAuth 2 sign-in starts with a redirect');
        const connected = finishConnect(one, { client, code: code === 'good' ? 'kit-code' : 'kit-bad-code',
          redirectUri, codeVerifier: start.codeVerifier, values: start.values, fetch, onRevokeFailed: error => { throw error; } });
        if (code === 'bad') return expect(connected).rejects.toBeInstanceOf(GrantRevoked);
        const { secret, values, account } = await connected;
        expect(account === null).toBe(one.identify?.id === undefined);
        const grant = { accessToken: GOOD_KEY, refreshToken: 'kit-refresh' };
        expect(secret).toMatchObject(grant);
        // A token answer's value is the kit's for a named host, else `kit-<path>`; a value read from identify's answer is the kit's.
        expect(values).toMatchObject(Object.fromEntries(Object.entries(one.save ?? {}).map(([name, read]) => [name,
          typeof read === 'string' && read.startsWith('tokenAnswer.') ? kitValues(one)[name] ?? `kit-${read.slice('tokenAnswer.'.length)}` : expect.anything()])));
        await expect(refreshGrant(one, client, 'kit-refresh', { fetch, values })).resolves.toMatchObject(grant);
        const { revoke } = one;
        if (revoke === undefined) return;
        const before = calls.length;
        await expect(revokeGrant(one, { ...grant, client, values, fetch })).resolves.toBeUndefined();
        // One request reached the revoke, with the token `revoke.token` selects, or a request revoke's credential.
        const sent = calls.slice(before);
        if ('url' in revoke) {
          expect(sent.map(call => call.url)).toEqual([new URL(filledBase(one, values, revoke.url)).href]);
          const body = sent[0]?.body ?? '';
          const json = one.auth[0].kind === 'oauth2' && one.auth[0].json === true;
          expect(new URLSearchParams(json ? JSON.parse(body) as Record<string, string> : body).get('token'))
            .toBe(revoke.token[0] === 'refresh' ? grant.refreshToken : grant.accessToken);
        } else {
          const base = filledBase(one, values, callBase(one, revoke.request).baseUrl).replace(/\/+$/u, '');
          expect(sent.map(call => call.url)).toEqual([`${base}${revoke.request.path ?? ''}`]);
          const [name = '', value] = credentialOf(one, GOOD_KEY, values).header ?? [];
          expect(sent[0]?.headers[name]).toBe(value);
        }
      });
    }
    // A token answer naming a host outside `http.host` connects nothing: the token request alone, then a fixed revoke.
    const hosts = Object.values(namedHosts(one));
    if (hosts.length > 0) {
      test(`refuses a token answer that names a host outside \`http.host\`${named}`, async () => {
        const values = kitValues(one);
        const token = new URL(filledBase(one, values, oauthUrls(one)?.token)).href;
        const answer = { access_token: GOOD_KEY, refresh_token: 'kit-refresh', token_type: 'bearer',
          ...Object.fromEntries(hosts.map(path => [path.slice('tokenAnswer.'.length), 'evil.test'])) };
        const { fetch, calls } = fakeFetch([{ url: token, respond: () => Response.json(answer) }, { url: /./u, respond: () => new Response(null) }]);
        const start = await startConnect(one, { clientId: 'kit-client', redirectUri: 'https://app.example.test/callback', state: 'kit-state', values });
        if (start.kind !== 'redirect') throw new Error('an OAuth 2 sign-in starts with a redirect');
        await expect(finishConnect(one, { client: { clientId: 'kit-client', clientSecret: 'kit-secret' }, code: 'kit-code', redirectUri: 'https://app.example.test/callback',
          codeVerifier: start.codeVerifier, values: start.values, fetch, onRevokeFailed: () => undefined })).rejects.toThrow(new TypeError(`base_host_refused: ${one.id}`));
        const revoke = one.revoke !== undefined && 'url' in one.revoke ? [new URL(filledBase(one, values, one.revoke.url)).href] : [];
        expect(calls.map(call => call.url)).toEqual([token, ...revoke]);
      });
    }
  }
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
    for (const name of placeholders(signing(entry)?.signed ?? '')) expect(['body', 'timestamp', 'method', 'url']).toContain(name);
  });

  // With a recording beside it, the sign-in the recorder records (`recordedSignIn`: the key or token one, else the
  // first) replays a good and a bad key on its recordings' exchanges merged, through the check the recorder runs before it writes one: a file the recorder accepts,
  // the table accepts.
  const [first, ...rest] = recordings.filter(({ file }) => file.startsWith(`${id}.`));
  if ((entry.identify?.request === undefined && recordedSignIn(entry).auth[0].kind !== 'token') || first === undefined) return;
  const recording = { ...first, provider: id, exchanges: [first, ...rest].flatMap(item => item.exchanges) };
  test('replays its sign-ins: the key to an account where the entry names an id, the bad key rejected', async () => {
    expect(await replayProblem(entry, recording)).toBeNull();
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

test("Discord's User-Agent names the package's own version, which Discord asks of every client", () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  expect(entries.find(([id]) => id === 'discord')?.[1].http.headers?.['user-agent'])
    .toBe(`DiscordBot (https://www.npmjs.com/package/0-integrations, ${version})`);
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

const key = { id: 'k', name: 'K', docs: 'https://k.test/docs', categories: ['tasks'], http: { baseUrl: 'https://api.k.test' } } as const;
const oauth2 = { ...key, auth: [{ kind: 'oauth2', authorizeUrl: 'https://k.test/authorize', tokenUrl: 'https://k.test/token' }] } as const;
const secret = { name: 'apiKey', title: 'API key', secret: true } as const;
/** A token entry with Zoom's shape: a plain client id, one secret, Basic client authentication. */
const tokened = { ...key, fields: [{ name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Client secret', secret: true }],
  auth: [{ kind: 'token', request: { url: 'https://k.test/token', body: { grant_type: 'client_credentials' },
    basic: ['{clientId}', '{clientSecret}'] } }] } as const;
test('a challenge from a query or the body, answered as text and unsigned beside any kind, passes the schema and every rule', () => {
  for (const webhook of [{ kind: 'standard', challenge: { echo: { query: 'challenge' }, text: true } },
    { kind: 'basic', challenge: { echo: { query: 'challenge' }, text: true, unsigned: true } },
    { kind: 'standard', challenge: { when: { path: 'type', equals: 'url_verification' }, echo: 'challenge', text: true, unsigned: true } },
    { kind: 'token', header: 'x-token', challenge: { when: { header: 'x-kind', equals: 'check' }, echo: { query: 'check' }, text: true } }] as const) {
    const good = defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], webhook });
    expect(Object.keys(runnable).filter(rule => !runnable[rule as Rule](good))).toEqual([]);
    expect(entrySchema.safeParse(good).error).toBeUndefined();
  }
});

/** Wrike's shape: fixed sign-in URLs, the base and the refresh on the host the token answer names, under one domain. */
const named = { ...key, scopes: { default: [] }, save: { host: 'tokenAnswer.host' }, identify: { request: { path: '/me' }, id: 'id' },
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.k.test/authorize', tokenUrl: 'https://login.k.test/token', refreshUrl: 'https://{host}/token' }],
  http: { baseUrl: 'https://{host}/api', host: '*.k.test' } } as const;
test.each<[Rule, Entry]>([
  ['a `docs` link to the provider\'s page, https', defineProvider({ id: 'k', name: 'K', http: key.http, auth: [{ kind: 'key' }], fields: [secret] })],
  ['a `docs` link to the provider\'s page, https', defineProvider({ ...key, docs: 'http://k.test/docs', auth: [{ kind: 'key' }], fields: [secret] })],
  [TODO_RULE, defineProvider({ ...key, docs: 'https://TODO', auth: [{ kind: 'key' }], fields: [secret] })],
  ['`categories`: one or two unique values of the `Category` type in src/catalogue.ts, the first the main one', defineProvider({ id: 'k', name: 'K', docs: key.docs, http: key.http,
    auth: [{ kind: 'key' }], fields: [secret] })],
  ...([[], ['tasks', 'docs', 'chat'], ['tasks', 'tasks']] as const).map((categories): [Rule, Entry] => [
    '`categories`: one or two unique values of the `Category` type in src/catalogue.ts, the first the main one', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], categories })]),
  ...([{ path: '/tasks' }, { path: '/tasks', docs: 'http://k.test/tasks' }] as const).map((op): [Rule, Entry] => [
    'a `docs` page on every operation, https', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], operations: { 'tasks.list': op } })]),
  ['`auth.send` basic, query or header `value`: name the secret ({token}, or a key entry\'s secret field)', defineProvider({ ...key, fields: [secret, { name: 'apiId', title: 'API ID' }],
    auth: [{ kind: 'key', send: { query: { id: '{apiId}' } } }] })],
  ['`auth.send` basic, query or header `value`: name the secret ({token}, or a key entry\'s secret field)', defineProvider({ ...key, fields: [secret, { name: 'apiId', title: 'API ID' }],
    auth: [{ kind: 'key', send: { basic: ['{apiId}', ''] } }] })],
  ["`auth.send` templates: name only the entry's fields and {token}", defineProvider({ ...key, fields: [secret],
    auth: [{ kind: 'key', send: { query: { key: '{apiKey}', account: '{acount}' } } }] })],
  ["`auth.send` templates: name only the entry's fields and {token}", defineProvider({ ...key, fields: [secret],
    auth: [{ kind: 'key', send: { header: 'authorization', value: 'Bot {tokn}' } }] })],
  ['`auth.send` basic, query or header `value`: name the secret ({token}, or a key entry\'s secret field)', defineProvider({ ...key,
    fields: [secret, { name: 'apiId', title: 'API ID' }], auth: [{ kind: 'key', send: { header: 'authorization', value: 'Id {apiId}' } }] })],
  ["a `token` entry's `send`: name no secret field", defineProvider({ ...tokened,
    auth: [{ ...tokened.auth[0], send: { header: 'authorization', value: 'Bearer {token} {clientSecret}' } }] })],
  ...([{ header: 'x-api-key', value: '{token}' }, { header: 'authorization', value: 'Bearer {token}' }] as const).map((sent): [Rule, Entry] => [
    "`auth.send` header `value` other than a default: not '{token}' (leave `value` out), not `authorization: Bearer {token}` (leave `send` out)",
    defineProvider({ ...key, fields: [secret], auth: [{ kind: 'key', send: sent }] })]),
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...key, auth: [{ kind: 'key' }] })],
  ...([[{ name: 'token', title: 'Token', secret: true }], [secret, { name: 'token', title: 'Token' }]] as const).map((fields): [Rule, Entry] => [
    "no field named `token` (name it for what it is, such as `apiToken`): `{token}` is the credential",
    defineProvider({ ...key, auth: [{ kind: 'key' }], fields })]),
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...key, auth: [{ kind: 'key' }],
    fields: [secret, { name: 'other', title: 'Other', secret: true }] })],
  ['at most one secret field in `fields`, exactly one on a key or token entry', defineProvider({ ...oauth2, scopes: { default: [] },
    fields: [secret, { name: 'other', title: 'Other', secret: true }] })],
  ["an `identify.request` whenever a value reads identify's answer", defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { id: 'workspace_id' } })],
  ["an `identify.request` whenever a value reads identify's answer", defineProvider({ ...oauth2, scopes: { default: [] },
    identify: { id: 'tokenAnswer.team.id' }, save: { region: 'Region {region}' } })],
  ['no `tokenAnswer.*` on a key entry, except in an `id` or `name` list ending on a path of identify\'s requested answer, beside an OAuth 2 or token sign-in', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { id: 'tokenAnswer.team.id' } })],
  ['no `tokenAnswer.*` on a key entry, except in an `id` or `name` list ending on a path of identify\'s requested answer, beside an OAuth 2 or token sign-in', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { request: { path: '/me' }, id: ['id', 'tokenAnswer.team.id'] } })],
  ['no `tokenAnswer.*` on a key entry, except in an `id` or `name` list ending on a path of identify\'s requested answer, beside an OAuth 2 or token sign-in', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    identify: { request: { path: '/me' }, id: ['tokenAnswer.hub_id', 'portalId'] } })],
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
  ["`auth.send` basic, query or header `value`: name the secret ({token}, or a key entry's secret field)", defineProvider({ ...tokened,
    auth: [{ ...tokened.auth[0], send: { query: { s: '{clientSecret}' } } }] })],
  ["a `token` entry's `send`: name no secret field", defineProvider({ ...tokened,
    auth: [{ ...tokened.auth[0], send: { basic: ['{clientId}', '{clientSecret}'] } }] })],
  [HOST_PATTERN, defineProvider({ ...tokened,
    fields: [...tokened.fields, { name: 'apiHost', title: 'Host' }], auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request,
      url: 'https://{apiHost}/token' } }] })],
  ...([[{ url: 'https://k.test/{tenant}/token' }, "a token request names only the entry's fields, a plain one in its `url`"], [{ url: 'https://k.test/{clientSecret}/token' }, "a token request names only the entry's fields, a plain one in its `url`"],
    [{ body: { scope: '{scop}' } }, "a token request names only the entry's fields, a plain one in its `url`"], [{ body: { a: '{nope}' } }, "a token request names only the entry's fields, a plain one in its `url`"],
    [{ basic: ['{clientld}', '{clientSecret}'] }, "a token request names only the entry's fields, a plain one in its `url`"], [{ basic: ['{clientId}', '{secret}'] }, "a token request names only the entry's fields, a plain one in its `url`"],
    [{ basic: ['{clientId}', 'fixed'] }, "a token request sends the secret field in its body or Basic"]] as const).map(([part, rule]): [Rule, Entry] => [rule,
    defineProvider({ ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, ...part } }] })]),
  ...[defineProvider({ ...tokened, save: { t: 'tokenAnswer.access_token' } }),
    defineProvider({ ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, token: 'id' } }], identify: { id: 'tokenAnswer.id' } }),
    defineProvider({ ...oauth2, scopes: { default: [] }, identify: { id: 'tokenAnswer.refresh_token' } }),
    defineProvider({ ...oauth2, scopes: { default: [] }, save: { a: 'tokenAnswer.access_token.x' } }),
    // A second credential nested in the answer (a user token under another key).
    defineProvider({ ...oauth2, scopes: { default: [] }, save: { u: 'tokenAnswer.authed_user.access_token' } }),
    defineProvider({ ...oauth2, scopes: { default: [] }, identify: { id: 'tokenAnswer.openid.id_token' } })]
    .map((entry): [Rule, Entry] => ["no `identify` or `save` value that reads a token from `tokenAnswer.*`, its own or one nested (never returned: read another key)", entry]),
  ['`scopes` on an oauth2 entry', defineProvider(oauth2)],
  ...([
    [HOST_PATTERN, { baseUrl: 'https://{region}.k.test' }],
    [HOST_PATTERN, { baseUrl: 'https://api.k.test', host: 'api.k.test' }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: 'example.com/x' }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: '*.com' }],
    [HOST_PATTERN, { baseUrl: 'https://api.k.test/{region}', host: 'api.k.test' }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: ['*', 'api.k.test'] }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: ['*'] }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: [] }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: ['api.k.test', '*.com'] }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: ['api.k.test', 'API.K.EU'] }],
    [HOST_PATTERN, { baseUrl: 'https://api.k.test', host: ['api.k.test'] }],
    // An address is no name: a list keeps the plain fetch, so the address guard would never see it.
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: '127.0.0.1' }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: ['127.0.0.1'] }],
    [HOST_PATTERN, { baseUrl: 'https://{region}', host: ['*.0.1'] }],
    [ANY_HOST, { baseUrl: 'https://{region}.example.com', host: '*' }],
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
    [{ choices: ['api.mailgun.net', 'api.eu.mailgun.net'] }, ['api.mailgun.net', 'api.eu.mailgun.com']],
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
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { get: { path: '/items', params: { id: { in: 'path', type: 'string', required: true } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { get: { path: '/items', params: { first: { in: 'variables', type: 'integer' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { get: { path: '/items', params: { q: { in: 'body', type: 'string' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { me: { graphql: 'query { me { id } }', params: { id: { in: 'query', type: 'string' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { get: { path: '/items', params: { q: { in: 'form', type: 'string' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { add: { method: 'POST', path: '/items', params: { q: { in: 'form', type: 'string' }, r: { in: 'body', type: 'string' } } } }],
    ['a `params[].in` the operation\'s request has (a path parameter in its `path`, no body or form on a GET, never a body beside a form, only variables on GraphQL)', { me: { graphql: 'query { me { id } }', params: { q: { in: 'form', type: 'string' } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path, a query or a form', { add: { method: 'POST', path: '/items', params: { q: { in: 'form', type: { a: 'string' } } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path, a query or a form', { add: { method: 'POST', path: '/items', params: { q: { in: 'form', type: 'string', nullable: true } } } }],
    ['`notFound` only on an operation with no `paging`', { list: { path: '/items', paging: 'cursor', notFound: 'null' } }],
    ["an `operations[].records` path to a list in the operation's `result`", { list: { path: '/items', records: 'data.itemz', result: { data: { items: ['string'] } } } }],
    ["an `operations[].records` path to a list in the operation's `result`", { list: { path: '/items', records: 'data', result: { data: { items: ['string'] } } } }],
    ['`params[].enum` only on a `type: \'string\'` parameter', { list: { path: '/items', params: { n: { in: 'query', type: 'integer', enum: ['1'] } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path, a query or a form', { list: { path: '/items', params: { q: { in: 'query', type: 'string', nullable: true } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path, a query or a form', { list: { path: '/items', params: { q: { in: 'query', type: ['string'] } } } }],
    ['only a scalar, non-`nullable` parameter `in` a path, a query or a form', { get: { path: '/items/{id}', params: { id: { in: 'path', type: { a: 'string' }, required: true } } } }],
    ['`anyOf`: two or more sets of one or more paths, each to a declared argument (a parameter, or a key of its object `type`), none a `required` parameter', { get: { method: 'POST', path: '/p', anyOf: [['email']], params: { email: { in: 'body', type: 'string' } } } }],
    ['`anyOf`: two or more sets of one or more paths, each to a declared argument (a parameter, or a key of its object `type`), none a `required` parameter', { get: { method: 'POST', path: '/p', anyOf: [['email'], []], params: { email: { in: 'body', type: 'string' } } } }],
    ['`anyOf`: two or more sets of one or more paths, each to a declared argument (a parameter, or a key of its object `type`), none a `required` parameter', { get: { method: 'POST', path: '/p', anyOf: [['email'], ['emial']], params: { email: { in: 'body', type: 'string' } } } }],
    ['`anyOf`: two or more sets of one or more paths, each to a declared argument (a parameter, or a key of its object `type`), none a `required` parameter', { get: { method: 'POST', path: '/p', anyOf: [['email'], ['phone']], params: { email: { in: 'body', type: 'string' }, phone: { in: 'body', type: 'string', required: true } } } }],
  ] as const).map(([rule, operations]): [Rule, Entry] => [rule, defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], operations })]),
  ...([
    ["no `webhook.prefix` beside `webhook.part`", { kind: 'hmac', header: 'stripe-signature', part: 'v1', prefix: 'v1=' }],
    ["a `webhook.timestamp.part` only beside `webhook.part`", { kind: 'hmac', header: 'stripe-signature', signed: '{timestamp}.{body}',
      timestamp: { part: 't' } }],
    ['`{timestamp}` in `webhook.signed` exactly when a `webhook.timestamp` is declared', { kind: 'hmac', header: 'x-signature', signed: '{timestamp}.{body}' }],
    ['`{body}` in `webhook.signed` (left out, `signed` is the body)', { kind: 'hmac', header: 'x-signature', signed: '{timestamp}', timestamp: { header: 'x-t' } }],
    ['`{body}` in `webhook.signed` (left out, `signed` is the body)', { kind: 'ed25519', header: 'x-signature-ed25519', signed: '{timestamp}{url}',
      timestamp: { header: 'x-t' } }],
    ["a `webhook.timestamp` read apart from the signature (another `part`, another header)", { kind: 'hmac', header: 'stripe-signature',
      signed: '{timestamp}.{body}', part: 'v1', timestamp: { part: 'v1' } }],
    ["a `webhook.timestamp` read apart from the signature (another `part`, another header)", { kind: 'ed25519', header: 'x-signature-ed25519',
      signed: '{timestamp}{body}', timestamp: { header: 'x-signature-ed25519' } }],
    ['`{timestamp}` in `webhook.signed` exactly when a `webhook.timestamp` is declared', { kind: 'hmac', header: 'x-signature', timestamp: { header: 'x-t' } }],
    ['`{timestamp}` in `webhook.signed` exactly when a `webhook.timestamp` is declared', { kind: 'ed25519', header: 'x-signature-ed25519',
      signed: '{body}', timestamp: { header: 'x-t' } }],
    ['a `webhook.challenge.echo` with no `.` (a top-level key of the body)', { kind: 'ed25519', header: 'x-signature-ed25519',
      challenge: { when: { path: 'type', equals: 1 }, echo: 'a.b' } }],
  ] as const).map(([rule, webhook]): [Rule, Entry] => [rule, defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], webhook })]),
  ...([{ status: 200, path: 'type', equals: 1 }, { header: 'x-type', equals: '1' }, { path: 'type', detail: 'ping' }, { equals: 1 }] as const)
    .map((when): [Rule, Entry] => ["a `webhook.challenge.when` with no `status` or `detail`, reading a body `path` when `echo` is one (a query may leave `when` out)",
      defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
        webhook: { kind: 'ed25519', header: 'x-signature-ed25519', challenge: { when, echo: 'type' } } })]),
  // (A body `echo` without `when` does not compile.)
  ...([{ echo: { query: 'challenge' }, when: { status: 200, header: 'x-challenge' }, text: true },
    { echo: { query: 'challenge' }, when: { path: 'type', detail: 'ping' }, text: true, unsigned: true }] as const)
    .map((challenge): [Rule, Entry] => ["a `webhook.challenge.when` with no `status` or `detail`, reading a body `path` when `echo` is one (a query may leave `when` out)",
      defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], webhook: { kind: 'standard', challenge } })]),
  ["an operation on a `page` or `offset` shape whose `records` is the shape's `list` (both left out for a list at the answer's top level)", defineProvider({ ...key,
    auth: [{ kind: 'key' }], fields: [secret], paging: { page: { kind: 'page', send: { query: 'page' }, list: 'items' } },
    operations: { 'items.list': { docs: 'https://k.test/docs/items', path: '/items', paging: 'page', records: 'result.items',
      result: { result: { items: [{ id: 'string' }] } } } } })],
  ["an operation on a `page` or `offset` shape whose `records` is the shape's `list` (both left out for a list at the answer's top level)", defineProvider({ ...key,
    auth: [{ kind: 'key' }], fields: [secret], paging: { offset: { kind: 'offset', send: { body: 'offset' }, list: 'data' } },
    operations: { 'items.list': { docs: 'https://k.test/docs/items', method: 'POST', kind: 'read', path: '/items', paging: 'offset',
      result: { data: [{ id: 'string' }] } } } })],
  ["an operation on a `page` or `offset` shape whose `records` is the shape's `list` (both left out for a list at the answer's top level)", defineProvider({ ...key,
    auth: [{ kind: 'key' }], fields: [secret], paging: { page: { kind: 'page', send: { query: 'page' } } },
    operations: { 'items.list': { docs: 'https://k.test/docs/items', path: '/items', paging: 'page', records: 'items', result: { items: [{ id: 'string' }] } } } })],
  ...([[{ kind: 'page', send: { query: 'page' } }, 'page', 'query'], [{ kind: 'cursor', next: 'next', send: { body: 'cursor' } }, 'cursor', 'body'],
    [{ kind: 'offset', send: { query: 'offset' } }, 'offset', 'query'], [{ kind: 'cursor', next: 'next', send: { body: 'cursor' } }, 'q', 'form']] as const)
    .map(([shape, name, place]): [Rule, Entry] => ["no `operations[].params` entry in the place its paging shape's `send` writes (the walk sends it), and no `form` one beside a `send.body`",
      defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], paging: { list: shape },
        operations: { 'items.list': { docs: 'https://k.test/docs/items', method: 'POST', kind: 'read', path: '/items', paging: 'list',
          params: { [name]: { in: place, type: 'integer' } } } } })]),
  ...([
    [{ authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://{host}/token' }, { baseUrl: 'https://api.k.test' }],
    [{ authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://k.test/token' }, { baseUrl: 'https://{host}/api' }],
    [{ authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://{host}/token' }, { baseUrl: 'https://{host}/api', bases: { cloud: 'https://cloud.k.test' } }],
  ] as const).map(([urls, http]): [Rule, Entry] => [HOST_SPLIT, defineProvider({ ...oauth2, scopes: { default: [] },
    fields: [{ name: 'host', title: 'Host' }], auth: [{ kind: 'oauth2', ...urls }], http: { ...http, host: '*' } })]),
  // A typed host in the OAuth 2 URLs alone needs the pattern too: they are filled by the base's rule.
  [HOST_PATTERN, defineProvider({ ...oauth2, scopes: { default: [] }, fields: [{ name: 'host', title: 'Host' }],
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://{host}/token' }] })],
  ...(['https:///{region}/api', 'https://{region}@k.test', 'HTTPS://api.k.test'] as const).map((baseUrl): [Rule, Entry] => [WELL_FORMED_URLS,
    defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret, { name: 'region', title: 'Region' }], http: { baseUrl, host: '*' } })]),
  [WELL_FORMED_URLS, defineProvider({ ...oauth2, scopes: { default: [] }, auth: [{ ...oauth2.auth[0], tokenUrl: 'https:///k.test/token' }] })],
  // A fixed token URL beside a typed base: the token it gives would go to any host typed.
  [HOST_SPLIT, defineProvider({ ...tokened, fields: [...tokened.fields, { name: 'host', title: 'Host' }], http: { baseUrl: 'https://{host}/api', host: '*' } })],
  // A key on a typed host beside a fixed second base: the key would go to that other host.
  [HOST_SPLIT, defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret, { name: 'host', title: 'Host' }],
    http: { baseUrl: 'https://{host}/api', host: '*', bases: { cloud: 'https://cloud.k.test' } } })],
  [OAUTH_READS, defineProvider({ ...key, fields: [secret, { name: 'email', title: 'Email' }], scopes: { default: [] },
    auth: [oauth2.auth[0], { kind: 'key', send: { basic: ['{email}', '{apiKey}'] } }] })],
  ...(['https://k.test/{apiKey}/token', 'https://k.test/{site}/token'] as const).map((tokenUrl): [Rule, Entry] => [OAUTH_PLAIN_URLS,
    defineProvider({ ...oauth2, scopes: { default: [] }, fields: [secret], save: { site: 'site' }, identify: { request: { path: '/me' } },
      auth: [{ ...oauth2.auth[0], tokenUrl }] })]),
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
  ...[{ defaultWaitMs: 30_000, maxWaitMs: 10_000 }, { defaultWaitMs: 90_000 }, { maxWaitMs: 500 }].map((retry): [Rule, Entry] => [RETRY_DEFAULT,
    defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], http: { ...key.http, retry } })]),
  [RETRY_ONLY_STATED, defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    http: { ...key.http, retry: { onlyStated: true, defaultWaitMs: 5000 } } })],
  // A host the token answer names: never any host, never beside a typed one, and in no URL sent before the answer exists.
  [ANY_HOST, defineProvider({ ...named, http: { ...named.http, host: '*' } })],
  [HOST_PATTERN, defineProvider({ ...named, http: { baseUrl: named.http.baseUrl } })],
  [HOST_SPLIT, defineProvider({ ...named, fields: [{ name: 'region', title: 'Region' }], http: { ...named.http, baseUrl: 'https://{host}.{region}/api' } })],
  ...(['authorizeUrl', 'tokenUrl'] as const).map((part): [Rule, Entry] => [OAUTH_PLAIN_URLS,
    defineProvider({ ...named, auth: [{ ...named.auth[0], [part]: 'https://{host}/oauth' }] })]),
  [OAUTH_PLAIN_URLS, defineProvider({ ...named, revoke: { url: 'https://{host}/oauth/revoke', token: ['refresh'] } })],
  // A named host is the base's whole host: composed into another, it is typed, so split from the fixed sign-in URLs.
  ...['https://api-{host}.k.test/api', 'https://{host}.k.test/api'].map((baseUrl): [Rule, Entry] => [HOST_SPLIT,
    defineProvider({ ...named, http: { ...named.http, baseUrl } })]),
  [HOST_SPLIT, defineProvider({ ...named, auth: [{ ...named.auth[0], refreshUrl: 'https://auth.{host}/token' }] })],
])('an entry without %s is refused', (rule, bad) => { expect(runnable[rule](bad)).toBe(false); });

test.each([
  ['ends on the token answer', { request: { path: '/me' }, id: ['portalId', 'tokenAnswer.hub_id'] }],
  ['ends on a template, with no identify request', { id: ['tokenAnswer.hub_id', '{id}'] }],
] as const)("beside OAuth 2, a key's id list that %s is refused", (_, identify) => {
  const both = defineProvider({ ...key, fields: [secret], scopes: { default: [] }, auth: [oauth2.auth[0], { kind: 'key' }], identify });
  expect(broken(both)).toContain("no `tokenAnswer.*` on a key entry, except in an `id` or `name` list ending on a path of identify's requested answer, beside an OAuth 2 or token sign-in (key)");
});

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

test.each(['post', {}, true])('clientAuth %o fails the schema, with what to fix', value => {
  const bad = { ...oauth2, scopes: { default: [] }, auth: [{ ...oauth2.auth[0], clientAuth: value }] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([CLIENT_AUTH]);
});

test('a public client beside `pkce: false` fails the schema, with what to fix', () => {
  const bad = { ...oauth2, scopes: { default: [] }, auth: [{ ...oauth2.auth[0], clientAuth: 'none', pkce: false }] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([PUBLIC_PKCE]);
});

test.each(['basic', 'none'])('clientAuth %o passes the schema', value => {
  expect(entrySchema.safeParse({ ...oauth2, scopes: { default: [] }, auth: [{ ...oauth2.auth[0], clientAuth: value }] }).error).toBeUndefined();
});

test.each(['', '  '])('a token request whose `token` path is %j fails the schema, with what to fix', token => {
  const bad = { ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, token } }] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message))
    .toEqual(["a token request's `token` is the token's path in the answer: give it, or leave it out"]);
});

test.each<[string, Record<string, unknown>, string]>([
  ['a key before OAuth 2', { fields: [secret], scopes: { default: [] }, auth: [{ kind: 'key' }, oauth2.auth[0]] }, OAUTH_FIRST],
  ['two key sign-ins', { fields: [secret], auth: [{ kind: 'key' }, { kind: 'key', send: { header: 'x-api-key' } }] }, ONE_OF_EACH],
  ['a key beside a token', { fields: [secret], auth: [{ kind: 'key' },
    { kind: 'token', request: { url: 'https://k.test/token', body: { key: '{apiKey}' } } }] }, KEY_OR_TOKEN],
  ['an own base on its first sign-in', { fields: [secret], auth: [{ kind: 'key', http: { baseUrl: 'https://k.test/api' } }] }, OWN_FIRST],
  ['own fields on its first sign-in', { auth: [{ kind: 'key', fields: [secret] }] }, OWN_FIRST],
  ['a later sign-in\'s own headers', { fields: [secret], scopes: { default: [] },
    auth: [oauth2.auth[0], { kind: 'key', http: { baseUrl: 'https://k.test/api', headers: { a: 'b' } } }] }, 'Unrecognized key: "headers"'],
])('an entry with %s fails the schema, with what to fix', (_, parts, message) => {
  expect(entrySchema.safeParse({ ...key, ...parts }).error?.issues.map(issue => issue.message)).toEqual([message]);
});

test("pnpm new's unfilled skeleton breaks only rules that say what to fill: the TODOs and the categories", async () => {
  const folder = mkdtempSync(fileURLToPath(new URL('../../.scaffold-test-', import.meta.url)));
  try {
    mkdirSync(join(folder, 'src/catalogue'), { recursive: true });
    spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/new.mjs', import.meta.url)), 'acme'], { cwd: folder });
    const file = join(folder, 'src/catalogue/acme.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace("'../catalogue.js'", `'${new URL('../catalogue.ts', import.meta.url).href}'`));
    const { acme } = await import(pathToFileURL(file).href) as { acme: Entry };
    expect(entrySchema.safeParse(acme).error).toBeUndefined();
    expect(broken(acme)).toEqual([`${TODO_RULE} (key)`, '`categories`: one or two unique values of the `Category` type in src/catalogue.ts, the first the main one (key)']);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test.each<[string, Entry, string[]]>([
  // Narrowing a key entry would drop these: a one-sign-in entry is checked as it is.
  ['a key entry with scopes and an RFC 7009 revoke', defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret], scopes: { default: ['read'] },
    revoke: { url: 'https://k.test/revoke', token: ['refresh'] } }), ['no `scopes` or RFC 7009 `revoke` on a key or token entry (key)']],
  ['an OAuth entry with two secret fields', defineProvider({ ...oauth2, scopes: { default: [] }, fields: [secret, { name: 'other', title: 'Other', secret: true }] }),
    ['at most one secret field in `fields`, exactly one on a key or token entry (oauth2)']],
  // A fixed cloud token URL beside a typed base: the cloud's token would go to any host typed.
  ['a plain field in the base beside fixed OAuth 2 URLs and a key', defineProvider({ ...key, fields: [secret, { name: 'site', title: 'Site' }], scopes: { default: [] },
    http: { baseUrl: 'https://{site}.k.test', host: '*.k.test' }, auth: [oauth2.auth[0], { kind: 'key', send: { header: 'x-site', value: '{site} {apiKey}' } }] }),
    [`${HOST_SPLIT} (oauth2)`]],
  // A field only the key reads would be asked for by the OAuth 2 connect and never used.
  // A later token sign-in's own typed base beside its fixed token URL: the token would go to any host typed.
  ['a later token sign-in with its own typed base beside a fixed token URL', defineProvider({ ...key, scopes: { default: [] },
    auth: [oauth2.auth[0], { kind: 'token', request: { url: 'https://k.test/token', body: { s: '{apiKey}' } }, fields: [{ name: 'host', title: 'Host' }, secret],
      http: { baseUrl: 'https://{host}/api', host: '*' } }] }), [`${HOST_SPLIT} (token)`]],
  // A named host is OAuth 2's alone: a token sign-in's base read from its token answer is typed, beside a fixed token URL.
  ['a token entry whose base host its token answer names', defineProvider({ ...key, fields: [secret], save: { host: 'tokenAnswer.host' },
    auth: [{ kind: 'token', request: { url: 'https://login.k.test/token', body: { s: '{apiKey}' } } }], http: { baseUrl: 'https://{host}/api', host: '*.k.test' } }),
    [`${HOST_SPLIT} (token)`]],
  ['a later token sign-in whose own base host its token answer names', defineProvider({ ...key, scopes: { default: [] }, save: { host: 'tokenAnswer.host' },
    auth: [oauth2.auth[0], { kind: 'token', request: { url: 'https://login.k.test/token', body: { s: '{apiKey}' } }, fields: [secret],
      http: { baseUrl: 'https://{host}/api', host: '*.k.test' } }] }), [`${HOST_SPLIT} (token)`]],
  ['a Basic email the key alone reads, beside OAuth 2 and a key', defineProvider({ ...key, fields: [secret, { name: 'email', title: 'Email' }],
    scopes: { default: [] }, auth: [oauth2.auth[0], { kind: 'key', send: { basic: ['{email}', '{apiKey}'] } }] }), [`${OAUTH_READS} (oauth2)`]],
])('%s breaks only its rule', (_, entry, rules) => { expect(broken(entry)).toEqual(rules); });

test.each<[string, Entry]>([
  ['a plain field identify reads on an OAuth entry', defineProvider({ ...oauth2, scopes: { default: [] }, fields: [{ name: 'site', title: 'Site' }],
    identify: { request: { path: '/me' }, id: 'id', name: '{connection.site}' } })],
  // Mattermost's shape: every URL and the base on the host typed, and a key beside OAuth 2.
  ['an OAuth 2 sign-in and a key on a typed host', defineProvider({ ...key, fields: [{ name: 'host', title: 'Host' }, secret], scopes: { default: [] },
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/oauth/authorize', tokenUrl: 'https://{host}/oauth/token' }, { kind: 'key' }],
    revoke: { url: 'https://{host}/oauth/revoke', token: ['refresh'] }, http: { baseUrl: 'https://{host}/api', host: '*' } })],
  // A later key's own base on one of several fixed domains.
  ['a later key with its own base on a list of host patterns', defineProvider({ ...key, scopes: { default: [] }, identify: { request: { path: '/me' }, id: 'id' },
    auth: [oauth2.auth[0], { kind: 'key', fields: [{ name: 'host', title: 'Host', choices: ['a.k.test', 'b.k.example'] }, secret],
      http: { baseUrl: 'https://{host}', host: ['*.k.test', '*.k.example'] } }] })],
  // Outline's shape: OAuth 2 on the cloud host, a key with its own fields on a host the person types.
  ['OAuth 2 on a fixed host beside a key with its own typed base', defineProvider({ ...key, scopes: { default: [] }, identify: { request: { path: '/me' }, id: 'id' },
    auth: [oauth2.auth[0], { kind: 'key', fields: [{ name: 'host', title: 'Host' }, secret], http: { baseUrl: 'https://{host}/api', host: '*' } }] })],
  // Azure DevOps' shape: fixed OAuth 2 URLs, a value only in the base's path.
  ['fixed OAuth 2 URLs and a plain field in the base\'s path', defineProvider({ ...oauth2, scopes: { default: [] }, fields: [{ name: 'org', title: 'Organization' }],
    http: { baseUrl: 'https://api.k.test/{org}' } })],
  ["Wrike's shape: the base and the refresh on the host the token answer names", defineProvider(named)],
  ["Pipedrive's shape: the base on the origin the token answer names, the refresh fixed", defineProvider({ ...named,
    save: { apiDomain: 'tokenAnswer.api_domain' }, auth: [{ ...named.auth[0], refreshUrl: 'https://login.k.test/token' }],
    http: { baseUrl: 'https://{apiDomain}/api/v1', host: '*.k.test' } })],
  // HubSpot's shape: OAuth 2's id from the token answer, the key's from identify's answer, which the engine reads next.
  ['an id list from the token answer, then identify\'s answer, beside OAuth 2 and a key', defineProvider({ ...key, fields: [secret],
    scopes: { default: [] }, auth: [oauth2.auth[0], { kind: 'key' }], identify: { request: { path: '/me' }, id: ['tokenAnswer.hub_id', 'portalId'] } })],
])('%s breaks no rule', (_, entry) => { expect(broken(entry)).toEqual([]); });

test("a later sign-in's own host may list several patterns, as `http.host` may", () => {
  const listed = { ...key, fields: [secret], scopes: { default: [] }, auth: [oauth2.auth[0], { kind: 'key',
    fields: [{ name: 'host', title: 'Host' }, secret], http: { baseUrl: 'https://{host}', host: ['*.k.test', '*.k.example'] } }] };
  expect(entrySchema.safeParse(listed).error).toBeUndefined();
});

test('a token request whose body holds an object fails the schema, with what to fix', () => {
  const bad = { ...tokened, auth: [{ ...tokened.auth[0], request: { ...tokened.auth[0].request, body: { grant: { type: 'x' } } } }] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(["a token request's body is a flat record of templates"]);
});

test('a query send that names no parameter fails the schema, with what to fix', () => {
  const bad = { ...key, auth: [{ kind: 'key', send: { query: {} } }], fields: [secret] };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(['a query send names at least one parameter']);
});

test("a webhook `hash` other than 'sha1' fails the schema, with what to fix", () => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], webhook: { kind: 'hmac', header: 'x-signature', hash: 'md5' } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(["`hash` is 'sha1' or left out (SHA-256)"]);
});

test.each(['base64url', 'utf8', ''])("a webhook `secret` of %j fails the schema, with what to fix", value => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], webhook: { kind: 'hmac', header: 'x-signature', secret: value } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message))
    .toEqual(["`secret` is 'base64', 'hex' or left out (the key is the secret's own bytes)"]);
});

test.each(['prefix', 'encoding', 'hash', 'part'])('an `ed25519` webhook with `%s` fails the schema, with what to fix', part => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret],
    webhook: { kind: 'ed25519', header: 'x-signature-ed25519', [part]: part === 'encoding' ? 'base64' : 'x' } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message))
    .toEqual(['an `ed25519` webhook takes no `prefix`, `encoding`, `hash` or `part`: leave them out']);
});

test.each<[string, Record<string, unknown>]>([
  ['a send header', { auth: [{ kind: 'key', send: { header: 'x key' } }] }],
  ["a webhook's header", { webhook: { kind: 'hmac', header: 'X Signature' } }],
  ['a timestamp header', { webhook: { kind: 'hmac', header: 'x-signature', signed: '{timestamp}{body}', timestamp: { header: 'x-timestamp:' } } }],
  ['a delivery id header', { webhook: { kind: 'standard', deliveryId: { header: 'Webhook-Id' } } }],
  ["a condition's header", { errors: { rules: [{ when: { header: 'X-Error' }, code: 'rejected' }] } }],
  ['a header the entry sends on every call', { http: { ...key.http, headers: { 'X-Api-Version': '2' } } }],
  ["a rate limit's wait header", { http: { ...key.http, rateLimit: { when: [{ status: 403, wait: { header: 'x reset', unit: 'epochSeconds' } }] } } }],
  ["a retry's wait header", { http: { ...key.http, retry: { wait: { header: 'RateLimit-Reset', unit: 's' } } } }],
  ["one of a retry's wait headers", { http: { ...key.http, retry: { wait: { header: ['ratelimit-reset', 'RateLimit-User-Reset'], unit: 's' } } } }],
])('%s that is no lowercase HTTP token fails the schema, with what to fix', (_, parts) => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], ...parts };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([headerMessage]);
});

test.each<[string, Record<string, unknown>, string]>([
  ['a send value with a control character', { auth: [{ kind: 'key', send: { header: 'x-api-key', value: 'k{token}\r\nx-evil: 1' } }] },
    'a header `value` holds no control character'],
  ['a challenge that compares nothing', { webhook: { kind: 'ed25519', header: 'x-signature-ed25519', challenge: { when: { path: 'type' }, echo: 'type' } } },
    'a `challenge.when` compares a value: give `equals` or `in`'],
  ['a challenge from an empty query name', { webhook: { kind: 'hmac', header: 'x-signature', challenge: { echo: { query: '' }, text: true, unsigned: true } } },
    'a challenge `query` names its parameter: give the name'],
  ['a challenge from a query answered as JSON', { webhook: { kind: 'standard', challenge: { echo: { query: 'challenge' }, unsigned: true } } },
    'a challenge read from a query is answered as text: give `text: true`'],
])('%s fails the schema, with what to fix', (_, parts, message) => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], ...parts };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([message]);
});

test.each<[string, Record<string, unknown>, string]>([
  ['`retry.waitFromBody`', { retry: { waitFromBody: { path: 'wait', unit: 'ms' } } }, 'Unrecognized key: "waitFromBody"'],
  ["a rate-limit rule's `resetAt`", { rateLimit: { when: [{ status: 403, resetAt: { header: 'x-reset', unit: 'epochSeconds' } }] } },
    'Unrecognized key: "resetAt"'],
  ['a wait with both a header and a path', { retry: { wait: { header: 'x-reset', path: 'wait', unit: 's' } } },
    'a `wait` reads one `header` (or a list of headers) or one `path`'],
  ['a wait in minutes', { retry: { wait: { header: 'x-reset', unit: 'min' } } }, "a wait's `unit` is 's', 'ms', 'epochSeconds' or 'epochMs'"],
])('%s fails the schema, with what to fix', (_, http, message) => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], http: { ...key.http, ...http } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([message]);
});

test('an `ed25519` webhook with an unknown key such as `signd` gets the ordinary message', () => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], webhook: { kind: 'ed25519', header: 'x-signature-ed25519', signd: '{body}' } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual(['Unrecognized key: "signd"']);
});

test.each<[Record<string, unknown>, string]>([
  [{ kind: 'cursor', next: 'next', send: { query: 'cursor' }, zeroBased: true }, 'Unrecognized key: "zeroBased"'],
  [{ kind: 'nextUrl', next: 'next', zeroBased: true }, 'Unrecognized key: "zeroBased"'],
  [{ kind: 'page', send: { query: 'page' }, zeroBased: false }, '`zeroBased` is `true` or left out (the first page is 1)'],
  [{ kind: 'offset', send: { query: 'offset' }, zeroBased: true }, 'Unrecognized key: "zeroBased"'],
  [{ kind: 'linkHeader', zeroBased: true }, 'Unrecognized key: "zeroBased"'],
  [{ kind: 'linkHeader', next: 'next' }, 'Unrecognized key: "next"'],
  ...['me', '/me', 'me/'].flatMap(pathPrefix => [{ kind: 'linkHeader', pathPrefix }, { kind: 'nextUrl', next: 'next', pathPrefix }]
    .map((shape): [Record<string, unknown>, string] => [shape, '`pathPrefix` is a whole directory: start and end it with `/` (`/me/`)'])),
])('a paging shape %j fails the schema, with what to fix', (shape, message) => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], paging: { list: shape } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([message]);
});

test.each([...['', 'v 1', 'v1,t', 'v1=', '\tv1'].map(part => ({ part })), ...['t,', 't=', 't t'].map(name => ({ part: 'v1', timestamp: { part: name } }))])(
  'an `hmac` webhook with %j fails the schema, with what to fix', parts => {
    const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], webhook: { kind: 'hmac', header: 'stripe-signature', ...parts } };
    expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message))
      .toEqual(['a `part` names one `name=value` piece: give it a name with no `,`, `=` or space']);
  });

test.each<[string, Record<string, unknown>, string]>([
  ['token', { header: 'x-goog-channel-token', prefix: 'x' }, 'a `token` webhook takes only its `header` (and `deliveryId` and `challenge`): leave the rest out'],
  ['token', { header: 'x-goog-channel-token', timestamp: { header: 'x-t' } }, 'a `token` webhook takes only its `header` (and `deliveryId` and `challenge`): leave the rest out'],
  ['token', {}, 'Invalid input: expected string, received undefined'],
  ['token', { header: 'x-goog-channel-token', secret: 'hex' }, 'a `token` webhook takes only its `header` (and `deliveryId` and `challenge`): leave the rest out'],
  ['ed25519', { header: 'x-signature-ed25519', secret: 'hex' }, 'Unrecognized key: "secret"'],
  ...([{ header: 'authorization' }, { prefix: 'Basic ' }, { signed: '{body}' }, { timestamp: { header: 'x-t' } }, { secret: 'base64' },
    { deliveryld: { header: 'x-id' } }] as const).map((parts): [string, Record<string, unknown>, string] => ['basic', parts,
      'a `basic` webhook takes only `deliveryId` and `challenge`: its header is `authorization`, leave the rest out']),
  ['standard', { deliveryld: { header: 'webhook-id' } }, 'Unrecognized key: "deliveryld"'],
  ...['header', 'signed', 'timestamp', 'prefix', 'secret'].map((part): [string, Record<string, unknown>, string] => ['standard',
    { [part]: part === 'timestamp' ? { header: 'webhook-timestamp' } : 'x' },
    'a `standard` webhook takes no `header`, `signed`, `timestamp`, `prefix` or `secret`: Standard Webhooks fixes them']),
])('a `%s` webhook with %j fails the schema, with what to fix', (kind, parts, message) => {
  const bad = { ...key, auth: [{ kind: 'key' }], fields: [secret], webhook: { kind, ...parts } };
  expect(entrySchema.safeParse(bad).error?.issues.map(issue => issue.message)).toEqual([message]);
});


test("a base with a host from a field's choices and a path segment from a saved value passes every rule", () => {
  const good = defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret, { name: 'region', title: 'Region', choices: ['eu.k.test'] }],
    http: { baseUrl: 'https://{region}/sites/{siteId}', host: '*.k.test' }, identify: { request: { path: '/me' } }, save: { siteId: 'id' } });
  expect(Object.keys(runnable).filter(rule => !runnable[rule as Rule](good))).toEqual([]);
});

test('an entry whose operations keep every rule passes them all', () => {
  const good = defineProvider({ ...key, auth: [{ kind: 'key' }], fields: [secret],
    paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'cursor' } }, links: { kind: 'linkHeader', pathPrefix: '/pages/' } },
    operations: {
      'pages.list': { docs: 'https://k.test/docs/pages', path: '/pages/{space}', paging: 'cursor', records: 'data.items',
        params: { space: { in: 'path', type: 'string', required: true }, q: { in: 'query', type: 'string' } },
        result: { data: { items: [{ id: 'string' }] }, 'next?': 'string' } },
      'pages.events': { docs: 'https://k.test/docs/events', path: '/events', paging: 'cursor', records: 'a.b', result: { 'a.b': ['string'], a: { b: 'string' } } },
      'requests.create': { docs: 'https://k.test/docs/requests', method: 'POST', path: '/requests', params: { title: { in: 'body', type: 'string', required: true },
        state: { in: 'query', type: 'string', enum: ['open'] }, parent: { in: 'body', type: { id: 'string' }, nullable: true } } },
      'then.later': { docs: 'https://k.test/docs/later', path: '/later' },
      'people.get': { docs: 'https://k.test/docs/people', method: 'POST', path: '/people', anyOf: [['email'], ['person.name', 'person.company.domain']],
        params: { email: { in: 'body', type: 'string' }, person: { in: 'body', type: { 'name?': 'string', 'company?': { domain: 'string' } }, required: true } } },
      me: { docs: 'https://k.test/docs/me', graphql: 'query Me($first: Int) { me { id } }', params: { first: { in: 'variables', type: 'integer' } } },
    } });
  expect(Object.keys(runnable).filter(rule => !runnable[rule as Rule](good))).toEqual([]);
  expect(entrySchema.safeParse(good).error).toBeUndefined();
});

test.each([['json', true], ['request.create', true], ['paginate.all', true], ['then', true],
  ['requests.create', false], ['pages.markdown', false], ['jsonish', false], ['then.later', false], ['thenable', false]])('operation id %s alone is refused: %s', (id, taken) => {
  expect(clashing([id]) !== undefined).toBe(taken);
});
