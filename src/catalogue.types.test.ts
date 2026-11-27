import { expect, expectTypeOf, test } from 'vitest';
import { defineProvider, signInWith, type Entry, type Own, type SignIn } from './catalogue.js';
import { clickup } from './catalogue/clickup.js';
import { jira } from './catalogue/jira.js';
import { linear } from './catalogue/linear.js';
import { azuredevops } from './catalogue/azuredevops.js';
import { mattermost } from './catalogue/mattermost.js';
import { outline } from './catalogue/outline.js';
import { client } from './client.js';
import { finishConnect, startConnect, type Connected } from './connect.js';
import { slack } from './catalogue/slack.js';
import { zoom } from './catalogue/zoom.js';
import { authorizeUrl, exchangeCode, refreshGrant, revokeGrant, tokenSource, type Grant, type OAuthClient } from './oauth.js';
import { fakeProvider } from './testing.js';

test('defineProvider keeps the literal', () => {
  const acme = defineProvider({ id: 'acme', name: 'Acme', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' } });
  const id: 'acme' = acme.id;
  expect(id).toBe('acme');
  // @ts-expect-error an entry needs a base URL
  defineProvider({ id: 'bad', name: 'Bad', auth: [{ kind: 'key' }], http: {} });
  // @ts-expect-error an entry needs at least one sign-in
  defineProvider({ id: 'bad', name: 'Bad', auth: [], http: { baseUrl: 'https://x.test' } });
  // @ts-expect-error a category is one of the closed list
  defineProvider({ id: 'bad', name: 'Bad', categories: ['task'], auth: [{ kind: 'key' }], http: { baseUrl: 'https://x.test' } });
});

/** Two sign-ins, OAuth 2 first: Linear's shape. */
const both = defineProvider({ id: 'both', name: 'Both', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://both.test/authorize', tokenUrl: 'https://api.both.test/token', scopeSeparator: ',' },
    { kind: 'key', send: { header: 'authorization' } }],
  scopes: { default: ['read'] }, revoke: { url: 'https://api.both.test/revoke', token: ['access'] },
  http: { baseUrl: 'https://api.both.test' }, identify: { request: { path: '/me' }, id: 'id' },
  operations: { 'items.get': { path: '/items/{id}', params: { id: { in: 'path', type: 'string', required: true } }, result: { id: 'string' } } } });

test('signInWith narrows to one sign-in: OAuth 2 keeps scopes and revoke, the key drops them; both keep the fields', () => {
  const oauth = signInWith(both, 'oauth2');
  const key = signInWith(both, 'key');
  expect(oauth).toEqual({ ...both, auth: [both.auth[0]] });
  expect(key).toEqual({ id: both.id, name: both.name, fields: both.fields, auth: [both.auth[1]], http: both.http,
    identify: both.identify, operations: both.operations });
  for (const one of [oauth, key]) expect(JSON.parse(JSON.stringify(one))).toEqual(one);
  // @ts-expect-error a kind the entry does not declare
  expect(() => signInWith(both, 'token')).toThrow(new TypeError('sign_in_unknown: both token'));
});

// Never called: the types are the test.
async function narrowed(clientId: string, apiKey: string) {
  const oauth = signInWith(both, 'oauth2');
  const key = signInWith(both, 'key');
  expectTypeOf<Connected<typeof oauth>['secret']>().toEqualTypeOf<Grant>();
  expectTypeOf<Connected<typeof key>['secret']>().toEqualTypeOf<Readonly<Record<'apiKey', string>>>();
  expectTypeOf((await startConnect(oauth, { clientId, redirectUri: 'https://app.test/cb', state: 's' })).kind).toEqualTypeOf<'redirect'>();
  expectTypeOf((await startConnect(key)).kind).toEqualTypeOf<'form'>();
  const { secret } = await finishConnect(key, { secret: { apiKey } });
  expectTypeOf(await client(oauth, { token: 't' }).items.get({ id: 'i' })).branded.toEqualTypeOf<{ id: string }>();
  fakeProvider(oauth, { key: 'k', operations: { 'items.get': () => ({ id: 'i' }) } });
  // Scopes and revoke belong to the OAuth 2 sign-in.
  expectTypeOf(key).not.toHaveProperty('scopes');
  expectTypeOf(key).not.toHaveProperty('revoke');
  expectTypeOf(oauth).toHaveProperty('revoke');
  // An entry used whole is its first sign-in: an OAuth redirect.
  expectTypeOf((await startConnect(both, { clientId, redirectUri: 'https://app.test/cb', state: 's' })).kind).toEqualTypeOf<'redirect'>();
  expectTypeOf<Connected<typeof linear>['secret']>().toEqualTypeOf<Grant>();
  // Linear and ClickUp, OAuth 2 then a key; ClickUp declares no revoke.
  expectTypeOf<Connected<ReturnType<typeof signInWith<typeof linear, 'oauth2'>>>['secret']>().toEqualTypeOf<Grant>();
  expectTypeOf(signInWith(clickup, 'oauth2').scopes.default).toEqualTypeOf<readonly []>();
  expectTypeOf<Connected<ReturnType<typeof signInWith<typeof clickup, 'key'>>>['secret']>()
    .toEqualTypeOf<Readonly<Record<'apiToken', string>>>();
  // @ts-expect-error Linear has no token sign-in
  signInWith(linear, 'token');
  expectTypeOf(signInWith(linear, 'key')).not.toHaveProperty('scopes');
  return secret;
}

/** OAuth 2 first, then a key whose Basic pair reads a plain email: the OAuth connect reads no form field. */
const mailed = defineProvider({ id: 'mailed', name: 'Mailed', fields: [{ name: 'email', title: 'Email' }, { name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://mailed.test/authorize', tokenUrl: 'https://api.mailed.test/token' },
    { kind: 'key', send: { basic: ['{email}', '{apiKey}'] } }],
  scopes: { default: [] }, http: { baseUrl: 'https://api.mailed.test' }, identify: { request: { path: '/me' }, id: 'id' } });

// Never called: the types are the test.
async function stored(kind: 'oauth2' | 'key', clientId: string) {
  // An app narrows again with the kind it kept: a union of the two narrowings, each with what its sign-in has.
  const either = signInWith(linear, kind);
  expectTypeOf(either.auth[0].kind).toEqualTypeOf<'oauth2' | 'key'>();
  // Scopes are OAuth 2's: there only once the kind is known.
  expectTypeOf(either).not.toHaveProperty('scopes');
  // TypeScript narrows a union by a key, not by the nested `auth[0].kind`: `'scopes' in`, or the kind the app kept.
  if ('scopes' in either) expectTypeOf(either.scopes.default).toEqualTypeOf<readonly ['read', 'issues:create']>();
  if (kind === 'oauth2') expectTypeOf(signInWith(linear, kind)).toHaveProperty('scopes');
  await startConnect(either, { clientId, redirectUri: 'https://app.test/cb', state: 's' });
  void client(either, { token: 't' }).issues.get({ id: 'ENG-1' });
  // Every sign-in's values hold the entry's plain fields, OAuth 2's included.
  expectTypeOf<Connected<typeof mailed>['values']['email']>().toEqualTypeOf<string>();
  expectTypeOf<Connected<ReturnType<typeof signInWith<typeof mailed, 'key'>>>['values']['email']>().toEqualTypeOf<string>();
}

// Never called: the types are the test.
async function typedHost(clientId: string, redirectUri: string, state: string, host: string) {
  // Mattermost's OAuth 2 reads the host typed: its start needs it, and its connection keeps it.
  expectTypeOf<Connected<SignIn<typeof mattermost, 'oauth2'>>['values']['host']>().toEqualTypeOf<string>();
  const oauth = signInWith(mattermost, 'oauth2');
  // @ts-expect-error the host has no default: the start needs it
  await startConnect(oauth, { clientId, redirectUri, state });
  const started = await startConnect(oauth, { clientId, redirectUri, state, values: { host } });
  expectTypeOf(started.values.host).toEqualTypeOf<string>();
  // A union of entries starts with a union of results: each its own plain fields, never both.
  const either = (id: string) => (id === 'mattermost' ? mattermost : azuredevops);
  const one = await startConnect(either('mattermost'), { clientId, redirectUri, state, values: { host } });
  expectTypeOf(one.values).toEqualTypeOf<Readonly<Record<'host', string>> | Readonly<Record<'organization', string>>>();
  // Linear's has no plain field, so it takes none.
  await startConnect(linear, { clientId, redirectUri, state });
  // @ts-expect-error Linear has no plain field
  await startConnect(linear, { clientId, redirectUri, state, values: { host } });
}

// Never called: the types are the test.
async function valuesByEntry(own: OAuthClient, refreshToken: string, host: string) {
  const oauth = signInWith(mattermost, 'oauth2');
  const start = { clientId: 'c', redirectUri: 'https://app.test/cb', state: 's', scopes: [], codeChallenge: 'c' };
  const exchange = { code: 'c', redirectUri: 'https://app.test/cb' };
  // Mattermost's OAuth 2 reads the host typed: every function needs it, and refuses another key.
  // @ts-expect-error the host is required
  authorizeUrl(oauth, start);
  authorizeUrl(oauth, { ...start, values: { host } });
  // @ts-expect-error the host is required
  await exchangeCode(oauth, own, exchange);
  await exchangeCode(oauth, own, { ...exchange, values: { host } });
  // @ts-expect-error the host is required
  await refreshGrant(oauth, own, refreshToken, {});
  // @ts-expect-error the host is required
  await refreshGrant(oauth, own, refreshToken);
  await refreshGrant(oauth, own, refreshToken, { values: { host } });
  // @ts-expect-error a key the entry does not declare
  await refreshGrant(oauth, own, refreshToken, { values: { host, site: 's' } });
  // @ts-expect-error the host is required
  await revokeGrant(oauth, { accessToken: 'a', client: own });
  await revokeGrant(oauth, { accessToken: 'a', client: own, values: { host } });
  // Linear declares neither a plain field nor `save`: none.
  authorizeUrl(linear, start);
  await exchangeCode(linear, own, exchange);
  await refreshGrant(linear, own, refreshToken);
  await revokeGrant(linear, { accessToken: 'a', client: own });
  // @ts-expect-error Linear has no value
  await refreshGrant(linear, own, refreshToken, { values: { host } });
  // @ts-expect-error Linear has no value
  authorizeUrl(linear, { ...start, values: { host } });
  // Jira keeps only what `save` read: optional on a connection, none before the exchange.
  await refreshGrant(jira, own, refreshToken);
  await revokeGrant(jira, { accessToken: 'a', values: { cloudId: 'c1' } });
  // @ts-expect-error nothing is saved before the exchange
  await exchangeCode(jira, own, { ...exchange, values: { cloudId: 'c1' } });
  // Slack's plain `domain` is required on a connection, beside what `save` read.
  await revokeGrant(slack, { accessToken: 'a', values: { domain: 'slack.com', botUserId: 'U1' } });
  // @ts-expect-error the domain is required
  await refreshGrant(slack, own, refreshToken);
  // @ts-expect-error a key the entry does not declare
  await revokeGrant(slack, { accessToken: 'a', values: { domain: 'slack.com', host } });
  // Zoom's token request reads its plain values.
  // @ts-expect-error the account and client ids are required
  tokenSource(zoom, { secret: { clientSecret: 's' } });
  tokenSource(zoom, { secret: { clientSecret: 's' }, values: { accountId: 'a', clientId: 'c' } });
  // @ts-expect-error a key the entry does not declare
  tokenSource(zoom, { secret: { clientSecret: 's' }, values: { accountId: 'a', clientId: 'c', host } });
}

// Never called: the types are the test.
async function valuesWide(wide: Entry, own: OAuthClient, refreshToken: string, connected: Connected<typeof linear>, id: string) {
  const start = { clientId: 'c', redirectUri: 'https://app.test/cb', state: 's', scopes: [], codeChallenge: 'c' };
  // A wide entry: its values are not known, so each function takes them as optional, as `startConnect` does.
  authorizeUrl(wide, start);
  await exchangeCode(wide, own, { code: 'c', redirectUri: 'https://app.test/cb' });
  await refreshGrant(wide, own, refreshToken);
  await revokeGrant(wide, { accessToken: 'a' });
  tokenSource(wide, { secret: {} });
  await startConnect(wide, { clientId: 'c', redirectUri: 'https://app.test/cb', state: 's' });
  // A connection's own values may be handed back, empty ones included; a value Linear does not declare may not.
  await refreshGrant(linear, own, refreshToken, { values: connected.values });
  await revokeGrant(linear, { accessToken: 'a', client: own, values: connected.values });
  // @ts-expect-error Linear has no value
  await revokeGrant(linear, { accessToken: 'a', client: own, values: { host: 'x' } });
  // A union of two entries: one input per entry (either entry's values alone), never their names merged.
  const either = id === 'mattermost' ? signInWith(mattermost, 'oauth2') : azuredevops;
  authorizeUrl(either, { ...start, values: { host: 'h' } });
  await refreshGrant(either, own, refreshToken, { values: { organization: 'o' } });
  // @ts-expect-error a value neither entry declares
  authorizeUrl(either, { ...start, values: { site: 's' } });
}

/** OAuth 2 on a cloud host, then a key with its own fields, base on a host the person types, and identify. */
const owned = defineProvider({ id: 'owned', name: 'Owned',
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://cloud.owned.test/authorize', tokenUrl: 'https://cloud.owned.test/token' },
    { kind: 'key', send: { header: 'x-api-key' }, fields: [{ name: 'host', title: 'Host' }, { name: 'apiKey', title: 'API key', secret: true }],
      http: { baseUrl: 'https://{host}/api', host: '*' }, identify: { request: { path: '/key' }, id: 'key.id' } }],
  scopes: { default: ['read'] }, http: { baseUrl: 'https://cloud.owned.test/api', headers: { accept: 'application/json' }, retry: {} },
  identify: { request: { path: '/me' }, id: 'id' } });

test("signInWith puts a later sign-in's own fields, base, host and identify in place of the entry's", () => {
  const [oauth, key] = owned.auth;
  expect(signInWith(owned, 'key')).toEqual({ id: 'owned', name: 'Owned', fields: key.fields, auth: [{ kind: 'key', send: key.send }],
    http: { ...owned.http, ...key.http }, identify: key.identify });
  // The OAuth 2 sign-in, first, is the entry's top level: the entry used whole.
  expect(signInWith(owned, 'oauth2')).toEqual({ ...owned, auth: [oauth] });
});

// Never called: the types are the test.
function ownTypes() {
  const key = signInWith(owned, 'key');
  const oauth = signInWith(owned, 'oauth2');
  // Each key the run time puts in place, as it puts it.
  expectTypeOf(key.fields).toEqualTypeOf(owned.auth[1].fields);
  expectTypeOf(key.identify).toEqualTypeOf(owned.auth[1].identify);
  expectTypeOf(key.http.baseUrl).toEqualTypeOf<'https://{host}/api'>();
  expectTypeOf(key.http.host).toEqualTypeOf<'*'>();
  expectTypeOf(key.http.headers).toEqualTypeOf(owned.http.headers);
  expectTypeOf(key.http.retry).toEqualTypeOf(owned.http.retry);
  expectTypeOf(key.auth).toEqualTypeOf<readonly [{ readonly kind: 'key'; readonly send: { readonly header: 'x-api-key' } }]>();
  expectTypeOf(oauth).not.toHaveProperty('fields');
  expectTypeOf(oauth.http).toEqualTypeOf(owned.http);
  expectTypeOf(oauth.identify).toEqualTypeOf(owned.identify);
  expectTypeOf(oauth.auth).toEqualTypeOf<readonly [typeof owned.auth[0]]>();
  // Outline: its key's connection keeps the host typed; its OAuth 2 one has none.
  expectTypeOf<Connected<SignIn<typeof outline, 'key'>>['values']['host']>().toEqualTypeOf<string>();
  expectTypeOf<Connected<SignIn<typeof outline, 'oauth2'>>['values']>().not.toHaveProperty('host');
  expectTypeOf<Connected<SignIn<typeof outline, 'key'>>['secret']>().toEqualTypeOf<Readonly<Record<'apiKey', string>>>();
  // An own `http` brings only its base and host, the host typed as `http.host` is: a list of patterns too.
  const listed = signInWith(defineProvider({ id: 'listed', name: 'Listed', scopes: { default: [] }, http: { baseUrl: 'https://cloud.listed.test',
    bases: { b: 'https://b.listed.test' } }, auth: [owned.auth[0], { kind: 'key', fields: [{ name: 'host', title: 'Host' }, { name: 'k', title: 'K', secret: true }],
    http: { baseUrl: 'https://{host}', host: ['*.listed.test', '*.listed.example'], bases: { b: 'https://evil.test' } } }] }), 'key');
  expectTypeOf(listed.http.host).toEqualTypeOf<readonly ['*.listed.test', '*.listed.example']>();
  expectTypeOf(listed.http.bases).toEqualTypeOf<{ readonly b: 'https://b.listed.test' }>();
  const wide: Own['http'] = { baseUrl: 'https://{host}', host: ['*.a.test'] };
  defineProvider({ id: 'first', name: 'First', http: { baseUrl: 'https://first.test' },
    // @ts-expect-error the first sign-in's part is the entry's top level
    auth: [{ kind: 'key', http: { baseUrl: 'https://{host}/api', host: '*' } }] });
  return wide;
}

test('the narrowed types compile', () => {
  expect([narrowed, stored, typedHost, valuesByEntry, valuesWide, ownTypes].every(item => typeof item === 'function')).toBe(true);
  expect(mailed.auth.map(auth => auth.kind)).toEqual(['oauth2', 'key']);
});
