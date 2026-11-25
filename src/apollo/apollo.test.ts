import { expect, test } from 'vitest';
import { GOOD_KEY, lookupKit, type Recording } from '../kit.test-support.js';
import { fakeFetch } from '../testing.js';
import { apolloClient, type ApolloClient, type ApolloOrganization, type ApolloPerson } from './apollo.js';
import { fakeApollo, type FakeApolloAccount } from './fake.js';
import recording from './fixtures/recording.json' with { type: 'json' };

const BASE = 'https://api.apollo.io/api/v1';
const organization = (name: string, domain: string): ApolloOrganization => ({ id: `org_${domain}`, name, primary_domain: domain,
  website_url: `https://www.${domain}`, linkedin_url: null, industry: 'information technology & services',
  estimated_num_employees: 850, founded_year: 2018, annual_revenue_printed: '85M', short_description: null,
  city: 'San Francisco', state: 'California', country: 'United States' });
const northstar = organization('Northstar Analytics', 'northstar.example');
const jordan: ApolloPerson = { id: 'person_1', name: 'Jordan Blake', title: 'Founder & CEO',
  headline: 'Founder & CEO at Northstar Analytics', linkedin_url: 'http://www.linkedin.com/in/jordan-blake-example',
  city: 'San Francisco', state: 'California', country: 'United States', match_confidence: 'high', organization: northstar };
const account: FakeApolloAccount = {
  profile: { id: 'user_1', team_id: 'team_1', first_name: 'John', last_name: 'Doe', email: 'john.doe@example.com' },
  people: [{ ...jordan, email: 'jordan.blake@northstar.example' }],
  organizations: [northstar, organization('Apollo.io', 'apollo.io')],
};

lookupKit<ApolloClient>({
  provider: 'apollo',
  client: ({ apiKey, fetch }) => apolloClient({ apiKey, fetch, minIntervalMs: 0 }),
  identify: client => client.profile(),
  person: async (client, known) => ({ found: await client.person({ email: known ? 'jordan.blake@northstar.example'
    : 'nobody@nowhere.example' }), credits: null }),
  company: async client => ({ found: await client.organization('apollo.io'), credits: null }),
  noMatchCredits: null,
  retriesRateLimit: true,
}, { recording: recording as Recording, fake: fakeApollo({ account: key => (key === GOOD_KEY ? account : null) }) });

const client = (fetchImpl: typeof fetch) => apolloClient({ apiKey: 'apollo-key', fetch: fetchImpl, minIntervalMs: 0 });
const answering = (body: unknown, status = 200) => fakeFetch([{ url: /api\.apollo\.io/u, respond: () => Response.json(body, { status }) }]);
const documented = (url: string) => (recording as Recording).exchanges.find(exchange => exchange.url.startsWith(url))?.response;

test("sends People Enrichment's parameters in the body, never in the URL, with no reveal or waterfall, and the key as x-api-key", async () => {
  const fake = fakeFetch(fakeApollo({ account: () => account }));
  await expect(client(fake.fetch).person({ firstName: 'Jordan', lastName: 'Blake', domain: 'northstar.example',
    organizationName: 'Northstar Analytics' })).resolves.toEqual(jordan);
  await client(fake.fetch).organization('apollo.io');
  expect(fake.calls.map(call => [call.method, call.url, call.body])).toEqual([
    ['POST', `${BASE}/people/match`, JSON.stringify({ first_name: 'Jordan', last_name: 'Blake', domain: 'northstar.example',
      organization_name: 'Northstar Analytics' })],
    ['GET', `${BASE}/organizations/enrich?domain=apollo.io`, ''],
  ]);
  expect(fake.calls[0]?.headers['x-api-key']).toBe('apollo-key');
});

test("drops a person's emails, phones, employment history and CRM contact, which a page does not need", async () => {
  const person = await client(answering(documented(`${BASE}/people/match`)).fetch).person({ email: 'jordan.blake@northstar.example' });
  expect(Object.keys(person ?? {}).sort()).toEqual(Object.keys(jordan).sort());
  expect(person?.organization).toMatchObject({ name: 'Northstar Analytics', primary_domain: 'northstar.example', estimated_num_employees: 850 });
  const found = await client(answering(documented(`${BASE}/organizations/enrich`)).fetch).organization('apollo.io');
  expect(Object.keys(found ?? {}).sort()).toEqual(Object.keys(northstar).sort());
});

test('answers null for every no-match shape: no person, no id, or no confidence at all', async () => {
  for (const body of [{}, { person: null }, { person: { id: null, name: '' } }, { person: { id: 'p', name: 'X', match_confidence: 'none' } }]) {
    await expect(client(answering(body).fetch).person({ email: 'x@y.test' })).resolves.toBeNull();
  }
  for (const body of [{}, { organization: null }, { organization: {} }]) {
    await expect(client(answering(body).fetch).organization('nowhere.example')).resolves.toBeNull();
  }
});

test("reads a refusal's code from error_details", async () => {
  const scope = { error: 'This API key is not authorized to access api/v1/organizations/enrich.', error_code: 'API_INACCESSIBLE',
    error_details: { code: 'AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED', message: 'Your team is not permitted to call this endpoint.' } };
  await expect(client(answering(scope, 403).fetch).organization('apollo.io'))
    .rejects.toMatchObject({ code: 'rejected', status: 403, detail: 'AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED' });
  const invalid = { error_details: { code: 'ORGANIZATION.VALIDATION.ORGANIZATION_IDENTIFIER_REQUIRED', message: 'Include a domain.' } };
  await expect(client(answering(invalid, 422).fetch).organization(''))
    .rejects.toMatchObject({ code: 'request_failed', status: 422, detail: 'ORGANIZATION.VALIDATION.ORGANIZATION_IDENTIFIER_REQUIRED' });
  const plain = fakeFetch([{ url: `${BASE}/users/api_profile`, respond: () => new Response('Invalid API key.', { status: 401 }) }]);
  await expect(client(plain.fetch).profile()).rejects.toMatchObject({ code: 'rejected', status: 401, detail: null });
});
