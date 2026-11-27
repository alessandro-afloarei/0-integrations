import * as oauth from 'oauth4webapi';
import { lookupNames } from './account.js';
import type { Entry, Kept, Plain, Values, ValuesOption } from './catalogue.js';
import { GrantRevoked, ProviderHttpError } from './errors.js';
import { callBase, callRequest, createClient, defaultFetch, filledBase, type ProviderResponse } from './http.js';
import { classify, codeOf, responseJson, safeDetail, sentWith } from './http-response.js';
import { checkHosts, fill, holds, oauthUrls, parseJson, placeholders, plainFields, plainValue, readPath } from './rules.js';

export type Grant = { accessToken: string; refreshToken: string | null; expiresAt: string | null };
export type OAuthClient = { clientId: string; clientSecret: string };
/** A refresh's input, which may be left out only when its values may. */
type RefreshInput<E extends Entry, I = { fetch?: typeof globalThis.fetch } & ValuesOption<Kept<E>>> = Partial<I> extends I ? [input?: I] : [input: I];

/** The entry's OAuth 2 URLs, each filled and checked by the base's rule from the plain fields alone: a secret is never
 * in a URL, and a saved value does not exist before the exchange. */
function endpoints(entry: Entry, values: Values = {}) {
  const [auth] = entry.auth;
  const urls = oauthUrls(entry);
  if (auth.kind !== 'oauth2' || urls === undefined) throw new TypeError('oauth_unsupported');
  checkHosts(entry);
  const plain = Object.fromEntries(plainFields(entry).map(({ name }) => [name, values[name]]));
  const url = (template: string) => new URL(filledBase(entry, plain, template));
  return { config: auth, authorize: url(urls.authorize), token: url(urls.token), refresh: url(urls.refresh),
    revoke: urls.revoke === undefined ? undefined : url(urls.revoke) };
}

/** The token answer's top-level keys the entry reads (`identify`, `save`), then `scope` when every scope must be granted.
 * Never the token's own key: the token is not returned or stored. */
function tokenAnswerKeys(entry: Entry): string[] {
  const [auth] = entry.auth;
  const withheld = auth.kind === 'token' ? [(auth.request.token ?? 'access_token').split('.')[0]] : ['access_token', 'refresh_token'];
  const keys = lookupNames(entry).filter(name => name.startsWith('tokenAnswer.')).map(name => name.split('.')[1] ?? '')
    .filter(key => !withheld.includes(key));
  return [...new Set([...keys, ...(entry.scopes?.requireGranted ? ['scope'] : [])])];
}

/** Only the token answer's keys the entry reads: nothing else of it leaves the engine. */
function tokenAnswerOf(entry: Entry, answer: unknown): Record<string, unknown> {
  return Object.fromEntries(tokenAnswerKeys(entry).map((key): [string, unknown] => [key, readPath(answer, key)])
    .filter(([, value]) => value !== undefined));
}

/** The consent URL. Every OAuth 2 URL of the entry is filled from `values` and checked first, so a value its token,
 * refresh or revoke URL would refuse is refused before the person is sent anywhere. */
export function authorizeUrl<const E extends Entry>(entry: E, input: {
  clientId: string; redirectUri: string; scopes: readonly string[]; state: string; codeChallenge?: string } & ValuesOption<Plain<E>>): URL {
  const { config, authorize: url } = endpoints(entry, input.values);
  if (!input.state.trim()) throw new TypeError('state_required');
  if (config.pkce !== false && !input.codeChallenge) throw new TypeError('code_challenge_required');
  url.searchParams.set('client_id', input.clientId);
  if (input.scopes.length > 0) url.searchParams.set('scope', input.scopes.join(config.scopeSeparator ?? ' '));
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

type CustomFetch = NonNullable<oauth.HttpRequestOptions<'POST', URLSearchParams>[typeof oauth.customFetch]>;

/** The form oauth4webapi builds, sent as one JSON object of the same names and values. */
const jsonBodies = (fetch: typeof globalThis.fetch): CustomFetch => (url, options) => fetch(url, { ...options,
  headers: { ...options.headers, 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(options.body)) });

/** A token answer that states no `token_type` is read as Bearer, as most OAuth clients read it (ClickUp's states none).
 * Only a 2xx answer to a grant (an exchange or a refresh) is read; a revoke sends no `grant_type`. */
const bearerByDefault = (send: CustomFetch): CustomFetch => async (url, options) => {
  const response = await send(url, options);
  if (!response.ok || !options.body.has('grant_type')) return response;
  const body: unknown = await response.clone().json().catch(() => null);
  if (typeof body !== 'object' || body === null || !('access_token' in body) || 'token_type' in body) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json({ ...body, token_type: 'bearer' }, { status: response.status, headers });
};

type Sent = { values?: Values; fetch?: typeof globalThis.fetch };

/** A refresh posts to the entry's `refreshUrl` when it names one; every other request to its `tokenUrl`. The app's
 * `fetch`, else the entry's default: the address guard for a typed host. */
function context(entry: Entry, credentials: OAuthClient, input: Sent, refresh = false) {
  // Each URL passes the one check every URL the library sends to passes, before anything is sent.
  const { config, token, refresh: renew, revoke } = endpoints(entry, input.values);
  const fetch = input.fetch ?? defaultFetch(entry);
  const as: oauth.AuthorizationServer = { issuer: token.origin, token_endpoint: (refresh ? renew : token).href,
    ...(revoke ? { revocation_endpoint: revoke.href } : {}) };
  const client = { client_id: credentials.clientId };
  const auth = config.clientAuth === 'basic' ? oauth.ClientSecretBasic(credentials.clientSecret) : oauth.ClientSecretPost(credentials.clientSecret);
  // The Basic value as sent (the id and secret form-encoded first), so no error detail echoes it.
  const sent = new Headers();
  void auth(as, client, new URLSearchParams(), sent);
  const basic = sent.get('authorization')?.slice('Basic '.length);
  return {
    config, as, client, auth, secrets: [credentials.clientSecret, ...(basic === undefined ? [] : [basic])],
    options: { [oauth.customFetch]: bearerByDefault(config.json ? jsonBodies(fetch) : fetch), signal: AbortSignal.timeout(entry.http.timeoutMs ?? 30_000) },
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
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error; // the address guard's refusal
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

export async function exchangeCode<const E extends Entry>(entry: E, client: OAuthClient, input: { code: string; redirectUri: string;
  codeVerifier?: string | undefined; fetch?: typeof globalThis.fetch } & ValuesOption<Plain<E>>): Promise<{ grant: Grant; extras: Record<string, unknown> }> {
  const c = context(entry, client, input);
  if (c.config.pkce !== false && !input.codeVerifier?.trim()) throw new TypeError('code_verifier_required');
  const params = new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri });
  if (input.codeVerifier) params.set('code_verifier', input.codeVerifier);
  const secrets = [...c.secrets, input.code, input.codeVerifier ?? ''];
  const response = await send(c, entry, secrets, () => oauth.genericTokenEndpointRequest(c.as, c.client, c.auth, 'authorization_code', params, c.options));
  try {
    const answer = await oauth.processGenericTokenEndpointResponse(c.as, c.client, response, c.processing);
    return { grant: grant(answer, null), extras: tokenAnswerOf(entry, answer) };
  } catch (error) {
    throw processingError(error, entry, response.status, secrets);
  }
}

export async function refreshGrant<const E extends Entry>(entry: E, client: OAuthClient, refreshToken: string,
  ...[input]: RefreshInput<E>): Promise<Grant> {
  const c = context(entry, client, input ?? {}, true);
  const secrets = [...c.secrets, refreshToken];
  const response = await send(c, entry, secrets, () => oauth.refreshTokenGrantRequest(c.as, c.client, c.auth, refreshToken, c.options));
  try {
    return grant(await oauth.processRefreshTokenResponse(c.as, c.client, response, c.processing), refreshToken);
  } catch (error) {
    throw processingError(error, entry, response.status, secrets);
  }
}

async function revokeToken(entry: Entry, client: OAuthClient, token: string, input: Sent): Promise<void> {
  const c = context(entry, client, input);
  const secrets = [...c.secrets, token];
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
export async function revokeGrant<const E extends Entry>(entry: E, input: { accessToken?: string; refreshToken?: string | null;
  client?: OAuthClient; fetch?: typeof globalThis.fetch } & ValuesOption<Kept<E>>): Promise<void> {
  const { revoke } = entry;
  checkHosts(entry);
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
    const http = createClient(entry, { token: () => Promise.resolve(accessToken), fetch: input.fetch ?? defaultFetch(entry),
      values: input.values ?? {}, ...callBase(entry, revoke.request) });
    responseJson(entry, await http.request(...callRequest(revoke.request)));
  } catch (error) {
    const gone = error instanceof GrantRevoked || (error instanceof ProviderHttpError && error.detail !== null
      && (revoke.goneErrors ?? []).includes(error.detail));
    if (!gone) throw error;
  }
}

const RFC6749_ERRORS = ['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope'];
type TokenInput = { secret: Readonly<Record<string, string>>; values?: Values; fetch?: typeof fetch };

/** @internal Requests a token entry's token: the token, its expiry (ms since epoch) or null, and the answer's keys the
 * entry reads (`tokenAnswer.*`). Sent once, never retried (it is no read of the provider's API) and never redirected. Its
 * templates read the secret fields from `secret` and every other name as a plain value; no error detail holds a secret, a
 * body value filled from one, or the Basic value sent. */
export async function requestToken(entry: Entry, input: TokenInput): Promise<{ token: string; expiresAt: number | null; extras: Record<string, unknown> }> {
  const [auth] = entry.auth;
  if (auth.kind !== 'token') throw new TypeError('token_unsupported');
  checkHosts(entry);
  const { request } = auth;
  const values = { ...input.values }; // own values, each read once, for the URL, the body and Basic
  const secretNames = new Set((entry.fields ?? []).filter(field => field.secret).map(field => field.name));
  // The URL is filled from the plain fields only (a secret field's name there is missing, whatever `values` holds), and
  // checked before any secret is read.
  const url = filledBase(entry, Object.fromEntries(plainFields(entry).map(({ name }) => [name, values[name]])), request.url);
  // One read of each secret (an app's may be a getter), so the value redacted is the value sent.
  const secret = { ...input.secret };
  const filled = (template: string) => fill(template, name => plainValue(secretNames.has(name) ? secret : values, name), entry.id);
  const body = Object.fromEntries(Object.entries(request.body).map(([name, template]) => [name, filled(template)]));
  const basic = request.basic && Buffer.from(`${filled(request.basic[0])}:${filled(request.basic[1])}`).toString('base64');
  const secrets = [...Object.values(secret), basic ?? '', ...Object.entries(request.body)
    .filter(([, template]) => placeholders(template).some(name => secretNames.has(name))).map(([name]) => body[name] ?? '')];
  const headers = new Headers(entry.http.headers);
  headers.set('content-type', request.json ? 'application/json' : 'application/x-www-form-urlencoded;charset=UTF-8');
  if (basic !== undefined) headers.set('authorization', `Basic ${basic}`);
  let response: ProviderResponse;
  try {
    const answer = await (input.fetch ?? defaultFetch(entry))(url, { method: 'POST', headers, redirect: 'manual',
      body: request.json ? JSON.stringify(body) : new URLSearchParams(body), signal: AbortSignal.timeout(entry.http.timeoutMs ?? 30_000) });
    response = sentWith({ status: answer.status, headers: answer.headers, data: parseJson(await answer.text()) }, secrets);
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error; // the address guard's refusal
    throw new ProviderHttpError('unavailable', null);
  }
  const { status, data } = response;
  // RFC 6749 §5.2: a refused client or grant; its detail is the answer's `error` only when that is one of the RFC's codes.
  if (status === 400 || status === 401 || status === 403) {
    const code = readPath(data, 'error');
    throw new ProviderHttpError('rejected', status, typeof code === 'string' && RFC6749_ERRORS.includes(code) ? safeDetail(code, secrets) : null);
  }
  const error = status >= 200 && status < 300 ? null : classify(entry, response);
  if (error) throw error;
  const token = readPath(data, request.token ?? 'access_token');
  if (typeof token !== 'string' || token.trim() === '') throw new ProviderHttpError('invalid_response', status, 'missing_fields');
  const life = readPath(data, 'expires_in');
  return { token, expiresAt: typeof life === 'number' && Number.isFinite(life) && life > 0 ? Date.now() + life * 1000 : null,
    extras: tokenAnswerOf(entry, data) };
}

/** The token function `client()` takes, for a `token` entry: requests a token, keeps it until it expires (60 s early) or
 * is refused, and shares one request among concurrent callers. A failed request is not kept. */
export function tokenSource<const E extends Entry>(entry: E, input: Omit<TokenInput, 'values'> & ValuesOption<Kept<E>>): (rejected?: string) => Promise<string> {
  let kept: Promise<{ token: string; expiresAt: number | null }> | undefined;
  let settled = false;
  const request = () => {
    settled = false;
    const pending = requestToken(entry, input).then(answer => { if (kept === pending) settled = true; return answer; },
      (error: unknown) => { if (kept === pending) kept = undefined; throw error; });
    return (kept = pending);
  };
  return async rejected => {
    // A token requested by this call, or still being requested when it came, is fresh for it, however short its life.
    const fresh = kept === undefined || !settled;
    const held = kept ?? request();
    const { token, expiresAt } = await held;
    if (token !== rejected && (fresh || expiresAt === null || expiresAt - Date.now() > 60_000)) return token;
    // The first caller to find it stale requests again; the others wait for that request.
    return (await (kept === held ? request() : kept ?? request())).token;
  };
}
