import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineProvider } from './catalogue.js';
import { aircall } from './catalogue/aircall.js';
import { attio } from './catalogue/attio.js';
import { google } from './catalogue/google.js';
import { slack } from './catalogue/slack.js';
import { finishConnect, startConnect } from './connect.js';
import { ProviderHttpError } from './errors.js';
import { fakeGoogle } from './google/fake.js';
import { fakeSlack } from './slack/fake.js';
import { fakeFetch, type Route } from './testing.js';

const callback = 'https://app.test/api/integrations/slack/callback';
const start = { clientId: 'client', redirectUri: callback, state: 'state' };
const client = { clientId: 'client', clientSecret: 'secret' };
const data = { redirectUri: callback, team: { id: 'T1', name: 'Acme' }, botUserId: 'U1', channels: [] };
const tokenUrl = 'https://slack.com/api/oauth.v2.access';
const revokeUrl = 'https://slack.com/api/auth.revoke';
async function authorize(http: ReturnType<typeof fakeFetch>): Promise<string> {
  const begun = await startConnect(slack, start);
  if (begun.kind !== 'redirect') throw new Error('expected_redirect');
  const response = await http.fetch(begun.url);
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
/** A token answer whose team has no id: identify refuses it. */
const noTeam = { ...data, team: { id: '', name: 'Acme' } };
afterEach(() => vi.useRealTimers());

describe('connect', () => {
  it('builds the existing Slack authorization URL byte for byte', async () => {
    expect(await startConnect(slack, start)).toEqual({ kind: 'redirect',
      url: 'https://slack.com/oauth/v2/authorize?client_id=client&scope=chat%3Awrite%2Cchat%3Awrite.public%2Cchannels%3Aread%2Cgroups%3Aread&redirect_uri=https%3A%2F%2Fapp.test%2Fapi%2Fintegrations%2Fslack%2Fcallback&state=state' });
  });

  it('finishes Slack from its entry: the grant, the team, the bot user', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const http = fakeFetch(fakeSlack(data));
    const code = await authorize(http);
    const result = await finishConnect(slack, { client, code, redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(result).toEqual({ secret: { accessToken: 'xoxe.xoxb-fixture-1793491200000', refreshToken: 'xoxe-1-fixture-1793491200000',
      expiresAt: '2026-11-01T12:00:00.000Z' }, values: { botUserId: 'U1' }, account: { id: 'T1', name: 'Acme' } });
    const team: string = result.account.id; // typed: no null check for an entry whose identify names an id
    expect(team).toBe('T1');
    expect(Object.fromEntries(new URLSearchParams(http.calls[0]?.body))).toEqual({ client_id: 'client', client_secret: 'secret',
      grant_type: 'authorization_code', code, redirect_uri: callback });
    expect(http.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('rejects a refused grant before identity', async () => {
    const http = fakeFetch(fakeSlack(data));
    await expect(finishConnect(slack, { client, code: 'fixture-denied', redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() }))
      .rejects.toMatchObject({ detail: 'invalid_code' });
    expect(http.calls.map(call => call.url)).toEqual([tokenUrl]);
  });

  it('fake consent keeps the redirect URI and state identical at both ends', async () => {
    const http = fakeFetch(fakeSlack(data));
    const begun = await startConnect(slack, start);
    if (begun.kind !== 'redirect') throw new Error('expected_redirect');
    const response = await http.fetch(begun.url);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(callback);
    expect(location.searchParams.get('state')).toBe('state');
    expect(location.searchParams.get('code')).toMatch(/^fixture-code/u);
  });

  it('supports PKCE without owning state', async () => {
    const begun = await startConnect(pkceSlack, start);
    if (begun.kind !== 'redirect' || !begun.codeVerifier) throw new Error('expected_pkce');
    const params = new URL(begun.url).searchParams;
    expect(params.get('state')).toBe('state');
    expect(params.get('code_challenge')).toBe(createHash('sha256').update(begun.codeVerifier).digest('base64url'));
    expect(params.get('code_challenge_method')).toBe('S256');
    const http = fakeFetch(fakeSlack(data));
    await finishConnect(pkceSlack, { client, code: await authorize(http),
      redirectUri: callback, codeVerifier: begun.codeVerifier, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(new URLSearchParams(http.calls[0]?.body).get('code_verifier')).toBe(begun.codeVerifier);
  });

  it("returns a key entry's fields and verifies a refused key", async () => {
    const http = fakeFetch([{ url: 'https://api.attio.com/v2/self', respond: request => (request.headers.get('authorization') === 'Bearer valid'
      ? Response.json({ active: true, workspace_id: 'w1', workspace_name: 'Account' }) : Response.json({}, { status: 401 })) }]);
    expect(await startConnect(attio)).toEqual({ kind: 'form', fields: [{ name: 'apiKey', title: 'API key', secret: true }] });
    expect(await finishConnect(attio, { secret: { apiKey: 'valid' }, fetch: http.fetch }))
      .toEqual({ secret: { apiKey: 'valid' }, values: {}, account: { id: 'w1', name: 'Account' } });
    await expect(finishConnect(attio, { secret: { apiKey: 'bad' }, fetch: http.fetch })).rejects.toMatchObject({ code: 'rejected' });
  });

  it("keeps a key entry's plain values and builds its credential from them", async () => {
    const http = fakeFetch([{ url: 'https://api.aircall.io/v1/company', respond: () => Response.json({ company: { name: 'Lumen' } }) }]);
    expect(await finishConnect(aircall, { secret: { apiToken: 'token' }, values: { apiId: '12' }, fetch: http.fetch }))
      .toEqual({ secret: { apiToken: 'token' }, values: { apiId: '12' }, account: { id: '12', name: 'Lumen' } });
    expect(http.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('12:token').toString('base64')}`);
  });

  it.each([{}, { apiToken: '' }])('refuses a key entry without its secret (%j) before anything is sent', async secret => {
    const http = fakeFetch([]);
    await expect(finishConnect(aircall, { secret, values: { apiId: '12' }, fetch: http.fetch })).rejects.toThrow(new TypeError('connect_secret_required'));
    expect(http.calls).toHaveLength(0);
  });

  it('refuses a key entry that declares no secret field', async () => {
    const bare = defineProvider({ id: 'bare', name: 'Bare', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.bare.test' } });
    await expect(finishConnect(bare, { secret: { apiKey: 'key' }, fetch: fakeFetch([]).fetch })).rejects.toThrow(new TypeError('connect_secret_required'));
  });

  it.each([undefined, {}, { apiId: '' }])('refuses a key entry without a plain field (%j) before anything is sent', async values => {
    const http = fakeFetch([]);
    await expect(finishConnect(aircall, { secret: { apiToken: 'token' }, ...(values ? { values } : {}), fetch: http.fetch }))
      .rejects.toThrow(new TypeError('connect_field_required: apiId'));
    expect(http.calls).toHaveLength(0);
  });
});


describe('connect review regressions', () => {
  it.each(['', '  '])('refuses blank state %j', async state => {
    await expect(startConnect(slack, { ...start, state })).rejects.toThrow('state_required');
  });

  it('refuses an OAuth sign-in started or finished without its options', async () => {
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
    if (begun.kind !== 'redirect' || !begun.codeVerifier) throw new Error('expected_pkce');
    const code = new URL((await http.fetch(begun.url, { redirect: 'manual' })).headers.get('location') ?? '').searchParams.get('code') ?? '';
    const onRevokeFailed = vi.fn();
    await expect(finishConnect(google, { client, code, redirectUri, codeVerifier: begun.codeVerifier, fetch: http.fetch, onRevokeFailed }))
      .rejects.toEqual(new ProviderHttpError('rejected', null, 'scope_missing'));
    expect(http.calls.map(call => call.url.split('?')[0]).slice(1)).toEqual(['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/revoke']);
    expect(onRevokeFailed).not.toHaveBeenCalled();
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
