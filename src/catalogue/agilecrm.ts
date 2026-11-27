import { defineProvider } from '../catalogue.js';

/** Agile CRM: the user's email and REST API key as Basic, on the account's own subdomain; answers are XML unless
 * `accept` asks for JSON. A list's next cursor is in its last record: deals walk by it; contacts and companies answer
 * one page, `cursor` sent by the app. The contacts list and a contact answer 204 when there is none, so they are read
 * as they come. A company is a contact of type COMPANY; the companies list is a POST that only reads, its form body. */
const ref = 'https://github.com/agilecrm/rest-api';
const property = { 'type?': 'string', 'name?': 'string', 'subtype?': 'string', 'value?': 'string' } as const;
const contact = { id: 'unknown', 'type?': 'string', 'created_time?': 'unknown', 'updated_time?': 'integer',
  'tags?': ['string'], 'properties?': [property] } as const;
const properties = { in: 'body', type: [{ type: 'string', name: 'string', 'subtype?': 'string', 'value?': 'string' }],
  description: 'Fields as { type: "SYSTEM" or "CUSTOM", name, value }; a contact needs a first_name.' } as const;
const paged = { page_size: { in: 'query', type: 'integer' },
  cursor: { in: 'query', type: 'string', description: 'The cursor of the last record of the page before.' } } as const;

export const agilecrm = defineProvider({
  id: 'agilecrm', name: 'Agile CRM', docs: `${ref}#authentication-`,
  categories: ['crm'],
  fields: [{ name: 'domain', title: 'Agile CRM domain', help: 'The subdomain your account is on: acme in acme.agilecrm.com.' },
    { name: 'email', title: 'Agile CRM email', help: 'The email address you sign in with.' },
    { name: 'apiKey', title: 'REST API key', secret: true,
      help: 'Under Admin Settings, then API & Analytics: the first key, the one for the REST client.' }],
  auth: [{ kind: 'key', send: { basic: ['{email}', '{apiKey}'] } }],
  http: { baseUrl: 'https://{domain}.agilecrm.com/dev', host: '*.agilecrm.com', headers: { accept: 'application/json' } },
  identify: { request: { path: '/api/milestone/pipelines' } },
  paging: { cursor: { kind: 'last', next: 'cursor', send: { query: 'cursor' } } },
  operations: {
    'contacts.list': { docs: `${ref}#11-listing-contacts-`, path: '/api/contacts', params: paged },
    'contacts.search': { docs: `${ref}#111-search-contactscompanies`, path: '/api/search',
      params: { q: { in: 'query', type: 'string', required: true }, page_size: { in: 'query', type: 'integer', required: true },
        type: { in: 'query', type: 'string', required: true, enum: ['PERSON', 'COMPANY'],
          description: 'PERSON for contacts, COMPANY for companies.' } } },
    'contacts.get': { docs: `${ref}#12-get-contact-by-id`, path: '/api/contacts/{id}',
      params: { id: { in: 'path', type: 'string', required: true } } },
    'contacts.create': { docs: `${ref}#13-creating-a-contact`, method: 'POST', path: '/api/contacts',
      params: { properties: { ...properties, required: true }, tags: { in: 'body', type: ['string'] } }, result: contact },
    'contacts.update': { docs: `${ref}#14-update-properties-of-a-contact-by-id-partial-update`, method: 'PUT',
      path: '/api/contacts/edit-properties',
      params: { id: { in: 'body', type: 'string', required: true }, properties: { ...properties, required: true } }, result: contact },
    'companies.list': { docs: `${ref}#23-get-list-of-companies`, method: 'POST', kind: 'read', path: '/api/contacts/companies/list',
      params: { page_size: { in: 'form', type: 'integer' },
        global_sort_key: { in: 'form', type: 'string', description: 'The key to sort by, such as -created_time.' },
        cursor: { in: 'form', type: 'string', description: 'The cursor of the last company of the page before.' } },
      result: [{ ...contact, 'cursor?': 'string' }] },
    'deals.list': { docs: `${ref}#31-listing-deals`, path: '/api/opportunity', params: { page_size: paged.page_size }, paging: 'cursor',
      result: [{ id: 'integer', 'name?': 'string', 'milestone?': 'string', 'pipeline_id?': 'unknown', 'owner_id?': 'string',
        'close_date?': 'integer', 'created_time?': 'unknown', 'cursor?': 'string' }] },
  },
});
