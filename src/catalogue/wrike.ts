import { defineProvider } from '../catalogue.js';

/** Wrike: OAuth 2. The base and, as the guide's callout says, the refresh (its example: login.wrike.com) use the token
 * answer's `host`: one the reference lists, or Australia's (https://help.wrike.com/hc/en-us/articles/115004562769).
 * A 429 is retried (https://developers.wrike.com/docs/faq); a task list pages once `pageSize` is sent (Help Center):
 * https://help.wrike.com/hc/en-us/community/posts/211881385-API-Pagination-and-the-nextpage-Token */
const task = { id: 'string', 'title?': 'string', 'status?': 'string', 'importance?': 'string', 'permalink?': 'string',
  'createdDate?': 'string', 'updatedDate?': 'string' } as const;
const statuses = ['Active', 'Deferred', 'Completed', 'Cancelled'];
const written = { description: { in: 'query', type: 'string' }, status: { in: 'query', type: 'string', enum: statuses },
  importance: { in: 'query', type: 'string', enum: ['High', 'Low', 'Normal'] } } as const;
const reference = 'https://developers.wrike.com/reference';

export const wrike = defineProvider({
  id: 'wrike', name: 'Wrike', docs: 'https://developers.wrike.com/docs/oauth-20-authorization',
  categories: ['tasks'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.wrike.com/oauth2/authorize/v4', tokenUrl: 'https://login.wrike.com/oauth2/token',
    refreshUrl: 'https://{host}/oauth2/token', scopeSeparator: ',', authorizeParams: { response_type: 'code' } }],
  scopes: { default: ['wsReadWrite'] },
  save: { host: 'tokenAnswer.host' },
  http: { baseUrl: 'https://{host}/api/v4', host: ['www.wrike.com', 'app-eu.wrike.com', 'app-us2.wrike.com', 'app-ap.wrike.com'], retry: {} },
  identify: { request: { path: '/contacts', query: { me: 'true' } }, id: 'data.0.id', name: ['data.0.primaryEmail', 'data.0.profiles.0.email'] },
  errors: { detail: 'error' },
  paging: { nextPageToken: { kind: 'cursor', next: 'nextPageToken', send: { query: 'nextPageToken' } } },
  operations: {
    'tasks.list': { docs: `${reference}/getfolderssingletasks`, path: '/folders/{folderId}/tasks', paging: 'nextPageToken', records: 'data',
      params: { folderId: { in: 'path', type: 'string', required: true }, pageSize: { in: 'query', type: 'number', required: true } },
      result: { data: [task] } },
    'tasks.get': { docs: `${reference}/gettasksmulti`, path: '/tasks/{taskIds}', notFound: 'null',
      params: { taskIds: { in: 'path', type: 'string', required: true } }, result: { data: [task] } },
    'tasks.create': { docs: `${reference}/postfolderssingletasks`, method: 'POST', path: '/folders/{folderId}/tasks',
      params: { folderId: { in: 'path', type: 'string', required: true }, title: { in: 'query', type: 'string', required: true }, ...written },
      result: { data: [task] } },
    'tasks.update': { docs: `${reference}/puttaskssingle`, method: 'PUT', path: '/tasks/{taskId}',
      params: { taskId: { in: 'path', type: 'string', required: true }, title: { in: 'query', type: 'string' }, ...written },
      result: { data: [task] } },
    'folders.list': { docs: `${reference}/getfoldersempty`, path: '/folders',
      result: { data: [{ id: 'string', 'title?': 'string', 'childIds?': ['string'] }] } },
  },
});
