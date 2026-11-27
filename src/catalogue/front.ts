import { defineProvider } from '../catalogue.js';

/** Front: OAuth 2 (scopes set on the app; an admin authorizes; an app is private to its own instance until Front's team
 * publishes it: https://dev.frontapp.com/docs/create-and-manage-apps), or an API token. Identify (the company):
 * https://dev.frontapp.com/reference/api-token-details. `messages.create` emails people; `replies.create` reaches the
 * customer. 429: `Retry-After`, https://dev.frontapp.com/docs/rate-limiting. Lists: one page (company-host next). */
const conversation = { id: 'string', type: 'string', subject: 'string', status: 'string', 'status_category?': 'string',
  is_closed: 'boolean', 'created_at?': 'number', 'updated_at?': 'number' } as const;
const page = { limit: { in: 'query', type: 'integer', description: '50 by default, at most 100.' },
  page_token: { in: 'query', type: 'string', description: 'The page_token of the last answer\'s _pagination.next link.' } } as const;
const pagination = { '_pagination?': { 'next?': 'string' } } as const;
const message = { id: 'string', 'type?': 'string', 'is_inbound?': 'boolean', 'created_at?': 'number', 'subject?': 'string',
  'blurb?': 'string', 'body?': 'unknown' } as const;
const contact = { id: 'string', 'name?': 'string', 'description?': 'string', 'is_private?': 'boolean',
  'handles?': [{ handle: 'string', source: 'string' }] } as const;
const conversationId = { conversation_id: { in: 'path', type: 'string', required: true } } as const;
const channelId = { channel_id: { in: 'path', type: 'string', required: true } } as const;
const addressed = { to: { in: 'body', type: ['string'] }, cc: { in: 'body', type: ['string'] }, bcc: { in: 'body', type: ['string'] },
  subject: { in: 'body', type: 'string' }, body: { in: 'body', type: 'string', required: true } } as const;
const recipients = { ...addressed, author_id: { in: 'body', type: 'string' } } as const;
const ref = 'https://dev.frontapp.com/reference';

export const front = defineProvider({
  id: 'front', name: 'Front', docs: 'https://dev.frontapp.com/docs/oauth',
  categories: ['support', 'mail'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own Front instance: an app for every Front customer connects with the OAuth 2 sign-in, as Front requires. An admin makes the token under Settings, Developers, API Tokens, with Access resources and the read, write and send permissions on the inboxes the app uses.' }],
  // PKCE S256: https://app.frontapp.com/.well-known/oauth-authorization-server
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.frontapp.com/oauth/authorize', tokenUrl: 'https://app.frontapp.com/oauth/token',
    clientAuth: 'basic', authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api2.frontapp.com', retry: {} },
  identify: { request: { path: '/me' }, id: 'id', name: 'name' },
  // An application webhook: the base64 HMAC-SHA256 of the millisecond timestamp, a `:` and the raw body, keyed with the
  // webhook's token. Front states no window: the library's 300 seconds apply. Saving the URL sends a signed `type: 'sync'`
  // request, answered with `x-front-challenge` as text: https://dev.frontapp.com/docs/application-webhooks
  webhook: { kind: 'hmac', header: 'x-front-signature', signed: '{timestamp}:{body}', encoding: 'base64',
    timestamp: { header: 'x-front-request-timestamp', unit: 'epochMs' },
    challenge: { when: { path: 'type', equals: 'sync' }, echo: { header: 'x-front-challenge' }, text: true } },
  operations: {
    'conversations.list': { docs: `${ref}/list-conversations`, path: '/conversations', params: page,
      result: { ...pagination, _results: [conversation] } },
    'conversations.search': { docs: `${ref}/search-conversations`, path: '/conversations/search/{query}',
      params: { query: { in: 'path', type: 'string', required: true }, ...page },
      result: { ...pagination, '_total?': 'integer', _results: [conversation] } },
    'conversations.get': { docs: `${ref}/get-conversation-by-id`, path: '/conversations/{conversation_id}', notFound: 'null',
      params: { conversation_id: { in: 'path', type: 'string', required: true } }, result: conversation },
    'inboxes.list': { docs: `${ref}/list-inboxes`, path: '/inboxes',
      result: { _results: [{ id: 'string', 'name?': 'string', 'is_private?': 'boolean', 'is_public?': 'boolean' }] } },
    'drafts.create': { docs: `${ref}/create-draft`, method: 'POST', path: '/channels/{channel_id}/drafts',
      params: { ...channelId, ...recipients, mode: { in: 'body', type: 'string', enum: ['private', 'shared'] } },
      result: { id: 'string', 'type?': 'string', 'subject?': 'string', 'blurb?': 'string', 'draft_mode?': 'string', 'created_at?': 'number' } },
    'messages.create': { docs: `${ref}/create-message`, method: 'POST', path: '/channels/{channel_id}/messages',
      params: { ...channelId, ...recipients, sender_name: { in: 'body', type: 'string' }, text: { in: 'body', type: 'string' } },
      anyOf: [['to'], ['cc'], ['bcc']] },
    'conversations.update': { docs: `${ref}/update-conversation`, method: 'PATCH', path: '/conversations/{conversation_id}',
      params: { ...conversationId, assignee_id: { in: 'body', type: 'string', nullable: true, description: 'A teammate\'s id; null unassigns.' },
        inbox_id: { in: 'body', type: 'string', description: 'Moves the conversation to this inbox.' },
        status: { in: 'body', type: 'string', enum: ['archived', 'open'], description: 'Give status or status_id, not both.' },
        status_id: { in: 'body', type: 'string', description: 'A ticket status id (ticketing must be on); give status or status_id.' },
        tag_ids: { in: 'body', type: ['string'], description: 'Every tag of the conversation: replaces its tags.' } } },
    'messages.list': { docs: `${ref}/list-conversation-messages`, path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, ...page }, result: { ...pagination, _results: [message] } },
    'replies.create': { docs: `${ref}/create-message-reply`, method: 'POST', path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, ...addressed, channel_id: { in: 'body', type: 'string', description: 'The channel to send from.' },
        text: { in: 'body', type: 'string' },
        options: { in: 'body', type: { 'tag_ids?': ['string'], 'archive?': 'boolean' },
          description: 'archive is true by default: the conversation is archived as the reply is sent.' } } },
    'comments.create': { docs: `${ref}/add-comment`, method: 'POST', path: '/conversations/{conversation_id}/comments',
      params: { ...conversationId, body: { in: 'body', type: 'string', required: true },
        is_pinned: { in: 'body', type: 'boolean' } },
      result: { id: 'string', body: 'unknown', 'posted_at?': 'number', is_pinned: 'boolean' } },
    'contacts.list': { docs: `${ref}/list-contacts`, path: '/contacts', params: page, result: { ...pagination, _results: [contact] } },
  },
});
