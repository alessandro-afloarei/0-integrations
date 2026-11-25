import { apollo } from '../providers.js';
import type { Route } from '../testing.js';
import type { ApolloOrganization, ApolloPerson, ApolloProfile } from './apollo.js';

/** A person Apollo can match, with the work email Apollo answers too. */
export type FakeApolloPerson = ApolloPerson & { email: string };
export type FakeApolloAccount = { profile: ApolloProfile; people: readonly FakeApolloPerson[];
  organizations: readonly ApolloOrganization[] };

const BASE = apollo.baseUrl ?? '';

/**
 * Apollo for one key at a time: `account(apiKey)` is what it reads, null a key Apollo refuses (401, in plain text). People
 * Enrichment matches an email, or a first and last name with the employer's domain or name; Organization Enrichment a
 * primary domain. A miss answers `{ person: null }` or `{}`: Apollo documents neither.
 */
export function fakeApollo(data: { account: (apiKey: string) => FakeApolloAccount | null }): Route[] {
  const answer = async (request: Request, respond: (account: FakeApolloAccount, query: URLSearchParams) => Response) => {
    const account = data.account(request.headers.get('x-api-key') ?? '');
    if (!account) return new Response('Invalid API key. See https://docs.apollo.io/reference/authentication for how to authenticate.',
      { status: 401, headers: { 'content-type': 'text/plain' } });
    // Apollo reads a parameter from the query or from a JSON body.
    const query = new URL(request.url).searchParams;
    const body: unknown = request.method === 'POST' ? await request.json() : {};
    for (const [name, value] of Object.entries(typeof body === 'object' && body !== null ? body : {})) {
      if (typeof value === 'string') query.set(name, value);
    }
    return respond(account, query);
  };
  const same = (a: string | null | undefined, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  return [
    { method: 'GET', url: `${BASE}/users/api_profile`, respond: request => answer(request, account => Response.json(account.profile)) },
    { method: 'POST', url: `${BASE}/people/match`, respond: request => answer(request, (account, query) => {
      const name = `${query.get('first_name') ?? ''} ${query.get('last_name') ?? ''}`;
      const person = account.people.find(candidate => same(candidate.email, query.get('email'))
        || (same(candidate.name, name) && (same(candidate.organization?.primary_domain, query.get('domain'))
          || same(candidate.organization?.name, query.get('organization_name')))));
      return Response.json({ person: person ?? null });
    }) },
    { method: 'GET', url: `${BASE}/organizations/enrich`, respond: request => answer(request, (account, query) => {
      const organization = account.organizations.find(candidate => same(candidate.primary_domain, query.get('domain')));
      return Response.json(organization ? { organization } : {});
    }) },
  ];
}
