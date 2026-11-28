import { defineProvider } from '../catalogue.js';

/** RocketReach: a lookup spends an export credit when it finds data and may answer before it ends (`status` not
 * "complete"); searches are metered (https://docs.rocketreach.co/reference/faq). 429 with `Retry-After`, out of lookup
 * credits a 403 (https://docs.rocketreach.co/reference/responses-and-errors). A search answers one page: `start` counts
 * from 1. Webhooks: base64 HMAC-SHA256 of the body (https://docs.rocketreach.co/reference/webhooks). */
const ref = 'https://docs.rocketreach.co/reference';
const search = { query: { in: 'body', type: 'unknown', description: 'The search terms, such as { "current_title": ["Software Engineer"] }.' },
  start: { in: 'body', type: 'integer', description: 'The first result to return, counting from 1 (1 by default); at most 10,000.' },
  page_size: { in: 'body', type: 'integer', description: 'Results per page, 1 to 100 (10 by default).' },
  order_by: { in: 'body', type: 'string', enum: ['relevance', 'popularity', 'score'] } } as const;
const person = { id: 'integer', 'name?': 'string', 'current_title?': 'string', 'current_employer?': 'string',
  'current_employer_id?': 'integer', 'current_employer_domain?': 'string', 'linkedin_url?': 'string', 'location?': 'string' } as const;
const company = { id: 'integer', 'name?': 'string', 'email_domain?': 'string', 'industry_str?': 'string', 'city?': 'string',
  'region?': 'string', 'country_code?': 'string' } as const;

export const rocketreach = defineProvider({
  id: 'rocketreach', name: 'RocketReach', docs: `${ref}/rocketreach-api-account`,
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From the API section of your RocketReach account settings. Lookups and searches spend the account\'s credits.' }],
  auth: [{ kind: 'key', send: { header: 'api-key' } }],
  http: { baseUrl: 'https://api.rocketreach.co/api/v2', retry: {} },
  identify: { request: { path: '/account/' }, id: 'id', name: 'email' },
  webhook: { kind: 'hmac', header: 'x-rocketreach-signature', encoding: 'base64' },
  operations: {
    'people.search': { docs: `${ref}/people-search-api`, method: 'POST', path: '/person/search', kind: 'write', params: search,
      result: [person] },
    'people.get': { docs: `${ref}/people-lookup-api`, path: '/person/lookup', kind: 'write', notFound: 'null',
      params: { email: { in: 'query', type: 'string', description: 'The person\'s email.' },
        linkedin_url: { in: 'query', type: 'string', description: 'The person\'s LinkedIn URL.' },
        id: { in: 'query', type: 'integer', description: 'RocketReach\'s profile id.' },
        name: { in: 'query', type: 'string', description: 'The person\'s name. Must specify along with current_employer.' },
        current_employer: { in: 'query', type: 'string', description: 'The person\'s current employer. Must specify along with name.' } },
      result: { id: 'integer', 'status?': 'string', 'name?': 'string', 'current_title?': 'string', 'current_employer?': 'string',
        'linkedin_url?': 'string', 'recommended_email?': 'string', 'location?': 'string' } },
    'companies.search': { docs: `${ref}/company-search-api`, method: 'POST', path: '/searchCompany', kind: 'write', params: search,
      result: [company] },
    'companies.get': { docs: `${ref}/company-lookup-api`, path: '/company/lookup/', kind: 'write', notFound: 'null',
      params: { domain: { in: 'query', type: 'string', description: 'The company\'s domain (preferred).' },
        name: { in: 'query', type: 'string', description: 'The company\'s name.' },
        linkedin_url: { in: 'query', type: 'string', description: 'The company\'s LinkedIn URL.' },
        id: { in: 'query', type: 'integer', description: 'RocketReach\'s company id.' } },
      result: { id: 'integer', 'name?': 'string', 'domain?': 'string', 'industry?': 'string', 'num_employees?': 'integer',
        'year_founded?': 'integer', 'rr_profile_url?': 'string', 'description?': 'string' } },
  },
});
