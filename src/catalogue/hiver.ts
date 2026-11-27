import { defineProvider } from '../catalogue.js';

/** Hiver: an API key an admin creates, Bearer, with an admin user's access; identify only checks it. One request a
 * second per account, 5,000 a day; repeated retries after a 429 can get the key blacklisted, so none is retried. No
 * reply, conversation create or customer list in the API; a note's create takes a multipart body and is not declared.
 * A conversation's id is a number in a list and a string in a get. */
const conversation = { id: 'unknown', 'status?': 'string', 'assignee?': { 'assignee_type?': 'string', 'assignee_id?': 'number' },
  'tag_ids?': 'unknown', 'gmail_thread_id?': 'string', 'private_permalink?': 'string', 'public_permalink?': 'string' } as const;
const limit = { limit: { in: 'query', type: 'integer', description: 'Results per page, 10 to 100; 10 by default.' } } as const;
const inbox = { inbox_id: { in: 'path', type: 'string', required: true } } as const;
const one = { ...inbox, conversation_id: { in: 'path', type: 'string', required: true, description: 'A Hiver conversation id or a Gmail thread id.' },
  user_email: { in: 'query', type: 'string',
    description: 'Required only when conversation_id is a Gmail thread id from that inbox user\'s own mailbox.' } } as const;
const ref = 'https://developer.hiverhq.com/hiver-api';

export const hiver = defineProvider({
  id: 'hiver', name: 'Hiver', docs: ref,
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Only a Hiver admin can make one: Admin Panel > Integrations > Developer APIs > Create an API key, then switch the app on. It has an admin user\'s access.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api2.hiverhq.com/v1' },
  identify: { request: { path: '/inboxes' } },
  paging: { next: { kind: 'cursor', next: 'data.pagination.next_page', send: { query: 'next_page' } } },
  operations: {
    'inboxes.list': { docs: `${ref}/inbox/list-all-the-inboxes`, path: '/inboxes', paging: 'next', records: 'data.results',
      params: limit,
      result: { data: { results: [{ id: 'string', 'display_name?': 'string', 'email?': 'string', 'channel_type?': 'string',
        'inbox_type?': 'string', 'created_at?': 'number', 'updated_at?': 'number' }] } } },
    'conversations.list': { docs: `${ref}/conversations/get-conversations-in-the-inbox`, path: '/inboxes/{inbox_id}/conversations',
      paging: 'next', records: 'data.results', params: { ...inbox, ...limit }, result: { data: { results: [conversation] } } },
    'conversations.get': { docs: `${ref}/conversations/get-a-conversation-in-the-inbox`,
      path: '/inboxes/{inbox_id}/conversations/{conversation_id}', params: one, result: { data: [conversation] } },
    'conversations.update': { docs: `${ref}/conversations/update-conversation-in-the-inbox`, method: 'PATCH',
      path: '/inboxes/{inbox_id}/conversations/{conversation_id}',
      params: { ...one, status: { in: 'body', type: { 'name?': 'string' } }, assignee: { in: 'body', type: { 'email?': 'string' } },
        tags: { in: 'body', type: { 'to_apply?': 'unknown', 'to_remove?': 'unknown' }, description: 'The tags to apply and to remove.' } } },
  },
});
