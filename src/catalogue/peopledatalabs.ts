import { defineProvider } from '../catalogue.js';

/** People Data Labs: an enrichment spends 1 credit per match, a search 1 per record returned, Autocomplete none
 * (https://docs.peopledatalabs.com/support/billing/how-credits-work). A 404 means no match; errors carry `error.type`
 * (https://docs.peopledatalabs.com/docs/errors). A search pages by `scroll_token` by hand: past the last page is a 404
 * (https://docs.peopledatalabs.com/docs/input-parameters-person-search-api); a 429 past the key's rate limit. */
const person = { id: 'string', 'full_name?': 'string', 'job_title?': 'string', 'job_company_id?': 'string',
  'job_company_name?': 'string', 'linkedin_url?': 'string' } as const;
const company = { id: 'string', 'name?': 'string', 'display_name?': 'string', 'website?': 'string', 'linkedin_url?': 'string',
  'industry?': 'string', 'size?': 'string' } as const;
const search = { query: { in: 'body', type: 'unknown', required: true,
  description: 'An Elasticsearch (v7.7) query; the API also takes `sql` in its place, never both.' },
  size: { in: 'body', type: 'integer', description: 'Records to return, 1 to 100 (1 by default); each spends a credit.' },
  scroll_token: { in: 'body', type: 'string', description: 'The previous answer\'s `scroll_token`, for the next batch.' } } as const;
const found = { 'total?': 'integer', 'scroll_token?': 'string' } as const;
const onePerson = ' One of: profile OR email OR phone OR email_hash OR lid OR pdl_id, or a name with a company, school or location.';
const oneCompany = ' One of: pdl_id OR name OR ticker OR website OR profile.';
const ref = 'https://docs.peopledatalabs.com/docs';

export const peopledatalabs = defineProvider({
  id: 'peopledatalabs', name: 'People Data Labs', docs: `${ref}/authentication`,
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From the API Dashboard, under Account, then API Keys. Enrichments and searches spend the account\'s credits.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.peopledatalabs.com/v5', retry: {} },
  errors: { detail: 'error.type' },
  identify: { request: { path: '/autocomplete', query: { field: 'title' } } },
  operations: {
    'people.search': { docs: `${ref}/reference-person-search-api`, method: 'POST', path: '/person/search', params: search,
      result: { data: [person], ...found } },
    'people.get': { docs: `${ref}/reference-person-enrichment-api`, path: '/person/enrich', kind: 'write', notFound: 'null',
      params: { profile: { in: 'query', type: 'string', description: 'A social profile URL, such as a LinkedIn one.' + onePerson },
        email: { in: 'query', type: 'string', description: 'An email the person has used.' + onePerson },
        phone: { in: 'query', type: 'string', description: 'A phone number, starting with + and the country code.' + onePerson } },
      result: { 'likelihood?': 'integer', data: person } },
    'companies.search': { docs: `${ref}/reference-company-search-api`, method: 'POST', path: '/company/search', params: search,
      result: { data: [company], ...found } },
    'companies.get': { docs: `${ref}/reference-company-enrichment-api`, path: '/company/enrich', kind: 'write', notFound: 'null',
      params: { name: { in: 'query', type: 'string', description: 'The company\'s name.' + oneCompany },
        ticker: { in: 'query', type: 'string', description: 'The stock ticker, if publicly traded.' + oneCompany },
        website: { in: 'query', type: 'string', description: 'The company\'s website.' + oneCompany },
        profile: { in: 'query', type: 'string', description: 'The company\'s social profile.' + oneCompany },
        pdl_id: { in: 'query', type: 'string', description: 'The company\'s PDL ID.' + oneCompany } },
      result: { ...company, 'likelihood?': 'integer' } },
  },
});
