import { defineProvider } from '../catalogue.js';

/** Leadfeeder: an API key per user; most calls name the account (`account_id`, from `GET /v1/accounts`). 10 requests
 * a second per key, a 429 past it (https://docs.leadfeeder.com/api/public/rate-limits-354549m0). A search spends no
 * credits, a contact's or company's details 1 unless read in the last 12 months; its OAuth 2 apps are internal only
 * (https://help.leadfeeder.com/en/articles/16547323-how-to-create-and-manage-an-oauth-application). */
const accountId = { account_id: { in: 'query', type: 'string', required: true,
  description: 'The Leadfeeder account, from List Accounts.' } } as const;
const pageSize = { 'page[size]': { in: 'query', type: 'integer', description: 'Items per page, 1 to 100 (20 by default).' } } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const ref = 'https://docs.leadfeeder.com/api/public';

export const leadfeeder = defineProvider({
  id: 'leadfeeder', name: 'Leadfeeder (formerly Dealfront)', docs: `${ref}/authentication-354547m0`,
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Leadfeeder user, under Settings, then Personal, then API Keys: Leadfeeder asks an integration used by more than one person to use OAuth 2.0. Reading a contact\'s or a company\'s details spends the account\'s credits.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.leadfeeder.com', minIntervalMs: 100, retry: {} },
  errors: { detail: 'code' },
  identify: { request: { path: '/v1/users/me' }, id: 'data.id', name: 'data.attributes.email' },
  paging: { cursor: { kind: 'cursor', next: 'meta.pagination.next_cursor', send: { query: 'page[cursor]' } } },
  operations: {
    'contacts.search': { docs: `${ref}/search-contacts-4008959e0`, method: 'POST', path: '/v1/contacts/search', kind: 'read',
      paging: 'cursor', records: 'data',
      params: { ...accountId, ...pageSize, emails: { in: 'body', type: ['string'] }, search_terms: { in: 'body', type: ['string'],
        description: 'Matched against the contact\'s full name and title.' }, company_ids: { in: 'body', type: ['string'] } },
      result: { data: [{ id: 'string', type: 'string', attributes: { 'full_name?': 'string', 'hierarchy_level?': 'string' } }] } },
    'contacts.get': { docs: `${ref}/get-contact-details-4008957e0`, path: '/v1/contacts/{id}', kind: 'write', notFound: 'null',
      params: { ...id, ...accountId },
      result: { data: { id: 'string', type: 'string', attributes: { 'first_name?': 'string', 'last_name?': 'string',
        'title?': 'string', 'hierarchy_level?': 'string' } } } },
    'companies.search': { docs: `${ref}/search-companies-4008955e0`, method: 'POST', path: '/v1/companies/search', kind: 'read',
      paging: 'cursor', records: 'data',
      params: { ...accountId, ...pageSize, search_terms: { in: 'body', type: ['string'], required: true,
        description: 'Matched against the company\'s names and domains. The search needs at least one criterion: this, or locations, industries, employee_ranges, revenue, icp_ids or filters.' } },
      result: { data: [{ id: 'string', type: 'string', attributes: { name: 'string', 'url?': 'string', 'employee_range?': 'string' } }] } },
    'companies.get': { docs: `${ref}/get-company-details-4008951e0`, path: '/v1/companies/{id}', kind: 'write', notFound: 'null',
      params: { ...id, ...accountId },
      result: { data: { id: 'string', type: 'string', attributes: { name: 'string', 'url?': 'string', 'app_url?': 'string',
        'employee_range?': 'string' } } } },
  },
});
