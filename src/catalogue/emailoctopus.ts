import { defineProvider } from '../catalogue.js';

/** EmailOctopus API v2: an API key as Bearer; identify only checks it on the lists list, the page's own check.
 * Campaigns are read only: the API has no campaign create or send. A 429 is retried after a second (the bucket refills
 * 10 tokens a second); `X-RateLimit-Retry-After` states no unit. No webhooks are documented.
 * https://emailoctopus.com/api-documentation/v2 */
const contact = { id: 'string', email_address: 'string', 'status?': 'string', 'tags?': ['string'], 'fields?': 'unknown',
  'created_at?': 'string', 'last_updated_at?': 'string' } as const;
const campaign = { id: 'string', 'status?': 'string', 'name?': 'string', 'subject?': 'string', 'to?': ['string'],
  'from?': { 'name?': 'string', 'email_address?': 'string' }, 'created_at?': 'string', 'sent_at?': 'string' } as const;
const listId = { list_id: { in: 'path', type: 'string', required: true } } as const;
const contactId = { contact_id: { in: 'path', type: 'string', required: true,
  description: 'The contact\'s id, or the MD5 hash of the lowercase email address.' } } as const;
const limit = { limit: { in: 'query', type: 'integer', description: 'At most 100 results per page.' } } as const;
const status = { in: 'body', type: 'string', enum: ['pending', 'subscribed', 'unsubscribed'],
  description: 'No page says whether pending sends a confirmation email.' } as const;
const fields = { fields: { in: 'body', type: 'unknown', description: 'Field values keyed by each field\'s tag.' } } as const;
const ref = 'https://emailoctopus.com/api-documentation/v2#tag';

export const emailoctopus = defineProvider({
  id: 'emailoctopus', name: 'EmailOctopus', docs: 'https://emailoctopus.com/api-documentation/v2',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Generate it in your account settings, API keys. A key made before API v2 (labelled legacy) must be replaced.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.emailoctopus.com', retry: {} },
  identify: { request: { path: '/lists', query: { limit: '1' } } },
  paging: { cursor: { kind: 'cursor', next: 'paging.next.starting_after', send: { query: 'starting_after' } } },
  operations: {
    'lists.list': { docs: `${ref}/List/operation/api_lists_get`, path: '/lists', paging: 'cursor', records: 'data', params: limit,
      result: { data: [{ id: 'string', name: 'string', 'double_opt_in?': 'boolean', 'created_at?': 'string', 'last_updated_at?': 'string' }] } },
    'contacts.list': { docs: `${ref}/Contact/operation/api_lists_list_idcontacts_get`, path: '/lists/{list_id}/contacts',
      paging: 'cursor', records: 'data',
      params: { ...listId, status: { in: 'query', type: 'string', enum: ['subscribed', 'unsubscribed', 'pending'] },
        tag: { in: 'query', type: 'string' }, ...limit }, result: { data: [contact] } },
    'contacts.get': { docs: `${ref}/Contact/operation/api_lists_list_idcontacts_contact_id_get`, path: '/lists/{list_id}/contacts/{contact_id}',
      notFound: 'null', params: { ...listId, ...contactId }, result: contact },
    // Adds a contact to the list; no page names a confirmation email, but a contact subscribing to a list or tagged can
    // start the account's automations, which send emails, and no parameter stops them. A contact already in the list is
    // refused (already-exists).
    'contacts.create': { docs: `${ref}/Contact/operation/api_lists_list_idcontacts_post`, method: 'POST', path: '/lists/{list_id}/contacts',
      params: { ...listId, email_address: { in: 'body', type: 'string', required: true }, ...fields,
        tags: { in: 'body', type: ['string'] }, status }, result: contact },
    'contacts.update': { docs: `${ref}/Contact/operation/api_lists_list_idcontacts_contact_id_put`, method: 'PUT',
      path: '/lists/{list_id}/contacts/{contact_id}',
      params: { ...listId, ...contactId, email_address: { in: 'body', type: 'string' }, ...fields,
        tags: { in: 'body', type: 'unknown', description: 'Tag names as keys: true adds the tag, false removes it.' }, status },
      result: contact },
    'campaigns.list': { docs: `${ref}/Campaign/operation/api_campaigns_get`, path: '/campaigns', paging: 'cursor', records: 'data',
      params: limit, result: { data: [campaign] } },
    'campaigns.get': { docs: `${ref}/Campaign/operation/api_campaigns_campaign_id_get`, path: '/campaigns/{campaign_id}',
      notFound: 'null', params: { campaign_id: { in: 'path', type: 'string', required: true } }, result: campaign },
  },
});
