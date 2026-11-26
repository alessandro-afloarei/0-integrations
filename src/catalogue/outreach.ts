import { defineProvider } from '../catalogue.js';

/** Outreach: OAuth 2 only; until Outreach reviews the app, people outside its organization re-authorize it weekly
 * (https://developers.outreach.io/api/oauth, https://developers.outreach.io/guides/managing-apps). JSON:API bodies,
 * `links.next` paging, `errors[].id` codes: https://developers.outreach.io/api/making-requests. Webhooks: the hex
 * HMAC-SHA256 of the body in `Outreach-Webhook-Signature` (https://developers.outreach.io/api/webhooks). */
const prospect = { id: 'integer', 'attributes?': { 'name?': 'string', 'emails?': ['string'], 'title?': 'string',
  'company?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' } } as const;
const written = { 'firstName?': 'string', 'lastName?': 'string', 'emails?': ['string'], 'title?': 'string', 'company?': 'string' } as const;
const id = { in: 'path', type: 'integer', required: true } as const;
const size = { 'page[size]': { in: 'query', type: 'integer', description: 'Records per page.' } } as const;
const link = { data: { type: 'string', id: 'integer' } } as const;
const ref = 'https://developers.outreach.io/api/reference';

export const outreach = defineProvider({
  id: 'outreach', name: 'Outreach', docs: 'https://developers.outreach.io/api/getting-started',
  categories: ['sales'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.outreach.io/oauth/authorize', tokenUrl: 'https://api.outreach.io/oauth/token',
    pkce: false, authorizeParams: { response_type: 'code' } }],
  scopes: { default: ['prospects.read', 'prospects.write', 'sequences.read', 'sequenceStates.write'] },
  http: { baseUrl: 'https://api.outreach.io/api/v2', headers: { 'content-type': 'application/vnd.api+json' }, retry: {} },
  identify: { request: {} },
  errors: { detail: 'errors.0.id' },
  webhook: { kind: 'hmac', header: 'outreach-webhook-signature' },
  paging: { next: { kind: 'nextUrl', next: 'links.next' } },
  operations: {
    'sequences.list': { docs: `${ref}/sequence/paths/~1sequences/get`, path: '/sequences', paging: 'next', records: 'data', params: size,
      result: { data: [{ id: 'integer', 'attributes?': { 'name?': 'string', 'enabled?': 'boolean', 'createdAt?': 'string',
        'updatedAt?': 'string' } }] } },
    'prospects.list': { docs: `${ref}/prospect/paths/~1prospects/get`, path: '/prospects', paging: 'next', records: 'data',
      params: size, result: { data: [prospect] } },
    'prospects.get': { docs: `${ref}/prospect/paths/~1prospects~1%7Bid%7D/get`, path: '/prospects/{id}', notFound: 'null',
      params: { id }, result: { data: prospect } },
    'prospects.create': { docs: `${ref}/prospect/paths/~1prospects/post`, method: 'POST', path: '/prospects',
      params: { data: { in: 'body', required: true, type: { type: 'string', 'attributes?': written },
        description: 'The resource object: `type` is `prospect`.' } }, result: { data: prospect } },
    'prospects.update': { docs: `${ref}/prospect/paths/~1prospects~1%7Bid%7D/patch`, method: 'PATCH', path: '/prospects/{id}',
      params: { id, data: { in: 'body', required: true, type: { type: 'string', id: 'integer', 'attributes?': written },
        description: 'The resource object: `type` is `prospect`, `id` the same as the path\'s.' } }, result: { data: prospect } },
    'sequenceStates.create': { docs: 'https://developers.outreach.io/api/common-patterns#add-prospects-to-sequences',
      method: 'POST', path: '/sequenceStates',
      params: { data: { in: 'body', required: true,
        type: { type: 'string', relationships: { prospect: link, sequence: link, mailbox: link } },
        description: 'The resource object: `type` is `sequenceState`; each relationship\'s `data.type` is its name.' } },
      result: { data: { id: 'integer', 'attributes?': { 'state?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' } } } },
  },
});
