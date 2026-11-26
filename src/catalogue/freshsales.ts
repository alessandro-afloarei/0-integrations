import { defineProvider } from '../catalogue.js';

/** Freshsales (Freshworks CRM): a user's API key as `Token token=`; 1,000 requests an hour per account, then a 429.
 * A list reads a view, 25 a page. No page names the current user, so signing in reads the users. The bundle alias's
 * host is typed (reached only through the address guard unless the app passes its own `fetch`), on one of two domains:
 * https://developers.freshworks.com/docs/app-sdk/v2.3/freshsales-suite/app-settings/installation-parameters/ */
const ref = 'https://developers.freshworks.com/crm/api/';
const contact = { id: 'number', 'first_name?': 'string', 'last_name?': 'string', 'display_name?': 'string', 'email?': 'string',
  'owner_id?': 'number', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const viewId = { view_id: { in: 'path', type: 'number', required: true, description: 'A view id from the matching /filters list.' } } as const;
const id = { id: { in: 'path', type: 'number', required: true } } as const;
const written = { type: { 'first_name?': 'string', 'last_name?': 'string', 'email?': 'string', 'mobile_number?': 'string',
  'twitter?': 'string', 'external_id?': 'string', 'job_title?': 'string', 'owner_id?': 'number' },
  description: 'The contact. "Either Email/Mobile/Twitter ID is required to create a contact": email, mobile_number or twitter (the table also marks external_id); none is required alone.' } as const;
const meta = { 'meta?': { 'total_pages?': 'number', 'total?': 'number' } } as const;

export const freshsales = defineProvider({
  id: 'freshsales', name: 'Freshsales', docs: `${ref}#authentication`,
  categories: ['crm'],
  fields: [{ name: 'host', title: 'Bundle alias host',
    help: 'The host of the bundle alias shown below your API key under Profile Settings, then API Settings: widgetz.myfreshworks.com, or widgetz.freshworks.com for an account migrated from Freshsales Classic.' },
  { name: 'apiKey', title: 'API key', secret: true, help: 'Your API key, under Profile Settings, then API Settings.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Token token={token}' } }],
  http: { baseUrl: 'https://{host}/crm/sales/api', host: '*', headers: { 'content-type': 'application/json' }, retry: {} },
  identify: { request: { path: '/selector/owners' } },
  paging: { contacts: { kind: 'page', send: { query: 'page' }, list: 'contacts' },
    accounts: { kind: 'page', send: { query: 'page' }, list: 'sales_accounts' },
    deals: { kind: 'page', send: { query: 'page' }, list: 'deals' } },
  operations: {
    'contacts.list': { docs: `${ref}#list_all_contacts`, path: '/contacts/view/{view_id}', paging: 'contacts', records: 'contacts',
      params: viewId, result: { contacts: [contact] } },
    'contacts.search': { docs: `${ref}#search`, method: 'POST', path: '/filtered_search/contact', kind: 'read',
      params: { filter_rule: { in: 'body', type: [{ attribute: 'string', operator: 'string', value: 'unknown' }],
        description: 'Exact-match rules, such as { attribute: "contact_email.email", operator: "is_in", value: "a@b.test" }.' } },
      result: { contacts: [contact], ...meta } },
    'contacts.get': { docs: `${ref}#view_a_contact`, path: '/contacts/{id}', notFound: 'null', params: id, result: { contact } },
    'contacts.create': { docs: `${ref}#create_contact`, method: 'POST', path: '/contacts',
      params: { contact: { in: 'body', required: true, ...written } }, result: { contact } },
    'contacts.update': { docs: `${ref}#update_a_contact`, method: 'PUT', path: '/contacts/{id}',
      params: { ...id, contact: { in: 'body', required: true, ...written } }, result: { contact } },
    'accounts.list': { docs: `${ref}#list_all_accounts`, path: '/sales_accounts/view/{view_id}', paging: 'accounts',
      records: 'sales_accounts', params: viewId,
      result: { sales_accounts: [{ id: 'number', 'name?': 'string', 'website?': 'string', 'owner_id?': 'number',
        'parent_sales_account_id?': 'number', 'created_at?': 'string', 'updated_at?': 'string' }] } },
    'deals.list': { docs: `${ref}#list_all_deals`, path: '/deals/view/{view_id}', paging: 'deals', records: 'deals', params: viewId,
      result: { deals: [{ id: 'number', 'name?': 'string', 'amount?': 'unknown', 'sales_account_id?': 'number',
        'deal_stage_id?': 'number', 'owner_id?': 'number', 'expected_close?': 'string', 'created_at?': 'string' }] } },
  },
});
