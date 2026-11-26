import { defineProvider } from '../catalogue.js';

/** Capsule: OAuth 2, then a personal API token. A party is a person or an organisation, so there is no separate list
 * of companies. Lists page by the `Link` header (https://developer.capsulecrm.com/v2/overview/reading-from-the-api).
 * A 429 past 4,000 requests an hour per user (https://developer.capsulecrm.com/v2/overview/handling-api-responses).
 * Identify: https://developer.capsulecrm.com/v2/operations/User */
const party = { id: 'integer', 'type?': 'string', 'firstName?': 'string', 'lastName?': 'string', 'name?': 'string',
  'emailAddresses?': [{ 'address?': 'string', 'type?': 'string' }], 'organisation?': { 'id?': 'integer', 'name?': 'string' },
  'updatedAt?': 'string' } as const;
const written = { 'firstName?': 'string', 'lastName?': 'string', 'name?': 'string', 'jobTitle?': 'string',
  'emailAddresses?': [{ address: 'string', 'type?': 'string' }], 'organisation?': { 'id?': 'integer', 'name?': 'string' } } as const;
const partyId = { in: 'path', type: 'integer', required: true } as const;
const perPage = { perPage: { in: 'query', type: 'integer', description: 'Results per page: 50 by default, 1 to 100.' } } as const;
const ref = 'https://developer.capsulecrm.com/v2/operations';

export const capsule = defineProvider({
  id: 'capsule', name: 'Capsule', docs: 'https://developer.capsulecrm.com/v2/overview/authentication',
  categories: ['crm'],
  fields: [{ name: 'accessToken', title: 'API authentication token', secret: true,
    help: 'For your own Capsule account: My Preferences, then API Authentication Tokens. An app shared with other people connects with the OAuth 2 sign-in.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.capsulecrm.com/oauth/authorise', tokenUrl: 'https://api.capsulecrm.com/oauth/token',
    pkce: false, authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: ['read', 'write'] },
  revoke: { url: 'https://api.capsulecrm.com/oauth/token/revoke', token: ['refresh', 'access'] },
  http: { baseUrl: 'https://api.capsulecrm.com/api/v2', retry: {} },
  identify: { request: { path: '/users/current' }, id: 'user.id', name: 'user.name' },
  paging: { link: { kind: 'linkHeader' } },
  operations: {
    'parties.list': { docs: `${ref}/Party#listParties`, path: '/parties', paging: 'link', records: 'parties', params: perPage,
      result: { parties: [party] } },
    'parties.get': { docs: `${ref}/Party#showParty`, path: '/parties/{partyId}', params: { partyId },
      result: { party } },
    'parties.create': { docs: `${ref}/Party#createParty`, method: 'POST', path: '/parties',
      params: { party: { in: 'body', required: true, type: { type: 'string', ...written },
        description: 'type is person (firstName, lastName) or organisation (name).' } }, result: { party } },
    'parties.update': { docs: `${ref}/Party#updateParty`, method: 'PUT', path: '/parties/{partyId}',
      params: { partyId, party: { in: 'body', required: true, type: written,
        description: 'Only the fields sent change; an email address without an id is added.' } }, result: { party } },
    'parties.search': { docs: `${ref}/Party#searchParties`, path: '/parties/search', paging: 'link', records: 'parties',
      params: { q: { in: 'query', type: 'string', description: 'The value to search for, such as a name, a postcode or a phone number.' }, ...perPage },
      result: { parties: [party] } },
    'opportunities.list': { docs: `${ref}/Opportunity#listOpportunities`, path: '/opportunities', paging: 'link',
      records: 'opportunities', params: perPage,
      result: { opportunities: [{ id: 'integer', 'name?': 'string', 'party?': { 'id?': 'integer', 'name?': 'string' },
        'milestone?': { 'id?': 'integer', 'name?': 'string' }, 'value?': { 'amount?': 'number', 'currency?': 'string' },
        'closedOn?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' }] } },
  },
});
