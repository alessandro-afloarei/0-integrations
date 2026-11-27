import { defineProvider } from '../catalogue.js';

/** Zammad on the person's own server: the typed host is reached only through the address guard unless the app passes
 * its own `fetch`. A personal access token as `Token token=…`; `GET /users/me` names the person (an id local to that
 * server). A ticket create or update notifies agents unless `x-zammad-suppress-notifications`; an `email` article is
 * sent, even when `internal`. Lists page by `page` beside a required `per_page`; no rate limit is stated. */
const ref = 'https://docs.zammad.org/en/latest/api';
const ticket = { id: 'integer', 'number?': 'string', 'title?': 'string', 'state_id?': 'integer', 'group_id?': 'integer',
  'customer_id?': 'integer', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const article = { id: 'integer', 'ticket_id?': 'integer', 'type?': 'string', 'sender?': 'string', 'from?': 'string',
  'internal?': 'boolean', 'body?': 'unknown', 'created_at?': 'string' } as const;
const id = { id: { in: 'path', type: 'integer', required: true } } as const;
const perPage = { per_page: { in: 'query', type: 'integer', required: true,
  description: 'Objects per page; Zammad caps it at a limit of its own.' } } as const;
const internal = 'true keeps the article to agents; an email article is still sent.';
const written = { title: { in: 'body', type: 'string' }, group: { in: 'body', type: 'string', description: 'A group\'s name.' },
  state: { in: 'body', type: 'string', description: 'A state\'s name, such as open.' },
  priority: { in: 'body', type: 'string', description: 'A priority\'s name, such as 3 high.' },
  article: { in: 'body', type: { 'subject?': 'string', 'body?': 'string', 'type?': 'string', 'sender?': 'string', 'internal?': 'boolean' },
    description: `A new article on the ticket. type: email, phone, note and more; sender: Agent, Customer or System (Customer for a ticket made on a customer's behalf); internal: ${internal}` },
  'x-zammad-suppress-notifications': { in: 'header', type: 'boolean',
    description: 'true: no agent notifications (email and in-app); ignored for customers.' } } as const;

export const zammad = defineProvider({
  id: 'zammad', name: 'Zammad', docs: `${ref}/intro.html`,
  categories: ['support'],
  fields: [{ name: 'host', title: 'Zammad host', help: 'The host name of your Zammad, with no port.' },
    { name: 'accessToken', title: 'Personal access token', secret: true,
      help: 'Create it in your profile (Avatar, Profile, Token Access) with the ticket.agent permission. An admin can switch token access off.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Token token={token}' } }],
  http: { baseUrl: 'https://{host}/api/v1', host: '*' },
  identify: { request: { path: '/users/me' }, id: 'id', name: ['login', 'email'] },
  paging: { page: { kind: 'page', send: { query: 'page' } } },
  // HMAC-SHA256 with its signature token (https://admin-docs.zammad.org/en/latest/manage/webhook/payload.html); its
  // Bearer and Basic options are not what this checks.
  webhook: { kind: 'hmac', header: 'x-hub-signature-256', prefix: 'sha256=', deliveryId: { header: 'x-zammad-delivery' } },
  operations: {
    'tickets.list': { docs: `${ref}/ticket/index.html`, path: '/tickets', paging: 'page', params: perPage, result: [ticket] },
    'tickets.search': { docs: `${ref}/intro.html`, path: '/tickets/search', paging: 'page',
      params: { query: { in: 'query', type: 'string', required: true }, sort_by: { in: 'query', type: 'string' },
        order_by: { in: 'query', type: 'string', enum: ['asc', 'desc'] }, ...perPage },
      result: [ticket] },
    'tickets.get': { docs: `${ref}/ticket/index.html`, path: '/tickets/{id}', params: id, result: ticket },
    'tickets.create': { docs: `${ref}/ticket/index.html`, method: 'POST', path: '/tickets',
      params: { ...written, customer: { in: 'body', type: 'string', description: 'The customer\'s email address.' } }, result: ticket },
    'tickets.update': { docs: `${ref}/ticket/index.html`, method: 'PUT', path: '/tickets/{id}', params: { ...id, ...written },
      result: ticket },
    'articles.list': { docs: `${ref}/ticket/articles.html`, path: '/ticket_articles/by_ticket/{ticket_id}',
      params: { ticket_id: { in: 'path', type: 'integer', required: true } }, result: [article] },
    'articles.create': { docs: `${ref}/ticket/articles.html`, method: 'POST', path: '/ticket_articles',
      params: { ticket_id: { in: 'body', type: 'integer' }, to: { in: 'body', type: 'string' }, subject: { in: 'body', type: 'string' },
        body: { in: 'body', type: 'string' }, content_type: { in: 'body', type: 'string', enum: ['text/html', 'text/plain'] },
        type: { in: 'body', type: 'string', description: 'email sends it to `to`; note for an internal note; phone, web and more.' },
        internal: { in: 'body', type: 'boolean', description: internal } },
      result: article },
    'users.list': { docs: `${ref}/user.html`, path: '/users', paging: 'page', params: perPage,
      result: [{ id: 'integer', 'login?': 'string', 'firstname?': 'string', 'lastname?': 'string', 'email?': 'string',
        'organization_id?': 'integer', 'created_at?': 'string', 'updated_at?': 'string' }] },
  },
});
