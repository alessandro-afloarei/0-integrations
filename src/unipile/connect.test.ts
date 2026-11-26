import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ProviderHttpError } from '../errors.js';
import { fakeFetch, respondFrom } from '../testing.js';
import { fakeUnipile } from './fake.js';
import * as unipile from './unipile.js';

const api = 'https://api.unipile.com/v2/auth/link';
const consentUrl = 'https://app.test/api/integrations/linkedin/fixture-authorize';
const link: unipile.HostedSignIn = { state: 'fixture-nonce', redirectUri: 'https://app.test/api/integrations/linkedin/finish',
  expiresOn: '2026-11-02T04:10:00.000Z', providers: ['linkedin'] };
const data = { authLink: () => 'https://auth.unipile.com/hosted',
  accounts: (id: string) => (id === 'acc_1' || id === 'acc_mail' ? { createdAt: '2026-11-02T04:00:00.000Z' } : null),
  company: { id: '1', name: 'Lumen', tagline: '', description: '', industry: [], headcount: null, city: null, profileUrl: '' }, posts: [] };
const wire = { providers: ['linkedin'], expires_on: link.expiresOn, redirect_uri: link.redirectUri, state: link.state };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T04:00:00Z')); });
afterEach(() => vi.useRealTimers());

function setup(accountId: () => string | Promise<string> = () => 'acc_1') {
  const routes = fakeUnipile({ ...data, hostedConsent: { consentUrl, redirectUris: [link.redirectUri], accountId } });
  const fake = fakeFetch(routes);
  return { fake, client: unipile.unipileClient({ apiKey: 'fixture-key', fetch: fake.fetch }), respond: respondFrom(routes) };
}

test('the hosted sign-in is the link, then the account it made', async () => {
  const fake = fakeFetch(fakeUnipile(data));
  const client = unipile.unipileClient({ apiKey: 'fixture-key', fetch: fake.fetch });
  expect(await client.authLink(link)).toBe('https://auth.unipile.com/hosted');
  expect(JSON.parse(fake.calls[0]?.body ?? '')).toEqual(wire);
  expect(await client.account('acc_1')).toEqual({ createdAt: '2026-11-02T04:00:00.000Z', provider: 'linkedin', email: null, scopes: [] });
});

test('a missing account remains a typed not_found refusal', async () => {
  const { client } = setup();
  await expect(client.account('acc_missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
});

test.each(['authLink', 'account'])('a refused workspace key remains a typed error on %s', async operation => {
  const fake = fakeFetch([{ url: /https:/u, respond: () => new Response(null, { status: 401 }) }]);
  const client = unipile.unipileClient({ apiKey: 'fixture-key', fetch: fake.fetch });
  const result = operation === 'authLink' ? client.authLink(link) : client.account('acc_1');
  await expect(result).rejects.toBeInstanceOf(ProviderHttpError);
  await expect(result).rejects.toMatchObject({ code: 'rejected', status: 401 });
  expect(fake.calls).toHaveLength(1);
});

test('the account lookup keeps its deadline before a request is sent', async () => {
  const { client, fake } = setup();
  await expect(client.account('acc_1', AbortSignal.abort())).rejects.toMatchObject({ code: 'unavailable' });
  expect(fake.calls).toHaveLength(0);
});

test('the consent sends the browser back to the return address with the account, its provider and our state', async () => {
  const { client, fake, respond } = setup();
  const url = await client.authLink(link);
  const response = await respond(new Request(url));
  expect(response?.status).toBe(302);
  const back = new URL(response?.headers.get('location') ?? '');
  expect(back.origin + back.pathname).toBe(link.redirectUri);
  expect(Object.fromEntries(back.searchParams)).toEqual({ account_id: 'acc_1', provider: 'linkedin', state: 'fixture-nonce' });
  expect(JSON.parse(fake.calls[0]?.body ?? '')).toEqual(wire);
  expect(url).not.toContain(link.state);
  expect(url).not.toContain('fixture-key');
});

test('a mail sign-in hands its providers, scopes and state to an async accountId', async () => {
  let signIn: unknown;
  const routes = fakeUnipile({ ...data, hostedConsent: { consentUrl, redirectUris: [link.redirectUri],
    accountId: given => { signIn = given; return Promise.resolve('acc_mail'); } } });
  const mail = unipile.unipileClient({ apiKey: 'k', fetch: fakeFetch(routes).fetch });
  const url = await mail.authLink({ ...link, providers: ['google'], scopes: { google: ['gmail.readonly'] } });
  expect(new URL((await respondFrom(routes)(new Request(url)))?.headers.get('location') ?? '').searchParams.get('account_id'))
    .toBe('acc_mail');
  expect(signIn).toEqual({ state: link.state, providers: ['google'], scopes: { google: ['gmail.readonly'] } });
});

test.each(['state', 'redirect_uri', 'account_id'])('consent cannot be given another %s', async key => {
  const { client, respond } = setup();
  const url = new URL(await client.authLink(link));
  url.searchParams.set(key, 'https://evil.test/');
  expect((await respond(new Request(url)))?.status).toBe(400);
});

test('authLink refuses an unregistered return address before consent', async () => {
  const { client } = setup();
  await expect(client.authLink({ ...link, redirectUri: 'https://evil.test/' })).rejects.toMatchObject({ code: 'request_failed', status: 400 });
});

test.each([JSON.stringify({ ...wire, state: ' ' }), '{}', '{', JSON.stringify({ ...wire, state: null }),
  JSON.stringify({ ...wire, providers: [] }), JSON.stringify({ ...wire, providers: ['LINKEDIN'] }),
  JSON.stringify({ ...wire, account_id: 'acc_1' }), JSON.stringify({ ...wire, providers: undefined }),
  JSON.stringify({ ...wire, config: { google: { oauth_scope: [] } } })])('the fake refuses malformed input %s', async body => {
  const { fake } = setup();
  const result: unknown = await fake.fetch(api, { method: 'POST', body }).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Response);
  if (!(result instanceof Response)) throw new Error('expected_response');
  expect(result.status).toBe(400);
});

test('a consent ticket is single-use, including two concurrent requests', async () => {
  const { client, respond } = setup();
  const url = await client.authLink(link);
  const responses = await Promise.all([respond(new Request(url)), respond(new Request(url))]);
  expect(responses.map(response => response?.status).sort()).toEqual([302, 400]);
});

test('consent expires and is not recognised by another fake instance', async () => {
  const first = setup();
  const url = await first.client.authLink(link);
  expect((await setup().respond(new Request(url)))?.status).toBe(400);
  vi.setSystemTime(new Date(link.expiresOn));
  expect((await first.respond(new Request(url)))?.status).toBe(400);
});

test('the fake refuses a link that already expired', async () => {
  await expect(setup().client.authLink({ ...link, expiresOn: '2026-11-02T03:59:00.000Z' }))
    .rejects.toMatchObject({ code: 'request_failed', status: 400 });
});

test('registration refuses an unsafe consent or return address', () => {
  for (const value of ['/relative', '//evil.test/', 'javascript:alert(1)', 'https://person@evil.test/', 'https://app.test/#']) {
    for (const urls of [{ consentUrl: value, redirectUris: [link.redirectUri] }, { consentUrl, redirectUris: [link.redirectUri, value] }]) {
      expect(() => fakeUnipile({ ...data, hostedConsent: { ...urls, accountId: () => 'acc_1' } })).toThrow('fake_hosted_url_invalid');
    }
  }
});

test('sends the browser back to the return address its link named, of those registered', async () => {
  const other = 'https://app.test/api/integrations/outlook/finish';
  const routes = fakeUnipile({ ...data, hostedConsent: { consentUrl, redirectUris: [link.redirectUri, other], accountId: () => 'acc_1' } });
  const url = await unipile.unipileClient({ apiKey: 'k', fetch: fakeFetch(routes).fetch }).authLink({ ...link, redirectUri: other });
  expect((await respondFrom(routes)(new Request(url)))?.headers.get('location')).toMatch(/^https:\/\/app\.test\/api\/integrations\/outlook\/finish\?/u);
});
