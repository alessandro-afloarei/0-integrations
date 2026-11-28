import { defineProvider } from '../catalogue.js';

/** Gist: OAuth 2 (an app made alone in the Developer Portal; listing it for the public needs Gist's review:
 * https://developers.getgist.com/docs/listing-your-app; scopes: https://developers.getgist.com/docs/oauth-scopes), or
 * the workspace's API key. 100 requests per 10 seconds per workspace, then a 429. A `reply` message reaches the
 * contact. The conversation and message lists' answers are not shown: each answers one page as sent. */
const conversation = { id: 'integer', 'title?': 'string', 'channel?': 'string', 'state?': 'string', 'open?': 'boolean',
  'created_at?': 'integer', 'updated_at?': 'integer', 'assignee?': 'unknown' } as const;
const conversationId = { conversation_id: { in: 'path', type: 'integer', required: true } } as const;
const listed = { order: { in: 'query', type: 'string', enum: ['asc', 'desc'], description: 'desc by default.' },
  status: { in: 'query', type: 'string', enum: ['all', 'open', 'closed', 'snoozed'], description: 'all by default.' },
  order_by: { in: 'query', type: 'string', enum: ['created_at', 'updated_at', 'waiting_longest'] },
  page: { in: 'query', type: 'integer', description: '1 by default.' } } as const;
const ref = 'https://developers.getgist.com/api';

export const gist = defineProvider({
  id: 'gist', name: 'Gist', docs: 'https://developers.getgist.com/docs/working-with-oauth',
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Gist workspace, from Integration Settings: Gist asks an app for other workspaces to connect with OAuth 2.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.getgist.com/oauth/authorize', tokenUrl: 'https://api.getgist.com/oauth/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: ['read_conversations', 'write_conversations', 'read_bulk_contacts'] },
  http: { baseUrl: 'https://api.getgist.com', retry: { defaultWaitMs: 10_000 } },
  identify: { request: { path: '/token/info' }, id: 'workspace_id' },
  paging: { next: { kind: 'nextUrl', next: 'pages.next' } },
  operations: {
    'conversations.list': { docs: `${ref}/#list-all-conversations`, path: '/conversations', params: listed },
    'conversations.search': { docs: `${ref}/#search-conversations`, method: 'POST', path: '/conversations/search', kind: 'read',
      params: { ...listed, filter_query: { in: 'body', type: [{ criteria: [{ key: 'string', operator: 'string', value: 'unknown' }] }],
        description: 'Criteria joined by AND, each a list of conditions joined by OR.' } } },
    'conversations.get': { docs: `${ref}/#retrieve-a-conversation`, path: '/conversations/{conversation_id}', notFound: 'null',
      params: conversationId, result: { conversation } },
    'conversations.update': { docs: `${ref}/#update-a-conversation`, method: 'PATCH', path: '/conversations/{conversation_id}',
      params: { ...conversationId, title: { in: 'body', type: 'string' }, custom_properties: { in: 'body', type: 'unknown' },
        state: { in: 'body', type: 'string', enum: ['open', 'closed'],
          description: 'Closes or reopens the conversation; give teammate_id, or type `bot`, with it.' },
        teammate_id: { in: 'body', type: 'string',
          description: 'The teammate who closes or reopens the conversation: with state, give this or type `bot`.' },
        type: { in: 'body', type: 'bot', description: 'A bot closes or reopens the conversation, not a teammate: with state, give this or teammate_id.' } },
      result: { conversation } },
    'messages.list': { docs: `${ref}/#retrieve-all-messages-within-a-conversation`, path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, page: { in: 'query', type: 'integer', description: '1 by default.' },
        per_page: { in: 'query', type: 'integer', description: '50 by default, at most 60.' },
        with_notes: { in: 'query', type: 'boolean' } } },
    'messages.create': { docs: `${ref}/#reply-to-a-conversation`, method: 'POST', path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, message_type: { in: 'body', type: 'string', required: true, enum: ['reply', 'note'],
        description: '`note` keeps the message internal: notes are not visible to the contact.' },
      from: { in: 'body', type: { type: 'teammate', teammate_id: 'string' }, required: true,
        description: 'teammate_id is the teammate who writes: the agent the page requires the request to name.' },
      body: { in: 'body', type: 'string', required: true } },
      result: { message: { id: 'integer', 'conversation_id?': 'integer', 'message_type?': 'string', 'is_inbound?': 'boolean',
        'channel?': 'string', 'created_at?': 'integer', 'body?': 'unknown', 'author?': { 'type?': 'string', 'id?': 'integer' } } } },
    'contacts.list': { docs: `${ref}/#list-all-contacts`, path: '/contacts', paging: 'next', records: 'contacts',
      params: { per_page: { in: 'query', type: 'integer', description: '50 by default, at most 60.' },
        order: { in: 'query', type: 'string', enum: ['asc', 'desc'] },
        order_by: { in: 'query', type: 'string', enum: ['last_seen_at', 'created_at', 'updated_at', 'signed_up_at'] },
        email_like: { in: 'query', type: 'string' } },
      result: { contacts: [{ id: 'unknown', 'type?': 'string', 'name?': 'string', 'email?': 'string', 'user_id?': 'unknown',
        'created_at?': 'integer', 'updated_at?': 'integer', 'last_seen_at?': 'integer' }] } },
  },
});
