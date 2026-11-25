import { expect, test } from 'vitest';
import { GOOD_KEY, lookupKit, type Recording } from '../kit.test-support.js';
import { fakeFetch } from '../testing.js';
import { fakeLusha, type FakeLushaAccount } from './fake.js';
import { lushaClient, type LushaClient, type LushaCompany, type LushaPerson } from './lusha.js';
import recording from './fixtures/recording.json' with { type: 'json' };

const BASE = 'https://api.lusha.com';
const boston = { country: 'United States', state: 'Massachusetts', city: 'Boston' };
const ana: LushaPerson = { id: '1000000001', firstName: 'Ana', lastName: 'Lopez',
  jobTitle: { title: 'Head of Partnerships', seniority: 'Director' },
  company: { id: '16303253', name: 'Lusha', domain: 'www.lusha.com', industry: 'Technology, Information & Media' },
  location: { country: 'Spain', state: null, city: 'Madrid' }, socialLinks: { linkedin: 'https://www.linkedin.com/in/ana-lopez-example' } };
const company: LushaCompany = { id: '16303253', name: 'Lusha', domain: 'www.lusha.com', description: 'Sales Streaming.',
  companyType: 'Private Company', yearFounded: 2016, employeeCount: { exact: 364, min: 201, max: 500 },
  industry: 'Technology, Information & Media', subIndustry: 'Software Development', location: boston,
  socialLinks: { linkedin: 'https://www.linkedin.com/company/lushadata' }, revenueRange: null };
const account: FakeLushaAccount = { credits: { total: 10000, used: 1500, remaining: 8500 },
  contacts: [{ ...ana, email: 'ana.lopez@acme.example' }], companies: [company] };

lookupKit<LushaClient>({
  provider: 'lusha',
  client: ({ apiKey, fetch }) => lushaClient({ apiKey, fetch, minIntervalMs: 0 }),
  identify: client => client.usage(),
  person: async (client, known) => {
    const { match, creditsCharged } = await client.person({ email: known ? 'ana.lopez@acme.example' : 'nobody@nowhere.example' });
    return { found: match, credits: creditsCharged };
  },
  company: async client => {
    const { match, creditsCharged } = await client.company('lusha.com');
    return { found: match, credits: creditsCharged };
  },
  noMatchCredits: 0,
  retriesRateLimit: true,
}, { recording: recording as Recording, fake: fakeLusha({ account: key => (key === GOOD_KEY ? account : null) }) });

const client = (fetchImpl: typeof fetch) => lushaClient({ apiKey: 'lusha-key', fetch: fetchImpl, minIntervalMs: 0 });
const answering = (body: unknown, status = 200) => fakeFetch([{ url: /api\.lusha\.com/u, respond: () => Response.json(body, { status }) }]);
const documented = (url: string) => (recording as Recording).exchanges.find(exchange => exchange.url === url)?.response;

test("sends each lookup as one v3 item, revealing nothing, with the key as api_key", async () => {
  const fake = fakeFetch(fakeLusha({ account: () => account }));
  await expect(client(fake.fetch).person({ linkedinUrl: 'https://www.linkedin.com/in/ana-lopez-example' }))
    .resolves.toEqual({ match: ana, creditsCharged: 1 });
  await expect(client(fake.fetch).person({ firstName: 'Ana', lastName: 'Lopez', companyDomain: 'lusha.com' }))
    .resolves.toEqual({ match: ana, creditsCharged: 1 });
  await expect(client(fake.fetch).company('lusha.com')).resolves.toEqual({ match: company, creditsCharged: 1 });
  await expect(client(fake.fetch).usage()).resolves.toEqual({ credits: account.credits });
  expect(fake.calls.map(call => [call.method, call.url, call.body])).toEqual([
    ['POST', `${BASE}/v3/contacts/search`, JSON.stringify({ contacts: [{ linkedinUrl: 'https://www.linkedin.com/in/ana-lopez-example' }] })],
    ['POST', `${BASE}/v3/contacts/search`, JSON.stringify({ contacts: [{ firstName: 'Ana', lastName: 'Lopez', companyDomain: 'lusha.com' }] })],
    ['POST', `${BASE}/v3/companies/search-and-enrich`, JSON.stringify({ companies: [{ domain: 'lusha.com' }] })],
    ['GET', `${BASE}/v3/account/usage`, ''],
  ]);
  expect(fake.calls[0]?.headers.api_key).toBe('lusha-key');
});

test("drops what a page does not need: Lusha's reveal offers, funding, technologies, emails and phones", async () => {
  const person = await client(answering(documented(`${BASE}/v3/contacts/search`)).fetch).person({ email: 'ana.lopez@acme.example' });
  expect(person).toEqual({ match: ana, creditsCharged: 1 });
  const found = await client(answering(documented(`${BASE}/v3/companies/search-and-enrich`)).fetch).company('lusha.com');
  expect(Object.keys(found.match ?? {}).sort()).toEqual(Object.keys(company).sort());
  expect(found.match?.location).toEqual(boston);
});

test('a miss or a compliance restriction is no match, a failed enrichment is unavailable, and absent billing is null', async () => {
  const item = (code: string) => ({ results: [{ error: { code, message: code } }], billing: { creditsCharged: 0, resultsReturned: 0 } });
  await expect(client(answering(item('COMPLIANCE_RESTRICTED')).fetch).person({ email: 'x@y.test' }))
    .resolves.toEqual({ match: null, creditsCharged: 0 });
  await expect(client(answering(item('ENRICH_FAILED')).fetch).company('y.test'))
    .rejects.toMatchObject({ code: 'unavailable', detail: 'enrich_failed' });
  await expect(client(answering({ results: [] }).fetch).company('y.test')).resolves.toEqual({ match: null, creditsCharged: null });
});

test('tells an account without v3 access from a bad key, and reports running out of credits', async () => {
  const v3 = fakeFetch(fakeLusha({ account: () => 'v3_not_enabled' }));
  await expect(client(v3.fetch).usage()).rejects.toMatchObject({ code: 'request_failed', status: 403, detail: 'v3_not_enabled' });
  await expect(client(v3.fetch).person({ email: 'x@y.test' })).rejects.toMatchObject({ code: 'request_failed', detail: 'v3_not_enabled' });
  const inactive = { statusCode: 403, message: 'Your account is not active. Please reach out to support at support@lusha.example' };
  await expect(client(answering(inactive, 403).fetch).usage()).rejects.toMatchObject({ code: 'rejected', status: 403, detail: null });
  await expect(client(answering({ statusCode: 402, message: 'Insufficient credits for this operation' }, 402).fetch).company('y.test'))
    .rejects.toMatchObject({ code: 'request_failed', status: 402 });
});

test("the entry's own detail is never taken for a credential, even when the key is a fragment of it", async () => {
  const v3 = fakeFetch(fakeLusha({ account: () => 'v3_not_enabled' }));
  await expect(lushaClient({ apiKey: 'enabled', fetch: v3.fetch, minIntervalMs: 0 }).usage())
    .rejects.toMatchObject({ code: 'request_failed', detail: 'v3_not_enabled' });
});
