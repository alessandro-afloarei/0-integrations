import { expect, expectTypeOf, test } from 'vitest';
import { defineProvider, signInWith } from './catalogue.js';
import { clickup } from './catalogue/clickup.js';
import { linear } from './catalogue/linear.js';
import { client } from './client.js';
import { finishConnect, startConnect, type Connected } from './connect.js';
import type { Grant } from './oauth.js';
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
  // An OAuth sign-in's values are only what `save` keeps; the key's are its plain fields.
  expectTypeOf<Connected<typeof mailed>['values']>().not.toHaveProperty('email');
  expectTypeOf<Connected<ReturnType<typeof signInWith<typeof mailed, 'oauth2'>>>['values']>().not.toHaveProperty('email');
  expectTypeOf<Connected<ReturnType<typeof signInWith<typeof mailed, 'key'>>>['values']['email']>().toEqualTypeOf<string>();
}

test('the narrowed types compile', () => {
  expect([narrowed, stored].every(item => typeof item === 'function')).toBe(true);
  expect(mailed.auth.map(auth => auth.kind)).toEqual(['oauth2', 'key']);
});
