import { defineProvider } from '../catalogue.js';

/** Outline, app.getoutline.com or the person's own server: the host is typed, so it is reached only through the address
 * guard unless the app passes its own `fetch`. Every method is a POST with a JSON body; a 429 names its wait in
 * `Retry-After`. Lists take `offset` and `limit` and answer one page each (https://www.getoutline.com/developers). Types:
 * https://www.getoutline.com/openapi.json */
const document = { id: 'string', 'title?': 'string', 'collectionId?': 'string', 'parentDocumentId?': 'string',
  'path?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const page = { offset: { in: 'body', type: 'number' }, limit: { in: 'body', type: 'number' } } as const;
const pagination = { 'offset?': 'number', 'limit?': 'number', 'nextPath?': 'string' } as const;
const fields = { title: { in: 'body', type: 'string' }, text: { in: 'body', type: 'string' },
  collectionId: { in: 'body', type: 'string', nullable: true }, publish: { in: 'body', type: 'boolean' } } as const;
const ref = 'https://www.getoutline.com/developers#tag';

export const outline = defineProvider({
  id: 'outline', name: 'Outline', docs: 'https://www.getoutline.com/developers#description/api-key',
  categories: ['docs'],
  fields: [{ name: 'host', title: 'Outline host', default: 'app.getoutline.com',
    help: 'app.getoutline.com, or the host name of your own Outline, with no port.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Create it under Settings => API & Apps. A key can be limited by scopes: keep write, which allows every read and write.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{host}/api', host: '*', headers: { 'content-type': 'application/json' }, retry: {} },
  identify: { request: { method: 'POST', path: '/auth.info' }, id: 'data.user.id', name: ['data.user.name', 'data.user.email'] },
  errors: { detail: 'error' },
  operations: {
    'documents.list': { docs: `${ref}/documents/POST/documents.list`, method: 'POST', path: '/documents.list', kind: 'read',
      params: { filters: { in: 'body', type: ['unknown'] }, ...page }, result: { data: [document], 'pagination?': pagination } },
    'documents.get': { docs: `${ref}/documents/POST/documents.info`, method: 'POST', path: '/documents.info', kind: 'read',
      notFound: 'null', params: { id: { in: 'body', type: 'string', required: true } }, result: { data: document } },
    'documents.create': { docs: `${ref}/documents/POST/documents.create`, method: 'POST', path: '/documents.create',
      params: { ...fields, parentDocumentId: { in: 'body', type: 'string', nullable: true } }, result: { data: document } },
    'documents.update': { docs: `${ref}/documents/POST/documents.update`, method: 'POST', path: '/documents.update',
      params: { id: { in: 'body', type: 'string', required: true }, ...fields }, result: { data: document } },
    'collections.list': { docs: `${ref}/collections/POST/collections.list`, method: 'POST', path: '/collections.list',
      kind: 'read', params: page,
      result: { data: [{ id: 'string', 'name?': 'string', 'url?': 'string', 'createdAt?': 'string', 'updatedAt?': 'string' }],
        'pagination?': pagination } },
  },
});
