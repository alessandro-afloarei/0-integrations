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
const statuses = ['active', 'closed', 'inbox_predefined', 'open', 'pending'] as const;
const imported = { in: 'body', type: 'boolean', description: 'true sends no emails or notifications.' } as const;
const ref = 'https://developer.helpscout.com/mailbox-api/endpoints';

export const helpscout = defineProvider({
  id: 'helpscout', name: 'Help Scout', docs: 'https://developer.helpscout.com/mailbox-api/overview/authentication/',
  categories: ['support', 'mail'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://secure.helpscout.net/authentication/authorizeClientApplication',
    tokenUrl: 'https://api.helpscout.net/v2/oauth2/token', authorizeParams: { response_type: 'code' } }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.helpscout.net', retry: { wait: { header: 'x-ratelimit-retry-after', unit: 's' } } },
  identify: { request: { path: '/v2/users/me' }, id: 'id', name: 'email' },
  webhook: { kind: 'hmac', header: 'x-helpscout-signature', hash: 'sha1', encoding: 'base64' },
  paging: { next: { kind: 'nextUrl', next: '_links.next.href' } },
  operations: {
    'conversations.list': { docs: `${ref}/conversations/list/`, path: '/v2/conversations', paging: 'next', records: '_embedded.conversations',
      params: { mailbox: { in: 'query', type: 'string', description: 'An inbox id, or several separated by commas.' },
        status: { in: 'query', type: 'string', enum: ['active', 'all', 'closed', 'open', 'pending', 'spam'], description: 'active by default.' },
        query: { in: 'query', type: 'string' } },
      result: { _embedded: { conversations: [conversation] } } },
    'conversations.get': { docs: `${ref}/conversations/get/`, path: '/v2/conversations/{conversationId}', notFound: 'null',
      params: { conversationId: { in: 'path', type: 'integer', required: true } }, result: conversation },
    'inboxes.list': { docs: `${ref}/inboxes/list/`, path: '/v2/mailboxes', paging: 'next', records: '_embedded.mailboxes',
      result: { _embedded: { mailboxes: [{ id: 'integer', 'name?': 'string', 'slug?': 'string', 'email?': 'string',
        'createdAt?': 'string', 'updatedAt?': 'string' }] } } },
    'conversations.create': { docs: `${ref}/conversations/create/`, method: 'POST', path: '/v2/conversations',
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
    'drafts.create': { docs: `${ref}/conversations/create/#creating-a-draft-conversation`, method: 'POST', path: '/v2/conversations',
      params: { subject: { in: 'body', type: 'string', required: true }, type: { in: 'body', type: 'email', required: true },
        mailboxId: { in: 'body', type: 'integer', required: true },
        status: { in: 'body', type: 'string', required: true, enum: ['active', 'closed', 'pending'] },
        customer: { in: 'body', type: customer, required: true },
        threads: { in: 'body', type: [{ type: 'reply', draft: true, text: 'string', customer }], required: true,
          description: 'One reply thread, a draft: Help Scout sends the reply only when someone sends it; automatic workflows still run on new conversations.' },
        assignTo: { in: 'body', type: 'integer' }, tags: { in: 'body', type: ['string'] } },
      anyOf: [['customer.id'], ['customer.email']], result: { 'threadIds?': ['integer'] } },
    'conversations.update': { docs: `${ref}/conversations/update/`, method: 'PATCH', path: '/v2/conversations/{conversationId}',
      params: { ...conversationId, op: { in: 'body', type: 'string', required: true, enum: ['add', 'move', 'remove', 'replace'],
        description: 'replace for every path but /mailboxId (move) and un-assigning /assignTo (remove).' },
      path: { in: 'body', type: 'string', required: true, enum: ['/assignTo', '/mailboxId', '/primaryCustomer.id', '/status', '/subject'],
        description: 'The field changed.' },
      value: { in: 'body', type: 'unknown', description: 'A string for /subject, one for /status (active, closed, open or pending: the entry does not check the value), a number for an id.' } } },
    'threads.list': { docs: `${ref}/conversations/threads/list/`, path: '/v2/conversations/{conversationId}/threads', paging: 'next',
      records: '_embedded.threads', params: conversationId, result: { _embedded: { threads: [thread] } } },
    'threads.create': { docs: `${ref}/conversations/threads/reply/`, method: 'POST', path: '/v2/conversations/{conversationId}/reply',
      params: { ...conversationId, text: { in: 'body', type: 'string', required: true },
        customer: { in: 'body', type: { 'id?': 'integer' }, required: true, description: 'The customer replied to.' },
        draft: { in: 'body', type: 'boolean', description: 'true creates a draft reply, which sends nothing.' }, imported,
        status: { in: 'body', type: 'string', enum: statuses,
          description: 'The conversation\'s new status; without it the reply thread reactivates the conversation.' },
        assignTo: { in: 'body', type: 'integer' }, cc: { in: 'body', type: ['string'] }, bcc: { in: 'body', type: ['string'] } } },
    'notes.create': { docs: `${ref}/conversations/threads/note/`, method: 'POST', path: '/v2/conversations/{conversationId}/notes',
      params: { ...conversationId, text: { in: 'body', type: 'string', required: true }, imported,
        status: { in: 'body', type: 'string', enum: statuses, description: 'The conversation\'s new status.' } } },
    'customers.list': { docs: `${ref}/customers/list-v3/`, path: '/v3/customers', paging: 'next', records: '_embedded.customers',
      params: { firstName: { in: 'query', type: 'string' }, lastName: { in: 'query', type: 'string' }, email: { in: 'query', type: 'string' },
        createdSince: { in: 'query', type: 'string', description: 'A date: customers created after it.' },
        modifiedSince: { in: 'query', type: 'string', description: 'A date: customers modified after it.' } },
      result: { _embedded: { customers: [{ id: 'integer', 'firstName?': 'string', 'lastName?': 'string', 'organizationId?': 'integer',
        'createdAt?': 'string', 'updatedAt?': 'string' }] } } },
  },
});
