import { defineProvider } from '../catalogue.js';

/** Confluence Cloud: Basic auth from the Atlassian account's email and an API token, on the person's own site. A 429's
 * wait is in `Retry-After` (https://developer.atlassian.com/cloud/confluence/rate-limiting/). Its OAuth 2.0 (3LO) calls
 * go through api.atlassian.com, another base, so this entry takes the token alone. */
const page = { id: 'string', 'status?': 'string', 'title?': 'string', 'spaceId?': 'string', 'parentId?': 'string',
  'createdAt?': 'string', 'version?': { 'number?': 'integer', 'createdAt?': 'string' }, '_links?': { 'webui?': 'string' } } as const;
const pageId = { in: 'path', type: 'integer', required: true } as const;
const status = { in: 'body', type: 'string', enum: ['current', 'draft'] } as const;
const limit = { in: 'query', type: 'integer' } as const;
const pages = 'https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/';

export const confluence = defineProvider({
  id: 'confluence', name: 'Confluence', docs: 'https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/',
  categories: ['docs'],
  fields: [{ name: 'site', title: 'Site', help: 'The name before .atlassian.net in your Confluence address.' },
    { name: 'email', title: 'Atlassian account email' }, { name: 'apiToken', title: 'API token', secret: true }],
  auth: [{ kind: 'key', send: { basic: ['{email}', '{apiToken}'] } }],
  http: { baseUrl: 'https://{site}.atlassian.net/wiki', host: '*.atlassian.net', retry: {} },
  identify: { request: { path: '/rest/api/user/current' }, id: 'accountId', name: ['displayName', 'publicName'] },
  paging: { next: { kind: 'nextUrl', next: '_links.next', pathPrefix: '/api/v2/' } },
  operations: {
    'pages.list': { docs: `${pages}#api-pages-get`, path: '/api/v2/pages', paging: 'next',
      params: { 'space-id': { in: 'query', type: 'string', description: 'Space ids, comma-separated.' }, limit },
      records: 'results', result: { results: [page] } },
    'pages.get': { docs: `${pages}#api-pages-id-get`, path: '/api/v2/pages/{pageId}', params: { pageId }, result: page },
    'pages.create': { docs: `${pages}#api-pages-post`, method: 'POST', path: '/api/v2/pages',
      params: { spaceId: { in: 'body', type: 'string', required: true }, status, title: { in: 'body', type: 'string' },
        parentId: { in: 'body', type: 'string' }, body: { in: 'body', type: 'unknown' } }, result: page },
    'pages.update': { docs: `${pages}#api-pages-id-put`, method: 'PUT', path: '/api/v2/pages/{pageId}',
      params: { pageId, id: { in: 'body', type: 'string', required: true }, status: { ...status, required: true },
        title: { in: 'body', type: 'string', required: true }, body: { in: 'body', type: 'unknown', required: true },
        version: { in: 'body', type: { 'number?': 'integer', 'message?': 'string' }, required: true,
          description: 'The current version number plus one.' },
        spaceId: { in: 'body', type: 'string' }, parentId: { in: 'body', type: 'string' } }, result: page },
    'spaces.list': { docs: 'https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/#api-spaces-get',
      path: '/api/v2/spaces', paging: 'next', params: { limit }, records: 'results',
      result: { results: [{ id: 'string', 'key?': 'string', 'name?': 'string', 'status?': 'string', 'createdAt?': 'string',
        '_links?': { 'webui?': 'string' } }] } },
  },
});
