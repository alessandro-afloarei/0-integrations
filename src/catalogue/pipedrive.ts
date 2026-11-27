import { defineProvider } from '../catalogue.js';

/** Pipedrive: OAuth 2, its scopes set on the app (contacts:full, deals:read); a private app installs by its own link, a
 * listing passes Pipedrive's approval: https://pipedrive.readme.io/docs/marketplace-creating-a-proper-app
 * Calls go to the token answer's `api_domain`, /api/v2 (https://pipedrive.readme.io/docs/core-api-concepts-requests)
 * or /api/v1; the revoke ends the refresh token: https://pipedrive.readme.io/docs/app-uninstallation */
const person = { id: 'integer', 'name?': 'string', 'emails?': [{ 'value?': 'string', 'primary?': 'boolean' }], 'org_id?': 'integer',
  'owner_id?': 'integer', 'add_time?': 'string', 'update_time?': 'string', 'custom_fields?': 'unknown' } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '100 by default, at most 500.' } } as const;
const id = { id: { in: 'path', type: 'integer', required: true } } as const;
const written = { emails: { in: 'body', type: [{ value: 'string', 'primary?': 'boolean', 'label?': 'string' }] },
  org_id: { in: 'body', type: 'integer' }, owner_id: { in: 'body', type: 'integer' } } as const;
const ref = 'https://developers.pipedrive.com/docs/api/v1';

export const pipedrive = defineProvider({
  id: 'pipedrive', name: 'Pipedrive', docs: 'https://pipedrive.readme.io/docs/marketplace-oauth-authorization',
  categories: ['crm'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://oauth.pipedrive.com/oauth/authorize', tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    pkce: false, clientAuth: 'basic', authorizeParams: { response_type: 'code' } }],
  scopes: { default: [] },
  revoke: { url: 'https://oauth.pipedrive.com/oauth/revoke', token: ['refresh'] },
  save: { apiDomain: 'tokenAnswer.api_domain' },
  http: { baseUrl: 'https://{apiDomain}/api', host: '*.pipedrive.com', headers: { 'content-type': 'application/json' } },
  identify: { request: { path: '/v1/users/me' }, id: '{data.company_id}:{data.id}', name: ['data.name', 'data.email'] },
  errors: { detail: 'code' },
  paging: { cursor: { kind: 'cursor', next: 'additional_data.next_cursor', send: { query: 'cursor' } } },
  operations: {
    'persons.list': { docs: `${ref}/Persons#getPersons`, path: '/v2/persons', paging: 'cursor', records: 'data',
      params: { org_id: { in: 'query', type: 'integer' }, ...limit }, result: { data: [person] } },
    'persons.search': { docs: `${ref}/Persons#searchPersons`, path: '/v2/persons/search', paging: 'cursor', records: 'data.items',
      params: { term: { in: 'query', type: 'string', required: true, description: 'At least 2 characters (or 1 with exact_match).' },
        fields: { in: 'query', type: 'string', description: 'Comma-separated fields to search, such as email; all of them by default.' },
        exact_match: { in: 'query', type: 'boolean' }, organization_id: { in: 'query', type: 'integer' },
        limit: { in: 'query', type: 'integer', description: '100 by default, at most 100.' } },
      result: { data: { items: [{ 'result_score?': 'number', item: { id: 'integer', 'name?': 'string', 'emails?': ['string'],
        'organization?': { 'id?': 'integer', 'name?': 'string' }, 'owner?': { 'id?': 'integer' } } }] } } },
    'persons.get': { docs: `${ref}/Persons#getPerson`, path: '/v2/persons/{id}', notFound: 'null', params: id, result: { data: person } },
    'persons.create': { docs: `${ref}/Persons#addPerson`, method: 'POST', path: '/v2/persons',
      params: { name: { in: 'body', type: 'string', required: true }, ...written }, result: { data: person } },
    'persons.update': { docs: `${ref}/Persons#updatePerson`, method: 'PATCH', path: '/v2/persons/{id}',
      params: { ...id, name: { in: 'body', type: 'string' }, ...written }, result: { data: person } },
    'organizations.list': { docs: `${ref}/Organizations#getOrganizations`, path: '/v2/organizations', paging: 'cursor', records: 'data',
      params: limit, result: { data: [{ id: 'integer', 'name?': 'string', 'owner_id?': 'integer', 'website?': 'string',
        'add_time?': 'string', 'update_time?': 'string', 'custom_fields?': 'unknown' }] } },
    'deals.list': { docs: `${ref}/Deals#getDeals`, path: '/v2/deals', paging: 'cursor', records: 'data',
      params: { org_id: { in: 'query', type: 'integer' }, ...limit },
      result: { data: [{ id: 'integer', 'title?': 'string', 'status?': 'string', 'person_id?': 'integer', 'org_id?': 'integer',
        'add_time?': 'string', 'update_time?': 'string', 'custom_fields?': 'unknown' }] } },
  },
});
