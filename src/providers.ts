import type { Auth, Entry, Errors, Webhook } from './catalogue.js';
import { aircall as aircallEntry } from './catalogue/aircall.js';
import { apollo as apolloEntry } from './catalogue/apollo.js';
import { attio as attioEntry } from './catalogue/attio.js';
import { breakcold as breakcoldEntry } from './catalogue/breakcold.js';
import { exa as exaEntry } from './catalogue/exa.js';
import { fathom as fathomEntry } from './catalogue/fathom.js';
import { fireflies as firefliesEntry } from './catalogue/fireflies.js';
import { firecrawl as firecrawlEntry } from './catalogue/firecrawl.js';
import { github as githubEntry } from './catalogue/github.js';
import { google as googleEntry } from './catalogue/google.js';
import { granola as granolaEntry } from './catalogue/granola.js';
import { hubspot as hubspotEntry } from './catalogue/hubspot.js';
import { lusha as lushaEntry } from './catalogue/lusha.js';
import { microsoft as microsoftEntry } from './catalogue/microsoft.js';
import { notion as notionEntry } from './catalogue/notion.js';
import { slack as slackEntry } from './catalogue/slack.js';
import { unipile as unipileEntry } from './catalogue/unipile.js';
import { bodyWaitOf, codeOf, rateLimitOf, retryPolicy, safeDetail } from './http-response.js';
import { holds, placeholders } from './rules.js';

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
  // Slack and Fireflies read their errors inside a 200 in their own modules: their definitions carried no function.
  const inBody = errors.failed !== undefined;
  const waitFromBody = !inBody && http.retry?.waitFromBody !== undefined;
  return {
    id: entry.id, baseUrl: http.baseUrl, timeoutMs: http.timeoutMs ?? 30_000, minIntervalMs: http.minIntervalMs ?? 0,
    ...('send' in auth ? { auth: 'basic' in auth.send ? { header: 'authorization', prefix: 'Basic ' } : { header: auth.send.header, prefix: '' } } : {}),
    retry: { ...retryPolicy(http.retry), ...(waitFromBody ? { waitFromBody: (body: unknown) => bodyWaitOf(http.retry, body, Date.now()) } : {}) },
    ...(auth.kind === 'oauth2' ? { oauth2: oauth2Of(entry, auth) } : {}),
    ...(entry.webhook ? { webhook: schemeOf(entry.webhook) } : {}),
    ...(!inBody && (errors.detail !== undefined || errors.rules?.some(rule => rule.detail !== undefined))
      ? { errorDetail: (body: unknown) => detailOf(errors, body) } : {}),
    ...(http.rateLimit ? { rateLimit: (status: number, headers: Headers, body: unknown) => {
      const limit = rateLimitOf(http, { status, headers, body, code: codeOf(errors, body) }, Date.now());
      return limit && { waitMs: limit.waitMs ?? 0 };
    } } : {}),
  };
}

/** An entry's OAuth sign-in as today's definition: PKCE on, the client secret in the body, scopes joined by a space. */
function oauth2Of(entry: Entry, auth: Extract<Auth, { kind: 'oauth2' }>): OAuth2Definition {
  const extras = tokenAnswerKeys(entry);
  return {
    authUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl,
    ...(entry.revoke && 'url' in entry.revoke ? { revokeUrl: entry.revoke.url } : {}),
    clientAuth: auth.clientAuth ?? 'post', pkce: auth.pkce !== false, scopeDelimiter: auth.scopeSeparator ?? ' ',
    ...(auth.authorizeParams ? { authParams: auth.authorizeParams } : {}),
    ...(auth.tokenTypes ? { tokenTypes: auth.tokenTypes } : {}),
    ...(auth.failed ? { errorsInBody: true } : {}),
    ...(entry.errors?.revoked ? { revokedErrors: entry.errors.revoked } : {}),
    ...(extras.length > 0 ? { extras } : {}),
  };
}

/** The token answer's top-level keys the entry reads (`identify`, `save`), then `scope` when every scope must be granted. */
function tokenAnswerKeys(entry: Entry): string[] {
  const reads = [entry.identify?.id, entry.identify?.name, ...Object.values(entry.save ?? {})].flat().filter(read => read !== undefined);
  const paths = reads.flatMap(read => (read.includes('{') ? placeholders(read) : [read]));
  const keys = paths.filter(path => path.startsWith('tokenAnswer.')).map(path => path.split('.')[1] ?? '');
  return [...new Set([...keys, ...(entry.scopes?.requireGranted ? ['scope'] : [])])];
}

/** An entry's webhook as today's scheme: SHA-256 over the entry's `signed` template (the raw body by default), hex, a
 * five-minute tolerance unless it says otherwise. */
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

export const hubspot = definitionOf(hubspotEntry);

export const slack = definitionOf(slackEntry);

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

export const microsoft = definitionOf(microsoftEntry);

export const GOOGLE_CALENDAR_BASE = googleEntry.http.bases.calendar;

export const google = definitionOf(googleEntry);

export const unipile = definitionOf(unipileEntry);

export const firecrawl = definitionOf(firecrawlEntry);

export const exa = definitionOf(exaEntry);
