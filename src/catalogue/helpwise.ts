import { defineProvider } from '../catalogue.js';

/** Helpwise: the API key and secret as HTTP Basic on API V1, Premium and Advanced plans (https://helpwise.io/pricing);
 * identify only checks them. Helpwise states 100 requests a minute. No V1 inbox list, conversation create, update,
 * reply or note; V0's notes, email send and inbox list take another credential form. Contacts: one page. Webhooks:
 * https://docs.helpwise.io/articles/221885-setup-webhooks-in-your-helpwise-account */
const tags = { 'tags?': [{ 'id?': 'integer', 'name?': 'string' }] } as const;
const contact = { id: 'integer', 'firstname?': 'string', 'lastname?': 'string', 'emails?': ['string'], 'phones?': 'unknown',
  'company?': 'string', 'jobTitle?': 'string' } as const;
const labelId = { labelId: { in: 'query', type: 'integer',
  description: '14 All, 0 Assigned, 10 Unassigned, 11 Starred, 9 Snoozed, 2 Draft, 1 Sent, 7 Closed, 8 Spam, 5 Trash, 6 Scheduled.' } } as const;
const slice = { limit: { in: 'query', type: 'integer', description: '50 by default.' }, offset: { in: 'query', type: 'integer' } } as const;
const docs = 'https://helpwise.io/developers/';

export const helpwise = defineProvider({
  id: 'helpwise', name: 'Helpwise', docs,
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', help: 'API access is on Helpwise\'s Premium and Advanced plans. The key is on the Settings page, API section, with its secret.' },
    { name: 'apiSecret', title: 'API secret', secret: true, help: 'The secret shown beside the API key on Helpwise\'s Settings page, API section.' }],
  auth: [{ kind: 'key', send: { basic: ['{apiKey}', '{apiSecret}'] } }],
  http: { baseUrl: 'https://apis.helpwise.io' },
  identify: { request: { path: '/tags' } },
  paging: { threads: { kind: 'cursor', next: 'nextPageToken', send: { query: 'pageToken' } } },
  operations: {
    'conversations.list': { docs, path: '/conversations', paging: 'threads', records: 'threads',
      params: { 'inboxIds[]': { in: 'query', type: 'integer', required: true, description: 'An inbox\'s id (its mailbox id).' }, ...labelId,
        limit: { in: 'query', type: 'integer' } },
      result: { threads: [{ id: 'integer', 'inboxId?': 'integer', 'subject?': 'string', 'ticketNumber?': 'integer', 'isArchived?': 'boolean',
        ...tags, 'snippet?': 'string', 'date?': 'string' }] } },
    'conversations.get': { docs, path: '/inboxes/{inboxId}/conversations/{conversationId}',
      params: { inboxId: { in: 'path', type: 'integer', required: true }, conversationId: { in: 'path', type: 'integer', required: true },
        ...labelId, pageToken: { in: 'query', type: 'string', description: 'The answer\'s nextPageToken: the next page of the messages.' },
        limit: { in: 'query', type: 'integer', description: 'How many messages.' } },
      result: { id: 'integer', 'inboxId?': 'integer', 'subject?': 'string', 'ticketNumber?': 'integer', 'isArchived?': 'boolean', ...tags,
        'items?': 'unknown', 'nextPageToken?': 'string' } },
    'contacts.list': { docs, path: '/contacts', params: slice, result: { 'nextPage?': 'boolean', results: [contact] } },
    'contacts.search': { docs, path: '/contacts/search', params: { term: { in: 'query', type: 'string' }, ...slice },
      result: { 'nextPage?': 'boolean', result: [contact] } },
  },
});
