import * as oauth from 'oauth4webapi';
import type { Auth, Entry } from './catalogue.js';
import { GrantRevoked, ProviderHttpError } from './errors.js';
import { sendCall } from './account.js';
import { createClient } from './http.js';
import { classify, codeOf, safeDetail } from './http-response.js';
import { holds, placeholders } from './rules.js';

export type Grant = { accessToken: string; refreshToken: string | null; expiresAt: string | null };
export type OAuthClient = { clientId: string; clientSecret: string };

function oauth2(entry: Entry): Extract<Auth, { kind: 'oauth2' }> {
  const [auth] = entry.auth;
  if (auth.kind !== 'oauth2') throw new TypeError('oauth_unsupported');
  return auth;
}

/** The token answer's top-level keys the entry reads (`identify`, `save`), then `scope` when every scope must be granted. */
function tokenAnswerKeys(entry: Entry): string[] {
  const reads = [entry.identify?.id, entry.identify?.name, ...Object.values(entry.save ?? {})].flat().filter(read => read !== undefined);
  const paths = reads.flatMap(read => (read.includes('{') ? placeholders(read) : [read]));
  const keys = paths.filter(path => path.startsWith('tokenAnswer.')).map(path => path.split('.')[1] ?? '');
  return [...new Set([...keys, ...(entry.scopes?.requireGranted ? ['scope'] : [])])];
}

export function authorizeUrl(entry: Entry, input: {
  clientId: string; redirectUri: string; scopes: readonly string[]; state: string; codeChallenge?: string;
}): URL {
  const config = oauth2(entry);
  if (!input.state.trim()) throw new TypeError('state_required');
  if (config.pkce !== false && !input.codeChallenge) throw new TypeError('code_challenge_required');
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('scope', input.scopes.join(config.scopeSeparator ?? ' '));
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(config.authorizeParams ?? {})) url.searchParams.set(key, value);
  return url;
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = oauth.generateRandomCodeVerifier();
  return { verifier, challenge: await oauth.calculatePKCECodeChallenge(verifier) };
}

function context(entry: Entry, credentials: OAuthClient, fetch: typeof globalThis.fetch) {
  const config = oauth2(entry);
  const as: oauth.AuthorizationServer = { issuer: new URL(config.tokenUrl).origin, token_endpoint: config.tokenUrl,
    ...(entry.revoke && 'url' in entry.revoke ? { revocation_endpoint: entry.revoke.url } : {}) };
  return {
    config, as, client: { client_id: credentials.clientId },
    auth: config.clientAuth === 'basic' ? oauth.ClientSecretBasic(credentials.clientSecret) : oauth.ClientSecretPost(credentials.clientSecret),
    options: { [oauth.customFetch]: fetch, signal: AbortSignal.timeout(entry.http.timeoutMs ?? 30_000) },
    processing: { recognizedTokenTypes: Object.fromEntries((config.tokenTypes ?? []).map(type => [type.toLowerCase(), () => undefined])) },
  };
}

type Context = ReturnType<typeof context>;

/** An OAuth refusal: `invalid_grant` or a revoked code is a gone grant; the detail never holds what the request sent. */
function refusal(code: string, entry: Entry, status: number, secrets: readonly string[]): Error {
  const detail = safeDetail(code, secrets);
  if (code === 'invalid_grant' || entry.errors?.revoked?.includes(code)) return new GrantRevoked(detail);
  return new ProviderHttpError('request_failed', status, detail);
}

async function send(c: Context, entry: Entry, secrets: readonly string[], work: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    response = await work();
  } catch {
    throw new ProviderHttpError('unavailable', null);
  }
  if (response.status >= 500) throw new ProviderHttpError('unavailable', response.status);
  const { failed } = c.config;
  if (failed !== undefined && response.status === 200) {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      throw new ProviderHttpError('invalid_response', response.status);
    }
    const code = codeOf(entry.errors, body);
    if (holds(failed, { status: response.status, headers: response.headers, body, code })) {
      throw refusal(code ?? '', entry, response.status, secrets);
    }
  }
  return response;
}

function processingError(error: unknown, entry: Entry, status: number, secrets: readonly string[]): Error {
  if (error instanceof oauth.ResponseBodyError) return refusal(error.error, entry, status, secrets);
  return new ProviderHttpError(status >= 200 && status < 300 ? 'invalid_response' : 'request_failed', status);
}

function grant(answer: oauth.TokenEndpointResponse, fallback: string | null): Grant {
  return { accessToken: answer.access_token, refreshToken: answer.refresh_token ?? fallback,
    expiresAt: answer.expires_in === undefined ? null : new Date(Date.now() + answer.expires_in * 1000).toISOString() };
}

export async function exchangeCode(entry: Entry, client: OAuthClient, input: {
  code: string; redirectUri: string; codeVerifier?: string; fetch: typeof fetch;
}): Promise<{ grant: Grant; extras: Record<string, unknown> }> {
  const c = context(entry, client, input.fetch);
  if (c.config.pkce !== false && !input.codeVerifier?.trim()) throw new TypeError('code_verifier_required');
  const params = new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri });
  if (input.codeVerifier) params.set('code_verifier', input.codeVerifier);
  const secrets = [client.clientSecret, input.code, input.codeVerifier ?? ''];
  const response = await send(c, entry, secrets, () => oauth.genericTokenEndpointRequest(c.as, c.client, c.auth, 'authorization_code', params, c.options));
  try {
    const answer = await oauth.processGenericTokenEndpointResponse(c.as, c.client, response, c.processing);
    const extras = Object.fromEntries(tokenAnswerKeys(entry).flatMap(key => answer[key] === undefined ? [] : [[key, answer[key]]]));
    return { grant: grant(answer, null), extras };
  } catch (error) {
    throw processingError(error, entry, response.status, secrets);
  }
}

export async function refreshGrant(entry: Entry, client: OAuthClient, refreshToken: string,
  input: { fetch: typeof fetch }): Promise<Grant> {
  const c = context(entry, client, input.fetch);
  const secrets = [client.clientSecret, refreshToken];
  const response = await send(c, entry, secrets, () => oauth.refreshTokenGrantRequest(c.as, c.client, c.auth, refreshToken, c.options));
  try {
    return grant(await oauth.processRefreshTokenResponse(c.as, c.client, response, c.processing), refreshToken);
  } catch (error) {
    throw processingError(error, entry, response.status, secrets);
  }
}

async function revokeToken(entry: Entry, client: OAuthClient, token: string, input: { fetch: typeof fetch }): Promise<void> {
  const c = context(entry, client, input.fetch);
  const secrets = [client.clientSecret, token];
  const response = await send(c, entry, secrets, () => oauth.revocationRequest(c.as, c.client, c.auth, token, c.options));
  // Any 2xx, as providers answer a revoke with 200 or 204; oauth4webapi accepts only 200.
  if (response.ok || response.status === 404) return;
  try {
    await oauth.processRevocationResponse(response);
  } catch (error) {
    throw processingError(error, entry, response.status, secrets);
  }
}

/** Revokes what the entry's `revoke` names. Done also when the entry declares none, when the grant lacks the token it
 * names, and when the grant is already gone: a 2xx, `invalid_grant`, a revoked code, a `goneErrors` detail, and an RFC 7009
 * revoke's 404 (a request revoke's 404 is a missing route, not a gone token).
 * `client` is the OAuth app, sent only by an RFC 7009 revoke, which refuses to start without it. */
export async function revokeGrant(entry: Entry, input: { accessToken?: string; refreshToken?: string | null;
  client?: OAuthClient; fetch: typeof fetch }): Promise<void> {
  const { revoke } = entry;
  if (revoke === undefined) return;
  try {
    if ('url' in revoke) {
      const { client } = input;
      if (client === undefined) throw new TypeError('oauth_client_required');
      const token = revoke.token.map(kind => (kind === 'refresh' ? input.refreshToken : input.accessToken))
        .find((value): value is string => typeof value === 'string' && value !== '');
      if (token !== undefined) await revokeToken(entry, client, token, input);
      return;
    }
    const { accessToken } = input;
    if (accessToken === undefined) return;
    const http = createClient(entry, { token: () => Promise.resolve(accessToken), fetch: input.fetch });
    const error = classify(entry, await sendCall(http, revoke.request));
    if (error) throw error;
  } catch (error) {
    const gone = error instanceof GrantRevoked || (error instanceof ProviderHttpError && error.detail !== null
      && (revoke.goneErrors ?? []).includes(error.detail));
    if (!gone) throw error;
  }
}
