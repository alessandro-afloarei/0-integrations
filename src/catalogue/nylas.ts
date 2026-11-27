import { defineProvider } from '../catalogue.js';

/** Nylas: Hosted OAuth on the region's host (https://developer.nylas.com/docs/dev-guide/platform/data-residency/), the
 * app made in the Dashboard, its client secret the app's API key. `messages.create` emails people. A 429 waits
 * `Retry-After`, else the one-second window: https://developer.nylas.com/docs/dev-guide/platform/rate-limits/
 * Webhooks: https://developer.nylas.com/docs/cookbook/use-cases/build/verify-webhook-signatures/ */
const hosts = ['api.us.nylas.com', 'api.eu.nylas.com'] as const;
const person = [{ 'name?': 'string', 'email?': 'string' }] as const;
const message = { id: 'string', 'thread_id?': 'string', 'subject?': 'string', 'snippet?': 'string', 'date?': 'integer',
  'unread?': 'boolean', 'folders?': ['string'], 'from?': person } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '50 by default, at most 200.' } } as const;
const ref = 'https://developer.nylas.com/docs/reference/api';

export const nylas = defineProvider({
  id: 'nylas', name: 'Nylas', docs: 'https://developer.nylas.com/docs/v3/auth/hosted-oauth-accesstoken/',
  categories: ['mail', 'calendar'],
  fields: [{ name: 'apiHost', title: 'Nylas region', choices: hosts, default: 'api.us.nylas.com',
    help: 'The region your Nylas application was created in, which cannot change: api.us.nylas.com for the U.S., api.eu.nylas.com for Europe.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://{apiHost}/v3/connect/auth', tokenUrl: 'https://{apiHost}/v3/connect/token',
    authorizeParams: { response_type: 'code', access_type: 'offline' } }],
  scopes: { default: [] },
  http: { baseUrl: 'https://{apiHost}/v3/grants/me', host: hosts, retry: { defaultWaitMs: 1_000 } },
  identify: { id: 'tokenAnswer.grant_id', name: 'tokenAnswer.email' },
  errors: { detail: 'error.type' },
  webhook: { kind: 'hmac', header: 'x-nylas-signature' },
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', send: { query: 'page_token' } } },
  operations: {
    'messages.list': { docs: `${ref}/messages/get-messages/`, path: '/messages', paging: 'cursor', records: 'data',
      params: { in: { in: 'query', type: 'string', description: 'A folder or label id.' }, unread: { in: 'query', type: 'boolean' },
        thread_id: { in: 'query', type: 'string' }, search_query_native: { in: 'query', type: 'string' }, ...limit },
      result: { data: [message] } },
    'messages.get': { docs: `${ref}/messages/get-messages-id/`, path: '/messages/{message_id}', notFound: 'null',
      params: { message_id: { in: 'path', type: 'string', required: true } }, result: { data: message } },
    'folders.list': { docs: `${ref}/folders/get-folder/`, path: '/folders', paging: 'cursor', records: 'data', params: limit,
      result: { data: [{ id: 'string', 'name?': 'string', 'parent_id?': 'string', 'system_folder?': 'boolean',
        'total_count?': 'integer', 'unread_count?': 'integer' }] } },
    'drafts.create': { docs: `${ref}/drafts/post-draft/`, method: 'POST', path: '/drafts',
      params: { to: { in: 'body', type: [{ 'name?': 'string', email: 'string' }] }, cc: { in: 'body', type: [{ 'name?': 'string', email: 'string' }] },
        bcc: { in: 'body', type: [{ 'name?': 'string', email: 'string' }] }, subject: { in: 'body', type: 'string' },
        body: { in: 'body', type: 'string' }, reply_to_message_id: { in: 'body', type: 'string' } },
      result: { data: { id: 'string', 'thread_id?': 'string', 'subject?': 'string' } } },
    'messages.create': { docs: `${ref}/messages/send-message/`, method: 'POST', path: '/messages/send',
      params: { to: { in: 'body', type: person }, cc: { in: 'body', type: person }, bcc: { in: 'body', type: person },
        subject: { in: 'body', type: 'string' }, body: { in: 'body', type: 'string', description: 'HTML.' },
        reply_to_message_id: { in: 'body', type: 'string' }, send_at: { in: 'body', type: 'integer', description: 'Unix seconds.' } },
      anyOf: [['to'], ['cc'], ['bcc']], result: { data: message } },
  },
});
