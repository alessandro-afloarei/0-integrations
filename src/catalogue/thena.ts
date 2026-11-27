import { defineProvider } from '../catalogue.js';

/** Thena (its APIs are on the Standard and Enterprise plans: https://www.thena.ai/pricing): a public comment reaches
 * the customer in the ticket's conversation, on Slack, email or web chat, and a note never does:
 * https://docs.thena.ai/guides/ticketing/tickets. No webhook signature is documented. */
const ticket = { id: 'string', 'ticketId?': 'number', 'title?': 'string', 'status?': 'string',
  'teamId?': 'string', 'requestorEmail?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const comment = { id: 'string', 'contentHtml?': 'unknown', 'commentType?': 'string', 'commentVisibility?': 'string',
  'authorId?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const written = { description: { in: 'body', type: 'string' }, statusName: { in: 'body', type: 'string' },
  priorityName: { in: 'body', type: 'string' }, assignedAgentId: { in: 'body', type: 'string' },
  assignedAgentEmail: { in: 'body', type: 'string' }, accountId: { in: 'body', type: 'string' } } as const;
const ref = 'https://docs.thena.ai/api-reference/platform/tickets';

export const thena = defineProvider({
  id: 'thena', name: 'Thena', docs: 'https://docs.thena.ai/api-reference/introduction',
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Your personal API key, in Settings > Security & access: it is tied to your user-level permissions. Tickets and comments need the Standard or Enterprise plan.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  // A 429 says to wait until `X-RateLimit-Reset`, a UNIX timestamp in seconds.
  http: { baseUrl: 'https://platform.thena.ai', retry: { onlyStated: true, wait: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } } },
  identify: { request: { path: '/v1/users/details' }, id: 'id', name: ['name', 'email'] },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'data', zeroBased: true } },
  operations: {
    'tickets.list': { docs: `${ref}/get-all-tickets`, path: '/v1/tickets', paging: 'page', records: 'data',
      params: { teamId: { in: 'query', type: 'string' },
        dateRange: { in: 'query', type: 'string', enum: ['1d', '2d', '1w', '2w', '3w', '4w', '1m', '3m'], description: 'A calendar range in UTC: 1d is since 00:00 UTC yesterday.' },
        limit: { in: 'query', type: 'number', description: '10 by default, 1 to 100.' } },
      result: { data: [ticket] } },
    'tickets.get': { docs: `${ref}/get-a-ticket`, path: '/v1/tickets/{id}', params: id, result: { data: ticket } },
    'tickets.create': { docs: `${ref}/create-a-ticket`, method: 'POST', path: '/v1/tickets',
      params: { title: { in: 'body', type: 'string', required: true }, requestorEmail: { in: 'body', type: 'string', required: true },
        teamId: { in: 'body', type: 'string', required: true }, ...written },
      result: { data: ticket } },
    'tickets.update': { docs: `${ref}/update-a-ticket`, method: 'PATCH', path: '/v1/tickets/{id}',
      params: { ...id, title: { in: 'body', type: 'string' }, ...written }, result: { data: ticket } },
    'comments.list': { docs: `${ref}/get-comments-for-a-ticket`, path: '/v1/tickets/{id}/comments',
      params: { ...id, commentType: { in: 'query', type: 'string', required: true, enum: ['comment', 'note'] },
        visibility: { in: 'query', type: 'string', required: true, enum: ['private', 'public'] },
        page: { in: 'query', type: 'number' }, limit: { in: 'query', type: 'number' } },
      result: { data: [comment] } },
    'comments.create': { docs: `${ref}/comment-on-a-ticket`, method: 'POST', path: '/v1/tickets/{id}/comment',
      params: { ...id, content: { in: 'body', type: 'string' }, contentHtml: { in: 'body', type: 'string' },
        commentType: { in: 'body', type: 'string', description: '`comment`, or `note`: a note is internal, invisible to customers.' },
        commentVisibility: { in: 'body', type: 'string', description: '`public` or `private`.' },
        shouldSendEmail: { in: 'body', type: 'boolean', description: 'Whether to send an email.' } },
      result: { data: comment } },
    'contacts.search': { docs: 'https://docs.thena.ai/api-reference/specs/platform-openapi.yaml', path: '/v1/search/contact-search',
      params: { query: { in: 'query', type: 'string', required: true, description: 'Matched against first name, last name, email and phone number.' },
        cursor: { in: 'query', type: 'string', description: 'The ID of the last item of the previous page.' },
        limit: { in: 'query', type: 'number', description: '1 to 100.' } } },
  },
});
