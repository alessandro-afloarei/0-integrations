import { expect, test } from 'vitest';
import {
  aircall, apollo, attio, breakcold, exa, fathom, firecrawl, fireflies, github, google, granola, hubspot, lusha, microsoft, notion, slack,
  unipile,
} from './providers.js';

const providers = [hubspot, slack, fireflies, granola, breakcold, unipile, firecrawl, exa, fathom, attio, aircall, notion, github,
  apollo, lusha, microsoft, google];

test("keeps the providers' timing and retry values", () => {
  const expected = [
    [30000, 250, 1, 10000, 1000], [15000, 0, 0, 0, 0], [30000, 0, 0, 0, 0],
    [30000, 200, 0, 0, 0], [30000, 0, 1, 60000, 0], [30000, 0, 3, 60000, 30000],
    [120000, 0, 3, 60000, 30000], [30000, 0, 3, 60000, 30000], [30000, 1000, 1, 60000, 5000],
    [30000, 100, 1, 10000, 1000], [30000, 500, 1, 60000, 60000], [30000, 350, 1, 60000, 1000], [30000, 250, 0, 0, 0],
    [30000, 1200, 1, 60000, 60000], [30000, 1500, 1, 60000, 60000], [30000, 0, 2, 30000, 5000], [30000, 0, 2, 30000, 5000],
  ];
  providers.forEach((provider, i) => {
    const { timeoutMs, minIntervalMs, retry: { limit, maxWaitMs, defaultWaitMs } } = provider;
    expect([timeoutMs, minIntervalMs, limit, maxWaitMs, defaultWaitMs]).toEqual(expected[i]);
  });
  expect(providers.map(p => [p.id, p.baseUrl, p.auth])).toEqual([
    ['hubspot', 'https://api.hubapi.com', undefined], ['slack', 'https://slack.com/api', undefined],
    ['fireflies', 'https://api.fireflies.ai/graphql', undefined], ['granola', 'https://public-api.granola.ai/v1', undefined],
    ['breakcold', 'https://rest.breakcold.com/api/v1', undefined], ['unipile', 'https://api.unipile.com/v2', { header: 'x-api-key', prefix: '' }],
    ['firecrawl', 'https://api.firecrawl.dev', undefined], ['exa', 'https://api.exa.ai', { header: 'x-api-key', prefix: '' }],
    ['fathom', 'https://api.fathom.ai/external/v1', { header: 'x-api-key', prefix: '' }],
    ['attio', 'https://api.attio.com/v2', undefined],
    ['aircall', 'https://api.aircall.io/v1', { header: 'authorization', prefix: 'Basic ' }],
    ['notion', 'https://api.notion.com/v1', undefined], ['github', 'https://api.github.com', undefined],
    ['apollo', 'https://api.apollo.io/api/v1', { header: 'x-api-key', prefix: '' }],
    ['lusha', 'https://api.lusha.com', { header: 'api_key', prefix: '' }],
    ['microsoft', 'https://graph.microsoft.com/v1.0', undefined], ['google', 'https://gmail.googleapis.com/gmail/v1', undefined],
  ]);
});

test('breakcold reads the wait its 429 body names', () => {
  expect(breakcold.retry.waitFromBody?.({ error: { retryAfterMs: 1500 } })).toBe(1500);
  for (const body of [{}, null, { error: { retryAfterMs: '1' } }]) {
    expect(breakcold.retry.waitFromBody?.(body)).toBeUndefined();
  }
});

test('every endpoint is https', () => {
  for (const p of providers) {
    for (const url of [p.baseUrl, p.oauth2?.authUrl, p.oauth2?.tokenUrl, p.oauth2?.revokeUrl]) {
      if (url !== undefined) expect(url.startsWith('https://')).toBe(true);
    }
  }
});

test('the OAuth providers keep their endpoints', () => {
  expect(hubspot.oauth2).toEqual({
    authUrl: 'https://app.hubspot.com/oauth/authorize', tokenUrl: 'https://api.hubapi.com/oauth/2026-03/token',
    revokeUrl: 'https://api.hubapi.com/oauth/2026-03/token/revoke', clientAuth: 'post', pkce: false, scopeDelimiter: ' ',
    extras: ['hub_id'],
  });
  expect(slack.oauth2).toEqual({
    authUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientAuth: 'post', pkce: false, scopeDelimiter: ',', tokenTypes: ['bot'], errorsInBody: true,
    revokedErrors: ['invalid_auth', 'token_revoked', 'account_inactive', 'invalid_refresh_token', 'invalid_grant', 'not_authed'],
    extras: ['team', 'bot_user_id'],
  });
  // A member's mailbox: PKCE, the code in the query; Microsoft has no revoke endpoint, Google returns a refresh token on every consent.
  expect(microsoft.oauth2).toEqual({
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientAuth: 'post', pkce: true, scopeDelimiter: ' ', authParams: { response_type: 'code', response_mode: 'query' },
  });
  expect(google.oauth2).toEqual({
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke', clientAuth: 'post', pkce: true, scopeDelimiter: ' ',
    authParams: { response_type: 'code', access_type: 'offline', prompt: 'consent' }, extras: ['scope'],
  });
});

test("Graph's and Google's error codes are read from their error objects, and Google's quota refusal is a rate limit", () => {
  expect(microsoft.errorDetail?.({ error: { code: 'InvalidAuthenticationToken', message: 'm' } })).toBe('InvalidAuthenticationToken');
  const quota = { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'userRateLimitExceeded' }] } };
  expect(google.errorDetail?.(quota)).toBe('userRateLimitExceeded');
  expect(google.rateLimit?.(403, new Headers(), quota)).toEqual({ waitMs: 60_000 });
  expect(google.rateLimit?.(403, new Headers(), { error: { errors: [{ reason: 'insufficientPermissions' }] } })).toBeUndefined();
  expect(google.errorDetail?.({ error: { status: 'UNAUTHENTICATED' } })).toBe('UNAUTHENTICATED');
});

test("breakcold reads its error code from Breakcold's error object", () => {
  expect(breakcold.errorDetail?.({ error: { code: 'organization_moved', message: 'm', requestId: 'r' } })).toBe('organization_moved');
  for (const body of [undefined, 'x', { error: 'usage_limit' }, { error: { code: 7 } }, { code: 'usage_limit' }]) {
    expect(breakcold.errorDetail?.(body)).toBeUndefined();
  }
});
