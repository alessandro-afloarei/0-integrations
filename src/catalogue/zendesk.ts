import { defineProvider } from '../catalogue.js';

/** Zendesk Support: OAuth 2 with a local client an admin makes on one instance (a token reaches that instance alone);
 * an app for many Zendesk customers needs a global client, which Zendesk approves (below). Then the API token,
 * deprecated, for your own instance. A ticket's create and update email the requester and CCs (`operations`).
 * https://developer.zendesk.com/documentation/marketplace/building-a-marketplace-app/set-up-a-global-oauth-client/ */
const ticket = { id: 'integer', 'subject?': 'string', 'status?': 'string', 'priority?': 'string', 'requester_id?': 'integer',
  'assignee_id?': 'integer', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const user = { id: 'integer', 'name?': 'string', 'email?': 'string', 'role?': 'string', 'organization_id?': 'integer',
  'active?': 'boolean', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const comment = { 'body?': 'string', 'html_body?': 'string', 'public?': 'boolean' } as const;
const written = { 'subject?': 'string', 'status?': 'string', 'priority?': 'string', 'type?': 'string', 'requester_id?': 'integer',
  'requester?': 'unknown', 'assignee_id?': 'integer', 'group_id?': 'integer', 'tags?': ['string'], 'external_id?': 'string' } as const;
const fields = 'The comment is the reply: `comment.public: false` keeps it an internal note, and the first comment\'s `public` holds for later ones unless changed. `status` is new, open, pending, hold, solved or closed; `priority` urgent, high, normal or low; `tags` replaces the ticket\'s tags.';
const size = { 'page[size]': { in: 'query', type: 'integer', required: true,
  description: 'Records per page, at most 100. Sending it pages by cursor.' } } as const;
const ticketId = { ticket_id: { in: 'path', type: 'integer', required: true } } as const;
const subdomain = { name: 'subdomain', title: 'Zendesk subdomain',
  help: 'The part before .zendesk.com in your Zendesk address: your core subdomain, not a host-mapped one.' } as const;
const ref = 'https://developer.zendesk.com/api-reference/ticketing';

export const zendesk = defineProvider({
  id: 'zendesk', name: 'Zendesk', docs: 'https://developer.zendesk.com/api-reference/introduction/security-and-auth/',
  categories: ['support'],
  fields: [subdomain],
  // The token request as JSON, the client's secret in it, PKCE S256:
  // https://support.zendesk.com/hc/en-us/articles/4408845965210
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://{subdomain}.zendesk.com/oauth/authorizations/new',
    tokenUrl: 'https://{subdomain}.zendesk.com/oauth/tokens', json: true, authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { basic: ['{email}/token', '{token}'] }, fields: [subdomain,
    { name: 'email', title: 'Email address', help: 'The email address of the agent or admin you sign in as: the token acts with that user\'s role.' },
    { name: 'apiToken', title: 'API token', secret: true,
      help: 'For your own Zendesk instance: an app for other Zendesk customers connects with the OAuth 2 sign-in, as Zendesk requires. An admin makes it in Admin Center under Apps and integrations, APIs, Zendesk API. Zendesk has deprecated API tokens.' }] }],
  scopes: { default: ['tickets:read', 'tickets:write', 'users:read'] },
  // A 429 waits `Retry-After`: https://developer.zendesk.com/api-reference/introduction/rate-limits/
  http: { baseUrl: 'https://{subdomain}.zendesk.com/api/v2', host: '*.zendesk.com', headers: { accept: 'application/json' }, retry: {} },
  identify: { request: { path: '/users/me' }, id: 'user.id', name: ['user.name', 'user.email'] },
  // https://developer.zendesk.com/api-reference/introduction/requests/
  errors: { detail: 'error' },
  // Cursor paging, turned on by `page[size]`: https://developer.zendesk.com/api-reference/introduction/pagination/
  paging: { cursor: { kind: 'cursor', next: 'meta.after_cursor', more: 'meta.has_more', send: { query: 'page[after]' } },
    // List Users states `has_more` only with `include_boundary_indicators`: its walk ends on a blank cursor.
    users: { kind: 'cursor', next: 'meta.after_cursor', send: { query: 'page[after]' } },
    nextPage: { kind: 'nextUrl', next: 'next_page' } },
  // No comment create or note endpoint: a reply, or with `public: false` an internal note, is the `comment` of a
  // ticket's create or update, which email the requester and CCs as the triggers say:
  // https://developer.zendesk.com/documentation/ticketing/managing-tickets/creating-and-updating-tickets/
  operations: {
    'tickets.list': { docs: `${ref}/tickets/tickets/#list-tickets`, path: '/tickets', paging: 'cursor', records: 'tickets',
      params: { ...size, external_id: { in: 'query', type: 'string' },
        sort: { in: 'query', type: 'string', description: 'updated_at, id or status; a leading - sorts descending.' } },
      result: { tickets: [ticket] } },
    'tickets.get': { docs: `${ref}/tickets/tickets/#show-ticket`, path: '/tickets/{ticket_id}', params: ticketId, result: { ticket } },
    'tickets.create': { docs: `${ref}/tickets/tickets/#create-ticket`, method: 'POST', path: '/tickets',
      params: { ticket: { in: 'body', required: true, type: { comment, ...written }, description: fields } }, result: { ticket } },
    'tickets.update': { docs: `${ref}/tickets/tickets/#update-ticket`, method: 'PUT', path: '/tickets/{ticket_id}',
      params: { ...ticketId, ticket: { in: 'body', required: true, type: { 'comment?': comment, ...written }, description: fields } },
      result: { ticket } },
    'comments.list': { docs: `${ref}/tickets/ticket_comments/#list-comments`, path: '/tickets/{ticket_id}/comments', paging: 'cursor',
      records: 'comments', params: { ...ticketId, ...size },
      result: { comments: [{ id: 'integer', 'type?': 'string', 'author_id?': 'integer', 'body?': 'unknown', 'public?': 'boolean',
        'created_at?': 'string' }] } },
    'users.list': { docs: `${ref}/users/users/#list-users`, path: '/users', paging: 'users', records: 'users',
      params: { ...size, role: { in: 'query', type: 'string', description: 'end-user, agent, admin or a custom role name.' } },
      result: { users: [user] } },
    // Offset pages, at most 10,000 records a query.
    'users.search': { docs: `${ref}/users/users/#search-users`, path: '/users/search', paging: 'nextPage', records: 'users',
      params: { query: { in: 'query', type: 'string', description: 'Zendesk search syntax: part or all of a name, email address, notes or phone.' },
        external_id: { in: 'query', type: 'string' } },
      result: { users: [user] } },
  },
});
