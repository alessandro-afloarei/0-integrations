import { defineProvider } from '../catalogue.js';

/** ClickUp: a personal API token, bare in `Authorization`. 100 requests a minute per token on the Free, Unlimited and
 * Business plans, a 429 past it (https://developer.clickup.com/docs/rate-limits). A webhook delivery is signed with the
 * webhook's secret: the hex HMAC-SHA256 of the body in `X-Signature` (https://developer.clickup.com/docs/webhooksignature). */
const task = { id: 'string', name: 'string', status: { status: 'string' }, url: 'string', date_created: 'string',
  date_updated: 'string', 'parent?': 'string', list: { id: 'string' } } as const;
const listId = { in: 'path', type: 'number', required: true } as const;
const taskId = { in: 'path', type: 'string', required: true } as const;
const fields = { name: { in: 'body', type: 'string' }, status: { in: 'body', type: 'string' } } as const;

export const clickup = defineProvider({
  id: 'clickup', name: 'ClickUp', docs: 'https://developer.clickup.com/docs/authentication',
  categories: ['tasks'],
  fields: [{ name: 'apiToken', title: 'Personal API token', secret: true }],
  auth: [{ kind: 'key', send: { header: 'authorization' } }],
  http: { baseUrl: 'https://api.clickup.com/api/v2', minIntervalMs: 600, retry: {} },
  identify: { request: { path: '/user' }, id: 'user.id', name: ['user.username', 'user.email'] },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'tasks', zeroBased: true } },
  webhook: { kind: 'hmac', header: 'x-signature' },
  operations: {
    'tasks.list': { docs: 'https://developer.clickup.com/reference/gettasks', path: '/list/{list_id}/task', paging: 'page',
      params: { list_id: listId }, records: 'tasks', result: { tasks: [task] } },
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
