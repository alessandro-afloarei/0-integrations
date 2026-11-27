import { defineProvider } from '../catalogue.js';

/** Freshchat: an API key an admin generates, Bearer, on the account's host; a 429 past the plan's hourly limit. A
 * message an agent sends reaches the user. No list holds every conversation: `conversations.list` names one user's;
 * `messages.list` answers one page. No conversation create: its message names its own actor. Webhooks are RSA-signed:
 * https://crmsupport.freshworks.com/support/solutions/articles/50000004461-freshchat-webhooks-payload-structure-and-authentication */
const conversation = { conversation_id: 'string', 'status?': 'string', 'channel_id?': 'string', 'assigned_agent_id?': 'string',
  'assigned_group_id?': 'string', 'app_id?': 'string', 'properties?': 'unknown' } as const;
const message = { id: 'string', 'conversation_id?': 'string', 'message_type?': 'string', 'actor_type?': 'string',
  'actor_id?': 'string', 'user_id?': 'string', 'created_time?': 'string', 'message_parts?': 'unknown' } as const;
const conversationId = { conversation_id: { in: 'path', type: 'string', required: true } } as const;
const agent = { actor_type: { in: 'body', type: 'agent', required: true },
  actor_id: { in: 'body', type: 'string', required: true, description: 'The agent sending the message.' } } as const;
const assigned = { assigned_agent_id: { in: 'body', type: 'string', description: 'With status assigned, give this or assigned_group_id.' },
  assigned_group_id: { in: 'body', type: 'string' },
  properties: { in: 'body', type: 'unknown', description: 'Only for chat accounts in Freshsales Suite.' } } as const;
const status = { in: 'body', type: 'string', enum: ['new', 'assigned', 'resolved', 'reopened'] } as const;
const filter = { in: 'query', type: 'string' } as const;
const perPage = { items_per_page: { in: 'query', type: 'integer', description: '10 by default.' } } as const;
const ref = 'https://developers.freshchat.com/api';

export const freshchat = defineProvider({
  id: 'freshchat', name: 'Freshchat', docs: `${ref}/#authentication`,
  categories: ['support'],
  fields: [{ name: 'host', title: 'Account host',
    help: 'Your account\'s host, like yourcompany.freshchat.com; for chat in Freshsales Suite, the host of "Your chat URL" under Settings, Admin Settings, Website Tracking and APIs, API Settings.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Generated under Admin, Configure, API Tokens (in Freshsales Suite: the same API Settings page). Each token has a lifetime.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{host}/v2', host: ['*.freshchat.com', '*.myfreshworks.com'], retry: {} },
  errors: { detail: 'status' },
  identify: { request: { path: '/accounts/configuration' }, id: 'account_id', name: 'account_domain' },
  paging: { next: { kind: 'nextUrl', next: 'links.next_page.href' } },
  operations: {
    'conversations.list': { docs: `${ref}/#retrieve_all_conversation_for_a_user`, path: '/users/{user_id}/conversations',
      params: { user_id: { in: 'path', type: 'string', required: true } }, result: { conversations: [{ id: 'string' }] } },
    'conversations.get': { docs: `${ref}/#retrieve_a_conversation`, path: '/conversations/{conversation_id}', notFound: 'null',
      params: conversationId, result: conversation },
    'conversations.update': { docs: `${ref}/#update_a_conversation`, method: 'PUT', path: '/conversations/{conversation_id}',
      params: { ...conversationId, status, ...assigned }, result: conversation },
    'messages.list': { docs: `${ref}/#list_messages`, path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, from_time: { in: 'query', type: 'string' }, page: { in: 'query', type: 'integer', description: '1 by default.' },
        items_per_page: { in: 'query', type: 'integer', description: '20 by default, at most 50.' } },
      result: { messages: [message] } },
    'messages.create': { docs: `${ref}/#send_message_to_conversation`, method: 'POST', path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, ...agent,
        message_parts: { in: 'body', type: [{ text: { content: 'string' } }], description: 'The text of the message.' },
        message_type: { in: 'body', type: 'string', enum: ['normal', 'private'],
          description: 'normal by default; private keeps the message internal, not visible to the user.' } },
      result: message },
    'users.list': { docs: `${ref}/#list_users`, path: '/users', paging: 'next', records: 'users',
      params: { first_name: filter, last_name: filter, email: filter, reference_id: filter, phone_no: filter, created_from: filter,
        created_to: filter, updated_from: filter, updated_to: filter, ...perPage },
      anyOf: [['first_name'], ['last_name'], ['email'], ['reference_id'], ['phone_no'], ['created_from'], ['created_to'],
        ['updated_from'], ['updated_to']],
      result: { users: [{ id: 'string', 'first_name?': 'string', 'last_name?': 'string', 'email?': 'string', 'phone?': 'string',
        'reference_id?': 'string', 'created_time?': 'string', 'updated_time?': 'string' }] } },
  },
});
