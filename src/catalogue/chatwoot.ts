import { defineProvider } from '../catalogue.js';

/** Chatwoot Cloud or the person's own server: the typed host is reached only through the address guard unless the app
 * passes its own `fetch`. A user's access token as Bearer (Chatwoot 4.19.0 and later); each call names the numeric
 * `account_id`. An outgoing message, and a new conversation's first message, reach the contact on its channel;
 * `private` keeps a message an internal note. Messages answer one page (`after`, `before`); no rate limit is stated. */
const ref = 'https://developers.chatwoot.com/api-reference';
const conversation = { id: 'number', 'account_id?': 'number', 'inbox_id?': 'number', 'status?': 'string', 'priority?': 'string',
  'created_at?': 'number', 'updated_at?': 'number', 'last_activity_at?': 'number' } as const;
const message = { id: 'number', 'conversation_id?': 'number', 'content?': 'unknown', 'message_type?': 'integer',
  'private?': 'boolean', 'status?': 'string', 'created_at?': 'integer' } as const;
const account = { account_id: { in: 'path', type: 'integer', required: true, description: 'The numeric ID of the account.' } } as const;
const one = { ...account, conversation_id: { in: 'path', type: 'integer', required: true } } as const;
const conversations = '/api/v1/accounts/{account_id}/conversations';

export const chatwoot = defineProvider({
  id: 'chatwoot', name: 'Chatwoot', docs: `${ref}/introduction`,
  categories: ['support'],
  fields: [{ name: 'host', title: 'Chatwoot host', default: 'app.chatwoot.com',
    help: 'app.chatwoot.com, or the host name of your own Chatwoot (4.19.0 or later), with no port.' },
  { name: 'accessToken', title: 'Access token', secret: true, help: 'Your user access token, under Profile Settings.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{host}', host: '*' },
  identify: { request: { path: '/api/v1/profile' }, id: 'id', name: ['name', 'email'] },
  paging: { conversations: { kind: 'page', send: { query: 'page' }, list: 'data.payload' },
    contacts: { kind: 'page', send: { query: 'page' }, list: 'payload' } },
  // https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks: a hex digest, the time in seconds.
  webhook: { kind: 'hmac', header: 'x-chatwoot-signature', prefix: 'sha256=', signed: '{timestamp}.{body}',
    timestamp: { header: 'x-chatwoot-timestamp' }, deliveryId: { header: 'x-chatwoot-delivery' } },
  operations: {
    'conversations.list': { docs: `${ref}/conversations/conversations-list`, path: conversations, paging: 'conversations',
      records: 'data.payload',
      params: { ...account, assignee_type: { in: 'query', type: 'string', enum: ['me', 'unassigned', 'all', 'assigned'] },
        status: { in: 'query', type: 'string', enum: ['all', 'open', 'resolved', 'pending', 'snoozed'], description: 'open by default.' },
        q: { in: 'query', type: 'string', description: 'Conversations with messages holding this term.' },
        inbox_id: { in: 'query', type: 'integer' }, team_id: { in: 'query', type: 'integer' } },
      result: { data: { payload: [conversation] } } },
    'conversations.get': { docs: `${ref}/conversations/conversation-details`, path: `${conversations}/{conversation_id}`,
      notFound: 'null', params: one, result: conversation },
    'conversations.create': { docs: `${ref}/conversations/create-new-conversation`, method: 'POST', path: conversations,
      params: { ...account, source_id: { in: 'body', type: 'string', required: true }, inbox_id: { in: 'body', type: 'integer' },
        contact_id: { in: 'body', type: 'integer' }, status: { in: 'body', type: 'string', enum: ['open', 'resolved', 'pending'] },
        assignee_id: { in: 'body', type: 'integer' }, team_id: { in: 'body', type: 'integer' },
        message: { in: 'body', type: { content: 'string' }, description: 'The first message, sent to the conversation.' } },
      result: conversation },
    'conversations.update': { docs: `${ref}/conversations/update-conversation`, method: 'PATCH', path: `${conversations}/{conversation_id}`,
      params: { ...one, priority: { in: 'body', type: 'string', nullable: true, enum: ['urgent', 'high', 'medium', 'low'],
        description: 'null clears it.' } },
      result: conversation },
    'messages.list': { docs: `${ref}/messages/get-messages`, path: `${conversations}/{conversation_id}/messages`,
      params: { ...one, after: { in: 'query', type: 'integer', description: 'A message id: up to 100 messages after it, oldest first.' },
        before: { in: 'query', type: 'integer', description: 'A message id: up to 20 messages before it, oldest first.' } },
      result: { payload: [message] } },
    'messages.create': { docs: `${ref}/messages/create-new-message`, method: 'POST', path: `${conversations}/{conversation_id}/messages`,
      params: { ...one, content: { in: 'body', type: 'string', required: true },
        message_type: { in: 'body', type: 'string', enum: ['outgoing'], description: 'The agent\'s message.' },
        private: { in: 'body', type: 'boolean', description: 'true makes it a private note.' } },
      result: message },
    'contacts.list': { docs: `${ref}/contacts/list-contacts`, path: '/api/v1/accounts/{account_id}/contacts', paging: 'contacts',
      records: 'payload',
      params: { ...account, sort: { in: 'query', type: 'string',
        enum: ['name', 'email', 'phone_number', 'last_activity_at', '-name', '-email', '-phone_number', '-last_activity_at'] } },
      result: { payload: [{ id: 'integer', 'name?': 'string', 'email?': 'string', 'phone_number?': 'string', 'identifier?': 'string',
        'blocked?': 'boolean', 'created_at?': 'integer', 'last_activity_at?': 'integer' }] } },
  },
});
