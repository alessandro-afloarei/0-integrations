import { defineProvider } from '../catalogue.js';

/** Pipedrive with an API token; OAuth 2.0 is on the waiting list. Every request sends JSON's content type:
 * https://pipedrive.readme.io/docs/core-api-concepts-requests. A 429 past a per-plan limit:
 * https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting. Errors carry a `code`:
 * https://pipedrive.readme.io/docs/core-api-concepts-responses */
const person = { id: 'integer', 'name?': 'string', 'emails?': [{ 'value?': 'string', 'primary?': 'boolean' }],
  'org_id?': 'integer', 'owner_id?': 'integer', 'add_time?': 'string', 'update_time?': 'string', 'custom_fields?': 'unknown' } as const;
const id = { in: 'path', type: 'integer', required: true } as const;
const limit = { in: 'query', type: 'integer', description: 'Results per page: 100 by default, at most 500.' } as const;
const written = { emails: { in: 'body', type: [{ 'value?': 'string', 'primary?': 'boolean' }] },
  org_id: { in: 'body', type: 'integer' }, owner_id: { in: 'body', type: 'integer' } } as const;
const ref = 'https://developers.pipedrive.com/docs/api/v1';

export const pipedrive = defineProvider({
  id: 'pipedrive', name: 'Pipedrive', docs: 'https://pipedrive.readme.io/docs/core-api-concepts-authentication',
  categories: ['crm'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own Pipedrive account. It acts as you in one company, with access to all your data, and only one is active at a time.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-token' } }],
  http: { baseUrl: 'https://api.pipedrive.com', headers: { 'content-type': 'application/json' }, retry: {} },
  identify: { request: { path: '/v1/users/me' }, id: 'data.id', name: ['data.name', 'data.email'] },
  errors: { detail: 'code' },
  paging: { cursor: { kind: 'cursor', next: 'additional_data.next_cursor', send: { query: 'cursor' } } },
  operations: {
    'persons.list': { docs: `${ref}/Persons#getPersons`, path: '/api/v2/persons', paging: 'cursor', records: 'data',
      params: { org_id: { in: 'query', type: 'integer' }, limit }, result: { data: [person] } },
    'persons.get': { docs: `${ref}/Persons#getPerson`, path: '/api/v2/persons/{id}', notFound: 'null', params: { id },
      result: { data: person } },
    'persons.create': { docs: `${ref}/Persons#addPerson`, method: 'POST', path: '/api/v2/persons',
      params: { name: { in: 'body', type: 'string', required: true }, ...written }, result: { data: person } },
    'persons.update': { docs: `${ref}/Persons#updatePerson`, method: 'PATCH', path: '/api/v2/persons/{id}',
      params: { id, name: { in: 'body', type: 'string' }, ...written }, result: { data: person } },
    'persons.search': { docs: `${ref}/Persons#searchPersons`, path: '/api/v2/persons/search', paging: 'cursor', records: 'data.items',
      params: { term: { in: 'query', type: 'string', required: true, description: 'At least 2 characters (1 with exact_match).' },
        fields: { in: 'query', type: 'string', description: 'Comma-separated fields to search, such as email.' },
        exact_match: { in: 'query', type: 'boolean' },
        limit: { in: 'query', type: 'integer', description: 'Results per page: 100 by default, at most 100.' } },
      result: { data: { items: [{ 'result_score?': 'number', item: { id: 'integer', 'name?': 'string', 'emails?': ['string'],
        'organization?': { 'id?': 'integer', 'name?': 'string' }, 'owner?': { 'id?': 'integer' } } }] } } },
    'organizations.list': { docs: `${ref}/Organizations#getOrganizations`, path: '/api/v2/organizations', paging: 'cursor',
      records: 'data', params: { limit },
      result: { data: [{ id: 'integer', 'name?': 'string', 'owner_id?': 'integer', 'website?': 'string', 'add_time?': 'string',
        'update_time?': 'string' }] } },
    'deals.list': { docs: `${ref}/Deals#getDeals`, path: '/api/v2/deals', paging: 'cursor', records: 'data',
      params: { org_id: { in: 'query', type: 'integer' }, limit },
      result: { data: [{ id: 'integer', 'title?': 'string', 'status?': 'string', 'value?': 'number', 'person_id?': 'integer',
        'org_id?': 'integer', 'add_time?': 'string', 'update_time?': 'string' }] } },
  },
});
