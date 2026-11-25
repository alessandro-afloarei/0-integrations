import { expect, test } from 'vitest';
import { fakeFetch } from '../testing.js';
import { fakeUnipile } from './fake.js';
import { unipileClient, type HostedSignIn, type LinkedInCompany, type LinkedInPost } from './unipile.js';

const API = 'https://api.unipile.com/v2';
const company: LinkedInCompany = { id: '10433123', name: 'Lumen Payroll', tagline: 'EU payroll', description: 'Lumen runs EU payroll.',
  industry: ['Software Development'], headcount: 42, city: 'Lisbon', profileUrl: 'https://www.linkedin.com/company/lumen-payroll/' };
const posts: LinkedInPost[] = [{ url: 'https://www.linkedin.com/posts/lumen_1', text: 'Payroll in 2.3 days', createdAt: '2026-09-27T09:12:00.000Z',
  author: 'Lumen Payroll' }];
const signIn: HostedSignIn = { state: 'n'.repeat(64), redirectUri: 'http://localhost:3000/api/integrations/linkedin/finish',
  expiresOn: '2099-10-11T21:00:00.000Z', providers: ['linkedin'] };
const answering = (url: string | RegExp, body: unknown) => fakeFetch([{ url, respond: () => Response.json(body) }]);
const client = (fetchImpl: typeof fetch) => unipileClient({ apiKey: 'u', fetch: fetchImpl });

test('round-trips every call through its fake', async () => {
  const fake = fakeFetch(fakeUnipile({ authLink: link => `https://auth.test/link?state=${link.state}`,
    accounts: id => (id === 'acc_gone' ? null : { createdAt: '2026-10-31T09:00:00.000Z' }), company, posts }));
  const unipile = client(fake.fetch);
  expect(await unipile.authLink(signIn)).toBe(`https://auth.test/link?state=${signIn.state}`);
  expect(await unipile.account('acc_1')).toEqual({ createdAt: '2026-10-31T09:00:00.000Z', provider: 'linkedin', email: null, scopes: [] });
  await expect(unipile.account('acc_gone')).rejects.toMatchObject({ code: 'not_found' });
  expect(await unipile.company('acc_1', 'lumen-payroll')).toEqual(company);
  expect(await unipile.posts('acc_1', '10433123', 10)).toEqual(posts);
  await expect(fake.fetch(`${API}/acc_1/chats`)).rejects.toThrow('fakeFetch: no route');
});

test('speaks V2: one address, the key in X-API-KEY, the account in the path, our state and return address on the link', async () => {
  const fake = fakeFetch([{ url: /^https:\/\/api\.unipile\.com\/v2\//u, respond: request => Response.json(request.url.endsWith('/auth/link')
    ? { object: 'HostedAuthLink', link: 'https://auth.unipile.com/x' } : { data: [] }) }]);
  const unipile = unipileClient({ apiKey: 'u-test', fetch: fake.fetch });
  expect(await unipile.authLink(signIn)).toBe('https://auth.unipile.com/x');
  await unipile.posts('acc_1', '10433123', 10);
  expect(fake.calls[0]?.url).toBe(`${API}/auth/link`);
  expect(JSON.parse(fake.calls[0]?.body ?? '')).toEqual({ providers: ['linkedin'], expires_on: signIn.expiresOn,
    redirect_uri: signIn.redirectUri, state: signIn.state });
  expect(fake.calls[0]?.headers['x-api-key']).toBe('u-test');
  expect(fake.calls[0]?.headers.accept).toBe('application/json');
  expect(fake.calls[1]?.url).toBe(`${API}/acc_1/users/10433123/posts?limit=10`);
});

test('asks each OAuth provider for the scopes given, signs an account in again by its id, and writes the expiry in UTC', async () => {
  const fake = answering(`${API}/auth/link`, { object: 'HostedAuthLink', link: 'https://auth.unipile.com/x' });
  await client(fake.fetch).authLink({ state: 's', redirectUri: 'https://app.test/finish', expiresOn: '2099-01-01T10:00:00+01:00',
    providers: ['google'], scopes: { google: ['gmail.readonly', 'calendar.readonly'] } });
  await client(fake.fetch).authLink({ state: 's', redirectUri: 'https://app.test/finish', expiresOn: '2099-01-01T09:00:00.000Z',
    accountId: 'acc_1' });
  expect(fake.calls.map(call => JSON.parse(call.body) as unknown)).toEqual([
    { providers: ['google'], expires_on: '2099-01-01T09:00:00.000Z', redirect_uri: 'https://app.test/finish', state: 's',
      config: { google: { oauth_scope: ['gmail.readonly', 'calendar.readonly'] } } },
    { account_id: 'acc_1', expires_on: '2099-01-01T09:00:00.000Z', redirect_uri: 'https://app.test/finish', state: 's' }]);
});

test("reads a mailbox account's address from its primary sender, and the scopes it granted", async () => {
  const fake = fakeFetch(fakeUnipile({ accounts: () => ({ createdAt: '2026-11-23T09:00:00.000Z', provider: 'outlook',
    email: 'ana@lumen.test', scopes: ['user.read', 'mail.read', 'calendars.read'] }), company, posts }));
  expect(await client(fake.fetch).account('acc_1')).toEqual({ createdAt: '2026-11-23T09:00:00.000Z', provider: 'outlook',
    email: 'ana@lumen.test', scopes: ['user.read', 'mail.read', 'calendars.read'] });
  expect(fake.calls.map(call => call.url)).toEqual([`${API}/accounts/acc_1`, `${API}/acc_1/email-senders`]);
  const secondary = fakeFetch([{ url: `${API}/accounts/acc_1`, respond: () => Response.json({ provider: 'google', created_at: 'x' }) },
    { url: `${API}/acc_1/email-senders`, respond: () => Response.json({ data: [{ email: 'alias@lumen.test', is_primary: false }] }) }]);
  expect((await client(secondary.fetch).account('acc_1')).email).toBeNull();
});

test('reads the headcount from insights, and no city without a headquarters', async () => {
  const fake = answering(`${API}/acc_1/linkedin/company/porto`, { id: '1', name: 'Porto Co',
    profile_url: 'https://www.linkedin.com/company/porto/', insights: { headcount: 12 }, locations: [{ is_headquarter: false, city: 'Porto' }] });
  expect(await client(fake.fetch).company('acc_1', 'porto')).toEqual({ id: '1', name: 'Porto Co', tagline: '', description: '',
    industry: [], headcount: 12, city: null, profileUrl: 'https://www.linkedin.com/company/porto/' });
});

test('drops a post without text', async () => {
  const fake = answering(/\/posts\?/u, { data: [{ share_url: 'https://a.test', text: '' }, { share_url: 'https://b.test', text: 't' }] });
  expect(await client(fake.fetch).posts('acc_1', '1', 5)).toEqual([{ url: 'https://b.test', text: 't', createdAt: null, author: '' }]);
});

test('answers a person at once: a sign-in link or a read with a deadline never waits on a 429', async () => {
  const fake = fakeFetch([{ url: /^https:\/\/api\.unipile\.com\//u, respond: () => new Response(null, { status: 429 }) }]);
  const unipile = client(fake.fetch);
  await expect(unipile.authLink(signIn)).rejects.toMatchObject({ code: 'rate_limited' });
  expect(fake.calls).toHaveLength(1);
  await expect(unipile.account('acc_1', AbortSignal.timeout(30_000))).rejects.toMatchObject({ code: 'rate_limited' });
  expect(fake.calls).toHaveLength(2);
});

test('refuses a blank state, or an expiry it cannot write in UTC, before asking', async () => {
  const fake = answering(`${API}/auth/link`, { link: 'x' });
  await expect(client(fake.fetch).authLink({ ...signIn, state: '  ' })).rejects.toThrow('state_required');
  await expect(client(fake.fetch).authLink({ ...signIn, expiresOn: '2099-01-01T10:00:00' })).rejects.toThrow('date_invalid');
  expect(fake.calls).toHaveLength(0);
});

test("names Unipile's refusal by its type and thrower, so a member's grant falling short reads apart from our key", async () => {
  for (const [type, detail] of [['provider/insufficient_permissions', 'provider.insufficient_permissions'],
    ['api/expired_authorization', 'api.expired_authorization'], ['errors/disconnected_account', null]] as const) {
    const refusing = fakeFetch([{ url: `${API}/acc_1/calendars`, respond: () => Response.json({ object: 'Error', type, status: 403 },
      { status: 403 }) }]);
    await expect(client(refusing.fetch).calendars('acc_1')).rejects.toMatchObject({ code: 'rejected', status: 403, detail });
  }
});
