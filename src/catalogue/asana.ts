import { defineProvider } from '../catalogue.js';

/** Asana: OAuth 2, its app registered for these four scopes (only pre-approved scopes are accepted; an app with Full
 * permissions asks `default`) and shared with "Any workspace" (https://developers.asana.com/docs/oauth), or a personal
 * access token; a 429 with `Retry-After` (https://developers.asana.com/docs/rate-limits). A list pages only when
 * `limit` (1 to 100) is sent, so it is required (https://developers.asana.com/docs/pagination). */
const task = { gid: 'string', 'name?': 'string', 'completed?': 'boolean', 'parent?': { 'gid?': 'string' },
  'permalink_url?': 'string', 'created_at?': 'string', 'modified_at?': 'string' } as const;
const taskGid = { in: 'path', type: 'string', required: true } as const;
const limit = { in: 'query', type: 'integer', required: true } as const;
const written = { 'name?': 'string', 'notes?': 'string', 'completed?': 'boolean' } as const;
const reference = 'https://developers.asana.com/reference';

export const asana = defineProvider({
  id: 'asana', name: 'Asana', docs: 'https://developers.asana.com/docs/oauth',
  categories: ['tasks'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For your own Asana account: an app for other people connects with the OAuth 2 sign-in, as Asana requires.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.asana.com/-/oauth_authorize', tokenUrl: 'https://app.asana.com/-/oauth_token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: ['users:read', 'tasks:read', 'tasks:write', 'projects:read'] },
  revoke: { url: 'https://app.asana.com/-/oauth_revoke', token: ['refresh'] },
  http: { baseUrl: 'https://app.asana.com/api/1.0', retry: {} },
  identify: { request: { path: '/users/me' }, id: 'data.gid', name: ['data.name', 'data.email'] },
  paging: { offset: { kind: 'cursor', next: 'next_page.offset', send: { query: 'offset' } } },
  operations: {
    'tasks.list': { docs: `${reference}/gettasks`, path: '/tasks', paging: 'offset', records: 'data',
      params: { project: { in: 'query', type: 'string', required: true }, limit }, result: { data: [task] } },
    'tasks.get': { docs: `${reference}/gettask`, path: '/tasks/{task_gid}', notFound: 'null', params: { task_gid: taskGid },
      result: { data: task } },
    'tasks.create': { docs: `${reference}/createtask`, method: 'POST', path: '/tasks',
      params: { data: { in: 'body', required: true,
        type: { ...written, 'projects?': ['string'], 'workspace?': 'string', 'parent?': 'string' } } }, result: { data: task } },
    'tasks.update': { docs: `${reference}/updatetask`, method: 'PUT', path: '/tasks/{task_gid}',
      params: { task_gid: taskGid, data: { in: 'body', required: true, type: written } }, result: { data: task } },
    'projects.list': { docs: `${reference}/getprojects`, path: '/projects', paging: 'offset', records: 'data',
      params: { workspace: { in: 'query', type: 'string' }, limit }, result: { data: [{ gid: 'string', 'name?': 'string' }] } },
  },
});
