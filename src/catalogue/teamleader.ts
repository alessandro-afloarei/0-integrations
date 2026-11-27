import { defineProvider } from '../catalogue.js';

/** Teamleader Focus: OAuth 2 only, scopes chosen at registration. Every method is a POST with a JSON body; a list
 * answers one page (`page.number` is nested in the body). A 429 past the limit; errors are titles only:
 * https://developer.focus.teamleader.eu/docs/general-principles. The docs show the latest API version; an older
 * integration sends `x-api-version`: https://developer.focus.teamleader.eu/docs/changelog/upgrading-api-version */
const contact = { id: 'string', 'first_name?': 'string', 'last_name?': 'string', 'status?': 'string',
  'emails?': [{ 'type?': 'string', 'email?': 'string' }], 'web_url?': 'string', 'added_at?': 'string', 'updated_at?': 'string' } as const;
const page = { page: { in: 'body', type: { 'size?': 'number', 'number?': 'number' },
  description: 'The page asked for: size (20 by default) and number (1 by default).' } } as const;
const emails = { emails: { in: 'body', type: [{ type: 'string', email: 'string' }], description: 'Each type is primary.' } } as const;
const ref = 'https://developer.focus.teamleader.eu/docs/api';

export const teamleader = defineProvider({
  id: 'teamleader', name: 'Teamleader Focus', docs: 'https://developer.focus.teamleader.eu/docs/authentication',
  categories: ['crm'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://focus.teamleader.eu/oauth2/authorize',
    tokenUrl: 'https://focus.teamleader.eu/oauth2/access_token', pkce: false, authorizeParams: { response_type: 'code' } }],
  scopes: { default: [] },
  // A 429 waits its `x-ratelimit-reset`, else the sliding minute.
  http: { baseUrl: 'https://api.focus.teamleader.eu',
    retry: { defaultWaitMs: 60_000, wait: { header: 'x-ratelimit-reset', unit: 'iso8601' } } },
  identify: { request: { method: 'POST', path: '/users.me' }, id: 'data.id', name: 'data.email' },
  operations: {
    'contacts.list': { docs: `${ref}/contacts-list`, method: 'POST', path: '/contacts.list', kind: 'read',
      params: { filter: { in: 'body', type: { 'email?': { type: 'string', email: 'string' }, 'company_id?': 'string', 'term?': 'string',
        'updated_since?': 'string' }, description: 'email: { type: "primary", email }; term searches names, email and telephone.' }, ...page },
      result: { data: [contact] } },
    'contacts.get': { docs: `${ref}/contacts-info`, method: 'POST', path: '/contacts.info', kind: 'read',
      params: { id: { in: 'body', type: 'string', required: true } }, result: { data: contact } },
    'contacts.create': { docs: `${ref}/contacts-add`, method: 'POST', path: '/contacts.add',
      params: { last_name: { in: 'body', type: 'string', required: true }, first_name: { in: 'body', type: 'string' }, ...emails },
      result: { data: { id: 'string', 'type?': 'string' } } },
    'contacts.update': { docs: `${ref}/contacts-update`, method: 'POST', path: '/contacts.update',
      params: { id: { in: 'body', type: 'string', required: true }, first_name: { in: 'body', type: 'string' },
        last_name: { in: 'body', type: 'string' }, ...emails } },
    'companies.list': { docs: `${ref}/companies-list`, method: 'POST', path: '/companies.list', kind: 'read',
      params: { filter: { in: 'body', type: { 'term?': 'string', 'updated_since?': 'string' } }, ...page },
      result: { data: [{ id: 'string', 'name?': 'string', 'status?': 'string', 'website?': 'string', 'web_url?': 'string',
        'added_at?': 'string', 'updated_at?': 'string' }] } },
    'deals.list': { docs: `${ref}/deals-list`, method: 'POST', path: '/deals.list', kind: 'read', params: page,
      result: { data: [{ id: 'string', 'title?': 'string', 'status?': 'string',
        'lead?': { 'customer?': { 'type?': 'string', 'id?': 'string' } }, 'estimated_value?': { 'amount?': 'number', 'currency?': 'string' },
        'web_url?': 'string', 'created_at?': 'string', 'updated_at?': 'string' }] } },
  },
});
