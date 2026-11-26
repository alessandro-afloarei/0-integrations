import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { parseAnswer } from '../parse.js';
import { lusha } from '../providers.js';
import { orNull, text } from '../shapes.js';

// Lusha's own field names: an app stores these values and reads them back with its own schema.
export type LushaUsage = { credits: { total: number; used: number; remaining: number } };
export type LushaLocation = { country: string | null; state: string | null; city: string | null };
export type LushaPerson = {
  id: string; firstName: string | null; lastName: string | null;
  jobTitle: { title: string | null; seniority: string | null } | null;
  company: { id: string | null; name: string | null; domain: string | null; industry: string | null } | null;
  location: LushaLocation | null; socialLinks: { linkedin: string | null } | null;
};
export type LushaCompany = {
  id: string; name: string;
  /** As Lusha writes it, often with `www.`. */
  domain: string | null;
  description: string | null; companyType: string | null; yearFounded: number | null;
  employeeCount: { exact: number | null; min: number | null; max: number | null } | null;
  industry: string | null; subIndustry: string | null; location: LushaLocation | null;
  socialLinks: { linkedin: string | null } | null; revenueRange: { min: number | null; max: number | null } | null;
};
/** What a lookup found (null: no match) and the credits Lusha charged for it (null when its answer does not say). */
export type LushaLookup<T> = { match: T | null; creditsCharged: number | null };
export type LushaPersonQuery = { email: string } | { linkedinUrl: string } | { firstName: string; lastName: string; companyDomain: string };
export type LushaClient = {
  /** The key proof and the account's credit balance; Lusha allows it 5 calls a minute. */
  usage(): Promise<LushaUsage>;
  /** Lusha's contact search: the profile without emails or phones, charged per match as `api_search`. */
  person(query: LushaPersonQuery): Promise<LushaLookup<LushaPerson>>;
  /** Lusha's company search and enrich, revealing nothing extra: base firmographics, charged per match as `reveal_company`. */
  company(domain: string): Promise<LushaLookup<LushaCompany>>;
};

const count = orNull(z.number());
const location = orNull(z.object({ country: text, state: text, city: text }));
const socialLinks = orNull(z.object({ linkedin: text }));
// Every key it does not name is dropped: Lusha's `has`, `canReveal`, funding, technologies, emails and phones.
const personSchema = z.object({ id: z.string().min(1), firstName: text, lastName: text,
  jobTitle: orNull(z.object({ title: text, seniority: text })),
  company: orNull(z.object({ id: text, name: text, domain: text, industry: text })), location, socialLinks });
const companySchema = z.object({ id: z.string().min(1), name: z.string(), domain: text, description: text, companyType: text,
  yearFounded: count, employeeCount: orNull(z.object({ exact: count, min: count, max: count })), industry: text,
  subIndustry: text, location, socialLinks, revenueRange: orNull(z.object({ min: count, max: count })) });
const usageSchema = z.object({ credits: z.object({ total: z.number(), used: z.number(), remaining: z.number() }) });
// v3 answers every lookup as a batch: one result per item, a miss as the item's `error`, inside a 200.
const batchSchema = z.object({ results: z.array(z.looseObject({ error: z.object({ code: z.string() }).optional() })),
  billing: z.object({ creditsCharged: z.number().optional() }).nullish() });
/** Item errors that are Lusha's final answer; any other (`ENRICH_FAILED`) failed this time. */
const NO_MATCH = new Set(['NOT_FOUND', 'COMPLIANCE_RESTRICTED']);

/** An account without v3 access is not a bad key, and no new key fixes it: `request_failed`, not `rejected`. */
function v3Refusal(error: unknown): never {
  if (error instanceof ProviderHttpError && error.detail === 'v3_not_enabled') {
    throw new ProviderHttpError('request_failed', 403, 'v3_not_enabled');
  }
  throw error;
}

export function lushaClient(input: { apiKey: string; fetch: typeof fetch; minIntervalMs?: number }): LushaClient {
  const http = createClient({ provider: lusha, token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  async function lookup<T>(path: string, json: unknown, schema: z.ZodType<T>): Promise<LushaLookup<T>> {
    // A lookup changes nothing and a 429 was not charged, so it is waited out like a GET's.
    const answer = await http.json(path, { method: 'POST', json, idempotent: true }).catch(v3Refusal);
    const { results: [result], billing } = parseAnswer(batchSchema, answer);
    if (result?.error && !NO_MATCH.has(result.error.code)) throw new ProviderHttpError('unavailable', null, 'enrich_failed');
    return { match: result && !result.error ? parseAnswer(schema, result) : null, creditsCharged: billing?.creditsCharged ?? null };
  }
  return {
    async usage() {
      return parseAnswer(usageSchema, await http.json('/v3/account/usage').catch(v3Refusal));
    },
    person: query => lookup('/v3/contacts/search', { contacts: [query] }, personSchema),
    company: domain => lookup('/v3/companies/search-and-enrich', { companies: [{ domain }] }, companySchema),
  };
}
