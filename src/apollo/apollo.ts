import { z } from 'zod';
import { createClient } from '../http.js';
import { parseAnswer } from '../parse.js';
import { apollo } from '../catalogue/apollo.js';
import { orNull, text } from '../shapes.js';

// Apollo's own field names: an app stores these values and reads them back with its own schema.
/** The key's owner: Apollo acts as the workspace's longest-standing admin, whatever person made the key. */
export type ApolloProfile = { id: string; team_id: string; first_name: string | null; last_name: string | null; email: string | null };
export type ApolloOrganization = {
  id: string; name: string; primary_domain: string | null; website_url: string | null; linkedin_url: string | null;
  industry: string | null; estimated_num_employees: number | null; founded_year: number | null;
  annual_revenue_printed: string | null; short_description: string | null;
  city: string | null; state: string | null; country: string | null;
};
export type ApolloPerson = {
  id: string; name: string; title: string | null; headline: string | null; linkedin_url: string | null;
  /** Where the person lives, not their employer's headquarters. */
  city: string | null; state: string | null; country: string | null;
  match_confidence: 'high' | 'medium' | 'low' | null;
  /** The current employer, with the firmographics `organization()` reads: one person lookup can fill both pages. */
  organization: ApolloOrganization | null;
};
export type ApolloPersonQuery = { email?: string | undefined; firstName?: string | undefined; lastName?: string | undefined;
  /** The employer's bare domain, without `www.`. */
  domain?: string | undefined; organizationName?: string | undefined };
export type ApolloClient = {
  /** The key proof, at no credit. */
  profile(): Promise<ApolloProfile>;
  /** People Enrichment without personal emails, phones or waterfall: one credit when Apollo returns data, none on no
   * match. Null when Apollo matches nobody, or is not confident at all (`match_confidence: none`). */
  person(query: ApolloPersonQuery): Promise<ApolloPerson | null>;
  /** Organization Enrichment by a bare domain (no `www.`): one credit. Null when Apollo knows no organization there. */
  organization(domain: string): Promise<ApolloOrganization | null>;
};

const count = orNull(z.number());
const profileSchema = z.object({ id: z.string().min(1), team_id: z.string().min(1), first_name: text, last_name: text, email: text });
// Every key it does not name is dropped: emails, phones, employment history and Apollo's CRM contact never leave the client.
const organizationSchema = z.object({ id: z.string().min(1), name: z.string(), primary_domain: text, website_url: text,
  linkedin_url: text, industry: text, estimated_num_employees: count, founded_year: count, annual_revenue_printed: text,
  short_description: text, city: text, state: text, country: text });
const personSchema = z.object({ id: z.string().min(1), name: z.string(), title: text, headline: text, linkedin_url: text,
  city: text, state: text, country: text, match_confidence: orNull(z.enum(['high', 'medium', 'low'])),
  organization: orNull(organizationSchema) });
// Read only far enough to tell a match: Apollo documents no no-match body, so an absent, null or id-less entry is none.
const candidate = z.looseObject({ id: z.string().nullish(), match_confidence: z.string().nullish() }).nullish();
const matchSchema = z.object({ person: candidate });
const enrichSchema = z.object({ organization: candidate });

export function apolloClient(input: { apiKey: string; fetch: typeof fetch; minIntervalMs?: number }): ApolloClient {
  const http = createClient(apollo, { token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  return {
    async profile() {
      return parseAnswer(profileSchema, await http.json('/users/api_profile'));
    },
    async person({ email, firstName, lastName, domain, organizationName }) {
      const json = Object.fromEntries(Object.entries({ email, first_name: firstName, last_name: lastName, domain,
        organization_name: organizationName }).filter(entry => entry[1] !== undefined));
      // In the body, which Apollo also reads: a URL with the email would reach logs. A 429 was not served, so it is waited
      // out like a GET's.
      const { person } = parseAnswer(matchSchema, await http.json('/people/match', { method: 'POST', json, idempotent: true }));
      return person?.id && person.match_confidence !== 'none' ? parseAnswer(personSchema, person) : null;
    },
    async organization(domain) {
      const { organization } = parseAnswer(enrichSchema, await http.json('/organizations/enrich', { query: { domain } }));
      return organization?.id ? parseAnswer(organizationSchema, organization) : null;
    },
  };
}
