import { defineProvider } from '../catalogue.js';

/** Front: OAuth 2 (scopes set on the app; an admin authorizes; an app is private to its own instance until Front's team
 * publishes it: https://dev.frontapp.com/docs/create-and-manage-apps), or an API token. Identify (the company):
 * https://dev.frontapp.com/reference/api-token-details. `messages.create` emails people. A 429 waits `Retry-After`:
 * https://dev.frontapp.com/docs/rate-limiting. Each list answers one page: its next link is on the company's host. */
const conversation = { id: 'string', type: 'string', subject: 'string', status: 'string', 'status_category?': 'string',
  is_closed: 'boolean', 'created_at?': 'number', 'updated_at?': 'number' } as const;
const page = { limit: { in: 'query', type: 'integer', description: '50 by default, at most 100.' },
  page_token: { in: 'query', type: 'string', description: 'The page_token of the last answer\'s _pagination.next link.' } } as const;
const pagination = { '_pagination?': { 'next?': 'string' } } as const;
const channelId = { channel_id: { in: 'path', type: 'string', required: true } } as const;
const recipients = { to: { in: 'body', type: ['string'] }, cc: { in: 'body', type: ['string'] }, bcc: { in: 'body', type: ['string'] },
  subject: { in: 'body', type: 'string' }, body: { in: 'body', type: 'string', required: true }, author_id: { in: 'body', type: 'string' } } as const;
const ref = 'https://dev.frontapp.com/reference';

export const front = defineProvider({
  id: 'front', name: 'Front', docs: 'https://dev.frontapp.com/docs/oauth',
  categories: ['mail'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own Front instance: an app for every Front customer connects with the OAuth 2 sign-in, as Front requires. An admin makes the token under Settings, Developers, API Tokens, with Access resources and the read, write and send permissions on the inboxes the app uses.' }],
  // PKCE S256: https://app.frontapp.com/.well-known/oauth-authorization-server
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.frontapp.com/oauth/authorize', tokenUrl: 'https://app.frontapp.com/oauth/token',
    clientAuth: 'basic', authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api2.frontapp.com', retry: {} },
  identify: { request: { path: '/me' }, id: 'id', name: 'name' },
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
  },
});
