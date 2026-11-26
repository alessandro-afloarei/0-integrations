import { defineProvider } from '../catalogue.js';

/** Salesloft, pages under https://developers.salesloft.com/docs/: other teams use an OAuth 2 app once Salesloft
 * allowlists it: platform/marketplace/submission-checklist/. The key, identify (no scope), the `data`
 * envelope, paging, webhooks (hex HMAC-SHA1): platform/api-basics/api-key-authentication/, api/me-index/,
 * platform/api-basics/request-response-format/, …/filtering-paging-sorting/, platform/webhooks/delivery-headers/. */
const person = { id: 'integer', 'display_name?': 'string', 'email_address?': 'string', 'account?': { 'id?': 'integer' },
  'owner?': { 'id?': 'integer' }, 'created_at?': 'string', 'updated_at?': 'string' } as const;
const perPage = { per_page: { in: 'query', type: 'integer', description: '1 to 100, 25 by default.' } } as const;
const id = { in: 'path', type: 'string', required: true } as const;
const written = { first_name: { in: 'body', type: 'string' }, last_name: { in: 'body', type: 'string' },
  title: { in: 'body', type: 'string' }, phone: { in: 'body', type: 'string' }, account_id: { in: 'body', type: 'integer' },
  owner_id: { in: 'body', type: 'integer' } } as const;
const api = 'https://developers.salesloft.com/docs/api';

export const salesloft = defineProvider({
  id: 'salesloft', name: 'Salesloft', docs: 'https://developers.salesloft.com/docs/platform/api-basics/oauth-authentication/',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Salesloft account: Salesloft makes API keys for customers, and an app for other people connects with the OAuth 2 sign-in. Give the key the people:read, people:write, cadences:read and cadences:write scopes.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://accounts.salesloft.com/oauth/authorize', tokenUrl: 'https://accounts.salesloft.com/oauth/token',
    json: true, pkce: false, authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: ['people:read', 'people:write', 'cadences:read', 'cadences:write'] },
  http: { baseUrl: 'https://api.salesloft.com' },
  identify: { request: { path: '/v2/me' }, id: 'data.id', name: ['data.name', 'data.email'] },
  webhook: { kind: 'hmac', header: 'x-salesloft-signature', hash: 'sha1' },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'data' } },
  operations: {
    'cadences.list': { docs: `${api}/cadences-index/`, path: '/v2/cadences', paging: 'page', records: 'data', params: perPage,
      result: { data: [{ id: 'integer', 'name?': 'string', 'current_state?': 'string', 'archived?': 'boolean',
        'owner?': { 'id?': 'integer' }, 'created_at?': 'string', 'updated_at?': 'string' }] } },
    'people.list': { docs: `${api}/people-index/`, path: '/v2/people', paging: 'page', records: 'data', params: perPage,
      result: { data: [person] } },
    'people.get': { docs: `${api}/people-show/`, path: '/v2/people/{id}', notFound: 'null', params: { id }, result: { data: person } },
    'people.create': { docs: `${api}/people-create/`, method: 'POST', path: '/v2/people',
      params: { email_address: { in: 'body', type: 'string', required: true,
        description: 'Salesloft takes this, or `phone` with `last_name`, as the person\'s unique lookup on the team.' }, ...written },
      result: { data: person } },
    'people.update': { docs: `${api}/people-update/`, method: 'PUT', path: '/v2/people/{id}',
      params: { id, email_address: { in: 'body', type: 'string' }, ...written }, result: { data: person } },
    'cadenceMemberships.create': { docs: `${api}/cadence-memberships-create/`, method: 'POST', path: '/v2/cadence_memberships',
      params: { person_id: { in: 'query', type: 'integer', required: true }, cadence_id: { in: 'query', type: 'integer', required: true } },
      result: { data: { id: 'integer', 'current_state?': 'string', 'person?': { 'id?': 'integer' }, 'cadence?': { 'id?': 'integer' },
        'created_at?': 'string', 'updated_at?': 'string' } } },
  },
});
