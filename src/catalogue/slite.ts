import { defineProvider } from '../catalogue.js';

/** Slite: a personal API key as Bearer, the scheme of the API's OpenAPI file (https://api.slite.com/openapi.json) and of
 * every reference page; the getting-started guide sends it in `x-slite-api-key` instead. Errors carry a code in `id`, a
 * 429 past the rate limit. Notes nest under a parent note; no endpoint lists channels. */
const note = { id: 'string', title: 'string', url: 'string', 'parentNoteId?': 'string', 'archivedAt?': 'string',
  'reviewState?': 'string', createdAt: 'string', updatedAt: 'string' } as const;
const noteId = { in: 'path', type: 'string', required: true } as const;
const markdown = { in: 'body', type: 'string' } as const;
const reference = 'https://developers.slite.com/reference';

export const slite = defineProvider({
  id: 'slite', name: 'Slite', docs: 'https://developers.slite.com/docs/getting-started',
  categories: ['docs'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Settings > API > Create a new key; it is shown once. It reaches all your content.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.slite.com/v1', retry: {} },
  identify: { request: { path: '/me' }, id: 'email', name: ['displayName', 'email'] },
  errors: { detail: 'id' },
  paging: { cursor: { kind: 'cursor', next: 'nextCursor', more: 'hasNextPage', send: { query: 'cursor' } } },
  operations: {
    'notes.list': { docs: `${reference}/listnotes`, path: '/notes', paging: 'cursor', records: 'notes',
      params: { parentNoteId: { in: 'query', type: 'string' } }, result: { notes: [note] } },
    'notes.get': { docs: `${reference}/getnotebyid`, path: '/notes/{noteId}', params: { noteId }, result: note },
    'notes.create': { docs: `${reference}/createnote`, method: 'POST', path: '/notes',
      params: { title: { in: 'body', type: 'string', required: true }, parentNoteId: { in: 'body', type: 'string' }, markdown },
      result: note },
    'notes.update': { docs: `${reference}/updatenote`, method: 'PUT', path: '/notes/{noteId}',
      params: { noteId, title: { in: 'body', type: 'string' }, markdown }, result: note },
  },
});
