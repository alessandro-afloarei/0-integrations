import { defineProvider } from '../catalogue.js';

/** GitBook: a personal access token as Bearer; a 429 past the rate limit (https://gitbook.com/docs/developers/gitbook-api/rate-limiting).
 * Lists page by `next.page` (https://gitbook.com/docs/developers/gitbook-api/pagination). Pages change only through change
 * requests, so no page write is declared. */
const page = { id: 'string', title: 'string', 'type?': 'string', 'path?': 'string', 'urls?': { 'app?': 'string' },
  'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const spaceId = { in: 'path', type: 'string', required: true } as const;
const reference = 'https://gitbook.com/docs/developers/gitbook-api/api-reference';

export const gitbook = defineProvider({
  id: 'gitbook', name: 'GitBook', docs: 'https://gitbook.com/docs/developers/gitbook-api/authentication',
  categories: ['docs'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'From Developer settings in your GitBook account. Read only is enough; the token can do what your account can, and its IP rules, if any, must allow the app.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.gitbook.com/v1', retry: {} },
  identify: { request: { path: '/user' }, id: 'id', name: ['displayName', 'email'] },
  paging: { cursor: { kind: 'cursor', next: 'next.page', send: { query: 'page' } } },
  operations: {
    'pages.list': { docs: `${reference}/spaces/space-content/list-all-pages-in-a-space-with-their-hierarchy-and-metadata`,
      path: '/spaces/{spaceId}/content/pages', params: { spaceId }, result: { pages: [page] } },
    'pages.get': { docs: `${reference}/spaces/space-content/get-a-single-page-from-a-space-by-its-id`,
      path: '/spaces/{spaceId}/content/page/{pageId}', notFound: 'null',
      params: { spaceId, pageId: { in: 'path', type: 'string', required: true } }, result: page },
    'spaces.list': { docs: `${reference}/spaces/list-all-spaces-in-an-organization`, path: '/orgs/{organizationId}/spaces',
      paging: 'cursor', records: 'items',
      params: { organizationId: { in: 'path', type: 'string', required: true }, limit: { in: 'query', type: 'number' } },
      result: { items: [{ id: 'string', title: 'string', visibility: 'string', organization: 'string', urls: { app: 'string' },
        createdAt: 'string', updatedAt: 'string' }] } },
  },
});
