import { defineProvider } from '../catalogue.js';

/** HelpCrunch: the organization's API key, Bearer; 120 requests a minute, then a 429 with no wait. `messages.create` of
 * type `message` reaches the customer in the chat. Webhooks: a hex HMAC-SHA1 of the raw body under the HTTP Webhook
 * Signing Key: https://docs.helpcrunch.com/en/webhooks/how-to-verify-help-crunch-webhook-signatures */
const chat = { id: 'integer', 'status?': 'string', 'createdAt?': 'string', 'closedAt?': 'string', 'lastMessageAt?': 'string',
  'customer?': { 'id?': 'integer', 'name?': 'string', 'email?': 'string' }, 'assignee?': { 'id?': 'integer', 'name?': 'string' },
  'department?': { 'id?': 'integer', 'name?': 'string' } } as const;
const message = { id: 'integer', 'type?': 'string', 'text?': 'string', 'from?': 'string', 'chat?': 'integer', 'read?': 'boolean',
  'createdAt?': 'string', 'agent?': { 'id?': 'integer', 'name?': 'string' } } as const;
const customer = { id: 'integer', 'name?': 'string', 'email?': 'string', 'userId?': 'string', 'company?': 'string',
  'phone?': 'string', 'firstSeen?': 'string', 'lastSeen?': 'string' } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '100 by default, at most 100.' } } as const;
const order = { in: 'query', type: 'string', enum: ['asc', 'desc'] } as const;
const search = { filter: { in: 'body', type: [{ field: 'string', operator: 'string', value: 'unknown' }] },
  comparison: { in: 'body', type: 'string', enum: ['AND', 'OR'] }, sort: { in: 'body', type: 'string' },
  order: { in: 'body', type: 'string', enum: ['ASC', 'DESC'] }, limit: { in: 'body', type: 'integer', description: '100 by default.' } } as const;
const chatId = { chat_id: { in: 'path', type: 'integer', required: true } } as const;
const ref = 'https://docs.helpcrunch.com/en/rest-api-v1';

export const helpcrunch = defineProvider({
  id: 'helpcrunch', name: 'HelpCrunch', docs: `${ref}/api-setup-v1`,
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Your API key from Settings, Developers, Public API (not the Legacy API Key). It never expires.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.helpcrunch.com/v1', retry: { defaultWaitMs: 60_000 } },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/organization' }, id: 'data.id', name: 'data.domain' },
  webhook: { kind: 'hmac', header: 'x-helpcrunch-signature', hash: 'sha1' },
  paging: { offset: { kind: 'offset', send: { query: 'offset' }, list: 'data' },
    search: { kind: 'offset', send: { body: 'offset' }, list: 'data' } },
  operations: {
    'chats.list': { docs: `${ref}/get-chats-v1`, path: '/chats', paging: 'offset', records: 'data',
      params: { sort: { in: 'query', type: 'string',
        enum: ['chats.createdAt', 'chats.lastCustomerMessageAt', 'chats.lastMessageAt', 'chats.closedAt'] }, order, ...limit },
      result: { data: [chat] } },
    'chats.search': { docs: `${ref}/search-chats-v1`, method: 'POST', path: '/chats/search', kind: 'read', paging: 'search',
      records: 'data', params: search, result: { data: [chat] } },
    'chats.get': { docs: `${ref}/get-chat-v1`, path: '/chats/{chat_id}', notFound: 'null', params: chatId, result: chat },
    'chats.create': { docs: `${ref}/create-chat-v1`, method: 'POST', path: '/chats',
      params: { customer: { in: 'body', type: 'integer', required: true }, application: { in: 'body', type: 'integer', required: true },
        assignee: { in: 'body', type: 'integer' }, department: { in: 'body', type: 'integer' } }, result: chat },
    'chats.update': { docs: `${ref}/update-chat-status-v1`, method: 'PUT', path: '/chats/status',
      params: { id: { in: 'body', type: 'integer', required: true }, status: { in: 'body', type: 'string', required: true,
        enum: ['new', 'opened', 'pending', 'on hold', 'no communication', 'closed'] } }, result: chat },
    'messages.list': { docs: `${ref}/get-messages-v1`, path: '/chats/{chat_id}/messages', paging: 'offset', records: 'data',
      params: { ...chatId, ...limit }, result: { data: [message] } },
    'messages.create': { docs: `${ref}/create-message-v1`, method: 'POST', path: '/messages',
      params: { chat: { in: 'body', type: 'integer', required: true }, text: { in: 'body', type: 'string', required: true },
        markdownText: { in: 'body', type: 'string' }, agent: { in: 'body', type: 'integer', required: true },
        type: { in: 'body', type: 'string', required: true, enum: ['message', 'private'],
          description: '`private` keeps the message an internal note, visible to agents only.' } },
      result: message },
    'customers.list': { docs: `${ref}/get-customers-v1`, path: '/customers', paging: 'offset', records: 'data',
      params: { sort: { in: 'query', type: 'string', enum: ['customers.firstSeen', 'customers.lastSeen'] }, order, ...limit },
      result: { data: [customer] } },
    'customers.search': { docs: `${ref}/search-customers-v1`, method: 'POST', path: '/customers/search', kind: 'read',
      paging: 'search', records: 'data', params: search, result: { data: [customer] } },
  },
});
