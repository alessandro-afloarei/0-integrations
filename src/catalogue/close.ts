import { defineProvider } from '../catalogue.js';

/** Close: OAuth 2, private to the app's own organization until Close reviews it and makes it public
 * (https://developer.close.com/integrations/publish), then an API key with an access level
 * (https://help.close.com/docs/api-keys-oauth). Companies are leads, deals are opportunities. Identify:
 * https://developer.close.com/api/resources/users/get-me */
const email = { email: 'string', 'type?': 'string' } as const;
const contactKeys = { 'name?': 'string', 'title?': 'string', 'lead_id?': 'string', 'emails?': [email] } as const;
const contact = { id: 'string', display_name: 'string', ...contactKeys, date_created: 'string', date_updated: 'string' } as const;
const written = { name: { in: 'body', type: 'string' }, title: { in: 'body', type: 'string' },
  emails: { in: 'body', type: [{ email: 'string', 'type?': 'string' }] } } as const;
const limit = { _limit: { in: 'query', type: 'integer', description: 'Results per page: 100 by default; the maximum varies by resource.' } } as const;
const ref = 'https://developer.close.com/api/resources';

export const close = defineProvider({
  id: 'close', name: 'Close', docs: 'https://developer.close.com/api/overview/oauth-authentication',
  categories: ['crm'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Close organization: Settings, then Developer, then API Keys, with the access level "Read, write, and delete". An app for other Close customers connects with the OAuth 2 sign-in.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.close.com/oauth2/authorize/', tokenUrl: 'https://api.close.com/oauth2/token/',
    pkce: false, authorizeParams: { response_type: 'code' } }, { kind: 'key', send: { basic: ['{apiKey}', ''] } }],
  scopes: { default: ['all.full_access'] },
  revoke: { url: 'https://api.close.com/oauth2/revoke/', token: ['refresh'] },
  http: { baseUrl: 'https://api.close.com/api/v1', retry: {} },
  identify: { request: { path: '/me/' }, id: 'id', name: 'email' },
  errors: { detail: 'error_code' },
  paging: { skip: { kind: 'offset', send: { query: '_skip' }, list: 'data', more: 'has_more' },
    cursor: { kind: 'cursor', next: 'cursor', send: { body: 'cursor' } } },
  operations: {
    'contacts.list': { docs: `${ref}/contacts/list`, path: '/contact/', paging: 'skip', records: 'data',
      params: { lead_id: { in: 'query', type: 'string', description: 'Only this lead\'s contacts; required without the "View All Leads" permission.' },
        ...limit }, result: { data: [contact], has_more: 'boolean' } },
    'contacts.get': { docs: `${ref}/contacts/get`, path: '/contact/{id}/', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true } }, result: contact },
    'contacts.create': { docs: `${ref}/contacts/create`, method: 'POST', path: '/contact/',
      params: { ...written, lead_id: { in: 'body', type: 'string', description: 'Without it, a new lead is created for the contact.' } },
      result: contact },
    'contacts.update': { docs: `${ref}/contacts/update`, method: 'PUT', path: '/contact/{id}/',
      params: { id: { in: 'path', type: 'string', required: true }, ...written }, result: contact },
    'contacts.search': { docs: `${ref}/advanced-filtering/search`, method: 'POST', path: '/data/search/', kind: 'read',
      paging: 'cursor', records: 'data',
      params: { query: { in: 'body', type: 'unknown', required: true,
        description: 'An `and` query holding { "type": "object_type", "object_type": "contact" } and the filters. Cursors expire after 30 seconds.' },
      _fields: { in: 'body', type: 'unknown', description: 'Fields per object type, such as { "contact": ["id", "display_name", "emails"] }; else only `id`.' },
      _limit: { in: 'body', type: 'integer', description: 'Results per page: 10 by default, at most 200.' } },
      result: { data: [{ id: 'string', 'display_name?': 'string', ...contactKeys, 'date_created?': 'string', 'date_updated?': 'string' }],
        'cursor?': 'string' } },
    'leads.list': { docs: `${ref}/leads/list`, path: '/lead/', paging: 'skip', records: 'data', params: limit,
      result: { data: [{ id: 'string', 'name?': 'string', 'display_name?': 'string', 'status_label?': 'string', html_url: 'string',
        'url?': 'string', date_created: 'string', date_updated: 'string' }], has_more: 'boolean' } },
    'opportunities.list': { docs: `${ref}/opportunities/list`, path: '/opportunity/', paging: 'skip', records: 'data',
      params: { lead_id: { in: 'query', type: 'string' }, ...limit },
      result: { data: [{ id: 'string', lead_id: 'string', status_id: 'string', 'status_type?': 'string', 'value?': 'integer',
        user_id: 'string', date_created: 'string', date_updated: 'string' }], has_more: 'boolean' } },
  },
});
