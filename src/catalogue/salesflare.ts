import { defineProvider } from '../catalogue.js';

/** Salesflare: an API key as Bearer; a 429 when there are too many requests. The answers of the lists, of a contact and
 * of a write are not described (https://api.salesflare.com/openapi.json), so they are read as they come and each list
 * answers one page: an app pages with `limit` and `offset` itself. */
const ref = 'https://api.salesflare.com/docs#operation';
const paged = { limit: { in: 'query', type: 'number', description: 'At least 1.' },
  offset: { in: 'query', type: 'number' } } as const;
const contactId = { contact_id: { in: 'path', type: 'number', required: true } } as const;
const written = { email: { in: 'body', type: 'string' }, firstname: { in: 'body', type: 'string' },
  lastname: { in: 'body', type: 'string' }, name: { in: 'body', type: 'string' }, owner: { in: 'body', type: 'number' },
  account: { in: 'body', type: 'number', nullable: true, description: 'The account to link; null unlinks it.' } } as const;

export const salesflare = defineProvider({
  id: 'salesflare', name: 'Salesflare', docs: 'https://api.salesflare.com/docs',
  categories: ['crm'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true, help: 'Made under Settings, then API keys.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.salesflare.com', retry: {} },
  identify: { request: { path: '/me' }, id: 'id', name: ['name', 'email'] },
  operations: {
    'contacts.list': { docs: `${ref}/getContacts`, path: '/contacts',
      params: { email: { in: 'query', type: 'string' }, ...paged } },
    'contacts.get': { docs: `${ref}/getContactsContact_id`, path: '/contacts/{contact_id}', params: contactId },
    'contacts.create': { docs: `${ref}/postContacts`, method: 'POST', path: '/contacts', params: written },
    'contacts.update': { docs: `${ref}/putContactsContact_id`, method: 'PUT', path: '/contacts/{contact_id}',
      params: { ...contactId, ...written } },
    'accounts.list': { docs: `${ref}/getAccounts`, path: '/accounts', params: paged },
    'opportunities.list': { docs: `${ref}/getOpportunities`, path: '/opportunities', params: paged },
  },
});
