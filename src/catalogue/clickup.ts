import { defineProvider } from '../catalogue.js';

/** ClickUp: a personal API token, bare in `Authorization`, or OAuth 2, its token as Bearer. A 429 past a per-token
 * limit that depends on the plan (https://developer.clickup.com/docs/rate-limits). Webhooks sign the body, hex
 * HMAC-SHA256 in `X-Signature` (https://developer.clickup.com/docs/webhooksignature). The error code is `ECODE`
 * (https://developer.clickup.com/reference/movefolder). Get Tasks leaves out subtasks and closed tasks. */
const task = { id: 'string', 'name?': 'string', 'status?': { 'status?': 'string' }, 'url?': 'string', 'date_created?': 'string',
  'date_updated?': 'string', 'parent?': 'string', 'list?': { 'id?': 'string' } } as const;
const listId = { in: 'path', type: 'number', required: true } as const;
const taskId = { in: 'path', type: 'string', required: true } as const;
const fields = { name: { in: 'body', type: 'string' }, status: { in: 'body', type: 'string' } } as const;

export const clickup = defineProvider({
  id: 'clickup', name: 'ClickUp', docs: 'https://developer.clickup.com/docs/authentication',
  categories: ['tasks'],
  fields: [{ name: 'apiToken', title: 'Personal API token', secret: true,
    help: 'For your own ClickUp account: an app for other people connects with the OAuth 2 sign-in, as ClickUp requires.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.clickup.com/api', tokenUrl: 'https://api.clickup.com/api/v2/oauth/token' },
    { kind: 'key', send: { header: 'authorization' } }],
  // No scopes: the person picks the Workspaces the app may reach on ClickUp's consent screen.
  scopes: { default: [] },
  http: { baseUrl: 'https://api.clickup.com/api/v2', retry: { wait: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } } },
  identify: { request: { path: '/user' }, id: 'user.id', name: ['user.username', 'user.email'] },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'tasks', zeroBased: true } },
  errors: { detail: 'ECODE' },
  webhook: { kind: 'hmac', header: 'x-signature' },
  operations: {
    'tasks.list': { docs: 'https://developer.clickup.com/reference/gettasks', path: '/list/{list_id}/task', paging: 'page',
      params: { list_id: listId, subtasks: { in: 'query', type: 'boolean' }, include_closed: { in: 'query', type: 'boolean' } },
      records: 'tasks', result: { tasks: [task] } },
    'tasks.get': { docs: 'https://developer.clickup.com/reference/gettask', path: '/task/{task_id}', params: { task_id: taskId },
      result: task },
    'tasks.create': { docs: 'https://developer.clickup.com/reference/createtask', method: 'POST', path: '/list/{list_id}/task',
      params: { list_id: listId, ...fields, name: { in: 'body', type: 'string', required: true },
        parent: { in: 'body', type: 'string', nullable: true } }, result: task },
    'tasks.update': { docs: 'https://developer.clickup.com/reference/updatetask', method: 'PUT', path: '/task/{task_id}',
      params: { task_id: taskId, ...fields, parent: { in: 'body', type: 'string' } }, result: task },
    'lists.list': { docs: 'https://developer.clickup.com/reference/getlists', path: '/folder/{folder_id}/list',
      params: { folder_id: { in: 'path', type: 'number', required: true } },
      result: { lists: [{ id: 'string', name: 'string', status: 'unknown', folder: { id: 'string' } }] } },
  },
});
