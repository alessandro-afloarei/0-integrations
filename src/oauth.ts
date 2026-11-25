import * as oauth from 'oauth4webapi';
import { ProviderHttpError } from './errors.js';
import { oauthRefusal } from './oauth-error.js';
import type { OAuth2Definition, ProviderDefinition } from './providers.js';

export type Grant = { accessToken: string; refreshToken: string | null; expiresAt: string | null };
export type OAuthClient = { clientId: string; clientSecret: string };

function definition(provider: ProviderDefinition): OAuth2Definition {
  if (!provider.oauth2) throw new TypeError('oauth_unsupported');
  return provider.oauth2;
}

export function authorizeUrl(provider: ProviderDefinition, input: {
  clientId: string; redirectUri: string; scopes: readonly string[]; state: string; codeChallenge?: string;
}): URL {
  const config = definition(provider);
  if (!input.state.trim()) throw new TypeError('state_required');
  if (config.pkce && !input.codeChallenge) throw new TypeError('code_challenge_required');
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('scope', input.scopes.join(config.scopeDelimiter));
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(config.authParams ?? {})) url.searchParams.set(key, value);
  return url;
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = oauth.generateRandomCodeVerifier();
  return { verifier, challenge: await oauth.calculatePKCECodeChallenge(verifier) };
}

function context(provider: ProviderDefinition, credentials: OAuthClient, fetch: typeof globalThis.fetch) {
  const config = definition(provider);
  const as: oauth.AuthorizationServer = { issuer: new URL(config.tokenUrl).origin, token_endpoint: config.tokenUrl,
    ...(config.revokeUrl ? { revocation_endpoint: config.revokeUrl } : {}) };
  return {
    config, as, client: { client_id: credentials.clientId },
    auth: config.clientAuth === 'post' ? oauth.ClientSecretPost(credentials.clientSecret) : oauth.ClientSecretBasic(credentials.clientSecret),
    options: { [oauth.customFetch]: fetch, signal: AbortSignal.timeout(provider.timeoutMs) },
    processing: { recognizedTokenTypes: Object.fromEntries((config.tokenTypes ?? []).map(type => [type.toLowerCase(), () => undefined])) },
  };
}

async function send(work: () => Promise<Response>, config: OAuth2Definition, secrets: readonly string[]): Promise<Response> {
  let response: Response;
  try {
    response = await work();
  } catch {
    throw new ProviderHttpError('unavailable', null);
  }
  if (response.status >= 500) throw new ProviderHttpError('unavailable', response.status);
  if (config.errorsInBody && response.status === 200) {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      throw new ProviderHttpError('invalid_response', response.status);
    }
    if (typeof body === 'object' && body !== null && 'ok' in body && body.ok === false) {
      const code = 'error' in body && typeof body.error === 'string' ? body.error : '';
      throw oauthRefusal(code, config.revokedErrors, response.status, secrets);
    }
  }
  return response;
}

function processingError(error: unknown, config: OAuth2Definition, status: number, secrets: readonly string[]): Error {
  if (error instanceof oauth.ResponseBodyError) return oauthRefusal(error.error, config.revokedErrors, status, secrets);
  return new ProviderHttpError(status >= 200 && status < 300 ? 'invalid_response' : 'request_failed', status);
}

function grant(answer: oauth.TokenEndpointResponse, fallback: string | null): Grant {
  return { accessToken: answer.access_token, refreshToken: answer.refresh_token ?? fallback,
    expiresAt: answer.expires_in === undefined ? null : new Date(Date.now() + answer.expires_in * 1000).toISOString() };
}

export async function exchangeCode(provider: ProviderDefinition, client: OAuthClient, input: {
  code: string; redirectUri: string; codeVerifier?: string; fetch: typeof fetch;
}): Promise<{ grant: Grant; extras: Record<string, unknown> }> {
  const c = context(provider, client, input.fetch);
  if (c.config.pkce && !input.codeVerifier?.trim()) throw new TypeError('code_verifier_required');
  const params = new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri });
  if (input.codeVerifier) params.set('code_verifier', input.codeVerifier);
  const secrets = [client.clientSecret, input.code, input.codeVerifier ?? ''];
  const response = await send(() => oauth.genericTokenEndpointRequest(c.as, c.client, c.auth, 'authorization_code', params, c.options), c.config, secrets);
  try {
    const answer = await oauth.processGenericTokenEndpointResponse(c.as, c.client, response, c.processing);
    const extras = Object.fromEntries((c.config.extras ?? []).flatMap(key => answer[key] === undefined ? [] : [[key, answer[key]]]));
    return { grant: grant(answer, null), extras };
  } catch (error) {
    throw processingError(error, c.config, response.status, secrets);
  }
}

export async function refreshGrant(provider: ProviderDefinition, client: OAuthClient, refreshToken: string,
  input: { fetch: typeof fetch }): Promise<Grant> {
  const c = context(provider, client, input.fetch);
  const secrets = [client.clientSecret, refreshToken];
  const response = await send(() => oauth.refreshTokenGrantRequest(c.as, c.client, c.auth, refreshToken, c.options), c.config, secrets);
  try {
    return grant(await oauth.processRefreshTokenResponse(c.as, c.client, response, c.processing), refreshToken);
  } catch (error) {
    throw processingError(error, c.config, response.status, secrets);
  }
}

export async function revokeGrant(provider: ProviderDefinition, client: OAuthClient, token: string,
  input: { fetch: typeof fetch }): Promise<void> {
  if (!definition(provider).revokeUrl) throw new TypeError('revoke_unsupported');
  const c = context(provider, client, input.fetch);
  const secrets = [client.clientSecret, token];
  const response = await send(() => oauth.revocationRequest(c.as, c.client, c.auth, token, c.options), c.config, secrets);
  // Any 2xx, as providers answer a revoke with 200 or 204; oauth4webapi accepts only 200.
  if (response.ok || response.status === 404) return;
  try {
    await oauth.processRevocationResponse(response);
  } catch (error) {
    if (error instanceof oauth.ResponseBodyError && error.error === 'invalid_grant') return;
    throw processingError(error, c.config, response.status, secrets);
  }
}
