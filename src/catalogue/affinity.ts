import { defineProvider } from '../catalogue.js';

/** Affinity API v2: an API key; the version header pins the shapes, else the app's default version answers
 * (https://developer.affinity.co/pages/external-api-v2/versioning). A 429 past a limit; the monthly calls depend on the
 * plan (https://developer.affinity.co/pages/external-api-v2/rate-limits). Creating and updating a person are in BETA
 * (https://developer.affinity.co/pages/external-api-v2/beta-endpoints). */
const person = { id: 'integer', firstName: 'string', 'lastName?': 'string', 'primaryEmailAddress?': 'string',
  emailAddresses: ['string'], type: 'string' } as const;
const personId = { in: 'path', type: 'integer', required: true } as const;
const limit = { limit: { in: 'query', type: 'integer', description: 'Items per page, 1 to 100 (100 by default).' } } as const;
const emails = { emailAddresses: { in: 'body', type: ['string'], description: 'At most 100.' } } as const;
const ref = 'https://developer.affinity.co/api-reference/2026-09-17';

export const affinity = defineProvider({
  id: 'affinity', name: 'Affinity', docs: 'https://developer.affinity.co/pages/external-api-v2/authentication',
  categories: ['crm'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From Manage Apps in your Affinity settings ("Generate an API key" permission). The lists need the "Export All People directory", "Export All Organizations directory" and "Export data from Lists" permissions; the Essentials plan has no API calls.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.affinity.co', headers: { 'x-affinity-api-version': '2026-09-17' },
    retry: { wait: { header: 'x-ratelimit-limit-user-reset', unit: 's' } } },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/v2/auth/whoami' }, id: 'user.id', name: 'user.emailAddress' },
  paging: { next: { kind: 'nextUrl', next: 'pagination.nextUrl' } },
  operations: {
    'persons.list': { docs: `${ref}/persons/get-all-persons`, path: '/v2/persons', paging: 'next', records: 'data',
      params: limit, result: { data: [person] } },
    'persons.get': { docs: `${ref}/persons/get-a-single-person`, path: '/v2/persons/{personId}', notFound: 'null',
      params: { personId }, result: person },
    'persons.create': { docs: `${ref}/persons/create-a-person`, method: 'POST', path: '/v2/persons',
      params: { firstName: { in: 'body', type: 'string', required: true },
        lastName: { in: 'body', type: 'string', required: true, nullable: true },
        primaryEmailAddress: { in: 'body', type: 'string', required: true, nullable: true }, ...emails },
      result: person },
    'persons.update': { docs: `${ref}/persons/update-a-person`, method: 'POST', path: '/v2/persons/{personId}',
      params: { personId, firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string', nullable: true },
        primaryEmailAddress: { in: 'body', type: 'string', nullable: true }, ...emails } },
    'companies.list': { docs: `${ref}/companies/get-all-companies`, path: '/v2/companies', paging: 'next', records: 'data',
      params: limit,
      result: { data: [{ id: 'integer', name: 'string', 'domain?': 'string', domains: ['string'], isGlobal: 'boolean' }] } },
    'opportunities.list': { docs: `${ref}/opportunities/get-all-opportunities`, path: '/v2/opportunities', paging: 'next',
      records: 'data', params: limit,
      result: { data: [{ id: 'integer', name: 'string', listId: 'integer', listName: 'string' }] } },
  },
});
