import { defineProvider } from '../catalogue.js';

/** Atlas: an admin's API key as Bearer, on Atlas's one paid plan (https://www.atlas.so/pricing). No endpoint names the
 * account, so identify only checks the key, as the authentication page does. Lists answer one page: no page says what
 * the answer's `cursor` is. `messages.create` sends an agent's message to the customer. No rate limit is stated; the
 * webhook's hash is not (https://help.atlas.so/articles/890811-webhook-events). */
const ref = 'https://developers.atlas.so/reference';
const conversation = { id: 'string', customerId: 'string', 'number?': 'integer', 'subject?': 'string', 'status?': 'string',
  'priority?': 'string', createdAt: 'string', 'closedAt?': 'string' } as const;
const page = { cursor: { in: 'query', type: 'integer', description: '0 by default.' },
  limit: { in: 'query', type: 'integer', description: '20 by default.' } } as const;
const listed = { 'total?': 'integer', 'cursor?': 'integer', 'limit?': 'integer' } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const statuses = ['OPEN', 'SNOOZED', 'CLOSED', 'PENDING'];
const written = { subject: { in: 'body', type: 'string' }, status: { in: 'body', type: 'string', enum: statuses },
  priority: { in: 'body', type: 'string', enum: ['NO_PRIORITY', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
  assignedAgentId: { in: 'body', type: 'string', description: 'An agent\'s id, as GET /v1/users lists them.' } } as const;

export const atlas = defineProvider({
  id: 'atlas', name: 'Atlas', docs: `${ref}/getting-started-with-your-api`,
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'An admin creates it under App Configuration, Data, API & webhooks. API access is part of Atlas\'s paid plan.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.atlas.so' },
  identify: { request: { path: '/v1/conversations', query: { limit: '1' } } },
  operations: {
    'conversations.list': { docs: `${ref}/list_conversations_v1_conversations_get`, path: '/v1/conversations',
      params: { ...page, status: { in: 'query', type: 'string', enum: statuses }, assignedAgentId: { in: 'query', type: 'string' },
        customerId: { in: 'query', type: 'string' }, startDate: { in: 'query', type: 'string' }, endDate: { in: 'query', type: 'string' } },
      result: { data: [conversation], ...listed } },
    'conversations.get': { docs: `${ref}/get_conversation_v1_conversations__id__get`, path: '/v1/conversations/{id}', params: id,
      result: conversation },
    'conversations.create': { docs: `${ref}/create_conversation_v1_conversations_post`, method: 'POST', path: '/v1/conversations',
      params: { customerId: { in: 'body', type: 'string', required: true },
        messages: { in: 'body', type: [{ text: 'string', senderId: 'string', side: 'string' }], required: true,
          description: 'Its messages; the page does not describe side or say whether they are sent.' }, ...written },
      result: conversation },
    'conversations.update': { docs: `${ref}/patch_conversation_v1_conversations__id__post`, method: 'POST', path: '/v1/conversations/{id}',
      params: { ...id, ...written, snoozedUntil: { in: 'body', type: 'string' } }, result: conversation },
    'messages.list': { docs: `${ref}/list_conversation_messages_v1_conversations__id__messages_get`, path: '/v1/conversations/{id}/messages',
      params: { ...id, ...page },
      result: { data: [{ id: 'integer', side: 'string', type: 'string', sentAt: 'string', text: 'unknown', 'channel?': 'string' }],
        ...listed } },
    'messages.create': { docs: `${ref}/send_message_v1_conversations__id__messages_post`, method: 'POST', path: '/v1/conversations/{id}/messages',
      params: { ...id, text: { in: 'body', type: 'string', required: true },
        agentId: { in: 'body', type: 'string', required: true, description: 'The sending agent\'s id, as GET /v1/users lists them.' },
        channel: { in: 'body', type: 'string', description: 'CHAT by default.' } },
      result: { id: 'integer', side: 'string', type: 'string', sentAt: 'string', text: 'unknown', 'channel?': 'string' } },
    'customers.list': { docs: `${ref}/list_api_v1_customers_get`, path: '/v1/customers', params: page,
      result: { data: [{ id: 'string', 'firstName?': 'string', 'lastName?': 'string', 'email?': 'string', 'phoneNumber?': 'string',
        'companyId?': 'string', 'externalUserId?': 'string', createdAt: 'string' }], ...listed } },
  },
});
