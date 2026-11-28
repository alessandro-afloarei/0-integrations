import { createHash } from 'node:crypto';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Account } from './account.js';
import { defineProvider, signInWith, type Entry, type Field, type SignIn } from './catalogue.js';
import { aircall } from './catalogue/aircall.js';
import { apollo } from './catalogue/apollo.js';
import { attio as attioEntry } from './catalogue/attio.js';
import { github } from './catalogue/github.js';
import { google } from './catalogue/google.js';
import { intercom } from './catalogue/intercom.js';
import { jira } from './catalogue/jira.js';
import { metabase } from './catalogue/metabase.js';
import { outline } from './catalogue/outline.js';
import { paypal } from './catalogue/paypal.js';
import { slack } from './catalogue/slack.js';
import { zoom } from './catalogue/zoom.js';
import { client as apiClient } from './client.js';
import { finishConnect, startConnect, type Connected, type ConnectStart } from './connect.js';
import { ProviderHttpError } from './errors.js';
import { fakeGoogle } from './google/fake.js';
import * as guard from './guard.js';
import { filledBase } from './http.js';
import { authorizeUrl as consentUrl, exchangeCode, refreshGrant, revokeGrant, tokenSource } from './oauth.js';
import { hubspot } from './catalogue/hubspot.js';
import { fakeSlack } from './slack/fake.js';
import { fakeFetch, fakeProvider, type Route } from './testing.js';

const callback = 'https://app.test/api/integrations/slack/callback';
const start = { clientId: 'client', redirectUri: callback, state: 'state' };
const client = { clientId: 'client', clientSecret: 'secret' };
const data = { redirectUri: callback, team: { id: 'T1', name: 'Acme' }, botUserId: 'U1', channels: [] };
const tokenUrl = 'https://slack.com/api/oauth.v2.access';
const revokeUrl = 'https://slack.com/api/auth.revoke';
async function authorize(http: ReturnType<typeof fakeFetch>): Promise<string> {
  const response = await http.fetch((await startConnect(slack, start)).url);
  const code = new URL(response.headers.get('location') ?? '').searchParams.get('code');
  if (!code) throw new Error('expected_code');
  http.calls.length = 0;
  return code;
}
const { authorizeUrl, tokenUrl: slackTokenUrl, scopeSeparator, tokenTypes, failed } = slack.auth[0];
/** Slack with PKCE on: no `pkce` key. */
const pkceSlack = defineProvider({ ...slack, auth: [{ kind: 'oauth2', authorizeUrl, tokenUrl: slackTokenUrl, scopeSeparator, tokenTypes, failed }] });
/** Slack whose re-consent may hand back a live connection's grant. */
const reusingSlack = defineProvider({ ...slack, auth: [{ ...slack.auth[0], reusesGrant: true }] });
/** Aircall as an entry whose fields are not known in the types: the runtime checks its input. */
const looseAircall: Entry = aircall;
const attio = signInWith(attioEntry, 'key');
/** A token answer whose team has no id: identify refuses it. */
const noTeam = { ...data, team: { id: '', name: 'Acme' } };
afterEach(() => vi.useRealTimers());

describe('connect', () => {
  it('builds the existing Slack authorization URL byte for byte', async () => {
    expect(await startConnect(slack, start)).toEqual({ kind: 'redirect',
      url: 'https://slack.com/oauth/v2/authorize?client_id=client&scope=chat%3Awrite%2Cchat%3Awrite.public%2Cchannels%3Aread%2Cgroups%3Aread&redirect_uri=https%3A%2F%2Fapp.test%2Fapi%2Fintegrations%2Fslack%2Fcallback&state=state', values: { domain: 'slack.com' } });
  });

  it('finishes Slack from its entry: the grant, the team, the bot user', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const http = fakeFetch(fakeSlack(data));
    const code = await authorize(http);
    const result = await finishConnect(slack, { client, code, redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(result).toEqual({ secret: { accessToken: 'xoxe.xoxb-fixture-1793491200000', refreshToken: 'xoxe-1-fixture-1793491200000',
      expiresAt: '2026-11-01T12:00:00.000Z' }, values: { domain: 'slack.com', botUserId: 'U1' }, account: { id: 'T1', name: 'Acme' } });
    const team: string = result.account.id; // typed: no null check for an entry whose identify names an id
    expect(team).toBe('T1');
    expect(Object.fromEntries(new URLSearchParams(http.calls[0]?.body))).toEqual({ client_id: 'client', client_secret: 'secret',
      grant_type: 'authorization_code', code, redirect_uri: callback });
    expect(http.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('rejects a refused grant before identity', async () => {
    // Slack's own identity needs no request; this one asks `auth.test`, so an identify would show in the calls.
    const asking = defineProvider({ ...slack, identify: { request: { path: '/auth.test' }, id: 'team_id' } });
    const http = fakeFetch(fakeSlack(data));
    await expect(finishConnect(asking, { client, code: 'fixture-denied', redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() }))
      .rejects.toMatchObject({ detail: 'invalid_code' });
    expect(http.calls.map(call => call.url)).toEqual([tokenUrl]);
  });

  it('fake consent keeps the redirect URI and state identical at both ends', async () => {
    const http = fakeFetch(fakeSlack(data));
    const response = await http.fetch((await startConnect(slack, start)).url);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(callback);
    expect(location.searchParams.get('state')).toBe('state');
    expect(location.searchParams.get('code')).toMatch(/^fixture-code/u);
  });

  it('supports PKCE without owning state', async () => {
    const begun = await startConnect(pkceSlack, start);
    if (!begun.codeVerifier) throw new Error('expected_pkce');
    const params = new URL(begun.url).searchParams;
    expect(params.get('state')).toBe('state');
    expect(params.get('code_challenge')).toBe(createHash('sha256').update(begun.codeVerifier).digest('base64url'));
    expect(params.get('code_challenge_method')).toBe('S256');
    const http = fakeFetch(fakeSlack(data));
    await finishConnect(pkceSlack, { client, code: await authorize(http),
      redirectUri: callback, codeVerifier: begun.codeVerifier, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(new URLSearchParams(http.calls[0]?.body).get('code_verifier')).toBe(begun.codeVerifier);
  });

  it("connects an app's copy of a catalogue entry whose sign-in says `pkce: false`: no challenge, no verifier", async () => {
    const noPkce = defineProvider({ ...intercom, auth: [{ ...intercom.auth[0], pkce: false }, intercom.auth[1]] });
    const begun = await startConnect(noPkce, start);
    expect(begun.codeVerifier).toBeUndefined();
    expect(new URL(begun.url).searchParams.has('code_challenge')).toBe(false);
    const http = fakeFetch(fakeProvider(noPkce, { key: 'k', client }));
    await expect(finishConnect(noPkce, { client, code: 'kit-code', redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() }))
      .resolves.toMatchObject({ secret: { accessToken: 'k' } });
    expect(new URLSearchParams(http.calls[0]?.body).has('code_verifier')).toBe(false);
  });

  it("returns a key entry's fields and verifies a refused key", async () => {
    const http = fakeFetch([{ url: 'https://api.attio.com/v2/self', respond: request => (request.headers.get('authorization') === 'Bearer valid'
      ? Response.json({ active: true, workspace_id: 'w1', workspace_name: 'Account' }) : Response.json({}, { status: 401 })) }]);
    expect(await startConnect(attio)).toEqual({ kind: 'form', fields: [{ name: 'apiKey', title: 'API key', secret: true }] });
    expect(await finishConnect(attio, { secret: { apiKey: 'valid' }, fetch: http.fetch }))
      .toEqual({ secret: { apiKey: 'valid' }, values: {}, account: { id: 'w1', name: 'Account' } });
    await expect(finishConnect(attio, { secret: { apiKey: 'bad' }, fetch: http.fetch })).rejects.toMatchObject({ code: 'rejected' });
  });

  it('reads the secret once: identify is sent the very value returned in secret', async () => {
    const http = fakeFetch([{ url: 'https://api.attio.com/v2/self', respond: () => Response.json({ workspace_id: 'w1', workspace_name: 'Account' }) }]);
    let reads = 0;
    const secret = { get apiKey() { reads += 1; return `k${String(reads)}`; } };
    const result = await finishConnect(attio, { secret, fetch: http.fetch });
    expect(reads).toBe(1);
    expect(result.secret).toEqual({ apiKey: 'k1' });
    expect(http.calls.map(call => call.headers.authorization)).toEqual(['Bearer k1']);
  });

  it("reads OAuth 2's id from the token answer and the key's from identify's answer, the absent path skipped", async () => {
    const both = defineProvider({ id: 'k', name: 'K', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://k.test/authorize', tokenUrl: 'https://k.test/token', pkce: false }, { kind: 'key' }],
      scopes: { default: [] }, http: { baseUrl: 'https://api.k.test' }, identify: { request: { path: '/me' }, id: ['tokenAnswer.hub_id', 'portalId'] } });
    const key = fakeFetch(fakeProvider(signInWith(both, 'key'), { key: 'k', account: { portalId: 7 } }));
    expect((await finishConnect(signInWith(both, 'key'), { secret: { apiKey: 'k' }, fetch: key.fetch })).account).toEqual({ id: '7', name: '7' });
    expect(key.calls.map(call => call.url)).toEqual(['https://api.k.test/me']);
    const oauth = fakeFetch([{ method: 'POST', url: 'https://k.test/token', respond: () => Response.json({ access_token: 'a', token_type: 'bearer', hub_id: 9 }) }]);
    expect((await finishConnect(both, { client, code: 'c', redirectUri: callback, fetch: oauth.fetch, onRevokeFailed: vi.fn() })).account)
      .toEqual({ id: '9', name: '9' });
    expect(oauth.calls.map(call => call.url)).toEqual(['https://k.test/token']);
  });

  it("keeps a key entry's plain values and builds its credential from them", async () => {
    const http = fakeFetch([{ url: 'https://api.aircall.io/v1/company', respond: () => Response.json({ company: { name: 'Lumen' } }) }]);
    expect(await finishConnect(aircall, { secret: { apiToken: 'token' }, values: { apiId: '12' }, fetch: http.fetch }))
      .toEqual({ secret: { apiToken: 'token' }, values: { apiId: '12' }, account: { id: '12', name: 'Lumen' } });
    expect(http.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('12:token').toString('base64')}`);
  });

  it.each([{}, { apiToken: '' }, { apiToken: '  ' }, { apiId: 'token' }])('refuses a key entry without its secret (%j) before anything is sent', async secret => {
    const http = fakeFetch([]);
    await expect(finishConnect(looseAircall, { secret, values: { apiId: '12', apiToken: 'token' }, fetch: http.fetch }))
      .rejects.toThrow(new TypeError('connect_field_required: apiToken'));
    expect(http.calls).toHaveLength(0);
  });

  it("refuses an app's key entry that declares no secret field, before anything is sent", async () => {
    const plain = defineProvider({ id: 'plain', name: 'Plain', fields: [{ name: 'region', title: 'Region' }], auth: [{ kind: 'key' }],
      http: { baseUrl: 'https://api.plain.test' }, identify: { request: { path: '/me' }, id: 'id' } });
    const http = fakeFetch([]);
    expect(await startConnect(plain)).toEqual({ kind: 'form', fields: [{ name: 'region', title: 'Region' }] });
    await expect(finishConnect(plain, { secret: {}, values: { region: 'eu' }, fetch: http.fetch }))
      .rejects.toThrow(new TypeError('connect_secret_field_missing: plain'));
    // The entry's fault is named before the caller's missing input.
    const loose: Entry = plain;
    await expect(finishConnect(loose, { secret: {}, fetch: http.fetch })).rejects.toThrow(new TypeError('connect_secret_field_missing: plain'));
    expect(http.calls).toHaveLength(0);
  });

  it('keeps and sends only the fields the entry declares, each in its own record', async () => {
    const http = fakeFetch([{ url: 'https://api.aircall.io/v1/company', respond: () => Response.json({ company: { name: 'Lumen' } }) }]);
    const form = { apiId: '12', apiToken: 'plain-copy' };
    // A value no field or `save` key names is refused, unsent.
    await expect(finishConnect(looseAircall, { secret: { apiToken: 'token' }, values: { ...form, note: 'extra' }, fetch: http.fetch }))
      .rejects.toThrow(new TypeError('value_undeclared: aircall note'));
    const result = await finishConnect(looseAircall, { secret: { apiToken: 'token', apiId: 'secret-copy', other: 'extra' }, values: form, fetch: http.fetch });
    expect(result).toEqual({ secret: { apiToken: 'token' }, values: { apiId: '12' }, account: { id: '12', name: 'Lumen' } });
    expect(http.calls).toHaveLength(1);
    expect(JSON.stringify(http.calls)).not.toMatch(/extra|plain-copy|secret-copy/u);
    expect(http.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('12:token').toString('base64')}`);
  });

  it.each([undefined, {}, { apiId: '' }, { apiId: ' ' }])('refuses a key entry without a plain field (%j) before anything is sent', async values => {
    const http = fakeFetch([]);
    await expect(finishConnect(looseAircall, { secret: { apiToken: 'token' }, ...(values ? { values } : {}), fetch: http.fetch }))
      .rejects.toThrow(new TypeError('connect_field_required: apiId'));
    expect(http.calls).toHaveLength(0);
  });
});

describe('field defaults and choices', () => {
  const me = (host: string) => ({ url: `https://${host}/me`, respond: (request: Request) => (request.headers.get('authorization') === 'Bearer tok'
    ? Response.json({ type: 'admin', app: { id_code: 'abc123', name: 'Workspace' } }) : Response.json({}, { status: 401 })) });
  const http = () => fakeFetch(['api.intercom.io', 'api.eu.intercom.io', 'api.au.intercom.io'].map(me));

  // An inherited `apiHost` is no value given: only own properties are read.
  it.each([undefined, { apiHost: '' }, { apiHost: '  ' }, Object.create({ apiHost: 'api.evil.test' }) as { apiHost: string }])(
    'a plain field left out or blank (%j) takes its default, which the values hold', async values => {
    const fake = http();
    const result = await finishConnect(signInWith(intercom, 'key'), { secret: { accessToken: 'tok' }, ...(values === undefined ? {} : { values }), fetch: fake.fetch });
    expect(result).toEqual({ secret: { accessToken: 'tok' }, values: { apiHost: 'api.intercom.io' }, account: { id: 'abc123', name: 'Workspace' } });
    expect(fake.calls.map(call => call.url)).toEqual(['https://api.intercom.io/me']);
  });

  it('an own getter is a value given: a getter-backed region connects to its host', async () => {
    const fake = http();
    const values = { get apiHost() { return 'api.eu.intercom.io'; } };
    const result = await finishConnect(signInWith(intercom, 'key'), { secret: { accessToken: 'tok' }, values, fetch: fake.fetch });
    expect(result.values).toEqual({ apiHost: 'api.eu.intercom.io' });
    expect(fake.calls.map(call => call.url)).toEqual(['https://api.eu.intercom.io/me']);
  });

  it.each(signInWith(intercom, 'key').fields[0].choices)('a value among the choices (%s) is used and passes the host pattern', async apiHost => {
    const fake = http();
    const { values } = await finishConnect(signInWith(intercom, 'key'), { secret: { accessToken: 'tok' }, values: { apiHost }, fetch: fake.fetch });
    expect(values.apiHost).toBe(apiHost);
    expect(fake.calls.map(call => call.url)).toEqual([`https://${apiHost}/me`]);
  });

  it.each([5, null, {}])('a value that is not a string (%j) is refused, never replaced by the default', async apiHost => {
    const fake = http();
    await expect(finishConnect(signInWith(intercom, 'key'), { secret: { accessToken: 'tok' }, values: { apiHost } as never, fetch: fake.fetch }))
      .rejects.toThrow(new TypeError('connect_field_invalid: apiHost'));
    expect(fake.calls).toHaveLength(0);
  });

  it.each(['api.evil.test', 'API.EU.INTERCOM.IO', 'api.intercom.io/x'])('a value not among the choices (%s) is refused before anything is sent', async apiHost => {
    const fake = http();
    await expect(finishConnect(signInWith(intercom, 'key'), { secret: { accessToken: 'tok' }, values: { apiHost }, fetch: fake.fetch }))
      .rejects.toThrow(new TypeError('connect_field_invalid: apiHost'));
    expect(fake.calls).toHaveLength(0);
  });
});

describe("Intercom's OAuth 2: the authorize host chosen per region, the token URL and the base fixed", () => {
  const appHosts = intercom.fields[0].choices;
  const answers = () => fakeFetch([
    { url: 'https://api.intercom.io/auth/eagle/token', respond: () => Response.json({ access_token: 'tok', token_type: 'bearer' }) },
    { url: 'https://api.intercom.io/me', respond: () => Response.json({ type: 'admin', app: { id_code: 'abc123', name: 'Workspace' } }) }]);

  it('passes the host split rule beside its fixed token URL', () => {
    expect(() => consentUrl(intercom, { clientId: 'c', redirectUri: callback, scopes: [], state: 's', codeChallenge: 'c', values: { appHost: 'app.intercom.com' } }))
      .not.toThrow();
  });

  it.each(appHosts)('consents on %s, then exchanges and identifies on api.intercom.io, keeping the region', async appHost => {
    const begun = await startConnect(intercom, { ...start, values: { appHost } });
    const url = new URL(begun.url);
    expect(`${url.origin}${url.pathname}`).toBe(`https://${appHost}/oauth`);
    expect(url.searchParams.get('client_id')).toBe('client');
    const http = answers();
    const connected = await finishConnect(intercom, { client, code: 'code', redirectUri: callback, codeVerifier: begun.codeVerifier,
      values: begun.values, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(connected.values).toEqual({ appHost });
    expect(http.calls.map(call => call.url)).toEqual(['https://api.intercom.io/auth/eagle/token', 'https://api.intercom.io/me']);
  });

  it('starts on the US host when no region is given, and returns it in `values`', async () => {
    const begun = await startConnect(intercom, start);
    expect(new URL(begun.url).host).toBe('app.intercom.com');
    expect(begun.values).toEqual({ appHost: 'app.intercom.com' });
  });

  it.each(['evil.test', 'app.eu.intercom.com.evil.test', '127.0.0.1', '2130706433', 'api.eu.intercom.io', 'APP.EU.INTERCOM.COM'])(
    'a region of %s is connect_field_invalid at the start and the finish, before the authorize URL or the exchange', async appHost => {
      const http = answers();
      let reads = 0;
      const counted = { clientId: 'client', get clientSecret() { reads++; return 'secret'; } };
      await expect(startConnect(intercom, { ...start, values: { appHost } })).rejects.toThrow(new TypeError('connect_field_invalid: appHost'));
      await expect(finishConnect(intercom, { client: counted, code: 'code', redirectUri: callback, codeVerifier: 'v'.repeat(43), values: { appHost },
        fetch: http.fetch, onRevokeFailed: vi.fn() })).rejects.toThrow(new TypeError('connect_field_invalid: appHost'));
      expect({ reads, requests: http.calls.length }).toEqual({ reads: 0, requests: 0 });
    });

  it.each(['evil.test', 'app.eu.intercom.com.evil.test', '127.0.0.1', '2130706433', 'api.eu.intercom.io', 'APP.EU.INTERCOM.COM'])(
    'a stored region of %s is base_host_refused at the authorize URL and a refresh, before the client secret is read or anything is sent', async appHost => {
      const http = answers();
      let reads = 0;
      const counted = { clientId: 'client', get clientSecret() { reads++; return 'secret'; } };
      expect(() => consentUrl(intercom, { clientId: 'c', redirectUri: callback, scopes: [], state: 's', codeChallenge: 'c', values: { appHost } }))
        .toThrow(new TypeError('base_host_refused: intercom'));
      await expect(refreshGrant(intercom, counted, 'r', { values: { appHost }, fetch: http.fetch })).rejects.toThrow(new TypeError('base_host_refused: intercom'));
      expect({ reads, requests: http.calls.length }).toEqual({ reads: 0, requests: 0 });
    });

  it('a refresh kept without `appHost` is template_missing before anything is sent; with it, it posts to the fixed token URL', async () => {
    const http = answers();
    await expect(refreshGrant(intercom, client, 'r', { values: {} as never, fetch: http.fetch })).rejects.toThrow(new TypeError('template_missing: intercom {appHost}'));
    expect(http.calls).toHaveLength(0);
    await refreshGrant(intercom, client, 'r', { values: { appHost: 'app.au.intercom.com' }, fetch: http.fetch });
    expect(http.calls.map(call => call.url)).toEqual(['https://api.intercom.io/auth/eagle/token']);
  });

  it("a call reads no region: the base is fixed, so every call goes to api.intercom.io", async () => {
    const http = answers();
    await apiClient(intercom, { token: 'tok', values: { appHost: 'app.eu.intercom.com' }, fetch: http.fetch }).request('/me');
    expect(http.calls.map(call => call.url)).toEqual(['https://api.intercom.io/me']);
  });

  it("a value kept from the other sign-in is value_undeclared: the key's `apiHost` on OAuth 2, OAuth 2's `appHost` on the key", async () => {
    const http = answers();
    expect(() => apiClient(intercom, { token: 'tok', values: { appHost: 'app.intercom.com', apiHost: 'api.eu.intercom.io' }, fetch: http.fetch }))
      .toThrow(new TypeError('value_undeclared: intercom apiHost'));
    expect(() => apiClient(signInWith(intercom, 'key'), { token: 'tok', values: { apiHost: 'api.intercom.io', appHost: 'app.intercom.com' }, fetch: http.fetch }))
      .toThrow(new TypeError('value_undeclared: intercom appHost'));
    await expect(refreshGrant(intercom, client, 'r', { values: { apiHost: 'api.eu.intercom.io' } as never, fetch: http.fetch }))
      .rejects.toThrow(new TypeError('value_undeclared: intercom apiHost'));
    expect(http.calls).toHaveLength(0);
  });

  it("a stored key region differing only in case is base_host_refused on a call, before the token is read; before, it was sent", async () => {
    const http = answers();
    const token = vi.fn<() => Promise<string>>().mockResolvedValue('tok');
    await expect(apiClient(signInWith(intercom, 'key'), { token, values: { apiHost: 'API.EU.INTERCOM.IO' }, fetch: http.fetch }).request('/me'))
      .rejects.toThrow(new TypeError('base_host_refused: intercom'));
    expect({ reads: token.mock.calls.length, requests: http.calls.length }).toEqual({ reads: 0, requests: 0 });
  });
});

describe('a token entry', () => {
  const basic = (pair: string) => `Basic ${Buffer.from(pair).toString('base64')}`;
  const zoomInput = { secret: { clientSecret: 'zoom-secret' }, values: { accountId: 'acc', clientId: 'cid' } };
  const metabaseInput = (host: string) => ({ secret: { password: 'p' }, values: { host, username: 'u@example.com' } });
  const session = (answer: unknown = { id: 's' }) => fakeFetch([
    { url: 'https://metabase.example.test/api/session', respond: () => Response.json(answer) },
    { url: 'https://metabase.example.test/api/user/current', respond: () => Response.json({ email: 'u@example.com' }) }]);

  it('Zoom starts as a form and finishes with one token request: the secret fields, the plain ones, the account entered', async () => {
    expect(await startConnect(zoom)).toEqual({ kind: 'form', fields: zoom.fields });
    const fake = fakeFetch([{ url: 'https://zoom.us/oauth/token', respond: () => Response.json({ access_token: 'at', expires_in: 3600 }) }]);
    expect(await finishConnect(zoom, { ...zoomInput, fetch: fake.fetch })).toEqual({ secret: { clientSecret: 'zoom-secret' },
      values: { accountId: 'acc', clientId: 'cid' }, account: { id: 'acc', name: 'acc' } });
    expect(fake.calls.map(call => call.url)).toEqual(['https://zoom.us/oauth/token']);
    expect(fake.calls[0]?.headers.authorization).toBe(basic('cid:zoom-secret'));
  });

  it('reads each field once and own values only: the token request is sent the very secret returned', async () => {
    const fake = fakeFetch([{ url: 'https://zoom.us/oauth/token', respond: () => Response.json({ access_token: 'at' }) }]);
    let reads = 0;
    const secret = { get clientSecret() { reads += 1; return `s${String(reads)}`; } };
    const values = Object.assign(Object.create({ accountId: 'inherited' }) as Record<string, string>, { accountId: 'acc', clientId: 'cid' });
    const result = await finishConnect(zoom, { secret, values, fetch: fake.fetch });
    expect(reads).toBe(1);
    expect(result.secret).toEqual({ clientSecret: 's1' });
    expect(fake.calls[0]?.headers.authorization).toBe(basic('cid:s1'));
    // An inherited value is none: PayPal's apiHost then takes its default.
    const inherited = Object.create({ apiHost: 'evil.test' }) as Record<string, string>;
    const paypalFake = fakeFetch([{ url: /https:/, respond: () => Response.json({ access_token: 'at', app_id: 'APP-1' }) }]);
    await finishConnect(paypal, { secret: { clientSecret: 's' }, values: Object.assign(inherited, { clientId: 'cid' }), fetch: paypalFake.fetch });
    expect(paypalFake.calls.map(call => call.url)).toEqual(['https://api-m.paypal.com/v1/oauth2/token']);
  });

  it('a refused token request is the refused credential', async () => {
    const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ error: 'invalid_client' }, { status: 401 }) }]);
    await expect(finishConnect(zoom, { ...zoomInput, fetch: fake.fetch })).rejects.toMatchObject({ code: 'rejected', detail: 'invalid_client' });
    expect(fake.calls).toHaveLength(1);
  });

  it.each([[undefined, 'api-m.paypal.com'], ['api-m.sandbox.paypal.com', 'api-m.sandbox.paypal.com']])(
    'PayPal with apiHost %j posts to %s, and the account is the app the answer names', async (apiHost, host) => {
      const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ scope: 'x', access_token: 'at', token_type: 'Bearer',
        app_id: 'APP-80W284485P519543T', expires_in: 31668, nonce: 'n' }) }]);
      const values = { clientId: 'cid', ...(apiHost === undefined ? {} : { apiHost }) };
      expect(await finishConnect(paypal, { secret: { clientSecret: 'pp-secret' }, values, fetch: fake.fetch })).toEqual({
        secret: { clientSecret: 'pp-secret' }, values: { apiHost: host, clientId: 'cid' },
        account: { id: 'APP-80W284485P519543T', name: 'APP-80W284485P519543T' } });
      expect(fake.calls.map(call => [call.method, call.url, call.body])).toEqual([['POST', `https://${host}/v1/oauth2/token`, 'grant_type=client_credentials']]);
      expect(fake.calls[0]?.headers.authorization).toBe(basic('cid:pp-secret'));
    });

  it('PayPal with a host not among its choices is connect_field_invalid, before anything is sent', async () => {
    const fake = fakeFetch([]);
    await expect(finishConnect(paypal, { secret: { clientSecret: 's' }, values: { apiHost: 'evil.test', clientId: 'cid' }, fetch: fake.fetch }))
      .rejects.toThrow(new TypeError('connect_field_invalid: apiHost'));
    expect(fake.calls).toHaveLength(0);
  });

  it('Metabase signs in with JSON at /api/session; the account is the email; calls carry the session, which the result never holds', async () => {
    const fake = session();
    const result = await finishConnect(metabase, { ...metabaseInput('metabase.example.test'), fetch: fake.fetch });
    expect(result).toEqual({ secret: { password: 'p' }, values: { host: 'metabase.example.test', username: 'u@example.com' },
      account: { id: 'u@example.com', name: 'u@example.com' } });
    expect(fake.calls.map(call => [call.method, call.url, call.headers['content-type']]))
      .toEqual([['POST', 'https://metabase.example.test/api/session', 'application/json']]);
    expect(JSON.parse(fake.calls[0]?.body ?? '') as unknown).toEqual({ username: 'u@example.com', password: 'p' });
    const token = tokenSource(metabase, { secret: result.secret, values: result.values, fetch: fake.fetch });
    expect(await apiClient(metabase, { token, values: result.values, fetch: fake.fetch }).json('/user/current')).toEqual({ email: 'u@example.com' });
    expect(fake.calls.at(-1)?.headers['x-metabase-session']).toBe('s');
    expect(fake.calls.at(-1)?.headers.authorization).toBeUndefined();
  });

  it("a token answer's keys the entry does not name never reach the result", async () => {
    const result = await finishConnect(metabase, { ...metabaseInput('metabase.example.test'), fetch: session({ id: 's', extra: 'x' }).fetch });
    expect(result).toEqual({ secret: { password: 'p' }, values: { host: 'metabase.example.test', username: 'u@example.com' },
      account: { id: 'u@example.com', name: 'u@example.com' } });
  });

  it("an entry that names the token's own key never gets the token back: not in values, not as the account", async () => {
    const zoomFake = fakeFetch([{ url: /https:/, respond: () => Response.json({ access_token: 'live-token', expires_in: 3600 }) }]);
    const saving = defineProvider({ ...zoom, id: 'saving', save: { t: 'tokenAnswer.access_token' } });
    const saved = await finishConnect(saving, { ...zoomInput, fetch: zoomFake.fetch });
    expect(saved.values).toEqual({ accountId: 'acc', clientId: 'cid' });
    expect(JSON.stringify(saved)).not.toContain('live-token');
    // Metabase's token path is `id`: an identify reading it finds nothing, so no account is made of the session.
    const naming = defineProvider({ ...metabase, id: 'naming', identify: { id: 'tokenAnswer.id' } });
    await expect(finishConnect(naming, { ...metabaseInput('metabase.example.test'), fetch: session().fetch }))
      .rejects.toEqual(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
  });

  it('Metabase on an address with an app fetch is address_blocked: the fetch never called, the password never sent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(finishConnect(metabase, { ...metabaseInput('127.0.0.1'), fetch }))
      .rejects.toEqual(new ProviderHttpError('request_failed', null, 'address_blocked'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Metabase with no fetch signs in through guardedFetch, which refuses a loopback name at once', async () => {
    const guarded = vi.spyOn(guard, 'guardedFetch');
    try {
      await expect(finishConnect(metabase, metabaseInput('localhost')))
        .rejects.toEqual(new ProviderHttpError('request_failed', null, 'address_blocked'));
      expect(guarded.mock.calls.map(([input]) => (input instanceof Request ? input.url : input.toString()))).toEqual(['https://localhost/api/session']);
    } finally { guarded.mockRestore(); }
  });

  it('a host that is no host name is base_value_invalid, before anything is sent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(finishConnect(metabase, { ...metabaseInput('x/y'), fetch })).rejects.toThrow(new TypeError('base_value_invalid: metabase {host}'));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('connect types', () => {
  const oauth = (fetch: typeof globalThis.fetch, code: string) => ({ client, code, redirectUri: callback, fetch, onRevokeFailed: vi.fn() });
  const attioFetch = fakeFetch([{ url: 'https://api.attio.com/v2/self', respond: () => Response.json({ workspace_id: 'w1', workspace_name: 'Account' }) }]).fetch;

  it('finishes either kind through a widened entry, or a union an app picks by id, with no cast', async () => {
    const pick = (id: string): typeof hubspot | typeof attio => (id === 'attio' ? attio : hubspot);
    const widened: Entry = slack;
    const http = fakeFetch(fakeSlack(data));
    expect((await finishConnect(widened, oauth(http.fetch, await authorize(http)))).account).toEqual({ id: 'T1', name: 'Acme' });
    expect((await finishConnect(pick('attio'), { secret: { apiKey: 'k' }, fetch: attioFetch })).account).toEqual({ id: 'w1', name: 'Account' });
    // Either input type-checks for both: the runtime refuses a mismatch (`oauth_options_required`, `connect_field_required`).
    for (const input of [oauth(http.fetch, 'code'), { secret: { apiKey: 'k' }, fetch: attioFetch }]) {
      expectTypeOf(input).toExtend<Parameters<typeof finishConnect<Entry>>[1]>();
      expectTypeOf(input).toExtend<Parameters<typeof finishConnect<typeof hubspot | typeof attio>>[1]>();
    }
    const widenedStart = await startConnect(widened, start);
    expectTypeOf(widenedStart).toEqualTypeOf<ConnectStart>();
    expectTypeOf(await startConnect(slack, start)).toHaveProperty('url').toEqualTypeOf<string>();
  });

  it('types each result from its entry', () => {
    expectTypeOf<Connected<typeof apollo>['account']>().toEqualTypeOf<Account | null>();
    expectTypeOf<Connected<typeof slack>['account']>().toEqualTypeOf<Account>();
    expectTypeOf<Connected<typeof attio>['secret']>().toEqualTypeOf<Readonly<Record<'apiKey', string>>>();
    expectTypeOf<Connected<typeof aircall>['values']['apiId']>().toEqualTypeOf<string>();
    expectTypeOf<Connected<typeof slack>['values']['botUserId']>().toEqualTypeOf<unknown>();
    // @ts-expect-error -- a misspelt name is no key of Slack's values
    expectTypeOf<Connected<typeof slack>['values']['botUserID']>().toBeUnknown();
    expectTypeOf<Connected['values']>().toEqualTypeOf<Readonly<Record<string, unknown>>>();
    // A union of entries is a union of results, until the caller narrows.
    expectTypeOf<Connected<typeof aircall | typeof attio>>().toEqualTypeOf<Connected<typeof aircall> | Connected<typeof attio>>();
  });

  it("types a key entry's finish from its fields", () => {
    type AircallFinish = Parameters<typeof finishConnect<typeof aircall>>[1];
    const fetch = attioFetch;
    expectTypeOf({ secret: { apiToken: 't' }, values: { apiId: '1' }, fetch }).toExtend<AircallFinish>();
    expectTypeOf({ secret: { apiKey: 'k' }, values: { apiId: '1' }, fetch }).not.toExtend<AircallFinish>();
    expectTypeOf({ secret: { apiToken: 't' }, fetch }).not.toExtend<AircallFinish>();
    type AttioFinish = Parameters<typeof finishConnect<typeof attio>>[1];
    expectTypeOf({ secret: { apiKey: 'k' }, fetch }).toExtend<AttioFinish>();
    // @ts-expect-error -- Attio has no plain field, so there are no values to pass
    expectTypeOf({ secret: { apiKey: 'k' }, values: 'plain', fetch }).toExtend<AttioFinish>();
    // The field names decide, not the id: names typed `readonly Field[]` take any record, known names are required.
    type Unnamed = Omit<typeof attio, 'fields'> & { fields: readonly Field[] };
    expectTypeOf({ secret: { apiKey: 'k' }, fetch }).toExtend<Parameters<typeof finishConnect<Unnamed>>[1]>();
    type WideAircall = Omit<typeof aircall, 'id'> & { id: string };
    expectTypeOf({ secret: { apiToken: 't' }, fetch }).not.toExtend<Parameters<typeof finishConnect<WideAircall>>[1]>();
    // A union of key entries takes either member's own secret, not both.
    type EitherFinish = Parameters<typeof finishConnect<typeof attio | SignIn<typeof hubspot, 'key'>>>[1];
    expectTypeOf({ secret: { apiKey: 'k' }, fetch }).toExtend<EitherFinish>();
    expectTypeOf({ secret: { accessToken: 't' }, fetch }).toExtend<EitherFinish>();
  });

  it("takes a form input's secret from its key members alone: an OAuth 2 member adds no form", () => {
    const fetch = attioFetch;
    // A key entry, and an entry narrowed to its key: their own secret.
    expectTypeOf({ secret: { apiKey: 'k' }, fetch }).toExtend<Parameters<typeof finishConnect<typeof attio>>[1]>();
    expectTypeOf({ secret: { apiKey: 'k' }, fetch }).toExtend<Parameters<typeof finishConnect<SignIn<typeof github, 'key'>>>[1]>();
    // Any record for the widened `Entry`.
    expectTypeOf({ secret: {}, fetch }).toExtend<Parameters<typeof finishConnect<Entry>>[1]>();
    // A key entry beside an OAuth 2 one: the key's own secret, or the OAuth input, never an empty secret.
    type Mixed = Parameters<typeof finishConnect<SignIn<typeof github, 'key'> | typeof slack>>[1];
    expectTypeOf({ secret: { apiKey: 'k' }, fetch }).toExtend<Mixed>();
    expectTypeOf(oauth(fetch, 'code')).toExtend<Mixed>();
    // @ts-expect-error -- Slack's OAuth 2 sign-in has no form, so its empty secret is no input
    expectTypeOf({ secret: {}, fetch }).toExtend<Mixed>();
  });
});


describe('connect review regressions', () => {
  it('keeps an entered field over a saved value of the same name', async () => {
    const own = defineProvider({ id: 'own', name: 'Own', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.own.test' },
      fields: [{ name: 'apiKey', title: 'API key', secret: true }, { name: 'region', title: 'Region' }],
      identify: { request: { path: '/me' } }, save: { region: 'region' } });
    const http = fakeFetch([{ url: 'https://api.own.test/me', respond: () => Response.json({ region: 7 }) }]);
    const { values } = await finishConnect(own, { secret: { apiKey: 'k' }, values: { region: 'eu' }, fetch: http.fetch });
    expect(values).toEqual({ region: 'eu' });
    expect(http.calls).toHaveLength(1);
  });

  it.each(['', '  '])('refuses blank state %j', async state => {
    await expect(startConnect(slack, { ...start, state })).rejects.toThrow('state_required');
  });

  it('refuses an OAuth sign-in started or finished without its options', async () => {
    // @ts-expect-error -- an OAuth entry is started with the app's client id, redirect URI and state
    await expect(startConnect(slack)).rejects.toThrow('oauth_options_required');
    // @ts-expect-error -- an OAuth entry is finished with the code, not a secret
    await expect(finishConnect(slack, { secret: {}, fetch: fakeFetch([]).fetch })).rejects.toThrow('oauth_options_required');
  });

  it('refuses a missing PKCE verifier before exchanging', async () => {
    const http = fakeFetch(fakeSlack(data));
    await expect(finishConnect(pkceSlack, { client, code: 'code', redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() }))
      .rejects.toThrow('code_verifier_required');
    expect(http.calls).toHaveLength(0);
  });

  it.each(['success', 'rejected', 'throws'])('revokes the grant when identity fails, even if revocation fails: %s', async revocation => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const revokeError = new Error('revoke_unavailable');
    const revoke: Route[] = revocation === 'success' ? [] : [{ url: revokeUrl, respond: () => {
      if (revocation === 'throws') throw revokeError;
      return Response.json({ ok: false, error: 'fatal_error' });
    } }];
    const http = fakeFetch([...revoke, ...fakeSlack(noTeam)]);
    const onRevokeFailed = vi.fn();
    await expect(finishConnect(slack, { client, code: await authorize(http), redirectUri: callback, fetch: http.fetch, onRevokeFailed }))
      .rejects.toEqual(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
    expect(http.calls.filter(call => call.url === revokeUrl)).toHaveLength(1);
    expect(http.calls.at(-1)?.headers.authorization).toBe('Bearer xoxe.xoxb-fixture-1793491200000');
    if (revocation === 'success') expect(onRevokeFailed).not.toHaveBeenCalled();
    else {
      expect(onRevokeFailed).toHaveBeenCalledExactlyOnceWith(revocation === 'throws'
        ? revokeError : new ProviderHttpError('request_failed', 200, 'fatal_error'));
    }
  });

  it('a public client connects and, after a failed identify, revokes with its id alone, never a secret', async () => {
    const open = defineProvider({ id: 'open', name: 'Open', http: { baseUrl: 'https://api.open.test' }, scopes: { default: [] },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://open.test/authorize', tokenUrl: 'https://open.test/token', clientAuth: 'none' }],
      revoke: { url: 'https://open.test/revoke', token: ['refresh'] }, identify: { request: { path: '/me' }, id: 'id' } });
    const http = fakeFetch([{ url: 'https://api.open.test/me', respond: () => Response.json({}, { status: 401 }) },
      ...fakeProvider(open, { key: 'k', client: { clientId: 'client' } })]);
    const onRevokeFailed = vi.fn();
    const { codeVerifier } = await startConnect(open, { clientId: 'client', redirectUri: callback, state: 's' });
    await expect(finishConnect(open, { client: { clientId: 'client' }, code: 'kit-code', redirectUri: callback, codeVerifier, fetch: http.fetch, onRevokeFailed }))
      .rejects.toMatchObject({ code: 'rejected' });
    expect(onRevokeFailed).not.toHaveBeenCalled();
    const [exchanged, , revoked] = http.calls;
    expect([exchanged?.url, revoked?.url]).toEqual(['https://open.test/token', 'https://open.test/revoke']);
    expect([exchanged?.headers.authorization, revoked?.headers.authorization]).toEqual([undefined, undefined]);
    expect(new URLSearchParams(exchanged?.body).get('client_id')).toBe('client');
    expect(new URLSearchParams(exchanged?.body).has('client_secret')).toBe(false);
    expect(Object.fromEntries(new URLSearchParams(revoked?.body))).toEqual({ token: 'kit-refresh', client_id: 'client' });
  });

  it('skips failed-identity cleanup only for a provider declaring reusesGrant true', async () => {
    const http = fakeFetch(fakeSlack(noTeam));
    const onRevokeFailed = vi.fn();
    await expect(finishConnect(reusingSlack, { client, code: await authorize(http), redirectUri: callback, fetch: http.fetch, onRevokeFailed }))
      .rejects.toEqual(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
    expect(onRevokeFailed).not.toHaveBeenCalled();
    expect(http.calls.some(call => call.url === revokeUrl)).toBe(false);
  });

  it('refuses and revokes a grant short of a scope the entry requires, before identity', async () => {
    const redirectUri = 'https://app.test/api/integrations/google/callback';
    const http = fakeFetch(fakeGoogle({ client, redirectUri, signIn: () => 'lee@lumen.test', mailboxes: () => null,
      granted: () => ['https://www.googleapis.com/auth/gmail.readonly'] }));
    const begun = await startConnect(google, { clientId: client.clientId, redirectUri, state: 'state-1' });
    if (!begun.codeVerifier) throw new Error('expected_pkce');
    const code = new URL((await http.fetch(begun.url, { redirect: 'manual' })).headers.get('location') ?? '').searchParams.get('code') ?? '';
    const onRevokeFailed = vi.fn();
    await expect(finishConnect(google, { client, code, redirectUri, codeVerifier: begun.codeVerifier, fetch: http.fetch, onRevokeFailed }))
      .rejects.toEqual(new ProviderHttpError('rejected', null, 'scope_missing'));
    expect(http.calls.map(call => call.url.split('?')[0]).slice(1)).toEqual(['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/revoke']);
    expect(onRevokeFailed).not.toHaveBeenCalled();
  });

  it("an OAuth 2 entry that names the grant's own tokens never gets them back in values", async () => {
    const saving = defineProvider({ id: 'saving', name: 'Saving', http: { baseUrl: 'https://api.saving.test' }, scopes: { default: [] },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://saving.test/authorize', tokenUrl: 'https://saving.test/token', pkce: false }],
      identify: { id: 'tokenAnswer.team' }, save: { a: 'tokenAnswer.access_token', r: 'tokenAnswer.refresh_token' } });
    const fake = fakeFetch([{ url: 'https://saving.test/token', respond: () => Response.json({ access_token: 'live-a', refresh_token: 'live-r',
      token_type: 'bearer', team: 'T1' }) }]);
    const result = await finishConnect(saving, { client, code: 'c', redirectUri: callback, fetch: fake.fetch, onRevokeFailed: vi.fn() });
    expect(result.values).toEqual({});
    expect(result.account).toEqual({ id: 'T1', name: 'T1' });
  });

  it('save keeps only a scalar: an object or a list from the token answer, which may nest a credential, never reaches values', async () => {
    const saving = defineProvider({ id: 'nested', name: 'Nested', http: { baseUrl: 'https://api.nested.test' }, scopes: { default: [] },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://nested.test/authorize', tokenUrl: 'https://nested.test/token', pkce: false }],
      save: { u: 'tokenAnswer.authed_user', uid: 'tokenAnswer.authed_user.id', l: 'tokenAnswer.list' } });
    const fake = fakeFetch([{ url: 'https://nested.test/token', respond: () => Response.json({ access_token: 'a', token_type: 'bearer',
      authed_user: { access_token: 'USERTOK', id: 'U1' }, list: ['USERTOK'] }) }]);
    const result = await finishConnect(saving, { client, code: 'c', redirectUri: callback, fetch: fake.fetch, onRevokeFailed: vi.fn() });
    expect(result.values).toEqual({ uid: 'U1' });
    // A JSON number beyond the finite range parses to Infinity: not kept.
    const huge = fakeFetch([{ url: 'https://nested.test/token', respond: () => new Response('{"access_token":"a","token_type":"bearer","authed_user":{"id":1e999}}',
      { headers: { 'content-type': 'application/json' } }) }]);
    const infinite = await finishConnect(saving, { client, code: 'c', redirectUri: callback, fetch: huge.fetch, onRevokeFailed: vi.fn() });
    expect(infinite.values).toEqual({});
  });

  it("compares the granted scopes split on the entry's separator; an answer naming none granted those asked", async () => {
    const commas = defineProvider({ id: 'commas', name: 'Commas', http: { baseUrl: 'https://api.commas.test' },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://commas.test/authorize', tokenUrl: 'https://commas.test/token', pkce: false, scopeSeparator: ',' }],
      scopes: { default: ['read', 'write'], requireGranted: true } });
    const granting = (scope?: string) => fakeFetch([{ url: 'https://commas.test/token', respond: () => Response.json({ access_token: 'a', token_type: 'bearer', scope }) }]);
    const finish = (scope?: string) => finishConnect(commas, { client, code: 'c', redirectUri: callback, fetch: granting(scope).fetch, onRevokeFailed: vi.fn() });
    const connected = { secret: { accessToken: 'a', refreshToken: null, expiresAt: null }, values: {}, account: null };
    await expect(finish('read,write')).resolves.toEqual(connected);
    // RFC 6749 §5.1: an answer without `scope` granted the scopes requested.
    await expect(finish()).resolves.toEqual(connected);
    await expect(finish('read')).rejects.toEqual(new ProviderHttpError('rejected', null, 'scope_missing'));
  });

  it.each([undefined, '/relative', 'https://attacker.test/callback', 'javascript:alert(1)', 'data:text/plain,hello'])
  ('fake authorization refuses unregistered redirect %s', async redirect => {
    const http = fakeFetch(fakeSlack(data));
    const url = new URL('https://slack.com/oauth/v2/authorize');
    if (redirect !== undefined) url.searchParams.set('redirect_uri', redirect);
    expect((await http.fetch(url)).status).toBe(400);
  });

  it('fake exchange binds code to the authorize redirect and client and spends it once', async () => {
    const http = fakeFetch(fakeSlack(data));
    const code = await authorize(http);
    const exchange = (redirectUri: string, clientId = 'client', suppliedCode = code) => finishConnect(slack,
      { client: { clientId, clientSecret: 'secret' }, code: suppliedCode, redirectUri, fetch: http.fetch, onRevokeFailed: vi.fn() });
    await expect(exchange('https://attacker.test/')).rejects.toMatchObject({ detail: 'bad_redirect_uri' });
    await expect(exchange(callback, 'wrong-client')).rejects.toMatchObject({ detail: 'invalid_client_id' });
    await expect(exchange(callback, 'client', 'unissued')).rejects.toMatchObject({ detail: 'invalid_code' });
    await exchange(callback);
    await expect(exchange(callback)).rejects.toMatchObject({ detail: 'invalid_code' });
  });
});

describe('an OAuth 2 sign-in that reads plain fields', () => {
  /** On the person's own server: the host typed, a team in the base's path with a default and choices. */
  const own = defineProvider({ id: 'own', name: 'Own',
    fields: [{ name: 'host', title: 'Host' }, { name: 'team', title: 'Team', default: 'main', choices: ['main', 'ops'] }],
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/oauth/authorize', tokenUrl: 'https://{host}/oauth/access_token' }],
    scopes: { default: [] }, revoke: { url: 'https://{host}/oauth/revoke', token: ['refresh'] },
    http: { baseUrl: 'https://{host}/api/{team}', host: '*' }, identify: { request: { path: '/users/me' }, id: 'id' } });
  const tokenAnswer = { access_token: 'a', refresh_token: 'r', token_type: 'bearer' };
  const finish = (fetch: typeof globalThis.fetch, values: Record<string, string>, codeVerifier = 'v'.repeat(43)) => finishConnect(own,
    { client, code: 'code', redirectUri: callback, codeVerifier, values: { host: 'chat.k.test', ...values }, fetch, onRevokeFailed: vi.fn() });

  it('starts on the host typed and returns the values read, a default applied; finishes there with them', async () => {
    const started = await startConnect(own, { ...start, values: { host: 'chat.k.test' } });
    expect(new URL(started.url).origin).toBe('https://chat.k.test');
    expect(new URL(started.url).pathname).toBe('/oauth/authorize');
    expect(started.values).toEqual({ host: 'chat.k.test', team: 'main' });
    const http = fakeFetch([{ url: 'https://chat.k.test/oauth/access_token', respond: () => Response.json(tokenAnswer) },
      { url: 'https://chat.k.test/api/main/users/me', respond: () => Response.json({ id: 'u1' }) }]);
    const connected = await finish(http.fetch, started.values, started.codeVerifier);
    expect(connected.values).toEqual({ host: 'chat.k.test', team: 'main' });
    expect(connected.account).toEqual({ id: 'u1', name: 'u1' });
  });

  it.each([
    ['127.0.0.1', new ProviderHttpError('request_failed', null, 'address_blocked')],
    ['[::1]', new TypeError('base_value_invalid: own {host}')],
    ['0x7f.1', new ProviderHttpError('request_failed', null, 'address_blocked')],
    ['a.k.test:443', new TypeError('base_value_invalid: own {host}')],
    ['a@b', new TypeError('base_value_invalid: own {host}')],
    ['a/b', new TypeError('base_value_invalid: own {host}')],
    ['', new TypeError('connect_field_required: host')],
    ['Kelvin.k.test', new TypeError('base_value_invalid: own {host}')],
  ])('refuses the host %j before a URL is returned', async (host, refused) => {
    await expect(startConnect(own, { ...start, values: { host } })).rejects.toEqual(refused);
  });

  it("refuses a value only the base reads before a URL is returned; a base that waits for a saved value starts", async () => {
    const org = defineProvider({ ...own, fields: [own.fields[0], { name: 'org', title: 'Organization' }],
      http: { baseUrl: 'https://{host}/api/{org}', host: '*' } });
    await expect(startConnect(org, { ...start, values: { host: 'chat.k.test', org: '..' } }))
      .rejects.toThrow(new TypeError('base_value_invalid: own {org}'));
    // Jira's base takes the `cloudId` its identify saves: nothing to fill at the start.
    expect((await startConnect(jira, start)).values).toEqual({});
  });

  it('refuses a value outside its choices before a URL is returned', async () => {
    await expect(startConnect(own, { ...start, values: { host: 'chat.k.test', team: 'other' } }))
      .rejects.toThrow(new TypeError('connect_field_invalid: team'));
  });

  it("refuses at the finish values that differ from the start's, to a blocked address, with no request", async () => {
    const http = fakeFetch([{ url: /./u, respond: () => Response.json(tokenAnswer) }]);
    await expect(finish(http.fetch, { host: '127.0.0.1' })).rejects.toEqual(new ProviderHttpError('request_failed', null, 'address_blocked'));
    expect(http.calls).toEqual([]);
  });

  it('refuses a finish with no values, with no request: a declared field is required, an undeclared placeholder is template_missing', async () => {
    const http = fakeFetch([{ url: /./u, respond: () => Response.json(tokenAnswer) }]);
    const input = { client, code: 'code', redirectUri: callback, codeVerifier: 'v'.repeat(43), fetch: http.fetch, onRevokeFailed: vi.fn() };
    const widened: Entry = own;
    await expect(finishConnect(widened, input)).rejects.toThrow(new TypeError('connect_field_required: host'));
    const undeclared: Entry = defineProvider({ ...own, fields: [] });
    await expect(finishConnect(undeclared, input)).rejects.toThrow(new TypeError('template_missing: own {host}'));
    expect(http.calls).toEqual([]);
  });

  it("revokes a grant whose identify failed on the host that issued it", async () => {
    const http = fakeFetch([{ url: 'https://chat.k.test/oauth/access_token', respond: () => Response.json(tokenAnswer) },
      { url: 'https://chat.k.test/api/main/users/me', respond: () => Response.json({ id: 'token.invalid' }, { status: 401 }) },
      { url: 'https://chat.k.test/oauth/revoke', respond: () => new Response(null, { status: 200 }) }]);
    await expect(finish(http.fetch, {})).rejects.toMatchObject({ code: 'rejected' });
    expect(http.calls.map(call => call.url)).toEqual(['https://chat.k.test/oauth/access_token', 'https://chat.k.test/api/main/users/me',
      'https://chat.k.test/oauth/revoke']);
  });
});

describe("a sign-in's own part", () => {
  const anything = () => fakeFetch([{ url: /./u, respond: () => Response.json({ access_token: 'a', token_type: 'bearer', id: 'u' }) }]);
  /** App entries built without the types, whose first sign-in declares a part of its own: refused everywhere, unsent. */
  const own = { fields: [{ name: 'host', title: 'Host' }], http: { baseUrl: 'https://{host}/api', host: '*' } };
  const oauthFirst = { id: 'first', name: 'First', scopes: { default: [] }, http: { baseUrl: 'https://cloud.first.test/api' },
    identify: { request: { path: '/me' }, id: 'id' }, revoke: { url: 'https://cloud.first.test/revoke', token: ['access'] },
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://cloud.first.test/authorize', tokenUrl: 'https://cloud.first.test/token', ...own }] } as unknown as Entry;
  const tokenFirst = { id: 'first', name: 'First', fields: [{ name: 'secret', title: 'Secret', secret: true }], http: { baseUrl: 'https://cloud.first.test/api' },
    auth: [{ kind: 'token', request: { url: 'https://cloud.first.test/token', body: { s: '{secret}' } }, ...own }] } as unknown as Entry;
  const refused = new TypeError('sign_in_own_first: first');
  const values = { host: 'cloud.first.test' };

  it('refuses an entry whose first sign-in declares one, from every connect and grant call, with no request', async () => {
    const http = anything();
    await expect(startConnect(oauthFirst, { ...start, values })).rejects.toThrow(refused);
    await expect(startConnect(tokenFirst)).rejects.toThrow(refused);
    await expect(finishConnect(oauthFirst, { client, code: 'c', redirectUri: callback, codeVerifier: 'v'.repeat(43), values, fetch: http.fetch,
      onRevokeFailed: vi.fn() })).rejects.toThrow(refused);
    await expect(finishConnect(tokenFirst, { secret: { secret: 's' }, values, fetch: http.fetch })).rejects.toThrow(refused);
    await expect(refreshGrant(oauthFirst, client, 'r', { values, fetch: http.fetch })).rejects.toThrow(refused);
    await expect(revokeGrant(oauthFirst, { accessToken: 'a', client, values, fetch: http.fetch })).rejects.toThrow(refused);
    await expect(exchangeCode(oauthFirst, client, { code: 'c', redirectUri: callback, codeVerifier: 'v'.repeat(43), values, fetch: http.fetch }))
      .rejects.toThrow(refused);
    expect(() => consentUrl(oauthFirst, { ...start, scopes: [], codeChallenge: 'c', values })).toThrow(refused);
    await expect(tokenSource(tokenFirst, { secret: { secret: 's' }, values, fetch: http.fetch })()).rejects.toThrow(refused);
    expect(http.calls).toEqual([]);
  });

  it('Outline narrowed to OAuth 2 sends only to app.getoutline.com, and refuses a host in the values, unsent', async () => {
    const oauth = signInWith(outline, 'oauth2');
    const kit = { clientId: 'kit-client', clientSecret: 'kit-secret' };
    const http = fakeFetch(fakeProvider(oauth, { key: 'kit', code: 'c', operations: { 'documents.get': () => ({ data: { id: 'd' } }) } }));
    const started = await startConnect(oauth, start);
    expect(new URL(started.url).host).toBe('app.getoutline.com');
    const { secret } = await finishConnect(oauth, { client: kit, code: 'c', redirectUri: callback, codeVerifier: started.codeVerifier,
      fetch: http.fetch, onRevokeFailed: vi.fn() });
    await refreshGrant(oauth, kit, secret.refreshToken ?? '', { fetch: http.fetch });
    await revokeGrant(oauth, { ...secret, client: kit, fetch: http.fetch });
    await apiClient(oauth, { token: 'kit', fetch: http.fetch }).documents.get({ id: 'd' });
    expect(new Set(http.calls.map(call => new URL(call.url).host))).toEqual(new Set(['app.getoutline.com']));
    expect(http.calls.map(call => new URL(call.url).pathname)).toEqual(['/oauth/token', '/api/auth.info', '/oauth/token', '/oauth/revoke',
      '/api/documents.info']);
    // The refresh token is the one revoked.
    expect(new URLSearchParams(http.calls[3]?.body).get('token')).toBe(secret.refreshToken);
    http.calls.length = 0;
    // A key connection's values, which a call on the whole entry would have sent to the cloud.
    const typed = { values: { host: 'docs.example.com' } } as object;
    const refused = new TypeError('value_undeclared: outline host');
    let reads = 0;
    const token = () => { reads++; return Promise.resolve('k'); };
    for (const entry of [outline, oauth]) {
      expect(() => apiClient(entry, { token, fetch: http.fetch, ...typed })).toThrow(refused);
      await expect(startConnect(entry, { ...start, ...typed })).rejects.toThrow(refused);
      await expect(finishConnect(entry, { client: kit, code: 'c', redirectUri: callback, codeVerifier: started.codeVerifier,
        fetch: http.fetch, onRevokeFailed: vi.fn(), ...typed })).rejects.toThrow(refused);
      expect(() => consentUrl(entry, { ...start, scopes: [], codeChallenge: 'c', ...typed })).toThrow(refused);
      await expect(exchangeCode(entry, kit, { code: 'c', redirectUri: callback, codeVerifier: started.codeVerifier, fetch: http.fetch, ...typed }))
        .rejects.toThrow(refused);
      await expect(refreshGrant(entry, kit, 'r', { fetch: http.fetch, ...typed })).rejects.toThrow(refused);
      await expect(revokeGrant(entry, { refreshToken: 'r', client: kit, fetch: http.fetch, ...typed })).rejects.toThrow(refused);
    }
    expect([reads, http.calls]).toEqual([0, []]);
    // The key's narrowing declares the host: there the same values reach the host typed.
    const key = fakeFetch(fakeProvider(signInWith(outline, 'key'), { key: 'k', values: { host: 'docs.example.com' },
      operations: { 'documents.get': () => ({ data: { id: 'd' } }) } }));
    await apiClient(signInWith(outline, 'key'), { token, fetch: key.fetch, values: { host: 'docs.example.com' } }).documents.get({ id: 'd' });
    expect([reads, key.calls.map(call => call.url)]).toEqual([1, ['https://docs.example.com/api/documents.info']]);
  });

  it('refuses a token sign-in value it does not declare, before a secret is read or anything is sent', async () => {
    const http = anything();
    let reads = 0;
    const secret = { get clientSecret() { reads++; return 's'; } };
    const values = { accountId: 'a', clientId: 'c', host: 'evil.test' } as unknown as { accountId: string; clientId: string };
    await expect(tokenSource(zoom, { secret, values, fetch: http.fetch })()).rejects.toThrow(new TypeError('value_undeclared: zoom host'));
    await expect(finishConnect(zoom, { secret, values, fetch: http.fetch })).rejects.toThrow(new TypeError('value_undeclared: zoom host'));
    expect([reads, http.calls]).toEqual([0, []]);
  });

  it("Outline narrowed to its key asks for the key's own fields, and refuses a host that is an address before the key is read", async () => {
    const key = signInWith(outline, 'key');
    expect(await startConnect(key)).toEqual({ kind: 'form', fields: key.fields });
    expect(key.fields.map(field => field.name)).toEqual(['host', 'apiKey']);
    const http = anything();
    let reads = 0;
    const token = () => { reads++; return Promise.resolve('k'); };
    await expect(apiClient(key, { token, values: { host: '127.0.0.1' }, fetch: http.fetch }).documents.get({ id: 'd' }))
      .rejects.toEqual(new ProviderHttpError('request_failed', null, 'address_blocked'));
    const secret = { get apiKey() { reads++; return 'k'; } };
    await expect(finishConnect(key, { secret, values: { host: '127.0.0.1' }, fetch: http.fetch }))
      .rejects.toEqual(new ProviderHttpError('request_failed', null, 'address_blocked'));
    expect([reads, http.calls]).toEqual([0, []]);
  });

  it.each(([['none', undefined], ['empty', {}], ['one reading only what was entered', { id: 'connection.host' }]] as const)
    .flatMap(([shape, identify]) => ([['*.k.test', 'evil.test', new TypeError('base_host_refused: typed')],
      ['*', '127.0.0.1', new ProviderHttpError('request_failed', null, 'address_blocked')]] as const)
      .map(([pattern, host, refusal]) => [shape, host, pattern, identify, refusal] as const)))(
    'a key connect whose identify is %s refuses the typed host %j (`http.host: %j`) before the key is read, unsent', async (_, host, pattern, identify, refusal) => {
      const typed = defineProvider({ id: 'typed', name: 'Typed', auth: [{ kind: 'key' }], ...identify && { identify },
        fields: [{ name: 'host', title: 'Host' }, { name: 'apiKey', title: 'API key', secret: true }],
        http: { baseUrl: 'https://{host}/api', host: pattern } });
      const http = anything();
      let reads = 0;
      const secret = { get apiKey() { reads++; return 'k'; } };
      await expect(finishConnect(typed, { secret, values: { host }, fetch: http.fetch })).rejects.toEqual(refusal);
      expect([reads, http.calls]).toEqual([0, []]);
    });

  it("takes only a later sign-in's own base and host: an app's own headers and bases there are never read", async () => {
    const smuggled = { id: 'sm', name: 'Sm', fields: [{ name: 'apiKey', title: 'API key', secret: true }], scopes: { default: [] },
      http: { baseUrl: 'https://cloud.sm.test', headers: { accept: 'application/json' } },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://cloud.sm.test/authorize', tokenUrl: 'https://cloud.sm.test/token' },
        { kind: 'key', http: { baseUrl: 'https://own.sm.test', headers: { accept: 'text/evil' }, bases: { b: 'https://evil.test' } },
          identify: { request: { base: 'b', path: '/me' }, id: 'id' } }] } as unknown as Entry;
    const key = signInWith(smuggled, 'key');
    expect(key.http).toEqual({ baseUrl: 'https://own.sm.test', headers: { accept: 'application/json' } });
    const http = anything();
    await expect(finishConnect(key, { secret: { apiKey: 'k' }, fetch: http.fetch })).rejects.toThrow(new TypeError('base_unknown: b'));
    expect(http.calls).toEqual([]);
  });

  it('refuses a later token sign-in whose own typed base sits beside a fixed token URL: host_split, with no request', async () => {
    const split = signInWith(defineProvider({ id: 'split', name: 'Split', scopes: { default: [] }, http: { baseUrl: 'https://cloud.split.test/api' },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://cloud.split.test/authorize', tokenUrl: 'https://cloud.split.test/token' },
        { kind: 'token', request: { url: 'https://cloud.split.test/token', body: { s: '{secret}' } },
          fields: [{ name: 'host', title: 'Host' }, { name: 'secret', title: 'Secret', secret: true }], http: { baseUrl: 'https://{host}/api', host: '*' } }] }), 'token');
    const http = anything();
    await expect(finishConnect(split, { secret: { secret: 's' }, values: { host: 'h.test' }, fetch: http.fetch })).rejects.toThrow(new TypeError('host_split: split'));
    await expect(tokenSource(split, { secret: { secret: 's' }, values: { host: 'h.test' }, fetch: http.fetch })()).rejects.toThrow(new TypeError('host_split: split'));
    expect(http.calls).toEqual([]);
  });
});

describe('a host the token answer names', () => {
  /** Wrike's shape: fixed sign-in URLs, the base and the refresh on the host the token answer names, under one domain. */
  const unidentified = { id: 'named', name: 'Named', scopes: { default: [] },
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.named.test/authorize', tokenUrl: 'https://login.named.test/token',
      refreshUrl: 'https://{host}/token' }],
    revoke: { url: 'https://login.named.test/revoke', token: ['refresh'] }, save: { host: 'tokenAnswer.host' },
    http: { baseUrl: 'https://{host}/api', host: '*.named.test' } } as const;
  const named = defineProvider({ ...unidentified, identify: { request: { path: '/me' }, id: 'id' } });
  /** The same base on a host a person types: a named value is checked as this one's is. */
  const typed = defineProvider({ ...named, fields: [{ name: 'host', title: 'Host' }], save: {} });
  const answering = (host: unknown) => fakeFetch([
    { url: 'https://login.named.test/token', respond: () => Response.json({ access_token: 'a', refresh_token: 'r', token_type: 'bearer',
      user_id: 'u1', ...(host === undefined ? {} : { host }) }) },
    { url: 'https://login.named.test/revoke', respond: () => new Response(null, { status: 200 }) },
    { url: /./u, respond: () => Response.json({ id: 'u1' }) }]);
  const finish = (fetch: typeof globalThis.fetch, extra: object = {}, entry: Entry = named) => finishConnect(entry, { client, code: 'c', redirectUri: callback,
    codeVerifier: 'v'.repeat(43), fetch, onRevokeFailed: error => { throw error; }, ...extra });
  const refusalOf = (run: () => unknown) => { try { run(); } catch (error) { return error; } return undefined; };

  it.each([['a.named.test', 'a.named.test'], ['A.NAMED.TEST', 'a.named.test'], ['xn--4ca.named.test', 'xn--4ca.named.test'],
    ['https://a.named.test', 'a.named.test'], ['https://x.named.test/', 'x.named.test']])(
    'a token answer naming %j sends identify there, and keeps it', async (host, sent) => {
      const http = answering(host);
      const connected = await finish(http.fetch);
      expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', `https://${sent}/api/me`]);
      expect(connected.values).toEqual({ host });
      expect(connected.account).toEqual({ id: 'u1', name: 'u1' });
    });

  it.each(['evil.test', 'named.test', 'a.named.test.evil.test', 'evilnamed.test', '127.0.0.1', '2130706433', '0x7f.1', '[::1]',
    'a.named.test.', ' a.named.test', 'a.named.test ', 'ä.named.test', 'a.named.test:8443', 'a%2enamed.test', 5,
    'https://a.named.test@evil.test', 'https://a.named.test:8443', 'https://a.named.test/x', 'https://portal.named.test/rest/',
    'https://a.named.test?x=1', 'https://a.named.test#f', 'http://a.named.test', 'HTTPS://a.named.test', 'https://'])(
    'a token answer naming %j is refused as a typed host is, before identify sends; the fresh grant is revoked', async host => {
      const http = answering(host);
      const refused = refusalOf(() => filledBase(typed, { host }));
      expect(refused).toBeInstanceOf(TypeError);
      await expect(finish(http.fetch)).rejects.toEqual(refused);
      expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', 'https://login.named.test/revoke']);
      expect(new URLSearchParams(http.calls[1]?.body).get('token')).toBe('r');
    });

  it.each(['https://evil.test', 'https://127.0.0.1', 'https://a.named.test.evil.test/'])(
    'a token answer naming the origin %j is refused as its host typed is, before identify sends; the fresh grant is revoked', async host => {
      const http = answering(host);
      await expect(finish(http.fetch)).rejects.toEqual(new TypeError('base_host_refused: named'));
      expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', 'https://login.named.test/revoke']);
    });

  it.each([undefined, '', '  ', null, {}, [], ['a.named.test'], { host: 'a.named.test' }, true])(
    'a token answer whose host is %j is invalid_response (missing_fields) before identify sends; the fresh grant is revoked', async host => {
      const http = answering(host);
      await expect(finish(http.fetch)).rejects.toEqual(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
      expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', 'https://login.named.test/revoke']);
    });

  it.each(([['reads the token answer alone', { id: 'tokenAnswer.user_id' }], ['is empty', {}], ['is not declared', undefined]] as const)
    .flatMap(([shape, identify]) => ['evil.test', '127.0.0.1', 'https://a.named.test:8443'].map(host => [shape, host, identify] as const)))(
    'an identify that %s, sending nothing on the base: a token answer naming %j is refused all the same; the grant is revoked', async (_, host, identify) => {
      const http = answering(host);
      await expect(finish(http.fetch, {}, defineProvider({ ...unidentified, ...identify && { identify } })))
        .rejects.toEqual(refusalOf(() => filledBase(typed, { host })));
      expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', 'https://login.named.test/revoke']);
    });

  it('after a failed identify, a revoke on the base goes to the host the token answer named', async () => {
    const requested = defineProvider({ ...named, revoke: { request: { method: 'POST', path: '/revoke' } } });
    const http = fakeFetch([
      { url: 'https://login.named.test/token', respond: () => Response.json({ access_token: 'a', refresh_token: 'r', token_type: 'bearer', host: 'a.named.test' }) },
      { url: 'https://a.named.test/api/me', respond: () => Response.json({}) },
      { url: 'https://a.named.test/api/revoke', respond: () => new Response(null, { status: 200 }) }]);
    await expect(finish(http.fetch, {}, requested)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', 'https://a.named.test/api/me', 'https://a.named.test/api/revoke']);
  });

  it("never takes the host from a caller's values: the start fills nothing named, the finish sends where the token answer says", async () => {
    const offered = { values: { host: 'evil.test' } } as object;
    const started = await startConnect(named, { ...start, ...offered });
    expect([new URL(started.url).host, started.values]).toEqual(['login.named.test', {}]);
    const http = answering('a.named.test');
    expect((await finish(http.fetch, offered)).values).toEqual({ host: 'a.named.test' });
    expect(http.calls.map(call => new URL(call.url).host)).toEqual(['login.named.test', 'a.named.test']);
  });
});
