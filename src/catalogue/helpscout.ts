import { defineProvider } from '../catalogue.js';

/** Help Scout: OAuth 2 on a paid plan (app under My apps): https://docs.helpscout.com/article/1140-mailbox-api
 * A 429 waits `X-RateLimit-Retry-After` seconds: https://developer.helpscout.com/mailbox-api/overview/rate-limiting/
 * A reply thread emails the customer (`imported` sends none). Webhooks: https://developer.helpscout.com/webhooks/
 * Lists follow `_links.next`: https://developer.helpscout.com/mailbox-api/overview/pagination/ */
const conversation = { id: 'integer', 'number?': 'integer', 'type?': 'string', 'status?': 'string', 'state?': 'string',
  'subject?': 'string', 'mailboxId?': 'integer', 'createdAt?': 'string' } as const;
const customer = { 'id?': 'integer', 'email?': 'string', 'firstName?': 'string', 'lastName?': 'string' } as const;
const ref = 'https://developer.helpscout.com/mailbox-api/endpoints';

export const helpscout = defineProvider({
  id: 'helpscout', name: 'Help Scout', docs: 'https://developer.helpscout.com/mailbox-api/overview/authentication/',
  categories: ['support', 'mail'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://secure.helpscout.net/authentication/authorizeClientApplication',
    tokenUrl: 'https://api.helpscout.net/v2/oauth2/token', pkce: false, authorizeParams: { response_type: 'code' } }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.helpscout.net/v2', retry: { wait: { header: 'x-ratelimit-retry-after', unit: 's' } } },
  identify: { request: { path: '/users/me' }, id: 'id', name: 'email' },
  webhook: { kind: 'hmac', header: 'x-helpscout-signature', hash: 'sha1', encoding: 'base64' },
  paging: { next: { kind: 'nextUrl', next: '_links.next.href' } },
  operations: {
    'conversations.list': { docs: `${ref}/conversations/list/`, path: '/conversations', paging: 'next', records: '_embedded.conversations',
      params: { mailbox: { in: 'query', type: 'string', description: 'An inbox id, or several separated by commas.' },
        status: { in: 'query', type: 'string', enum: ['active', 'all', 'closed', 'open', 'pending', 'spam'], description: 'active by default.' },
        query: { in: 'query', type: 'string' } },
      result: { _embedded: { conversations: [conversation] } } },
    'conversations.get': { docs: `${ref}/conversations/get/`, path: '/conversations/{conversationId}', notFound: 'null',
      params: { conversationId: { in: 'path', type: 'integer', required: true } }, result: conversation },
    'inboxes.list': { docs: `${ref}/inboxes/list/`, path: '/mailboxes', paging: 'next', records: '_embedded.mailboxes',
      result: { _embedded: { mailboxes: [{ id: 'integer', 'name?': 'string', 'slug?': 'string', 'email?': 'string',
        'createdAt?': 'string', 'updatedAt?': 'string' }] } } },
    'conversations.create': { docs: `${ref}/conversations/create/`, method: 'POST', path: '/conversations',
      params: { subject: { in: 'body', type: 'string', required: true },
        type: { in: 'body', type: 'string', required: true, enum: ['chat', 'email', 'phone'] },
        mailboxId: { in: 'body', type: 'integer', required: true },
        status: { in: 'body', type: 'string', required: true, enum: ['active', 'closed', 'pending'] },
        customer: { in: 'body', type: customer, required: true },
        threads: { in: 'body', type: [{ type: 'string', 'text?': 'string', 'customer?': customer, 'draft?': 'boolean' }], required: true,
          description: 'At least one; each type is note, chat, phone, reply or customer.' },
        imported: { in: 'body', type: 'boolean', description: 'true sends no emails or notifications.' },
        autoReply: { in: 'body', type: 'boolean' }, assignTo: { in: 'body', type: 'integer' }, tags: { in: 'body', type: ['string'] } },
      anyOf: [['customer.id'], ['customer.email']], result: { 'threadIds?': ['integer'] } },
  },
});
