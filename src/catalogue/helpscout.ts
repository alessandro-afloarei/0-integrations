import { defineProvider } from '../catalogue.js';

/** Help Scout: OAuth 2 on a paid plan (app under My apps): https://docs.helpscout.com/article/1140-mailbox-api
 * A 429 waits `X-RateLimit-Retry-After` seconds: https://developer.helpscout.com/mailbox-api/overview/rate-limiting/
 * A reply thread emails the customer (`imported` sends none). Webhooks: https://developer.helpscout.com/webhooks/
 * Lists follow `_links.next`: https://developer.helpscout.com/mailbox-api/overview/pagination/ */
const conversation = { id: 'integer', 'number?': 'integer', 'type?': 'string', 'status?': 'string', 'state?': 'string',
  'subject?': 'string', 'mailboxId?': 'integer', 'createdAt?': 'string' } as const;
const customer = { 'id?': 'integer', 'email?': 'string', 'firstName?': 'string', 'lastName?': 'string' } as const;
const thread = { id: 'integer', 'type?': 'string', 'status?': 'string', 'state?': 'string', 'body?': 'unknown', 'createdAt?': 'string',
  'createdBy?': { 'id?': 'integer', 'type?': 'string', 'email?': 'string' } } as const;
const conversationId = { conversationId: { in: 'path', type: 'integer', required: true } } as const;
const status = { in: 'body', type: 'string', enum: ['active', 'closed', 'inbox_predefined', 'open', 'pending', 'spam'],
  description: 'The conversation\'s new status; without it the thread reactivates the conversation.' } as const;
const imported = { in: 'body', type: 'boolean', description: 'true sends no emails or notifications.' } as const;
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
    'conversations.update': { docs: `${ref}/conversations/update/`, method: 'PATCH', path: '/conversations/{conversationId}',
      params: { ...conversationId, op: { in: 'body', type: 'string', required: true, enum: ['add', 'move', 'remove', 'replace'],
        description: 'replace for every path but /mailboxId (move) and un-assigning /assignTo (remove).' },
      path: { in: 'body', type: 'string', required: true, enum: ['/assignTo', '/draft', '/mailboxId', '/primaryCustomer.id', '/status', '/subject'],
        description: 'The field changed; /draft with true publishes the draft, which sends it.' },
      value: { in: 'body', type: 'unknown', description: 'A string for /subject and /status, a number for an id, a boolean for /draft.' } } },
    'threads.list': { docs: `${ref}/conversations/threads/list/`, path: '/conversations/{conversationId}/threads', paging: 'next',
      records: '_embedded.threads', params: conversationId, result: { _embedded: { threads: [thread] } } },
    'threads.create': { docs: `${ref}/conversations/threads/reply/`, method: 'POST', path: '/conversations/{conversationId}/reply',
      params: { ...conversationId, text: { in: 'body', type: 'string', required: true },
        customer: { in: 'body', type: { 'id?': 'integer' }, required: true, description: 'The customer replied to.' },
        draft: { in: 'body', type: 'boolean', description: 'true creates a draft reply, which sends nothing.' }, imported, status,
        user: { in: 'body', type: 'integer', description: 'The user adding the reply; the token\'s by default.' },
        assignTo: { in: 'body', type: 'integer' }, cc: { in: 'body', type: ['string'] }, bcc: { in: 'body', type: ['string'] } } },
    'notes.create': { docs: `${ref}/conversations/threads/note/`, method: 'POST', path: '/conversations/{conversationId}/notes',
      params: { ...conversationId, text: { in: 'body', type: 'string', required: true }, imported, status,
        user: { in: 'body', type: 'integer', description: 'The user adding the note; the token\'s by default.' } } },
    // Deprecated for List Customers (v3), sunset 1 March 2027: v3's `/v3` path is outside the entry's `/v2` base.
    'customers.list': { docs: `${ref}/customers/list/`, path: '/customers', paging: 'next', records: '_embedded.customers',
      params: { mailbox: { in: 'query', type: 'integer', description: 'Customers of one inbox.' }, firstName: { in: 'query', type: 'string' },
        lastName: { in: 'query', type: 'string' }, query: { in: 'query', type: 'string' } },
      result: { _embedded: { customers: [{ id: 'integer', 'firstName?': 'string', 'lastName?': 'string', 'organization?': 'string',
        'createdAt?': 'string', 'updatedAt?': 'string' }] } } },
  },
});
