import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { GrantRevoked, ProviderHttpError } from './errors.js';
import { authorizeUrl, exchangeCode, pkcePair, refreshGrant, revokeGrant } from './oauth.js';
import { defineProvider } from './catalogue.js';
import { figma } from './catalogue/figma.js';
import { google } from './catalogue/google.js';
import { hubspot } from './catalogue/hubspot.js';
import { microsoft } from './catalogue/microsoft.js';
import { slack } from './catalogue/slack.js';
import { fakeFetch } from './testing.js';
import { slackClient } from './slack/slack.js';

const client = { clientId: 'id', clientSecret: 'private-client-secret' };
const exchange = { code: 'private-authorization-code', redirectUri: 'https://app.test/cb' };
const token = { access_token: 'a', refresh_token: 'r', expires_in: 1800, token_type: 'bearer' };
function endpoint(body: unknown, status = 200) {
  return fakeFetch([{ url: /https:\/\//, respond: () => Response.json(body, { status }) }]);
}
/** PKCE on (no `pkce` key), the client secret by Basic auth, a fixed authorize parameter. */
const pkced = defineProvider({ id: 'pkced', name: 'PKCE', auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.test/authorize',
  tokenUrl: 'https://auth.test/token', clientAuth: 'basic', authorizeParams: { response_type: 'code' } }],
  http: { baseUrl: 'https://api.auth.test' } });

afterEach(() => vi.useRealTimers());

test("builds HubSpot's and Slack's authorize URLs", () => {
  const input = { clientId: 'id', redirectUri: 'https://app.test/cb', scopes: ['oauth', 'crm.objects.deals.read'], state: 's' };
  expect(authorizeUrl(hubspot, input).href).toBe('https://app.hubspot.com/oauth/authorize?client_id=id&scope=oauth+crm.objects.deals.read&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&state=s');
  expect(authorizeUrl(slack, { ...input, scopes: ['chat:write', 'channels:read'] }).href)
    .toContain('scope=chat%3Awrite%2Cchannels%3Aread');
});

test('adds the PKCE challenge and fixed params when the provider asks', async () => {
  const pair = await pkcePair();
  expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  expect(pair.challenge).toBe(createHash('sha256').update(pair.verifier).digest('base64url'));
  const input = { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state: 's' };
  expect(() => authorizeUrl(pkced, input)).toThrow('code_challenge_required');
  const url = authorizeUrl(pkced, { ...input, codeChallenge: pair.challenge });
  expect(url.searchParams.get('code_challenge')).toBe(pair.challenge);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('response_type')).toBe('code');
  const fake = endpoint(token);
  await exchangeCode(pkced, client, { ...exchange, codeVerifier: pair.verifier, fetch: fake.fetch });
  expect(new URLSearchParams(fake.calls[0]?.body).get('code_verifier')).toBe(pair.verifier);
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('id:private%2Dclient%2Dsecret').toString('base64')}`);
});

test('exchanges a HubSpot code', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  const fake = endpoint({ ...token, hub_id: 42 });
  const answer = await exchangeCode(hubspot, client, { ...exchange, fetch: fake.fetch });
  expect(answer.grant).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: '2026-10-24T12:30:00.000Z' });
  expect(answer.extras).toEqual({ hub_id: 42 });
  expect(fake.calls[0]?.url).toBe('https://api.hubapi.com/oauth/2026-03/token');
  expect(Object.fromEntries(new URLSearchParams(fake.calls[0]?.body))).toEqual({
    grant_type: 'authorization_code', code: exchange.code, redirect_uri: exchange.redirectUri,
    client_id: client.clientId, client_secret: client.clientSecret,
  });
});

test("accepts Slack's bot token and its team", async () => {
  const fake = endpoint({ access_token: 'bot-token', token_type: 'bot', team: { id: 'T1' }, bot_user_id: 'U1',
    authed_user: { access_token: 'nested-token' }, incoming_webhook: { url: 'https://hooks.slack.test/private' } });
  const result = await exchangeCode(slack, client, { ...exchange, fetch: fake.fetch });
  expect(result.grant).toEqual({ accessToken: 'bot-token', refreshToken: null, expiresAt: null });
  // Only the fields the catalogue names come back: the rest of an answer can hold other secrets.
  expect(result.extras).toEqual({ team: { id: 'T1' }, bot_user_id: 'U1' });
});

test("Slack's ok:false is a refusal, not a token", async () => {
  await expect(exchangeCode(slack, client, { ...exchange, fetch: endpoint({ ok: false, error: 'invalid_code' }).fetch }))
    .rejects.toMatchObject({ name: 'ProviderHttpError', code: 'request_failed', status: 200, detail: 'invalid_code' });
  await expect(refreshGrant(slack, client, 'old', { fetch: endpoint({ ok: false, error: 'token_revoked' }).fetch }))
    .rejects.toBeInstanceOf(GrantRevoked);
});

test('a refresh without a new refresh token keeps the old one', async () => {
  const fake = endpoint({ access_token: 'new', token_type: 'bearer' });
  expect(await refreshGrant(hubspot, client, 'old', { fetch: fake.fetch }))
    .toEqual({ accessToken: 'new', refreshToken: 'old', expiresAt: null });
  expect(new URLSearchParams(fake.calls[0]?.body).get('grant_type')).toBe('refresh_token');
  expect(new URLSearchParams(fake.calls[0]?.body).get('refresh_token')).toBe('old');
});

test('invalid_grant is GrantRevoked', async () => {
  await expect(refreshGrant(hubspot, client, 'old', { fetch: endpoint({ error: 'invalid_grant' }, 400).fetch }))
    .rejects.toBeInstanceOf(GrantRevoked);
});

test('a 502 proxy page is unavailable, and the token endpoint is never retried', async () => {
  for (const body of ['<html>bad gateway</html>', '']) {
    const fake = fakeFetch([{ url: /https:/, respond: () => new Response(body, { status: 502 }) }]);
    await expect(refreshGrant(hubspot, client, 'old', { fetch: fake.fetch }))
      .rejects.toMatchObject({ code: 'unavailable', status: 502 });
    expect(fake.calls).toHaveLength(1);
  }
});

test('a network failure is unavailable', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => { throw new TypeError('fetch failed'); } }]);
  await expect(refreshGrant(hubspot, client, 'old', { fetch: fake.fetch }))
    .rejects.toMatchObject({ code: 'unavailable', status: null });
  expect(fake.calls).toHaveLength(1);
});

test('revoke treats 404 and invalid_grant as done', async () => {
  await expect(revokeGrant(hubspot, { refreshToken: 'old', client, fetch: endpoint({}, 404).fetch })).resolves.toBeUndefined();
  const noContent = fakeFetch([{ url: /https:/, respond: () => new Response(null, { status: 204 }) }]);
  await expect(revokeGrant(hubspot, { refreshToken: 'old', client, fetch: noContent.fetch })).resolves.toBeUndefined();
  await expect(revokeGrant(hubspot, { refreshToken: 'old', client, fetch: endpoint({ error: 'invalid_grant' }, 400).fetch }))
    .resolves.toBeUndefined();
  await expect(revokeGrant(hubspot, { refreshToken: 'old', client, fetch: endpoint({ error: 'invalid_client' }, 401).fetch }))
    .rejects.toMatchObject({ code: 'request_failed', detail: 'invalid_client', status: 401 });
});

test('errors never carry the tokens they were sent', async () => {
  const refreshToken = 'private-refresh-token';
  const cases = [
    { provider: hubspot, fetch: endpoint({ error: 'invalid_grant', error_description: refreshToken }, 400).fetch },
    { provider: hubspot, fetch: endpoint({ error: 'invalid_client', error_description: client.clientSecret }, 401).fetch },
    { provider: hubspot, fetch: endpoint({ error: refreshToken }, 400).fetch },
    { provider: slack, fetch: endpoint({ ok: false, error: client.clientSecret, authed_user: { access_token: refreshToken } }).fetch },
    { provider: hubspot, fetch: endpoint({ access_token: refreshToken, token_type: 'unknown' }).fetch },
    { provider: hubspot, fetch: endpoint({ error: refreshToken }, 502).fetch },
    { provider: hubspot, fetch: fakeFetch([{ url: /https:/, respond: () => { throw new Error(refreshToken); } }]).fetch },
  ];
  for (const item of cases) {
    const error: unknown = await refreshGrant(item.provider, client, refreshToken, { fetch: item.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error('expected_error');
    const serialized = JSON.stringify({ fields: Object.fromEntries(Object.entries(error)), message: error.message, cause: error.cause });
    expect(serialized).not.toContain(refreshToken);
    expect(serialized).not.toContain(client.clientSecret);
    expect(error.cause).toBeUndefined();
  }
});

test('malformed token responses are invalid_response', async () => {
  for (const body of [{}, { access_token: '', token_type: 'bearer' }, { access_token: 'a', token_type: 'bearer', expires_in: 'wrong' }]) {
    await expect(exchangeCode(hubspot, client, { ...exchange, fetch: endpoint(body).fetch }))
      .rejects.toBeInstanceOf(ProviderHttpError);
    await expect(exchangeCode(hubspot, client, { ...exchange, fetch: endpoint(body).fetch }))
      .rejects.toMatchObject({ code: 'invalid_response', status: 200 });
  }
});

test('a refusal that is not an OAuth error body is request_failed', async () => {
  const challenge = fakeFetch([{ url: /https:/, respond: () => new Response(null,
    { status: 401, headers: { 'www-authenticate': 'Bearer realm="hubspot"' } }) }]);
  await expect(refreshGrant(hubspot, client, 'r', { fetch: challenge.fetch }))
    .rejects.toMatchObject({ code: 'request_failed', status: 401, detail: null });
  const page = fakeFetch([{ url: /https:/, respond: () => new Response('<html>bad request</html>', { status: 400 }) }]);
  await expect(revokeGrant(hubspot, { refreshToken: 'r', client, fetch: page.fetch }))
    .rejects.toMatchObject({ code: 'request_failed', status: 400 });
});

test.each(['', '  '])('authorizeUrl refuses blank state %j directly', state => {
  expect(() => authorizeUrl(slack, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state }))
    .toThrow('state_required');
});

test.each([undefined, '', '  '])('exchangeCode refuses missing PKCE verifier %j before HTTP', async codeVerifier => {
  const fake = endpoint(token);
  await expect(exchangeCode(pkced, client, { ...exchange, ...(codeVerifier === undefined ? {} : { codeVerifier }), fetch: fake.fetch }))
    .rejects.toThrow('code_verifier_required');
  expect(fake.calls).toHaveLength(0);
});

test('Slack token_revoked has the same library error shape for refresh and posting', async () => {
  const fake = endpoint({ ok: false, error: 'token_revoked' });
  const errors = await Promise.all([
    refreshGrant(slack, client, 'old', { fetch: fake.fetch }).catch((error: unknown) => error),
    slackClient({ token: 'access', fetch: fake.fetch }).postMessage({ channel: 'C1', text: 'hi' })
      .catch((error: unknown) => error),
  ]);
  for (const error of errors) {
    expect(error).toBeInstanceOf(GrantRevoked);
    expect(error).toMatchObject({ name: 'GrantRevoked', message: 'grant_revoked', detail: 'token_revoked' });
  }
});

test('revokeGrant: Google falls back to the access token and treats invalid_token as gone; HubSpot skips with no refresh token', async () => {
  const gone = fakeFetch([{ url: 'https://oauth2.googleapis.com/revoke', respond: () => Response.json({ error: 'invalid_token' }, { status: 400 }) }]);
  await expect(revokeGrant(google, { accessToken: 'access-token', refreshToken: null, client, fetch: gone.fetch })).resolves.toBeUndefined();
  expect(new URLSearchParams(gone.calls[0]?.body).get('token')).toBe('access-token');
  const none = fakeFetch([]);
  await revokeGrant(hubspot, { refreshToken: null, client, fetch: none.fetch });
  expect(none.calls).toHaveLength(0);
});

test('revokeGrant: an RFC 7009 revoke without the OAuth app sends nothing', async () => {
  const none = fakeFetch([]);
  await expect(revokeGrant(hubspot, { refreshToken: 'r', fetch: none.fetch })).rejects.toThrow('oauth_client_required');
  expect(none.calls).toHaveLength(0);
});

test('revokeGrant: Slack revokes by request with the access token and no OAuth app, and a token already gone is done', async () => {
  const fake = fakeFetch([{ url: 'https://slack.com/api/auth.revoke', respond: () => Response.json({ ok: false, error: 'token_revoked' }) }]);
  await expect(revokeGrant(slack, { accessToken: 'a', fetch: fake.fetch })).resolves.toBeUndefined();
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer a');
});

test('revokeGrant: a request revoke reads its answer as any JSON call does: a 404 is no gone token, a 2xx without JSON fails', async () => {
  const missing = fakeFetch([{ url: 'https://slack.com/api/auth.revoke', respond: () => new Response('', { status: 404 }) }]);
  await expect(revokeGrant(slack, { accessToken: 'a', fetch: missing.fetch })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  const plain = fakeFetch([{ url: 'https://slack.com/api/auth.revoke', respond: () => new Response('ok') }]);
  await expect(revokeGrant(slack, { accessToken: 'a', fetch: plain.fetch })).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
});

test('revokeGrant: an entry with no revoke (Microsoft) sends nothing', async () => {
  const none = fakeFetch([]);
  await expect(revokeGrant(microsoft, { accessToken: 'a', refreshToken: 'r', client, fetch: none.fetch })).resolves.toBeUndefined();
  expect(none.calls).toHaveLength(0);
});

test("a token answer refused inside a 200 is read through the entry's own condition and code", async () => {
  await expect(exchangeCode(slack, client, { ...exchange, fetch: endpoint({ ok: false, error: 'invalid_code' }).fetch }))
    .rejects.toMatchObject({ code: 'request_failed', detail: 'invalid_code' });
  // A `failed` other than `ok: false`: today's hard-coded check would accept this answer.
  const strict = defineProvider({ id: 'strict', name: 'Strict', auth: [{ kind: 'oauth2', authorizeUrl: 'https://strict.test/authorize',
    tokenUrl: 'https://strict.test/token', pkce: false, failed: { path: 'error' } }], http: { baseUrl: 'https://api.strict.test' },
    errors: { detail: 'reason' } });
  await expect(exchangeCode(strict, client, { ...exchange, fetch: endpoint({ ...token, error: 'refused', reason: 'code_used' }).fetch }))
    .rejects.toMatchObject({ code: 'request_failed', detail: 'code_used' });
});

test('an error never carries the Basic client credential the request sent, form-encoded as on the wire', async () => {
  // `id:abcdef` encodes to base64 without padding, so an echo of it would pass the detail pattern.
  const basicClient = { clientId: 'id', clientSecret: 'abcdef' };
  const sent = Buffer.from('id:abcdef').toString('base64');
  const basic = defineProvider({ id: 'basic', name: 'Basic', auth: [{ kind: 'oauth2', authorizeUrl: 'https://basic.test/authorize',
    tokenUrl: 'https://basic.test/token', pkce: false, clientAuth: 'basic' }], scopes: { default: [] },
    revoke: { url: 'https://basic.test/revoke', token: ['refresh'] }, http: { baseUrl: 'https://api.basic.test' } });
  const echo = endpoint({ error: sent }, 400);
  for (const run of [
    () => exchangeCode(basic, basicClient, { ...exchange, fetch: echo.fetch }),
    () => refreshGrant(basic, basicClient, 'r', { fetch: echo.fetch }),
    () => revokeGrant(basic, { refreshToken: 'r', client: basicClient, fetch: echo.fetch }),
  ]) await expect(run()).rejects.toMatchObject({ code: 'request_failed', detail: null });
  expect(echo.calls.map(call => call.headers.authorization)).toEqual(Array(3).fill(`Basic ${sent}`));
});

/** A token endpoint that takes JSON, the client id and secret in the body, no PKCE (Atlassian's shape). */
const jsonBodied = defineProvider({ id: 'jsonbodied', name: 'JSON', auth: [{ kind: 'oauth2', authorizeUrl: 'https://json.test/authorize',
  tokenUrl: 'https://json.test/token', json: true, pkce: false }], scopes: { default: [] },
  revoke: { url: 'https://json.test/revoke', token: ['refresh'] }, http: { baseUrl: 'https://api.json.test' } });

test('json: the exchange, the refresh and a revoke send their parameters as one JSON object', async () => {
  const fake = endpoint(token);
  await exchangeCode(jsonBodied, client, { ...exchange, fetch: fake.fetch });
  await refreshGrant(jsonBodied, client, 'old', { fetch: fake.fetch });
  await revokeGrant(jsonBodied, { refreshToken: 'old', client, fetch: fake.fetch });
  expect(fake.calls.map(call => call.headers['content-type'])).toEqual(Array(3).fill('application/json'));
  expect(fake.calls.map(call => JSON.parse(call.body) as unknown)).toEqual([
    { grant_type: 'authorization_code', code: exchange.code, redirect_uri: exchange.redirectUri,
      client_id: client.clientId, client_secret: client.clientSecret },
    { grant_type: 'refresh_token', refresh_token: 'old', client_id: client.clientId, client_secret: client.clientSecret },
    { token: 'old', client_id: client.clientId, client_secret: client.clientSecret },
  ]);
});

test('json: a refused refresh is read as any OAuth answer, and its detail never holds the secret sent', async () => {
  await expect(refreshGrant(jsonBodied, client, 'old', { fetch: endpoint({ error: 'invalid_grant' }, 400).fetch }))
    .rejects.toBeInstanceOf(GrantRevoked);
  // Atlassian documents a 403 for a refresh token that is gone.
  await expect(refreshGrant(jsonBodied, client, 'old', { fetch: endpoint({ error: 'invalid_grant' }, 403).fetch }))
    .rejects.toBeInstanceOf(GrantRevoked);
  await expect(refreshGrant(jsonBodied, client, 'old', { fetch: endpoint({ error: client.clientSecret }, 400).fetch }))
    .rejects.toMatchObject({ code: 'request_failed', status: 400, detail: null });
});

test("refreshUrl: Figma exchanges at its token URL and refreshes at its refresh URL, keeping the refresh token it sent", async () => {
  const fake = fakeFetch([
    { url: 'https://api.figma.com/v1/oauth/token', respond: () => Response.json({ ...token, user_id_string: '1234567890123456789' }) },
    { url: 'https://api.figma.com/v1/oauth/refresh', respond: () => Response.json({ access_token: 'new', token_type: 'bearer', expires_in: 7_776_000 }) },
  ]);
  const { grant, extras } = await exchangeCode(figma, client, { ...exchange, codeVerifier: 'v'.repeat(43), fetch: fake.fetch });
  expect(grant.refreshToken).toBe('r');
  expect(extras).toEqual({ user_id_string: '1234567890123456789' });
  expect(await refreshGrant(figma, client, 'r', { fetch: fake.fetch })).toMatchObject({ accessToken: 'new', refreshToken: 'r' });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.figma.com/v1/oauth/token', 'https://api.figma.com/v1/oauth/refresh']);
  expect(fake.calls.map(call => call.headers['content-type'])).toEqual(Array(2).fill('application/x-www-form-urlencoded;charset=UTF-8'));
  expect(fake.calls.map(call => call.headers.authorization)).toEqual(Array(2).fill(`Basic ${Buffer.from('id:private%2Dclient%2Dsecret').toString('base64')}`));
});
