import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineProvider } from './catalogue.js';
import { slack } from './catalogue/slack.js';
import { finishConnect, startConnect, type DirectConnect } from './connect.js';
import { ProviderHttpError } from './errors.js';
import { fakeSlack } from './slack/fake.js';
import { slackConnect } from './slack/slack.js';
import { fakeFetch } from './testing.js';

const callback = 'https://app.test/api/integrations/slack/callback';
const start = { clientId: 'client', redirectUri: callback, state: 'state' };
const data = { redirectUri: callback, team: { id: 'T1', name: 'Acme' }, botUserId: 'U1', channels: [] };
async function authorize(http: ReturnType<typeof fakeFetch>): Promise<string> {
  const begun = await startConnect(slackConnect, start);
  if (begun.kind !== 'redirect') throw new Error('expected_redirect');
  const response = await http.fetch(begun.url);
  const code = new URL(response.headers.get('location') ?? '').searchParams.get('code');
  if (!code) throw new Error('expected_code');
  http.calls.length = 0;
  return code;
}
const { authorizeUrl, tokenUrl, scopeSeparator, tokenTypes } = slack.auth[0];
/** Slack with PKCE on: no `pkce` key. */
const pkceSlack = defineProvider({ ...slack, auth: [{ kind: 'oauth2', authorizeUrl, tokenUrl, scopeSeparator, tokenTypes }] });
afterEach(() => vi.useRealTimers());

describe('connect', () => {
  it('builds the existing Slack authorization URL byte for byte', async () => {
    expect(await startConnect(slackConnect, start)).toEqual({ kind: 'redirect',
      url: 'https://slack.com/oauth/v2/authorize?client_id=client&scope=chat%3Awrite%2Cchat%3Awrite.public%2Cchannels%3Aread%2Cgroups%3Aread&redirect_uri=https%3A%2F%2Fapp.test%2Fapi%2Fintegrations%2Fslack%2Fcallback&state=state' });
  });

  it('finishes a grant and returns only its secret and identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const http = fakeFetch(fakeSlack(data));
    const code = await authorize(http);
    const result = await finishConnect(slackConnect, { client: { clientId: 'client', clientSecret: 'secret' },
      code, redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(result).toEqual({ secret: { accessToken: 'xoxe.xoxb-fixture-1793491200000', refreshToken: 'xoxe-1-fixture-1793491200000', expiresAt: '2026-11-01T12:00:00.000Z' },
      account: { id: 'T1', name: 'Acme' }, details: { botUserId: 'U1' } });
    expect(Object.fromEntries(new URLSearchParams(http.calls[0]?.body))).toEqual({ client_id: 'client', client_secret: 'secret',
      grant_type: 'authorization_code', code, redirect_uri: callback });
    expect(http.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('rejects a refused grant before identity', async () => {
    const http = fakeFetch(fakeSlack(data));
    const identify = vi.fn(slackConnect.identify);
    await expect(finishConnect({ ...slackConnect, identify }, { client: { clientId: 'client', clientSecret: 'secret' },
      code: 'fixture-denied', redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() })).rejects.toMatchObject({ detail: 'invalid_code' });
    expect(identify).not.toHaveBeenCalled();
  });

  it('fake consent keeps the redirect URI and state identical at both ends', async () => {
    const http = fakeFetch(fakeSlack(data));
    const begun = await startConnect(slackConnect, start);
    if (begun.kind !== 'redirect') throw new Error('expected_redirect');
    const response = await http.fetch(begun.url);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(callback);
    expect(location.searchParams.get('state')).toBe('state');
    expect(location.searchParams.get('code')).toMatch(/^fixture-code/u);
  });

  it('supports PKCE without owning state', async () => {
    const provider = { ...slackConnect, provider: pkceSlack };
    const begun = await startConnect(provider, start);
    if (begun.kind !== 'redirect' || !begun.codeVerifier) throw new Error('expected_pkce');
    const params = new URL(begun.url).searchParams;
    expect(params.get('state')).toBe('state');
    expect(params.get('code_challenge')).toBe(createHash('sha256').update(begun.codeVerifier).digest('base64url'));
    expect(params.get('code_challenge_method')).toBe('S256');
    const http = fakeFetch(fakeSlack(data));
    await finishConnect(provider, { client: { clientId: 'client', clientSecret: 'secret' }, code: await authorize(http),
      redirectUri: callback, codeVerifier: begun.codeVerifier, fetch: http.fetch, onRevokeFailed: vi.fn() });
    expect(new URLSearchParams(http.calls[0]?.body).get('code_verifier')).toBe(begun.codeVerifier);
  });

  it('returns secret form fields and verifies a refused key', async () => {
    const provider: DirectConnect<string, { verified: boolean }> = { kind: 'form',
      fields: [{ name: 'apiKey', label: 'API key', secret: true }], identify: key => {
        if (key !== 'valid') return Promise.reject(new ProviderHttpError('rejected', 401));
        return Promise.resolve({ account: { id: 'a', name: 'Account' }, details: { verified: true } });
      } };
    expect(await startConnect(provider)).toEqual({ kind: 'form', fields: [{ name: 'apiKey', label: 'API key', secret: true }] });
    expect(await finishConnect(provider, { secret: 'valid' })).toEqual({ secret: 'valid', account: { id: 'a', name: 'Account' }, details: { verified: true } });
    await expect(finishConnect(provider, { secret: 'bad' })).rejects.toMatchObject({ code: 'rejected' });
  });

  it('starts hosted authorization and identifies the named account', async () => {
    const provider: DirectConnect<string, { createdAt: string | null }> = { kind: 'hosted',
      authorize: () => Promise.resolve('https://hosted.test/sign-in'), identify: accountId => Promise.resolve({ account: { id: accountId, name: 'LinkedIn' }, details: { createdAt: null } }) };
    expect(await startConnect(provider)).toEqual({ kind: 'hosted', url: 'https://hosted.test/sign-in' });
    expect(await finishConnect(provider, { secret: 'acc_1' })).toEqual({ secret: 'acc_1', account: { id: 'acc_1', name: 'LinkedIn' }, details: { createdAt: null } });
  });
});


describe('connect review regressions', () => {
  it.each(['', '  '])('refuses blank state %j', async state => {
    await expect(startConnect(slackConnect, { ...start, state })).rejects.toThrow('state_required');
  });

  it('refuses a missing PKCE verifier before exchanging', async () => {
    const http = fakeFetch(fakeSlack(data));
    const provider = { ...slackConnect, provider: pkceSlack };
    await expect(finishConnect(provider, { client: { clientId: 'client', clientSecret: 'secret' },
      code: 'code', redirectUri: callback, fetch: http.fetch, onRevokeFailed: vi.fn() })).rejects.toThrow('code_verifier_required');
    expect(http.calls).toHaveLength(0);
  });

  it.each(['success', 'rejected', 'throws'])('revokes the grant when identity fails, even if revocation fails: %s', async revocation => {
    const http = fakeFetch(fakeSlack(data));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    const error = new ProviderHttpError('invalid_response', 200, 'missing_fields');
    const revokeError = new Error('revoke_unavailable');
    const onRevokeFailed = vi.fn();
    const revoke = vi.fn(slackConnect.revoke);
    if (revocation === 'rejected') revoke.mockRejectedValue(revokeError);
    if (revocation === 'throws') revoke.mockImplementation(() => { throw revokeError; });
    await expect(finishConnect({ ...slackConnect, identify: () => Promise.reject(error), revoke },
      { client: { clientId: 'client', clientSecret: 'secret' }, code: await authorize(http), redirectUri: callback, fetch: http.fetch, onRevokeFailed }))
      .rejects.toBe(error);
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith({
      grant: { accessToken: 'xoxe.xoxb-fixture-1793491200000', refreshToken: 'xoxe-1-fixture-1793491200000',
        expiresAt: '2026-11-01T12:00:00.000Z' },
      client: { clientId: 'client', clientSecret: 'secret' }, fetch: http.fetch,
    });
    if (revocation === 'success') {
      expect(http.calls.at(-1)?.url).toBe('https://slack.com/api/auth.revoke');
      expect(http.calls.at(-1)?.headers.authorization).toBe('Bearer xoxe.xoxb-fixture-1793491200000');
      expect(onRevokeFailed).not.toHaveBeenCalled();
    } else {
      expect(onRevokeFailed).toHaveBeenCalledExactlyOnceWith(revokeError);
    }
  });

  it('skips failed-identity cleanup only for a provider declaring reusesGrant true', async () => {
    const http = fakeFetch(fakeSlack(data));
    const error = new ProviderHttpError('invalid_response', null);
    const revoke = vi.fn(slackConnect.revoke);
    const onRevokeFailed = vi.fn();
    await expect(finishConnect({ ...slackConnect, reusesGrant: true,
      identify: () => Promise.reject(error), revoke }, {
      client: { clientId: 'client', clientSecret: 'secret' }, code: await authorize(http),
      redirectUri: callback, fetch: http.fetch, onRevokeFailed,
    })).rejects.toBe(error);
    expect(revoke).not.toHaveBeenCalled();
    expect(onRevokeFailed).not.toHaveBeenCalled();
    expect(http.calls.some(call => call.url === 'https://slack.com/api/auth.revoke')).toBe(false);
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
    const exchange = (redirectUri: string, clientId = 'client', suppliedCode = code) => finishConnect(slackConnect,
      { client: { clientId, clientSecret: 'secret' }, code: suppliedCode, redirectUri, fetch: http.fetch, onRevokeFailed: vi.fn() });
    await expect(exchange('https://attacker.test/')).rejects.toMatchObject({ detail: 'bad_redirect_uri' });
    await expect(exchange(callback, 'wrong-client')).rejects.toMatchObject({ detail: 'invalid_client_id' });
    await expect(exchange(callback, 'client', 'unissued')).rejects.toMatchObject({ detail: 'invalid_code' });
    await exchange(callback);
    await expect(exchange(callback)).rejects.toMatchObject({ detail: 'invalid_code' });
  });
});
