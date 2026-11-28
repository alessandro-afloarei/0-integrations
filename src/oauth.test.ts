import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { GrantRevoked, ProviderHttpError } from './errors.js';
import { authorizeUrl, exchangeCode, pkcePair, refreshGrant, requestToken, revokeGrant, tokenSource } from './oauth.js';
import { defineProvider, type Entry } from './catalogue.js';
import { figma } from './catalogue/figma.js';
import { google } from './catalogue/google.js';
import { hubspot } from './catalogue/hubspot.js';
import { intercom } from './catalogue/intercom.js';
import { microsoft } from './catalogue/microsoft.js';
import { slack } from './catalogue/slack.js';
import { zoom } from './catalogue/zoom.js';
import { client as apiClient } from './client.js';
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
  expect(authorizeUrl(hubspot, { ...input, codeChallenge: 'c' }).href).toBe('https://app.hubspot.com/oauth/authorize?client_id=id&scope=oauth+crm.objects.deals.read&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&state=s&code_challenge=c&code_challenge_method=S256');
  expect(authorizeUrl(slack, { ...input, scopes: ['chat:write', 'channels:read'], values: { domain: 'slack.com' } }).href)
    .toContain('scope=chat%3Awrite%2Cchannels%3Aread');
});

test.each(intercom.fields[0].choices)("builds Intercom's authorize URL on its region's host %s, and exchanges on the one token URL", async appHost => {
  const input = { clientId: 'id', redirectUri: 'https://app.test/cb', scopes: [], state: 's', codeChallenge: 'c', values: { appHost } };
  expect(authorizeUrl(intercom, input).href)
    .toBe(`https://${appHost}/oauth?client_id=id&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&state=s&code_challenge=c&code_challenge_method=S256`);
  const fake = endpoint(token);
  await exchangeCode(intercom, client, { ...exchange, codeVerifier: 'v'.repeat(43), values: { appHost }, fetch: fake.fetch });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.intercom.io/auth/eagle/token']);
});

test('sends `scope` only when scopes are asked: none for an empty list, the two joined by a space', () => {
  const input = { clientId: 'id', redirectUri: exchange.redirectUri, state: 's', codeChallenge: 'c' };
  expect(authorizeUrl(pkced, { ...input, scopes: [] }).searchParams.has('scope')).toBe(false);
  expect(authorizeUrl(pkced, { ...input, scopes: ['a', 'b'] }).searchParams.get('scope')).toBe('a b');
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
  const answer = await exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: fake.fetch });
  expect(answer.grant).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: '2026-10-24T12:30:00.000Z' });
  expect(answer.extras).toEqual({ hub_id: 42 });
  expect(fake.calls[0]?.url).toBe('https://api.hubapi.com/oauth/2026-03/token');
  expect(Object.fromEntries(new URLSearchParams(fake.calls[0]?.body))).toEqual({
    grant_type: 'authorization_code', code: exchange.code, redirect_uri: exchange.redirectUri, code_verifier: 'v',
    client_id: client.clientId, client_secret: client.clientSecret,
  });
});

test("accepts Slack's bot token and its team", async () => {
  const fake = endpoint({ access_token: 'bot-token', token_type: 'bot', team: { id: 'T1' }, bot_user_id: 'U1',
    authed_user: { access_token: 'nested-token' }, incoming_webhook: { url: 'https://hooks.slack.test/private' } });
  const result = await exchangeCode(slack, client, { ...exchange, fetch: fake.fetch, values: { domain: 'slack.com' } });
  expect(result.grant).toEqual({ accessToken: 'bot-token', refreshToken: null, expiresAt: null });
  // Only the fields the catalogue names come back: the rest of an answer can hold other secrets.
  expect(result.extras).toEqual({ team: { id: 'T1' }, bot_user_id: 'U1' });
});

test("Slack's ok:false is a refusal, not a token", async () => {
  await expect(exchangeCode(slack, client, { ...exchange, fetch: endpoint({ ok: false, error: 'invalid_code' }).fetch, values: { domain: 'slack.com' } }))
    .rejects.toMatchObject({ name: 'ProviderHttpError', code: 'request_failed', status: 200, detail: 'invalid_code' });
  await expect(refreshGrant(slack, client, 'old', { fetch: endpoint({ ok: false, error: 'token_revoked' }).fetch, values: { domain: 'slack.com' } }))
    .rejects.toBeInstanceOf(GrantRevoked);
});

test('a token answer that states no token_type is read as Bearer; one that states another type is refused unless listed', async () => {
  expect((await exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: endpoint({ access_token: 'a', refresh_token: 'r', expires_in: 1800 }).fetch }))
    .grant).toMatchObject({ accessToken: 'a', refreshToken: 'r' });
  // ClickUp's documented answer: the token alone.
  expect(await exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: endpoint({ access_token: 'only' }).fetch }))
    .toEqual({ grant: { accessToken: 'only', refreshToken: null, expiresAt: null }, extras: {} });
  expect(await refreshGrant(hubspot, client, 'old', { fetch: endpoint({ access_token: 'new' }).fetch }))
    .toEqual({ accessToken: 'new', refreshToken: 'old', expiresAt: null });
  expect((await exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: endpoint(token).fetch })).grant.accessToken).toBe('a');
  await expect(exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: endpoint({ ...token, token_type: 'mac' }).fetch }))
    .rejects.toMatchObject({ code: 'invalid_response', status: 200 });
});

test("the Bearer default reads only a 2xx token answer: a 5xx and a revoke's 200 are never read", async () => {
  /** A body that never ends: reading it would never finish. */
  const endless = (status: number) => fakeFetch([{ url: /https:/, respond: () => new Response(new ReadableStream({ start() {} }),
    { status, headers: { 'content-type': 'application/json' } }) }]);
  await expect(refreshGrant(hubspot, client, 'old', { fetch: endless(500).fetch })).rejects.toMatchObject({ code: 'unavailable', status: 500 });
  await expect(revokeGrant(hubspot, { refreshToken: 'old', client, fetch: endless(200).fetch })).resolves.toBeUndefined();
}, 2000);

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
    await expect(exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: endpoint(body).fetch }))
      .rejects.toBeInstanceOf(ProviderHttpError);
    await expect(exchangeCode(hubspot, client, { ...exchange, codeVerifier: 'v', fetch: endpoint(body).fetch }))
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
  expect(() => authorizeUrl(slack, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state, values: { domain: 'slack.com' } }))
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
    refreshGrant(slack, client, 'old', { fetch: fake.fetch, values: { domain: 'slack.com' } }).catch((error: unknown) => error),
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
  await expect(revokeGrant(slack, { accessToken: 'a', fetch: fake.fetch, values: { domain: 'slack.com' } })).resolves.toBeUndefined();
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer a');
});

test('revokeGrant: a request revoke reads its answer as any JSON call does: a 404 is no gone token, a 2xx without JSON fails', async () => {
  const missing = fakeFetch([{ url: 'https://slack.com/api/auth.revoke', respond: () => new Response('', { status: 404 }) }]);
  await expect(revokeGrant(slack, { accessToken: 'a', fetch: missing.fetch, values: { domain: 'slack.com' } })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  const plain = fakeFetch([{ url: 'https://slack.com/api/auth.revoke', respond: () => new Response('ok') }]);
  await expect(revokeGrant(slack, { accessToken: 'a', fetch: plain.fetch, values: { domain: 'slack.com' } })).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
});

test("revokeGrant: a `goneErrors` code that is a number is compared as its digits", async () => {
  const numbered = defineProvider({ id: 'numbered', name: 'Numbered', auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.test/authorize',
    tokenUrl: 'https://auth.test/token' }], http: { baseUrl: 'https://api.auth.test' }, errors: { detail: 'error.code' },
    revoke: { request: { method: 'POST', path: '/revoke' }, goneErrors: ['2001'] } });
  const answer = (code: number) => fakeFetch([{ url: 'https://api.auth.test/revoke', respond: () => Response.json({ error: { code } }, { status: 400 }) }]);
  await expect(revokeGrant(numbered, { accessToken: 'a', fetch: answer(2001).fetch })).resolves.toBeUndefined();
  await expect(revokeGrant(numbered, { accessToken: 'a', fetch: answer(2002).fetch })).rejects.toMatchObject({ code: 'request_failed', detail: '2002' });
});

test('revokeGrant: an entry with no revoke (Microsoft) sends nothing', async () => {
  const none = fakeFetch([]);
  await expect(revokeGrant(microsoft, { accessToken: 'a', refreshToken: 'r', client, fetch: none.fetch })).resolves.toBeUndefined();
  expect(none.calls).toHaveLength(0);
});

test("a token answer refused inside a 200 is read through the entry's own condition and code", async () => {
  await expect(exchangeCode(slack, client, { ...exchange, fetch: endpoint({ ok: false, error: 'invalid_code' }).fetch, values: { domain: 'slack.com' } }))
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

/** The client in the body (no `clientAuth`), an RFC 7009 revoke, no PKCE. */
const bodied = defineProvider({ id: 'bodied', name: 'Bodied', auth: [{ kind: 'oauth2', authorizeUrl: 'https://bodied.test/authorize',
  tokenUrl: 'https://bodied.test/token', pkce: false }], scopes: { default: [] },
  revoke: { url: 'https://bodied.test/revoke', token: ['access'] }, http: { baseUrl: 'https://api.bodied.test' } });

test('a client in the body: the exchange, the refresh and the revoke each send its id and secret in the body, no Basic', async () => {
  const fake = endpoint(token);
  await exchangeCode(bodied, client, { ...exchange, fetch: fake.fetch });
  await refreshGrant(bodied, client, 'r', { fetch: fake.fetch });
  await revokeGrant(bodied, { accessToken: 'a', client, fetch: fake.fetch });
  expect(fake.calls.map(call => call.headers.authorization)).toEqual(Array(3).fill(undefined));
  expect(fake.calls.map(call => Object.fromEntries(new URLSearchParams(call.body)))).toEqual([
    { code: exchange.code, redirect_uri: exchange.redirectUri, grant_type: 'authorization_code', client_id: 'id', client_secret: client.clientSecret },
    { refresh_token: 'r', grant_type: 'refresh_token', client_id: 'id', client_secret: client.clientSecret },
    { token: 'a', client_id: 'id', client_secret: client.clientSecret },
  ]);
});

test("no error detail echoes the client's Basic value, even from a request that sent its client in the body", async () => {
  // `id:abcdef` encodes to base64 without padding, so an echo of it would pass the detail pattern.
  const sent = Buffer.from('id:abcdef').toString('base64');
  const echoing = { clientId: 'id', clientSecret: 'abcdef' };
  const echo = endpoint({ error: sent }, 400);
  for (const run of [
    () => exchangeCode(bodied, echoing, { ...exchange, fetch: echo.fetch }),
    () => refreshGrant(bodied, echoing, 'r', { fetch: echo.fetch }),
    () => revokeGrant(bodied, { accessToken: 'a', client: echoing, fetch: echo.fetch }),
  ]) await expect(run()).rejects.toMatchObject({ code: 'request_failed', detail: null });
  expect(echo.calls.map(call => call.headers.authorization)).toEqual(Array(3).fill(undefined));
});

/** A public client (RFC 6749 §2.1): its id in the body, no secret, PKCE on (Firecrawl's shape). */
const publicClient = defineProvider({ id: 'publicclient', name: 'Public', auth: [{ kind: 'oauth2', authorizeUrl: 'https://public.test/authorize',
  tokenUrl: 'https://public.test/token', clientAuth: 'none' }], scopes: { default: [] },
  revoke: { url: 'https://public.test/revoke', token: ['refresh'] }, http: { baseUrl: 'https://api.public.test' } });

test("clientAuth 'none': the exchange, the refresh and the revoke send the client's id, and no secret or authorization", async () => {
  const fake = endpoint(token);
  await exchangeCode(publicClient, { clientId: 'id' }, { ...exchange, codeVerifier: 'v', fetch: fake.fetch });
  await refreshGrant(publicClient, { clientId: 'id' }, 'r', { fetch: fake.fetch });
  await revokeGrant(publicClient, { refreshToken: 'r', client: { clientId: 'id' }, fetch: fake.fetch });
  expect(fake.calls.map(call => call.headers.authorization)).toEqual([undefined, undefined, undefined]);
  expect(fake.calls.map(call => Object.fromEntries(new URLSearchParams(call.body)))).toEqual([
    { code: exchange.code, redirect_uri: exchange.redirectUri, code_verifier: 'v', grant_type: 'authorization_code', client_id: 'id' },
    { refresh_token: 'r', grant_type: 'refresh_token', client_id: 'id' },
    { token: 'r', client_id: 'id' },
  ]);
});

test("clientAuth 'none': a secret an untyped caller passes anyway is never sent", async () => {
  const untyped = client as unknown as { clientId: string };
  const fake = endpoint(token);
  await exchangeCode(publicClient, untyped, { ...exchange, codeVerifier: 'v', fetch: fake.fetch });
  await refreshGrant(publicClient, untyped, 'r', { fetch: fake.fetch });
  await revokeGrant(publicClient, { refreshToken: 'r', client: untyped, fetch: fake.fetch });
  // Basic would carry it base64-encoded: no call has an `authorization` header, and no body holds it raw.
  expect(fake.calls.map(call => call.headers.authorization)).toEqual([undefined, undefined, undefined]);
  for (const call of fake.calls) expect(JSON.stringify(call)).not.toContain(client.clientSecret);
});

test("clientAuth 'none': an untyped caller's secret that is no string still fails as the provider's refusal", async () => {
  const odd = { clientId: 'id', clientSecret: 123 } as unknown as { clientId: string };
  const refused = endpoint({ error: 'invalid_request' }, 400);
  await expect(refreshGrant(publicClient, odd, 'old-refresh', { fetch: refused.fetch })).rejects.toMatchObject({ code: 'request_failed', detail: 'invalid_request' });
  expect(refused.calls.map(call => call.body)).toEqual(['refresh_token=old-refresh&grant_type=refresh_token&client_id=id']);
});

test("clientAuth 'none' beside `pkce: false` is refused before anything is sent: a public client needs PKCE", async () => {
  const bare = defineProvider({ ...publicClient, auth: [{ ...publicClient.auth[0], pkce: false }] });
  const fake = endpoint(token);
  expect(() => authorizeUrl(bare, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state: 's' })).toThrow('pkce_required: publicclient');
  await expect(exchangeCode(bare, { clientId: 'id' }, { ...exchange, fetch: fake.fetch })).rejects.toThrow('pkce_required: publicclient');
  await expect(refreshGrant(bare, { clientId: 'id' }, 'r', { fetch: fake.fetch })).rejects.toThrow('pkce_required: publicclient');
  await expect(revokeGrant(bare, { refreshToken: 'r', client: { clientId: 'id' }, fetch: fake.fetch })).rejects.toThrow('pkce_required: publicclient');
  // A revoke sent as a request reaches no token URL, and is refused all the same.
  const byRequest = defineProvider({ ...bare, revoke: { request: { method: 'POST', path: '/revoke' } } });
  await expect(revokeGrant(byRequest, { accessToken: 'a', fetch: fake.fetch })).rejects.toThrow('pkce_required: publicclient');
  expect(fake.calls).toEqual([]);
});

/** A token endpoint that takes JSON (Atlassian's shape), the client id and secret in the body, no PKCE. */
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

test('json with Basic client authentication: the credential is the header, and the JSON body holds no client secret', async () => {
  const basicJson = defineProvider({ ...jsonBodied, id: 'basicjson', auth: [{ ...jsonBodied.auth[0], clientAuth: 'basic' }] });
  const fake = endpoint(token);
  await exchangeCode(basicJson, client, { ...exchange, fetch: fake.fetch });
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('id:private%2Dclient%2Dsecret').toString('base64')}`);
  expect(fake.calls[0]?.headers['content-type']).toBe('application/json');
  const body = JSON.parse(fake.calls[0]?.body ?? '') as Record<string, unknown>;
  expect(body).toMatchObject({ grant_type: 'authorization_code', code: exchange.code, redirect_uri: exchange.redirectUri });
  expect(body).not.toHaveProperty('client_secret');
  expect(fake.calls[0]?.body).not.toContain(client.clientSecret);
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
  // An entry that reads the token answer's `user_id_string` gets it in `extras`.
  const { grant, extras } = await exchangeCode({ ...figma, identify: { id: 'tokenAnswer.user_id_string' } }, client,
    { ...exchange, codeVerifier: 'v'.repeat(43), fetch: fake.fetch });
  expect(grant.refreshToken).toBe('r');
  expect(extras).toEqual({ user_id_string: '1234567890123456789' });
  expect(await refreshGrant(figma, client, 'r', { fetch: fake.fetch })).toMatchObject({ accessToken: 'new', refreshToken: 'r' });
  expect(fake.calls.map(call => call.url)).toEqual(['https://api.figma.com/v1/oauth/token', 'https://api.figma.com/v1/oauth/refresh']);
  expect(fake.calls.map(call => call.headers['content-type'])).toEqual(Array(2).fill('application/x-www-form-urlencoded;charset=UTF-8'));
  expect(fake.calls.map(call => call.headers.authorization)).toEqual(Array(2).fill(`Basic ${Buffer.from('id:private%2Dclient%2Dsecret').toString('base64')}`));
});

// The `token` kind: one declared request gives a short-lived token.
const zoomSecret = { clientSecret: 'zoom-client-secret' };
const zoomValues = { accountId: 'acc', clientId: 'cid' };
const zoomInput = (fetch: typeof globalThis.fetch, values = zoomValues) => ({ secret: zoomSecret, values, fetch });
/** A token endpoint answering each request with the next token, `t1`, `t2`, …, valid an hour. */
function tokens(url = 'https://zoom.us/oauth/token') {
  let n = 0;
  return fakeFetch([{ url, respond: () => Response.json({ access_token: `t${String(++n)}`, token_type: 'bearer', expires_in: 3600 }) }]);
}

test("Zoom: the token request is the documented POST, Basic client authentication and a form body", async () => {
  const fake = endpoint({ access_token: 'at', token_type: 'bearer', expires_in: 3600 });
  expect(await requestToken(zoom, zoomInput(fake.fetch))).toMatchObject({ token: 'at' });
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]).toMatchObject({ method: 'POST', url: 'https://zoom.us/oauth/token',
    body: 'grant_type=account_credentials&account_id=acc' });
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('cid:zoom-client-secret').toString('base64')}`);
  expect(fake.calls[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
});

test('tokenSource keeps the token until 60 s before it expires, and requests another when it is passed back', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  const fake = tokens();
  const source = tokenSource(zoom, zoomInput(fake.fetch));
  expect(await source()).toBe('t1');
  vi.setSystemTime(new Date('2026-11-26T12:58:59Z')); // 3539 s: 61 s left
  expect(await source()).toBe('t1');
  expect(fake.calls).toHaveLength(1);
  vi.setSystemTime(new Date('2026-11-26T12:59:01Z')); // 3541 s: 59 s left
  expect(await source()).toBe('t2');
  expect(await source('t2')).toBe('t3');
  // A token refused earlier is no reason to request again: the one kept is newer.
  expect(await source('t1')).toBe('t3');
  expect(fake.calls).toHaveLength(3);
});

test('tokenSource: concurrent calls share one request, and a failed request is not kept', async () => {
  const fake = tokens();
  const source = tokenSource(zoom, zoomInput(fake.fetch));
  expect(await Promise.all([source(), source(), source()])).toEqual(['t1', 't1', 't1']);
  expect(await Promise.all([source('t1'), source('t1')])).toEqual(['t2', 't2']);
  expect(fake.calls).toHaveLength(2);
  let fail = true;
  const flaky = fakeFetch([{ url: /https:/, respond: () => (fail ? new Response('', { status: 503 })
    : Response.json({ access_token: 'ok' })) }]);
  const retried = tokenSource(zoom, zoomInput(flaky.fetch));
  await expect(Promise.all([retried(), retried()])).rejects.toMatchObject({ code: 'unavailable' });
  expect(flaky.calls).toHaveLength(1);
  fail = false;
  expect(await retried()).toBe('ok');
  expect(flaky.calls).toHaveLength(2);
});

test('a token request never follows a redirect', async () => {
  const fake = fakeFetch([{ url: 'https://zoom.us/oauth/token', respond: () => new Response(null, { status: 302, headers: { location: 'https://evil.test/steal' } }) },
    { url: /evil/, respond: () => Response.json({ access_token: 'stolen' }) }]);
  await expect(requestToken(zoom, zoomInput(fake.fetch))).rejects.toMatchObject({ name: 'ProviderHttpError', code: 'request_failed', status: 302 });
  expect(fake.calls.map(call => call.url)).toEqual(['https://zoom.us/oauth/token']);
});

test('a refused token request is rejected, and its detail never holds a secret sent', async () => {
  await expect(requestToken(zoom, zoomInput(endpoint({ error: 'invalid_client' }, 400).fetch)))
    .rejects.toMatchObject({ code: 'rejected', status: 400, detail: 'invalid_client' });
  await expect(requestToken(zoom, zoomInput(endpoint({ error: 'nope' }, 401).fetch)))
    .rejects.toMatchObject({ code: 'rejected', status: 401 });
  const basic = Buffer.from('cid:zoom-client-secret').toString('base64');
  for (const echoed of [zoomSecret.clientSecret, basic]) {
    await expect(requestToken(zoom, zoomInput(endpoint({ error: echoed }, 400).fetch)))
      .rejects.toMatchObject({ code: 'rejected', detail: null });
  }
  // Any other answer is classified as usual, and its detail is redacted too.
  await expect(requestToken(zoom, zoomInput(endpoint({ error: zoomSecret.clientSecret }, 503).fetch)))
    .rejects.toMatchObject({ code: 'unavailable', status: 503, detail: null });
});

test('a body value filled from a secret field is never a detail', async () => {
  const session = defineProvider({ id: 'session', name: 'Session', fields: [{ name: 'user', title: 'User' },
    { name: 'password', title: 'Password', secret: true }],
  auth: [{ kind: 'token', request: { url: 'https://session.test/login', json: true, body: { user: '{user}', password: 'p-{password}' } } }],
  http: { baseUrl: 'https://session.test/api' }, errors: { detail: 'error' } });
  const input = { secret: { password: 'hunter2' }, values: { user: 'u' } };
  for (const status of [400, 409]) {
    await expect(requestToken(session, { ...input, fetch: endpoint({ error: 'p-hunter2' }, status).fetch }))
      .rejects.toMatchObject({ status, detail: null });
  }
});

test.each([[{}], [{ access_token: '' }], [{ access_token: 7 }]])('a 2xx without a token (%j) is invalid_response', async body => {
  await expect(requestToken(zoom, zoomInput(endpoint(body).fetch)))
    .rejects.toMatchObject({ code: 'invalid_response', status: 200, detail: 'missing_fields' });
});

test.each([-5, '3600', 0, Number.POSITIVE_INFINITY])('expires_in %j is no expiry: the token is kept until refused', async expiresIn => {
  const fake = endpoint({ access_token: 'at', expires_in: expiresIn });
  expect(await requestToken(zoom, zoomInput(fake.fetch))).toMatchObject({ token: 'at', expiresAt: null });
});

test('a template that names nothing, or a blank value, is template_missing before anything is sent', async () => {
  const fake = endpoint({ access_token: 'at' });
  const nope = defineProvider({ ...zoom, id: 'nope', auth: [{ kind: 'token', request: { ...zoom.auth[0].request, body: { a: '{nope}' } } }] });
  await expect(requestToken(nope, zoomInput(fake.fetch))).rejects.toThrow('template_missing: nope {nope}');
  await expect(requestToken(zoom, zoomInput(fake.fetch, { ...zoomValues, accountId: '  ' }))).rejects.toThrow('template_missing: zoom {accountId}');
  // A plain field is never read from the secret, nor a secret field from the values.
  await expect(requestToken(zoom, { secret: { ...zoomSecret, accountId: 'acc' }, values: { clientId: 'cid' }, fetch: fake.fetch }))
    .rejects.toThrow('template_missing: zoom {accountId}');
  await expect(requestToken(zoom, { secret: {}, values: { ...zoomValues, clientSecret: 'x' }, fetch: fake.fetch }))
    .rejects.toThrow('template_missing: zoom {clientSecret}');
  expect(fake.calls).toHaveLength(0);
});

test('json and a token path: the body is the filled flat object as JSON, and the token has no expiry', async () => {
  const session = defineProvider({ id: 'session', name: 'Session', fields: [{ name: 'username', title: 'Email' },
    { name: 'password', title: 'Password', secret: true }],
  auth: [{ kind: 'token', send: { header: 'x-session' }, request: { url: 'https://session.test/api/session', json: true, token: 'id',
    body: { username: '{username}', password: '{password}' } } }],
  http: { baseUrl: 'https://session.test/api', headers: { accept: 'application/json' } } });
  const fake = endpoint({ id: 's' });
  expect(await requestToken(session, { secret: { password: 'p' }, values: { username: 'u@example.com' }, fetch: fake.fetch }))
    .toEqual({ token: 's', expiresAt: null, extras: {} });
  expect(JSON.parse(fake.calls[0]?.body ?? '') as unknown).toEqual({ username: 'u@example.com', password: 'p' });
  expect(fake.calls[0]?.headers).toMatchObject({ 'content-type': 'application/json', accept: 'application/json' });
  expect(fake.calls[0]?.headers.authorization).toBeUndefined();
});

test("client(zoom) with tokenSource: a 401 from the API requests a new token and sends the call once more", async () => {
  let n = 0;
  const fake = fakeFetch([
    { url: 'https://zoom.us/oauth/token', respond: () => Response.json({ access_token: `t${String(++n)}`, expires_in: 3600 }) },
    { url: 'https://api.zoom.us/v2/users/me', respond: request => (request.headers.get('authorization') === 'Bearer t1'
      ? Response.json({ code: 124 }, { status: 401 }) : Response.json({ id: 'me' })) },
  ]);
  const api = apiClient(zoom, { token: tokenSource(zoom, zoomInput(fake.fetch)), values: zoomValues, fetch: fake.fetch });
  expect(await api.json('/users/me')).toEqual({ id: 'me' });
  expect(fake.calls.map(call => [call.url, call.headers.authorization ?? null])).toEqual([
    ['https://zoom.us/oauth/token', `Basic ${Buffer.from('cid:zoom-client-secret').toString('base64')}`],
    ['https://api.zoom.us/v2/users/me', 'Bearer t1'],
    ['https://zoom.us/oauth/token', `Basic ${Buffer.from('cid:zoom-client-secret').toString('base64')}`],
    ['https://api.zoom.us/v2/users/me', 'Bearer t2'],
  ]);
});

test("a token entry's secret field never travels with a call, even when its send names it", async () => {
  const leaky = defineProvider({ ...zoom, id: 'leaky', auth: [{ ...zoom.auth[0], send: { basic: ['{clientId}', '{clientSecret}'] } }] });
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({}) }]);
  const api = apiClient(leaky, { token: () => Promise.resolve('at'), values: { ...zoomValues, clientSecret: zoomSecret.clientSecret }, fetch: fake.fetch });
  await expect(api.json('/users/me')).rejects.toThrow('template_missing: leaky {clientSecret}');
  expect(fake.calls).toHaveLength(0);
});

// Task 28's review: every URL the library fills or uses passes one check.
const tokenAt = (url: string, extra: object = {}) => defineProvider({ ...zoom, id: 'at', ...extra,
  fields: [...zoom.fields, { name: 'apiHost', title: 'Host' }],
  auth: [{ kind: 'token', request: { ...zoom.auth[0].request, url } }] });

test.each([['https://u:pw@zoom.us/oauth/token', {}], ['https://zoom.us:99999/oauth/token', {}], ['https://zo om.us/token', {}],
  ['http://zoom.us/oauth/token', {}], ['https://x:y@{apiHost}/token', { http: { baseUrl: 'https://{apiHost}', host: '*.k.test' } }]])(
  'a token URL %s is base_host_refused before any secret is read or sent', async (url, extra) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    let read = false;
    const secret = { get clientSecret() { read = true; return 's'; } };
    await expect(requestToken(tokenAt(url, extra), { secret, values: { ...zoomValues, apiHost: 'api.k.test' }, fetch }))
      .rejects.toThrow(new TypeError('base_host_refused: at'));
    expect(fetch).not.toHaveBeenCalled();
    expect(read).toBe(false);
  });

test("an app's own base that is not https is base_host_refused, as an entry's is", async () => {
  const fake = fakeFetch([{ url: /./, respond: () => Response.json({}) }]);
  await expect(apiClient(zoom, { token: 't', baseUrl: 'http://api.zoom.us/v2', fetch: fake.fetch }).json('/users/me'))
    .rejects.toThrow(new TypeError('base_host_refused: zoom'));
  expect(fake.calls).toHaveLength(0);
});

test('a token URL never fills a secret field from the values', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const leaky = tokenAt('https://zoom.us/{clientSecret}/token');
  await expect(requestToken(leaky, { secret: zoomSecret, values: { ...zoomValues, clientSecret: zoomSecret.clientSecret }, fetch }))
    .rejects.toThrow('template_missing: at {clientSecret}');
  expect(fetch).not.toHaveBeenCalled();
});

test('a token that lives 60 seconds or less is used by the caller that requested it', async () => {
  const fake = fakeFetch([{ url: /https:/, respond: () => Response.json({ access_token: 'short', expires_in: 30 }) }]);
  const source = tokenSource(zoom, zoomInput(fake.fetch));
  expect(await source()).toBe('short');
  expect(fake.calls).toHaveLength(1);
  // Concurrent callers that joined that request get it too.
  const again = tokenSource(zoom, zoomInput(fake.fetch));
  expect(await Promise.all([again(), again()])).toEqual(['short', 'short']);
  expect(fake.calls).toHaveLength(2);
});

/** An OAuth 2 entry whose token, refresh and revoke URLs can each be replaced. */
const urls = (part: { tokenUrl?: string; refreshUrl?: string; revoke?: string }) => defineProvider({ id: 'userinfo', name: 'Userinfo',
  http: { baseUrl: 'https://api.auth.test' }, revoke: { url: part.revoke ?? 'https://auth.test/revoke', token: ['refresh'] },
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.test/authorize', tokenUrl: part.tokenUrl ?? 'https://auth.test/token',
    pkce: false, ...(part.refreshUrl ? { refreshUrl: part.refreshUrl } : {}) }] });
test.each([
  ['token', (fetch: typeof globalThis.fetch) => exchangeCode(urls({ tokenUrl: 'https://u:p@auth.test/token' }), client, { ...exchange, fetch })],
  ['refresh', (fetch: typeof globalThis.fetch) => refreshGrant(urls({ refreshUrl: 'https://u:p@auth.test/refresh' }), client, 'r', { fetch })],
  ['revoke', (fetch: typeof globalThis.fetch) => revokeGrant(urls({ revoke: 'https://u:p@auth.test/revoke' }), { refreshToken: 'r', client, fetch })],
])('an OAuth 2 %s URL with a username or password is base_host_refused, with nothing sent', async (_, run) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(run(fetch)).rejects.toThrow(new TypeError('base_host_refused: userinfo'));
  expect(fetch).not.toHaveBeenCalled();
});

test("an app's getter-backed secret is read once: the value redacted is the value sent", async () => {
  let reads = 0;
  const secret = { get clientSecret() { reads += 1; return `secret${String(reads)}`; } };
  const fake = endpoint({ error: 'secret1' }, 400);
  await expect(requestToken(zoom, { secret, values: zoomValues, fetch: fake.fetch })).rejects.toMatchObject({ code: 'rejected', detail: null });
  expect(reads).toBe(1);
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('cid:secret1').toString('base64')}`);
});

test('the plain values are read once and own ones only: a getter runs once, an inherited value is missing', async () => {
  let reads = 0;
  const values = { accountId: 'acc', get clientId() { reads += 1; return reads === 1 ? 'a' : 'b'; } };
  const fake = endpoint({ access_token: 'at' });
  await requestToken(zoom, { secret: zoomSecret, values, fetch: fake.fetch });
  expect(reads).toBe(1);
  expect(fake.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('a:zoom-client-secret').toString('base64')}`);
  const inherited = Object.assign(Object.create({ clientId: 'proto' }) as Record<string, string>, { accountId: 'acc' });
  await expect(requestToken(zoom, { secret: zoomSecret, values: inherited, fetch: fake.fetch })).rejects.toThrow('template_missing: zoom {clientId}');
  expect(fake.calls).toHaveLength(1);
});

test.each([['invalid_client', 'invalid_client'], ['unsupported_grant_type', 'unsupported_grant_type'], ['sess_abc123', null]])(
  'a refused token request keeps only an RFC 6749 code as its detail: %s', async (error, detail) => {
    await expect(requestToken(zoom, zoomInput(endpoint({ error }, 400).fetch))).rejects.toMatchObject({ code: 'rejected', status: 400, detail });
  });

test('an allowed code that echoes an entered secret is no detail', async () => {
  await expect(requestToken(zoom, { secret: { clientSecret: 'invalid_client' }, values: zoomValues,
    fetch: endpoint({ error: 'invalid_client' }, 401).fetch })).rejects.toMatchObject({ code: 'rejected', detail: null });
});

/** An OAuth 2 provider on the person's own server (Mattermost's shape): every URL and the base on the host typed. */
const own = defineProvider({ id: 'own', name: 'Own', fields: [{ name: 'host', title: 'Host' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/oauth/authorize', tokenUrl: 'https://{host}/oauth/access_token' }],
  scopes: { default: [] }, revoke: { url: 'https://{host}/oauth/revoke', token: ['refresh'] },
  http: { baseUrl: 'https://{host}/api/v4', host: '*' } });
const chat = { host: 'chat.k.test' };
const verifier = 'v'.repeat(43);

test("an OAuth 2 entry's exchange, refresh and revoke go to the host its values name", async () => {
  const fake = endpoint(token);
  await exchangeCode(own, client, { ...exchange, codeVerifier: verifier, values: chat, fetch: fake.fetch });
  await refreshGrant(own, client, 'r', { values: chat, fetch: fake.fetch });
  await revokeGrant(own, { refreshToken: 'r', client, values: chat, fetch: fake.fetch });
  expect(fake.calls.map(call => call.url)).toEqual(['https://chat.k.test/oauth/access_token', 'https://chat.k.test/oauth/access_token',
    'https://chat.k.test/oauth/revoke']);
});

test('a refresh or a revoke without the values its URLs take is template_missing, nothing sent', async () => {
  const fake = endpoint(token);
  // @ts-expect-error the types refuse it too: the host is required
  await expect(refreshGrant(own, client, 'r', { fetch: fake.fetch })).rejects.toThrow(new TypeError('template_missing: own {host}'));
  // @ts-expect-error the host is required
  await expect(revokeGrant(own, { refreshToken: 'r', client, fetch: fake.fetch })).rejects.toThrow(new TypeError('template_missing: own {host}'));
  expect(fake.calls).toEqual([]);
});

test('an OAuth 2 URL is filled from plain fields only: a secret field or a saved value is template_missing whatever the values hold', async () => {
  const fake = endpoint(token);
  const secretUrl = defineProvider({ ...own, fields: [...own.fields, { name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ ...own.auth[0], authorizeUrl: 'https://{host}/{apiKey}/authorize' }] });
  expect(() => authorizeUrl(secretUrl, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state: 's', codeChallenge: 'c',
    // @ts-expect-error the types refuse it too: a secret field is no plain value
    values: { ...chat, apiKey: 'private-key' } })).toThrow(new TypeError('template_missing: own {apiKey}'));
  const savedUrl = defineProvider({ ...own, save: { site: 'site' }, auth: [{ ...own.auth[0], tokenUrl: 'https://{host}/{site}/token' }] });
  await expect(refreshGrant(savedUrl, client, 'r', { values: { ...chat, site: 's1' }, fetch: fake.fetch }))
    .rejects.toThrow(new TypeError('template_missing: own {site}'));
  expect(fake.calls).toEqual([]);
});

test('a token endpoint that answers a redirect to another host is not followed: the exchange, the refresh and the revoke fail', async () => {
  const sent: string[] = [];
  // Follows a redirect as fetch does unless the request says `manual`, which is what the engine must send.
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push(request.url);
    if (request.url.startsWith('https://evil.test/')) return Response.json(token);
    return request.redirect === 'manual' ? new Response(null, { status: 302, headers: { location: 'https://evil.test/token' } })
      : fetch('https://evil.test/token', { method: request.method, headers: request.headers, body: await request.text() });
  };
  await expect(exchangeCode(own, client, { ...exchange, codeVerifier: verifier, values: chat, fetch })).rejects.toMatchObject({ code: 'request_failed', status: 302 });
  await expect(refreshGrant(own, client, 'r', { values: chat, fetch })).rejects.toMatchObject({ code: 'request_failed', status: 302 });
  await expect(revokeGrant(own, { refreshToken: 'r', client, values: chat, fetch })).rejects.toMatchObject({ code: 'request_failed', status: 302 });
  expect(sent.every(url => url.startsWith('https://chat.k.test/'))).toBe(true);
  expect(sent).toHaveLength(3);
});

/** Where a token issued on a typed host could go elsewhere: each shape `hostSplit` refuses. */
const split = (auth: { authorizeUrl: string; tokenUrl: string }, http: { baseUrl: string; bases?: Record<string, string> }) => defineProvider({
  ...own, auth: [{ kind: 'oauth2', ...auth }], revoke: { url: auth.tokenUrl.replace(/token$/u, 'revoke'), token: ['refresh'] },
  http: { ...http, host: '*' } });
test.each([
  ['fixed cloud URLs with a typed base', split({ authorizeUrl: 'https://k.test/authorize', tokenUrl: 'https://k.test/token' }, { baseUrl: 'https://{host}/api' })],
  ['a typed token URL with a fixed base', split({ authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://{host}/token' }, { baseUrl: 'https://api.k.test' })],
  ['a typed authorize URL with a fixed token URL', split({ authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://k.test/token' }, { baseUrl: 'https://{host}/api' })],
  ['a typed host beside an `http.bases` value', split({ authorizeUrl: 'https://{host}/authorize', tokenUrl: 'https://{host}/token' },
    { baseUrl: 'https://{host}/api', bases: { cloud: 'https://cloud.k.test' } })],
])('%s is host_split at start, exchange, refresh and revoke, nothing sent', async (_, entry) => {
  const fake = endpoint(token);
  const refused = new TypeError('host_split: own');
  expect(() => authorizeUrl(entry, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state: 's', codeChallenge: 'c', values: chat }))
    .toThrow(refused);
  await expect(exchangeCode(entry, client, { ...exchange, codeVerifier: verifier, values: chat, fetch: fake.fetch })).rejects.toThrow(refused);
  await expect(refreshGrant(entry, client, 'r', { values: chat, fetch: fake.fetch })).rejects.toThrow(refused);
  await expect(revokeGrant(entry, { refreshToken: 'r', client, values: chat, fetch: fake.fetch })).rejects.toThrow(refused);
  expect(fake.calls).toEqual([]);
});

const requested = defineProvider({ ...own, revoke: { request: { method: 'POST', path: '/oauth/revoke' } } });

test('a request revoke on a typed host goes to the base its values fill', async () => {
  const fake = fakeFetch([{ url: /https:\/\//u, respond: () => Response.json({}) }]);
  await revokeGrant(requested, { accessToken: 'a', values: chat, fetch: fake.fetch });
  expect(fake.calls.map(call => [call.method, call.url])).toEqual([['POST', 'https://chat.k.test/api/v4/oauth/revoke']]);
});

test('a request revoke beside fixed cloud OAuth 2 URLs and a typed base is host_split, nothing sent', async () => {
  const split = defineProvider({ ...requested, auth: [{ kind: 'oauth2', authorizeUrl: 'https://k.test/authorize', tokenUrl: 'https://k.test/token' }] });
  const fake = fakeFetch([{ url: /https:\/\//u, respond: () => Response.json({}) }]);
  await expect(revokeGrant(split, { accessToken: 'a', values: { host: 'evil.k.test' }, fetch: fake.fetch }))
    .rejects.toThrow(new TypeError('host_split: own'));
  expect(fake.calls).toEqual([]);
});

/** Wrike's shape: fixed sign-in URLs, the base and the refresh on the host the token answer names. */
const named = defineProvider({ id: 'named', name: 'Named', scopes: { default: [] }, save: { host: 'tokenAnswer.host' },
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.named.test/authorize', tokenUrl: 'https://login.named.test/token',
    refreshUrl: 'https://{host}/token', pkce: false }],
  revoke: { request: { method: 'POST', path: '/revoke' } }, http: { baseUrl: 'https://{host}/api', host: '*.named.test' } });

test("a refresh goes to the host the connection keeps, and a refresh answer's host is not read", async () => {
  const fake = endpoint({ ...token, host: 'evil.test' });
  expect(await refreshGrant(named, client, 'r', { values: { host: 'a.named.test' }, fetch: fake.fetch })).toMatchObject({ accessToken: 'a' });
  await refreshGrant(named, client, 'r', { values: { host: 'https://a.named.test/' }, fetch: fake.fetch });
  expect(fake.calls.map(call => call.url)).toEqual(['https://a.named.test/token', 'https://a.named.test/token']);
});

test.each([[{}, 'template_missing: named {host}'], [{ host: '' }, 'template_missing: named {host}'], [{ host: 'evil.test' }, 'base_host_refused: named'],
  [{ host: '127.0.0.1' }, 'base_host_refused: named'], [{ host: 'https://a.named.test:8443' }, 'base_value_invalid: named {host}'],
  [{ host: 'a.named.test@evil.test' }, 'base_value_invalid: named {host}'], [{ host: { toString: (): string => 'a.named.test' } }, 'template_missing: named {host}']])(
  'a refresh or a request revoke with the values %j is refused before its token is sent, nothing sent', async (values, message) => {
    const fake = endpoint(token);
    await expect(refreshGrant(named, client, 'private-refresh', { values, fetch: fake.fetch })).rejects.toThrow(new TypeError(message));
    await expect(revokeGrant(named, { accessToken: 'private-access', values, fetch: fake.fetch })).rejects.toThrow(new TypeError(message));
    expect(fake.calls).toEqual([]);
  });

test.each([['authorizeUrl', 'https://{host}/authorize'], ['tokenUrl', 'https://{host}/token']])(
  'a named host in the %s is template_missing at start and exchange, nothing sent: no token answer exists yet', async (key, url) => {
    const early: Entry = defineProvider({ ...named, auth: [{ ...named.auth[0], [key]: url }] });
    const fake = endpoint({ ...token, host: 'a.named.test' });
    const input = { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state: 's', values: { host: 'a.named.test' } };
    expect(() => authorizeUrl(early, input)).toThrow(new TypeError('template_missing: named {host}'));
    await expect(exchangeCode(early, client, { ...exchange, values: { host: 'a.named.test' }, fetch: fake.fetch }))
      .rejects.toThrow(new TypeError('template_missing: named {host}'));
    expect(fake.calls).toEqual([]);
  });

/** A client whose secret answers another value on each read, as a getter may. */
const shifting = () => {
  const secrets = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx'];
  let reads = 0;
  return { client: { clientId: 'id', get clientSecret() { return secrets[reads++ % secrets.length] ?? ''; } }, reads: () => reads };
};
/** A token endpoint that answers 400 with the client's credential it was sent, its Basic value or its body secret. */
const echoing = () => fakeFetch([{ url: /https:\/\//, respond: async (sent: Request) => Response.json({ error: sent.headers.get('authorization')
  ?.slice('Basic '.length) ?? (JSON.parse(await sent.text()) as { client_secret?: string }).client_secret }, { status: 400 }) }]);

test.each([['basic', pkced], ['post', jsonBodied]] as const)('a %s secret is read once: the value sent is the value no error detail echoes', async (_, entry) => {
  const { client: changing, reads } = shifting();
  const echo = echoing();
  await expect(refreshGrant(entry, changing, 'old-refresh', { fetch: echo.fetch })).rejects.toMatchObject({ code: 'request_failed', detail: null });
  expect(reads()).toBe(1);
});

test("a public client's secret is never read", async () => {
  const { client: changing, reads } = shifting();
  await refreshGrant(publicClient, changing, 'old-refresh', { fetch: endpoint(token).fetch });
  expect(reads()).toBe(0);
});

test('the code and the verifier are read once: validated, sent and redacted as the same values', async () => {
  let verifierReads = 0;
  let codeReads = 0;
  const fake = endpoint(token);
  // Getters, never spread: a spread would read each once before the engine does.
  const input = { redirectUri: exchange.redirectUri, fetch: fake.fetch, get codeVerifier() { return verifierReads++ === 0 ? 'v'.repeat(43) : ''; },
    get code() { return codeReads++ === 0 ? 'first-code' : 'other-code'; } };
  await exchangeCode(publicClient, { clientId: 'id' }, input);
  expect(new URLSearchParams(fake.calls[0]?.body).get('code_verifier')).toBe('v'.repeat(43));
  expect([verifierReads, codeReads]).toEqual([1, 1]);
});

test("an entry's authorizeParams never replace the parameters the engine sends", () => {
  const own = { client_id: 'evil', redirect_uri: 'https://evil.test', state: 'x', scope: 'all', code_challenge: 'c', code_challenge_method: 'plain' };
  const overriding = defineProvider({ ...pkced, auth: [{ ...pkced.auth[0], authorizeParams: { response_type: 'code', ...own } }] });
  const url = authorizeUrl(overriding, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: ['read'], state: 's', codeChallenge: 'challenge' });
  expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'id', scope: 'read', redirect_uri: exchange.redirectUri, state: 's',
    code_challenge: 'challenge', code_challenge_method: 'S256', response_type: 'code' });
});

test("an entry's authorizeParams still replace a parameter its authorize URL carries", () => {
  const prompted = defineProvider({ ...pkced, auth: [{ ...pkced.auth[0], authorizeUrl: 'https://auth.test/authorize?prompt=none',
    authorizeParams: { prompt: 'consent' } }] });
  const url = authorizeUrl(prompted, { clientId: 'id', redirectUri: exchange.redirectUri, scopes: [], state: 's', codeChallenge: 'challenge' });
  expect(url.searchParams.getAll('prompt')).toEqual(['consent']);
});
