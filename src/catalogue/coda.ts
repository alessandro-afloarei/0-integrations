import { defineProvider } from '../catalogue.js';

/** Superhuman Docs, formerly Coda: an API token as Bearer, its restrictions described in the OpenAPI file, which names
 * another base, https://docs.superhuman.com/apis/v1 (https://docs.superhuman.com/apis/v1/openapi.json). Limits are per
 * user (reads 100, writes 10 per 6 seconds), a 429 past them. A write answers 202 and is applied seconds later. */
const page = { id: 'string', name: 'string', browserLink: 'string', 'parent?': { id: 'string' }, 'createdAt?': 'string',
  'updatedAt?': 'string' } as const;
const docId = { in: 'path', type: 'string', required: true } as const;
const pageIdOrName = { in: 'path', type: 'string', required: true } as const;
const reference = 'https://docs.superhuman.com/developers/apis/v1';

export const coda = defineProvider({
  id: 'coda', name: 'Superhuman Docs (formerly Coda)', docs: `${reference}#operation/whoami`,
  categories: ['docs'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'From My account; it is shown once. Make it with no restriction, so it can do what you can: a token restricted to a doc can call only that doc (it cannot list docs), and a read-only one cannot write. Creating a page needs a Doc Maker in the workspace.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://coda.io/apis/v1', retry: {} },
  identify: { request: { path: '/whoami' }, id: 'loginId', name: ['name', 'loginId'] },
  paging: { cursor: { kind: 'cursor', next: 'nextPageToken', send: { query: 'pageToken' } } },
  operations: {
    'pages.list': { docs: `${reference}#operation/listPages`, path: '/docs/{docId}/pages', paging: 'cursor', records: 'items',
      params: { docId, limit: { in: 'query', type: 'integer' } }, result: { items: [page] } },
    'pages.get': { docs: `${reference}#operation/getPage`, path: '/docs/{docId}/pages/{pageIdOrName}', notFound: 'null',
      params: { docId, pageIdOrName }, result: page },
    'pages.create': { docs: `${reference}#operation/createPage`, method: 'POST', path: '/docs/{docId}/pages',
      params: { docId, name: { in: 'body', type: 'string' }, parentPageId: { in: 'body', type: 'string' },
        pageContent: { in: 'body', type: 'unknown' } } },
    'pages.update': { docs: `${reference}#operation/updatePage`, method: 'PUT', path: '/docs/{docId}/pages/{pageIdOrName}',
      params: { docId, pageIdOrName, name: { in: 'body', type: 'string' }, contentUpdate: { in: 'body', type: 'unknown' } } },
    'docs.list': { docs: `${reference}#operation/listDocs`, path: '/docs', paging: 'cursor', records: 'items',
      params: { limit: { in: 'query', type: 'integer' } },
      result: { items: [{ id: 'string', name: 'string', browserLink: 'string', folder: { id: 'string' }, createdAt: 'string',
        updatedAt: 'string' }] } },
  },
});
