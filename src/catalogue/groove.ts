import { defineProvider } from '../catalogue.js';

/** Groove's REST API v1, which its GraphQL API's still-unfinished inbox points to (https://developer.groovehq.com/). An
 * admin's private access token as Bearer; identify only checks it. A message reaches the customer only with
 * `send_copy_to_customer`, and `note` makes it private; agents are notified unless `skip_notifications`. Errors but a
 * 422 answer empty; no rate limit is stated. */
const ref = 'https://www.groovehq.com/docs';
const ticket = { number: 'integer', 'title?': 'unknown', 'summary?': 'string', 'priority?': 'unknown', 'tags?': ['string'],
  'href?': 'string', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const message = { 'href?': 'string', 'note?': 'boolean', 'body?': 'unknown', 'plain_text_body?': 'unknown',
  'created_at?': 'string', 'updated_at?': 'string' } as const;
const number = { ticket_number: { in: 'path', type: 'integer', required: true } } as const;
const perPage = { per_page: { in: 'query', type: 'integer', description: '25 by default, at most 50.' } } as const;
const states = ['unread', 'opened', 'pending', 'closed', 'spam'];
const settable = ['unread', 'opened', 'pending', 'closed'];
const sending = { note: { in: 'body', type: 'boolean', description: 'true adds it as a private note.' },
  send_copy_to_customer: { in: 'body', type: 'boolean', description: 'true emails it to the customer; false by default.' },
  skip_notifications: { in: 'body', type: 'boolean', description: 'true skips every agent notification.' } } as const;

export const groove = defineProvider({
  id: 'groove', name: 'Groove', docs: ref,
  categories: ['support'],
  fields: [{ name: 'accessToken', title: 'Private access token', secret: true,
    help: 'Your account\'s private access token, in the API section of the account settings; only an admin can see it.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.groovehq.com/v1', headers: { 'content-type': 'application/json' } },
  identify: { request: { path: '/me' } },
  paging: { tickets: { kind: 'page', send: { query: 'page' }, list: 'tickets' },
    messages: { kind: 'page', send: { query: 'page' }, list: 'messages' },
    customers: { kind: 'page', send: { query: 'page' }, list: 'customers' } },
  operations: {
    'tickets.list': { docs: `${ref}/tickets`, path: '/tickets', paging: 'tickets', records: 'tickets',
      params: { assignee: { in: 'query', type: 'string', description: 'An agent\'s email, or unassigned.' },
        customer: { in: 'query', type: 'string', description: 'A customer\'s email or id.' },
        state: { in: 'query', type: 'string', enum: states }, folder: { in: 'query', type: 'integer' }, ...perPage },
      result: { tickets: [ticket] } },
    'tickets.get': { docs: `${ref}/tickets`, path: '/tickets/{ticket_number}', params: number, result: { ticket } },
    'tickets.create': { docs: `${ref}/tickets`, method: 'POST', path: '/tickets',
      params: { body: { in: 'body', type: 'string', required: true, description: 'The first message.' },
        from: { in: 'body', type: 'string', required: true, description: 'The email of the agent or customer who sent it.' },
        to: { in: 'body', type: 'string', required: true, description: 'The email of the customer or mailbox it is addressed to.' },
        mailbox: { in: 'body', type: 'string', description: 'A mailbox\'s email or id; the primary mailbox by default.' },
        assignee: { in: 'body', type: 'string', description: 'An agent\'s email.' }, subject: { in: 'body', type: 'string' },
        state: { in: 'body', type: 'string', enum: settable }, tags: { in: 'body', type: ['string'] }, ...sending },
      result: { ticket } },
    'tickets.update': { docs: `${ref}/tickets`, method: 'PUT', path: '/tickets/{ticket_number}/state',
      params: { ...number, state: { in: 'body', type: 'string', required: true, enum: settable } } },
    'messages.list': { docs: `${ref}/messages`, path: '/tickets/{ticket_number}/messages', paging: 'messages', records: 'messages',
      params: { ...number, ...perPage }, result: { messages: [message] } },
    'messages.create': { docs: `${ref}/messages`, method: 'POST', path: '/tickets/{ticket_number}/messages',
      params: { ...number, body: { in: 'body', type: 'string', required: true },
        skip_unread_ticket: { in: 'body', type: 'boolean', description: 'true keeps the ticket from turning unread.' }, ...sending },
      result: { message } },
    'customers.list': { docs: `${ref}/customers`, path: '/customers', paging: 'customers', records: 'customers', params: perPage,
      result: { customers: [{ 'email?': 'string', 'name?': 'string', 'company_name?': 'string', 'phone_number?': 'string',
        'title?': 'string', 'href?': 'string' }] } },
  },
});
