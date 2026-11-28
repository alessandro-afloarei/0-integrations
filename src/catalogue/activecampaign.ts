import { defineProvider } from '../catalogue.js';

/** ActiveCampaign: a user's API key on its account's API URL, `<account>.api-us1.com`; lists offset-page from 0, a 429
 * waits `Retry-After`; nothing here sends a campaign, and webhooks are not declared:
 * https://developers.activecampaign.com/reference/url https://developers.activecampaign.com/reference/rate-limits
 * https://developers.activecampaign.com/reference/pagination */
const contact = { id: 'string', 'email?': 'string', 'firstName?': 'string', 'lastName?': 'string', 'phone?': 'string',
  'cdate?': 'string', 'udate?': 'string' } as const;
const campaign = { id: 'string', 'name?': 'string', 'type?': 'string', 'status?': 'string', 'cdate?': 'string', 'sdate?': 'string',
  'mdate?': 'string' } as const;
const written = { 'firstName?': 'string', 'lastName?': 'string', 'phone?': 'string' } as const;
const id = { id: { in: 'path', type: 'integer', required: true } } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '20 by default, at most 100.' } } as const;
const ref = 'https://developers.activecampaign.com/reference';

export const activecampaign = defineProvider({
  id: 'activecampaign', name: 'ActiveCampaign', docs: `${ref}/authentication`,
  categories: ['marketing'],
  fields: [{ name: 'host', title: 'API URL host',
    help: 'The host of the API URL in Settings, Developer tab, such as yourname.api-us1.com (no https:// and no /api/3). ActiveCampaign does not guarantee api-us1.com for every account, and the Developer tab is the source of truth: an API URL on another domain cannot connect here.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Your API key from Settings, Developer tab. Each user has their own key, and calls run with that user\'s permissions (adding and editing contacts included).' }],
  auth: [{ kind: 'key', send: { header: 'api-token' } }],
  http: { baseUrl: 'https://{host}/api/3', host: '*.api-us1.com', retry: {} },
  errors: { detail: 'errors.0.code' },
  // A user id is the user's within its account: the account's host keeps two accounts apart.
  identify: { request: { path: '/users/me' }, id: '{connection.host}:{user.id}', name: ['user.username', 'user.email'] },
  paging: { contacts: { kind: 'offset', send: { query: 'offset' }, list: 'contacts' },
    lists: { kind: 'offset', send: { query: 'offset' }, list: 'lists' },
    campaigns: { kind: 'offset', send: { query: 'offset' }, list: 'campaigns' } },
  operations: {
    'lists.list': { docs: `${ref}/retrieve-all-lists`, path: '/lists', paging: 'lists', records: 'lists',
      params: { ...limit, 'filters[name]': { in: 'query', type: 'string' },
        'filters[channel]': { in: 'query', type: 'string', enum: ['email', 'sms', 'all'], description: 'email by default.' } },
      result: { lists: [{ id: 'string', 'name?': 'string', 'stringid?': 'string', 'cdate?': 'string', 'udate?': 'string' }] } },
    'contacts.list': { docs: `${ref}/list-all-contacts`, path: '/contacts', paging: 'contacts', records: 'contacts',
      params: { ...limit, email: { in: 'query', type: 'string' }, listid: { in: 'query', type: 'string' },
        search: { in: 'query', type: 'string', description: 'A full email address matches exactly; any other value matches email, names, phone and account name.' } },
      result: { contacts: [contact] } },
    'contacts.get': { docs: `${ref}/get-contact`, path: '/contacts/{id}', notFound: 'null', params: id, result: { contact } },
    // A new contact only: it subscribes to no list here (`subscriptions.create` does); an existing email is a 422.
    'contacts.create': { docs: `${ref}/create-a-new-contact`, method: 'POST', path: '/contacts',
      params: { contact: { in: 'body', required: true, type: { email: 'string', ...written } } }, result: { contact } },
    'contacts.update': { docs: `${ref}/update-a-contact-new`, method: 'PUT', path: '/contacts/{id}',
      params: { ...id, contact: { in: 'body', required: true, type: { 'email?': 'string', ...written },
        description: 'Fields left out keep their current values.' } }, result: { contact } },
    // Subscribes a contact to a list (status 1): a new active membership gets the list's subscribe autoresponders and,
    // when the list is set to send it, the list's last campaign; its subscribe automations start.
    'subscriptions.create': { docs: `${ref}/update-list-status-for-contact`, method: 'POST', path: '/contactLists',
      params: { contactList: { in: 'body', required: true, type: { list: 'integer', contact: 'integer', status: '1',
        'suppressInstantAutoresponder?': 'boolean', 'responder?': 'integer' },
        description: 'suppressInstantAutoresponder true does not send the list\'s subscribe autoresponders; responder 0 stops its later, scheduled ones. Resubscribing an unsubscribed contact needs the resubscribe permission.' } },
      result: { contactList: { 'id?': 'string', 'list?': 'string', 'contact?': 'string', 'sdate?': 'string' } } },
    'campaigns.list': { docs: `${ref}/list-all-campaigns`, path: '/campaigns', paging: 'campaigns', records: 'campaigns',
      result: { campaigns: [campaign] } },
    'campaigns.get': { docs: `${ref}/retrieve-a-campaign`, path: '/campaigns/{id}', notFound: 'null', params: id, result: { campaign } },
  },
});
