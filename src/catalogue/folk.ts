import { defineProvider } from '../catalogue.js';

/** folk: an API key; the version header pins the shapes (https://developer.folk.app/api-reference/versioning). A 429
 * names its wait in `Retry-After` (https://developer.folk.app/api-reference/rate-limits). Deals are the `Deals` object
 * type of a group (https://developer.folk.app/core-concepts/deals). Webhooks are Standard Webhooks, a `whsec_` secret
 * (https://developer.folk.app/webhooks/handle-deliveries, https://developer.folk.app/webhooks/events-and-payloads). */
const person = { id: 'string', fullName: 'string', firstName: 'string', lastName: 'string', 'jobTitle?': 'string',
  emails: ['string'], companies: [{ id: 'string', 'name?': 'string' }], 'createdAt?': 'string' } as const;
const personId = { in: 'path', type: 'string', required: true } as const;
const limit = { limit: { in: 'query', type: 'integer', description: 'Items per page, 1 to 100 (20 by default).' } } as const;
const written = { firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string' },
  fullName: { in: 'body', type: 'string' }, jobTitle: { in: 'body', type: 'string' },
  emails: { in: 'body', type: ['string'], description: 'At most 20; the first is the primary email.' },
  companies: { in: 'body', type: [{ 'id?': 'string', 'name?': 'string' }],
    description: 'Each an `id`, or a `name` (a company of that name is made if none exists); the first is the primary.' } } as const;
const ref = 'https://developer.folk.app/api-reference';

export const folk = defineProvider({
  id: 'folk', name: 'folk', docs: `${ref}/authentication`,
  categories: ['crm'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true, help: 'From your workspace settings, under API.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.folk.app', headers: { 'x-api-version': '2025-06-09' }, retry: {} },
  errors: { detail: 'error.code' },
  identify: { request: { path: '/v1/users/me' }, id: 'data.id', name: ['data.fullName', 'data.email'] },
  paging: { next: { kind: 'nextUrl', next: 'data.pagination.nextLink' } },
  webhook: { kind: 'standard', deliveryId: { header: 'webhook-id' } },
  operations: {
    'people.list': { docs: `${ref}/people/list-people`, path: '/v1/people', paging: 'next', records: 'data.items',
      params: limit, result: { data: { items: [person] } } },
    'people.search': { docs: `${ref}/filtering`, path: '/v1/people', paging: 'next', records: 'data.items',
      params: { 'filter[emails][eq]': { in: 'query', type: 'string', required: true,
        description: 'An email the person has: the list filtered to the people who have it.' }, ...limit },
      result: { data: { items: [person] } } },
    'people.get': { docs: `${ref}/people/get-a-person`, path: '/v1/people/{personId}', notFound: 'null',
      params: { personId }, result: { data: person } },
    'people.create': { docs: `${ref}/people/create-a-person`, method: 'POST', path: '/v1/people', params: written,
      result: { data: person } },
    'people.update': { docs: `${ref}/people/update-a-person`, method: 'PATCH', path: '/v1/people/{personId}',
      params: { personId, ...written }, result: { data: person } },
    'companies.list': { docs: `${ref}/companies/list-companies`, path: '/v1/companies', paging: 'next', records: 'data.items',
      params: limit, result: { data: { items: [{ id: 'string', name: 'string', 'createdAt?': 'string' }] } } },
    'deals.list': { docs: `${ref}/custom-objects/list-objects`, path: '/v1/groups/{groupId}/{objectType}', paging: 'next',
      records: 'data.items',
      params: { groupId: { in: 'path', type: 'string', required: true },
        objectType: { in: 'path', type: 'string', required: true,
          description: 'The object type as the group names it, case-sensitive: `Deals` by folk\'s convention.' }, ...limit },
      result: { data: { items: [{ id: 'string', name: 'string', 'createdAt?': 'string' }] } } },
  },
});
