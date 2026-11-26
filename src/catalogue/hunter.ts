import { defineProvider } from '../catalogue.js';

/** Hunter: a search costs 1 credit, an enrichment 0.2, Discover none (https://hunter.io/api-documentation/v2#account);
 * a Domain Search page counts only when it finds results. The rate limit is a 403 `too_many_requests`, a 429 the
 * plan's usage limit (https://hunter.io/api-documentation/v2#errors). Free plans page neither Domain Search past 10
 * results nor Discover past its first page. Webhooks are unsigned. */
const api = 'https://hunter.io/api-documentation/v2';
const email = { value: 'string', 'first_name?': 'string', 'last_name?': 'string', 'position?': 'string',
  'department?': 'string', 'linkedin?': 'string', 'confidence?': 'integer' } as const;
const person = { id: 'string', email: 'string', 'name?': { 'fullName?': 'string' }, 'location?': 'string',
  'employment?': { 'domain?': 'string', 'name?': 'string', 'title?': 'string' }, 'linkedin?': { 'handle?': 'string' } } as const;
const company = { id: 'string', domain: 'string', 'name?': 'string', 'description?': 'string', 'foundedYear?': 'integer',
  'category?': { 'industry?': 'string' }, 'metrics?': { 'employees?': 'string' }, 'linkedin?': { 'handle?': 'string' } } as const;
const found = { domain: 'string', 'organization?': 'string', 'industry?': 'string', 'headcount?': 'string', 'country?': 'string' } as const;

export const hunter = defineProvider({
  id: 'hunter', name: 'Hunter', docs: `${api}#authentication`,
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From the API keys page of your Hunter dashboard. Domain searches and enrichments spend the account\'s credits.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.hunter.io/v2', rateLimit: { when: [{ status: 403, detail: 'too_many_requests' }] } },
  errors: { detail: 'errors.0.id' },
  identify: { request: { path: '/account-stats' }, id: 'data.id', name: 'data.email' },
  paging: { emails: { kind: 'offset', send: { query: 'offset' }, list: 'data.emails' },
    companies: { kind: 'offset', send: { body: 'offset' }, list: 'data' } },
  operations: {
    'people.search': { docs: `${api}#domain-search`, path: '/domain-search', kind: 'write', paging: 'emails',
      records: 'data.emails',
      params: { domain: { in: 'query', type: 'string', required: true,
        description: 'The company\'s domain, such as stripe.com. Hunter takes a domain or a company name; the domain wins.' },
        company: { in: 'query', type: 'string' },
        limit: { in: 'query', type: 'integer', description: 'Email addresses per page, 10 by default, at most 100.' } },
      result: { data: { 'domain?': 'string', 'organization?': 'string', emails: [email] }, 'meta?': { 'results?': 'integer' } } },
    'people.get': { docs: `${api}#email-enrichment`, path: '/people/find', kind: 'write', notFound: 'null',
      params: { email: { in: 'query', type: 'string', required: true,
        description: 'The person\'s email. Hunter takes an email or a LinkedIn handle; the handle wins.' },
        linkedin_handle: { in: 'query', type: 'string' } },
      result: { data: person } },
    'companies.search': { docs: `${api}#discover`, method: 'POST', path: '/discover', kind: 'read', paging: 'companies',
      records: 'data',
      params: { query: { in: 'body', type: 'string', required: true,
        description: 'The companies in plain words, such as "Companies in Europe in the Tech Industry". Hunter takes this or at least one filter; to page an assistant search the same way each time, it recommends sending back the `meta.filters` of the first page as filters instead.' },
        limit: { in: 'body', type: 'integer', description: 'Companies per page, at most 100 (the default).' } },
      result: { data: [found], 'meta?': { 'results?': 'integer' } } },
    'companies.get': { docs: `${api}#company-enrichment`, path: '/companies/find', kind: 'write', notFound: 'null',
      params: { domain: { in: 'query', type: 'string', required: true } },
      result: { data: company } },
  },
});
