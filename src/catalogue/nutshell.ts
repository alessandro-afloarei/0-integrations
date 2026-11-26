import { defineProvider } from '../catalogue.js';

/** Nutshell's REST API: a user's email and API key as Basic. Contacts are people, accounts companies, and leads the
 * deals. Lists page by `page[page]` from 0. An update is a JSON Patch, which the engine cannot send yet, so it is left
 * out. No page names the current user, so signing in reads the users. */
const ref = 'https://developers.nutshell.com/reference';
const contact = { id: 'string', 'name?': 'string', 'firstName?': 'string', 'lastName?': 'string',
  'emails?': [{ 'value?': 'string', 'isPrimary?': 'boolean' }], 'htmlUrl?': 'string', 'createdTime?': 'integer' } as const;
const limit = { 'page[limit]': { in: 'query', type: 'integer', description: 'Results a page.' } } as const;

export const nutshell = defineProvider({
  id: 'nutshell', name: 'Nutshell', docs: 'https://developers.nutshell.com/docs/api-authentication',
  categories: ['crm'],
  fields: [{ name: 'email', title: 'Nutshell email', help: 'The email address you sign in to Nutshell with.' },
    { name: 'apiKey', title: 'API key', secret: true,
      help: 'Created under Setup, then API keys: choose the API access permission type. A web-only key (for HTML forms) cannot sign in.' }],
  auth: [{ kind: 'key', send: { basic: ['{email}', '{apiKey}'] } }],
  http: { baseUrl: 'https://app.nutshell.com/rest' },
  identify: { request: { path: '/users' } },
  paging: { contacts: { kind: 'page', send: { query: 'page[page]' }, list: 'contacts', zeroBased: true },
    accounts: { kind: 'page', send: { query: 'page[page]' }, list: 'accounts', zeroBased: true },
    leads: { kind: 'page', send: { query: 'page[page]' }, list: 'leads', zeroBased: true } },
  operations: {
    'contacts.list': { docs: `${ref}/cde301caba6b033521a71e6bed772a58`, path: '/contacts', paging: 'contacts', records: 'contacts',
      params: { email: { in: 'query', type: 'string', description: 'Only the contacts with this email address.' }, ...limit },
      result: { contacts: [contact] } },
    'contacts.get': { docs: `${ref}/8a291bf9a1a7e4a7fd1ca0cabfdaa8a7`, path: '/contacts/{id}',
      params: { id: { in: 'path', type: 'string', required: true, description: 'An API ID such as 3-contacts.' } },
      result: { contacts: [contact] } },
    'contacts.create': { docs: `${ref}/376a09558c05d3d4d273459f15a57326`, method: 'POST', path: '/contacts',
      params: { contacts: { in: 'body', description: 'One contact: only one is created at a time.',
        type: [{ 'name?': 'string', 'description?': 'string', 'emails?': [{ 'value?': 'string', 'isPrimary?': 'boolean' }],
          'links?': { 'accounts?': ['string'], 'owner?': 'string' } }] } },
      result: { contacts: [contact] } },
    'accounts.list': { docs: `${ref}/ee7a9535ab7ae30da91d6d9cebe2ed85`, path: '/accounts', paging: 'accounts', records: 'accounts',
      params: { 'page[limit]': { in: 'query', type: 'string', description: 'Results a page.' } },
      result: { accounts: [{ id: 'string', 'name?': 'string', 'description?': 'string', 'htmlUrl?': 'string', 'createdTime?': 'integer' }] } },
    'leads.list': { docs: `${ref}/132e65861bebcb3781c3d37e66aff309`, path: '/leads', paging: 'leads', records: 'leads', params: limit,
      result: { leads: [{ id: 'string', 'name?': 'string', 'status?': 'string', 'htmlUrl?': 'string',
        'createdTime?': { 'timestamp?': 'number' } }] } },
  },
});
