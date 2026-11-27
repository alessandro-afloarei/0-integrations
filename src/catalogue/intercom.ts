import { defineProvider } from '../catalogue.js';

/** The three regional API hosts: https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis */
const hosts = ['api.intercom.io', 'api.eu.intercom.io', 'api.au.intercom.io'] as const;

/** Intercom: OAuth 2 on its US hosts, or the access token on one of three regional hosts (the US by default); `GET /me`
 * names the workspace. `replies.create` with `comment` reaches the customer (`note` stays internal); a conversation's
 * parts come with `conversations.get`. Webhooks: `X-Hub-Signature: sha1=<hex HMAC-SHA1>` of the body, keyed with the
 * app's client secret: https://developers.intercom.com/docs/references/2.13/webhooks/webhook-models */
const conversation = { id: 'string', 'title?': 'string', 'state?': 'string', 'priority?': 'string', 'admin_assignee_id?': 'integer',
  'created_at?': 'integer', 'updated_at?': 'integer' } as const;
const conversationId = { conversation_id: { in: 'path', type: 'string', required: true } } as const;
const ref = 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io';

export const intercom = defineProvider({
  id: 'intercom', name: 'Intercom',
  docs: 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/identifyadmin',
  categories: ['support'],
  // Intercom reviews an app before other workspaces install it; its permissions are ticked in the Developer Hub (/me
  // needs Read one admin). An EU or AU customer signing in with Google needs its region's authorize host (not here):
  // https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth
  // https://developers.intercom.com/docs/publish-to-the-app-store/review-publish-your-app
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.intercom.com/oauth', tokenUrl: 'https://api.intercom.io/auth/eagle/token', pkce: false },
  { kind: 'key', fields: [{ name: 'apiHost', title: 'Region', choices: hosts,
    default: 'api.intercom.io', help: 'Where the workspace is hosted: the US, the EU or Australia.' },
  { name: 'accessToken', title: 'Access token', secret: true,
    help: 'For your own Intercom workspace: the Access Token in your app\'s Configure > Authentication section in the Developer Hub, the app with the Read one admin, Read conversations, Write conversations and Read and list users and companies permissions. It reaches the conversations of the teammate who installed the app. Intercom requires OAuth for an app that reaches other people\'s workspaces.' }],
  http: { baseUrl: 'https://{apiHost}', host: hosts } }],
  // No scope is sent: the app also ticks Read conversations, Write conversations and Read and list users and companies:
  // https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/oauth-scopes
  scopes: { default: [] },
  // `api.intercom.io` attempts to route a call to the workspace's region; every request names the API version the entry
  // reads, which overrides the app's: https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis
  // https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis/update-your-api-version
  http: { baseUrl: 'https://api.intercom.io', headers: { accept: 'application/json', 'intercom-version': '2.18' },
    retry: { defaultWaitMs: 10_000, wait: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } } },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/me' }, id: 'app.id_code', name: 'app.name' },
  webhook: { kind: 'hmac', header: 'x-hub-signature', prefix: 'sha1=', hash: 'sha1' },
  paging: { cursor: { kind: 'cursor', next: 'pages.next.starting_after', send: { query: 'starting_after' } } },
  operations: {
    'conversations.list': { docs: `${ref}/conversations/listconversations`, path: '/conversations', paging: 'cursor',
      records: 'conversations', params: { per_page: { in: 'query', type: 'integer', description: '20 by default, at most 150.' } },
      result: { conversations: [conversation] } },
    'conversations.search': { docs: `${ref}/conversations/searchconversations`, method: 'POST', kind: 'read',
      path: '/conversations/search',
      params: { query: { in: 'body', type: 'unknown', required: true,
        description: 'A filter (field, operator, value), or AND or OR over a list of filters.' },
      pagination: { in: 'body', type: { 'per_page?': 'integer', 'starting_after?': 'string' },
        description: 'One page: pass the answer\'s pages.next.starting_after for the next.' } },
      result: { conversations: [conversation], 'pages?': { 'next?': { 'starting_after?': 'string' } } } },
    'conversations.get': { docs: `${ref}/conversations/retrieveconversation`, path: '/conversations/{conversation_id}',
      notFound: 'null', params: conversationId,
      result: { ...conversation, 'conversation_parts?': { conversation_parts: [{ id: 'string', 'part_type?': 'string',
        'body?': 'unknown', 'created_at?': 'integer' }] } } },
    'conversations.update': { docs: `${ref}/conversations/updateconversation`, method: 'PUT', path: '/conversations/{conversation_id}',
      params: { ...conversationId, title: { in: 'body', type: 'string' },
        read: { in: 'body', type: 'boolean', description: 'Marks the conversation as read.' },
        company_id: { in: 'body', type: 'string', nullable: true, description: 'The company\'s Intercom id; null removes it.' } },
      result: conversation },
    'replies.create': { docs: `${ref}/conversations/replyconversation`, method: 'POST', path: '/conversations/{conversation_id}/reply',
      params: { ...conversationId, message_type: { in: 'body', type: 'string', required: true, enum: ['comment', 'note'],
        description: 'comment reaches the customer; note keeps the reply internal, for teammates.' },
      type: { in: 'body', type: 'string', required: true, enum: ['admin'], description: 'admin: a teammate replies.' },
      admin_id: { in: 'body', type: 'string', required: true, description: 'The teammate who replies.' },
      body: { in: 'body', type: 'string', required: true },
      skip_notifications: { in: 'body', type: 'boolean', description: 'true sends no notifications.' } },
      result: conversation },
    'contacts.list': { docs: `${ref}/contacts/listcontacts`, path: '/contacts', paging: 'cursor', records: 'data',
      params: { per_page: { in: 'query', type: 'integer', description: '10 by default, at most 150.' } },
      result: { data: [{ id: 'string', 'role?': 'string', 'email?': 'string', 'name?': 'string', 'external_id?': 'string',
        'created_at?': 'integer', 'updated_at?': 'integer' }] } },
  },
});
