import type { Entry, Errors, Webhook } from './catalogue.js';
import { aircall as aircallEntry } from './catalogue/aircall.js';
import { apollo as apolloEntry } from './catalogue/apollo.js';
import { attio as attioEntry } from './catalogue/attio.js';
import { breakcold as breakcoldEntry } from './catalogue/breakcold.js';
import { exa as exaEntry } from './catalogue/exa.js';
import { fathom as fathomEntry } from './catalogue/fathom.js';
import { fireflies as firefliesEntry } from './catalogue/fireflies.js';
import { firecrawl as firecrawlEntry } from './catalogue/firecrawl.js';
import { github as githubEntry } from './catalogue/github.js';
import { granola as granolaEntry } from './catalogue/granola.js';
import { lusha as lushaEntry } from './catalogue/lusha.js';
import { notion as notionEntry } from './catalogue/notion.js';
import { unipile as unipileEntry } from './catalogue/unipile.js';
import { bodyWaitOf, codeOf, rateLimitOf, retryPolicy, safeDetail } from './http-response.js';
import { holds } from './rules.js';

export type RetryPolicy = {
  limit: number;
  maxWaitMs: number;
  defaultWaitMs: number;
  waitFromBody?: (body: unknown) => number | undefined;
};

export type HmacScheme = {
  signed: string;
  signatureHeader: string;
  prefix: string;
  encoding: 'hex' | 'base64';
  timestamp?: { header: string; toleranceSeconds: number };
};

export type OAuth2Definition = {
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientAuth: 'basic' | 'post';
  pkce: boolean;
  scopeDelimiter: ' ' | ',';
  authParams?: Readonly<Record<string, string>>;
  tokenTypes?: readonly string[];
  errorsInBody?: boolean;
  revokedErrors?: readonly string[];
  refreshMarginMs?: number;
  /** The token answer's fields an app may read; the rest are dropped, since they can hold other secrets. */
  extras?: readonly string[];
};

export type ProviderDefinition = {
  id: string;
  baseUrl?: string;
  auth?: { header: string; prefix: string };
  timeoutMs: number;
  minIntervalMs: number;
  retry: RetryPolicy;
  oauth2?: OAuth2Definition;
  webhook?: HmacScheme;
  /** The provider's own code for a refusal (Breakcold's `usage_limit`), read from its error body. */
  errorDetail?: (body: unknown) => string | undefined;
  /** A refusal that is a rate limit although its status may not say so (GitHub answers one as 403), with the wait it asks
   * for when no Retry-After names one; undefined when the refusal is no rate limit. */
  rateLimit?: (status: number, headers: Headers, body: unknown) => { waitMs: number } | undefined;
};

/** Today's definition of a provider, read from its entry; 0.13.0 removes `ProviderDefinition` and this with it. */
function definitionOf(entry: Entry): ProviderDefinition {
  const { http, errors = {} } = entry;
  const [auth] = entry.auth;
  // Task 7 derives this with its first entries.
  if (auth.kind === 'oauth2') throw new TypeError('derivation_missing');
  // Slack and Fireflies read their errors inside a 200 in their own modules: their definitions carried no function.
  const inBody = errors.failed !== undefined;
  const waitFromBody = !inBody && http.retry?.waitFromBody !== undefined;
  return {
    id: entry.id, baseUrl: http.baseUrl, timeoutMs: http.timeoutMs ?? 30_000, minIntervalMs: http.minIntervalMs ?? 0,
    ...('send' in auth ? { auth: 'basic' in auth.send ? { header: 'authorization', prefix: 'Basic ' } : { header: auth.send.header, prefix: '' } } : {}),
    retry: { ...retryPolicy(http.retry), ...(waitFromBody ? { waitFromBody: (body: unknown) => bodyWaitOf(http.retry, body, Date.now()) } : {}) },
    ...(entry.webhook ? { webhook: schemeOf(entry.webhook) } : {}),
    ...(!inBody && (errors.detail !== undefined || errors.rules?.some(rule => rule.detail !== undefined))
      ? { errorDetail: (body: unknown) => detailOf(errors, body) } : {}),
    ...(http.rateLimit ? { rateLimit: (status: number, headers: Headers, body: unknown) => {
      const limit = rateLimitOf(http, { status, headers, body, code: codeOf(errors, body) }, Date.now());
      return limit && { waitMs: limit.waitMs ?? 0 };
    } } : {}),
  };
}

/** An entry's webhook as today's scheme: SHA-256 over the raw body, hex, a five-minute tolerance unless it says otherwise. */
function schemeOf(webhook: Webhook): HmacScheme {
  return { signed: webhook.signed ?? '{body}', signatureHeader: webhook.header, prefix: webhook.prefix ?? '',
    encoding: webhook.encoding ?? 'hex',
    ...(webhook.timestamp ? { timestamp: { header: webhook.timestamp.header, toleranceSeconds: webhook.timestamp.toleranceSeconds ?? 300 } } : {}) };
}

/** A rule's detail when it reads the body alone (today's errorDetail saw no status or header), else the provider's code. */
function detailOf(errors: Errors, body: unknown): string | undefined {
  const answer = { status: 0, headers: new Headers(), body, code: codeOf(errors, body) };
  const rule = errors.rules?.find(item => item.detail !== undefined && item.when.status === undefined
    && item.when.header === undefined && holds(item.when, answer));
  return rule?.detail ?? (answer.code === undefined ? undefined : safeDetail(answer.code) ?? undefined);
}

export const hubspot: ProviderDefinition = {
  id: 'hubspot', baseUrl: 'https://api.hubapi.com', timeoutMs: 30000, minIntervalMs: 250,
  retry: { limit: 1, maxWaitMs: 10000, defaultWaitMs: 1000 },
  errorDetail: body => {
    if (typeof body !== 'object' || body === null || !('category' in body)) return undefined;
    // Admit known categories only: a credential can also look like a short error code.
    return body.category === 'MISSING_SCOPES' || body.category === 'VALIDATION_ERROR' ? body.category : undefined;
  },
  oauth2: {
    authUrl: 'https://app.hubspot.com/oauth/authorize', tokenUrl: 'https://api.hubapi.com/oauth/2026-03/token',
    revokeUrl: 'https://api.hubapi.com/oauth/2026-03/token/revoke', clientAuth: 'post', pkce: false, scopeDelimiter: ' ',
    extras: ['hub_id'],
  },
};

export const slack: ProviderDefinition = {
  id: 'slack', baseUrl: 'https://slack.com/api', timeoutMs: 15000, minIntervalMs: 0,
  retry: { limit: 0, maxWaitMs: 0, defaultWaitMs: 0 },
  oauth2: {
    authUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientAuth: 'post', pkce: false, scopeDelimiter: ',', tokenTypes: ['bot'], errorsInBody: true,
    revokedErrors: ['invalid_auth', 'token_revoked', 'account_inactive', 'invalid_refresh_token', 'invalid_grant', 'not_authed'],
    extras: ['team', 'bot_user_id'],
  },
};

export const fireflies = definitionOf(firefliesEntry);

export const granola = definitionOf(granolaEntry);

export const fathom = definitionOf(fathomEntry);

export const attio = definitionOf(attioEntry);

export const aircall = definitionOf(aircallEntry);

export const notion = definitionOf(notionEntry);

export const github = definitionOf(githubEntry);

export const apollo = definitionOf(apolloEntry);

export const lusha = definitionOf(lushaEntry);

export const breakcold = definitionOf(breakcoldEntry);

/** A provider's error code from `{ error: { code } }` (Graph) or `{ error: { errors: [{ reason }], status } }` (Google). */
function nestedErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body;
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  const reason = 'errors' in error && Array.isArray(error.errors) ? (error.errors[0] as { reason?: unknown } | undefined)?.reason : undefined;
  if (typeof reason === 'string') return reason;
  return 'status' in error && typeof error.status === 'string' ? error.status : undefined;
}

/** Microsoft Graph on a member's delegated grant (Outlook mail and calendar). A 429 names its wait in `Retry-After`.
 * Microsoft has no endpoint that revokes one app's delegated grant. */
export const microsoft: ProviderDefinition = {
  id: 'microsoft', baseUrl: 'https://graph.microsoft.com/v1.0', timeoutMs: 30000, minIntervalMs: 0,
  retry: { limit: 2, maxWaitMs: 30000, defaultWaitMs: 5000 },
  errorDetail: nestedErrorCode,
  oauth2: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientAuth: 'post', pkce: true, scopeDelimiter: ' ', authParams: { response_type: 'code', response_mode: 'query' },
  },
};

/** Gmail on a member's grant; Google Calendar sits on its own base. */
export const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_RATE_LIMITS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

/** Gmail and Google Calendar on a member's grant. Google answers a quota limit as 403 as well as 429; `prompt=consent`
 * returns a refresh token on every sign-in, and `access_type=offline` one at all. */
export const google: ProviderDefinition = {
  id: 'google', baseUrl: 'https://gmail.googleapis.com/gmail/v1', timeoutMs: 30000, minIntervalMs: 0,
  retry: { limit: 2, maxWaitMs: 30000, defaultWaitMs: 5000 },
  errorDetail: nestedErrorCode,
  rateLimit: (status, _headers, body) => {
    const code = nestedErrorCode(body);
    return status === 429 || (status === 403 && code !== undefined && GOOGLE_RATE_LIMITS.has(code)) ? { waitMs: 60_000 } : undefined;
  },
  oauth2: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke', clientAuth: 'post', pkce: true, scopeDelimiter: ' ',
    authParams: { response_type: 'code', access_type: 'offline', prompt: 'consent' },
    // What the member granted: Google's consent screen lets them untick a scope.
    extras: ['scope'],
  },
};

export const unipile = definitionOf(unipileEntry);

export const firecrawl = definitionOf(firecrawlEntry);

export const exa = definitionOf(exaEntry);
