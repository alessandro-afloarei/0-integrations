import { lusha } from '../catalogue/lusha.js';
import type { Route } from '../testing.js';
import type { LushaCompany, LushaPerson, LushaUsage } from './lusha.js';

/** A contact Lusha can match; its email is matched, never answered, as Lusha's contact search reveals none. */
export type FakeLushaContact = LushaPerson & { email: string };
export type FakeLushaAccount = { credits: LushaUsage['credits']; contacts: readonly FakeLushaContact[];
  companies: readonly LushaCompany[] };
type Wanted = { email?: string; linkedinUrl?: string; firstName?: string; lastName?: string; companyDomain?: string; domain?: string };

const BASE = lusha.http.baseUrl;
const bare = (domain: string | null | undefined) => domain?.toLowerCase().replace(/^www\./u, '');

/**
 * Lusha v3 for one key at a time: `account(apiKey)` is what it reads, null a key Lusha refuses (401), `v3_not_enabled` an
 * account without v3 access (403). A contact matches its email, its LinkedIn URL, or a first and last name with its
 * company's domain; a company its domain, with or without `www.`. Each match charges one credit, a miss none.
 */
export function fakeLusha(data: { account: (apiKey: string) => FakeLushaAccount | 'v3_not_enabled' | null }): Route[] {
  const answer = async (request: Request, respond: (account: FakeLushaAccount, wanted: Wanted[]) => Response) => {
    const account = data.account(request.headers.get('api_key') ?? '');
    if (account === null) return Response.json({ statusCode: 401, message: 'Invalid API key' }, { status: 401 });
    if (account === 'v3_not_enabled') {
      return Response.json({ statusCode: 403, message: 'V3 API access is not enabled for your account' }, { status: 403 });
    }
    const body = request.method === 'POST' ? await request.json() as { contacts?: Wanted[]; companies?: Wanted[] } : {};
    return respond(account, body.contacts ?? body.companies ?? []);
  };
  const batch = (found: readonly (object | undefined)[], miss: string) => {
    const matches = found.filter(Boolean).length;
    return Response.json({ results: found.map(match => match ?? { error: { code: 'NOT_FOUND', message: miss } }),
      billing: { creditsCharged: matches, resultsReturned: matches } });
  };
  return [
    { method: 'GET', url: `${BASE}/v3/account/usage`, respond: request => answer(request, account => Response.json({ credits: account.credits })) },
    { method: 'POST', url: `${BASE}/v3/contacts/search`, respond: request => answer(request, (account, wanted) => batch(wanted.map(item => {
      const contact = account.contacts.find(candidate => (item.email !== undefined && candidate.email === item.email)
        || (item.linkedinUrl !== undefined && candidate.socialLinks?.linkedin === item.linkedinUrl)
        || (candidate.firstName === item.firstName && candidate.lastName === item.lastName
          && item.companyDomain !== undefined && bare(candidate.company?.domain) === bare(item.companyDomain)));
      return contact && { ...contact, email: undefined };
    }), 'Contact not found')) },
    { method: 'POST', url: `${BASE}/v3/companies/search-and-enrich`, respond: request => answer(request, (account, wanted) =>
      batch(wanted.map(item => account.companies.find(company => item.domain !== undefined && bare(company.domain) === bare(item.domain))),
        'Company not found')) },
  ];
}
