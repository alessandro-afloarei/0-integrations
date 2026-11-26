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
const ref = 'https://docs.peopledatalabs.com/docs';

export const peopledatalabs = defineProvider({
  id: 'peopledatalabs', name: 'People Data Labs', docs: `${ref}/authentication`,
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Enrichments and searches spend the account\'s credits.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.peopledatalabs.com/v5', retry: {} },
  errors: { detail: 'error.type' },
  identify: { request: { path: '/autocomplete', query: { field: 'title' } } },
  operations: {
    'people.search': { docs: `${ref}/reference-person-search-api`, method: 'POST', path: '/person/search', params: search,
      result: { data: [person], ...found } },
    'people.get': { docs: `${ref}/reference-person-enrichment-api`, path: '/person/enrich', kind: 'write', notFound: 'null',
      params: { email: { in: 'query', type: 'string', required: true,
        description: 'The person\'s email. The API matches on any one of email, profile, phone, email_hash, lid or pdl_id, or on a name with a company, school or location.' },
        profile: { in: 'query', type: 'string' }, company: { in: 'query', type: 'string' } },
      result: { 'likelihood?': 'integer', data: person } },
    'companies.search': { docs: `${ref}/reference-company-search-api`, method: 'POST', path: '/company/search', params: search,
      result: { data: [company], ...found } },
    'companies.get': { docs: `${ref}/reference-company-enrichment-api`, path: '/company/enrich', kind: 'write', notFound: 'null',
      params: { website: { in: 'query', type: 'string', required: true,
        description: 'The company\'s website. The API matches on any one of website, profile, ticker, name or pdl_id.' },
        profile: { in: 'query', type: 'string' }, name: { in: 'query', type: 'string' } },
      result: { ...company, 'likelihood?': 'integer' } },
  },
});
