import { defineProvider } from '../catalogue.js';

/** Reply API v3, pages under https://docs.reply.io/api-reference/: limits per user, shared by every app acting for
 * them, and a 429 with `Retry-After` in seconds (rate-limits); errors are problem+json with a stable `code`
 * (introduction). A user API key acts as one user; Team and Organization keys impersonate users through headers this
 * entry does not send (authentication). Types: https://docs.reply.io/api-reference/bundled.yaml */
const contact = { id: 'integer', 'email?': 'string', 'firstName?': 'string', 'lastName?': 'string', 'company?': 'string',
  'ownerUserId?': 'integer', 'createdAt?': 'string', 'lastModifiedAt?': 'string' } as const;
const written = { firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string' },
  title: { in: 'body', type: 'string' }, company: { in: 'body', type: 'string' }, phone: { in: 'body', type: 'string' },
  linkedInUrl: { in: 'body', type: 'string' } } as const;
const top = { top: { in: 'query', type: 'integer', description: 'At most 1000, 25 by default.' } } as const;
const id = { in: 'path', type: 'integer', required: true } as const;
const oneOf = 'All fields are optional — at minimum provide email or a LinkedIn URL.';
const ref = 'https://docs.reply.io/api-reference';

export const replyio = defineProvider({
  id: 'replyio', name: 'Reply.io', docs: 'https://docs.reply.io/api-reference/authentication',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'A user API key (Settings, then API Key), which acts as you: a Team key also works but acts as the workspace owner, and an Organization key needs a header this sign-in does not send. Give it the contacts:write and sequences:operate scopes (each also covers reading).' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.reply.io', retry: {} },
  identify: { request: { path: '/v3/whoami' }, id: 'userId', name: 'username' },
  errors: { detail: 'code' },
  paging: { skip: { kind: 'offset', send: { query: 'skip' }, list: 'items', more: 'hasMore' } },
  operations: {
    'sequences.list': { docs: `${ref}/sequences/list-all-sequences`, path: '/v3/sequences', paging: 'skip', records: 'items',
      params: top, result: { items: [{ id: 'integer', 'name?': 'string', 'status?': 'string', 'isArchived?': 'boolean',
        'ownerUserId?': 'integer', 'created?': 'string' }], 'hasMore?': 'boolean' } },
    'contacts.list': { docs: `${ref}/contacts/list-all-contacts`, path: '/v3/contacts', paging: 'skip', records: 'items',
      params: top, result: { items: [contact], 'hasMore?': 'boolean' } },
    'contacts.get': { docs: `${ref}/contacts/get-a-contact`, path: '/v3/contacts/{id}', notFound: 'null', params: { id }, result: contact },
    'contacts.create': { docs: `${ref}/contacts/create-a-contact`, method: 'POST', path: '/v3/contacts',
      params: { ...written, email: { in: 'body', type: 'string', description: `The email. ${oneOf}` },
        linkedInUrl: { in: 'body', type: 'string', description: `The LinkedIn profile URL. ${oneOf}` } }, result: contact },
    'contacts.update': { docs: `${ref}/contacts/update-a-contact`, method: 'PATCH', path: '/v3/contacts/{id}',
      params: { id, email: { in: 'body', type: 'string' }, ...written }, result: contact },
    'contactLinks.create': { docs: `${ref}/sequence-contacts/bulk-add-contacts-to-sequence`, method: 'POST',
      path: '/v3/sequences/{id}/contact-links/bulk',
      params: { id, contactIds: { in: 'body', type: ['integer'], required: true, description: 'Up to 10,000 contact ids.' } },
      result: { 'added?': ['integer'], 'notProcessed?': 'unknown' } },
  },
});
