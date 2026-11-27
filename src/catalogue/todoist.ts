import { defineProvider } from '../catalogue.js';

/** Todoist: OAuth 2, or a personal API token, both as Bearer. Errors name their code in `error_tag`; a 429 is too
 * many requests from one user (https://developer.todoist.com/api/v1/sync/overview.md). `tasks.get` reads active tasks
 * only: a completed one reads as absent. Webhooks fire only for users of the app's OAuth 2: the base64 HMAC-SHA256 of
 * the body, keyed with the client secret, in `X-Todoist-Hmac-SHA256` (https://developer.todoist.com/api/v1/webhooks.md). */
const v1 = 'https://developer.todoist.com/api/v1';
const task = { id: 'string', content: 'string', checked: 'boolean', project_id: 'string', 'parent_id?': 'string',
  'added_at?': 'string', 'updated_at?': 'string' } as const;
const taskId = { in: 'path', type: 'string', required: true } as const;
const limit = { in: 'query', type: 'integer' } as const;
const description = { in: 'body', type: 'string' } as const;

export const todoist = defineProvider({
  id: 'todoist', name: 'Todoist', docs: `${v1}/authorization.md`,
  categories: ['tasks'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own Todoist account, from your integrations settings: an app for other people connects with the OAuth 2 sign-in, as Todoist requires.' }],
  // PKCE S256: https://developer.todoist.com/api/v1/authorization.md
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.todoist.com/oauth/authorize',
    tokenUrl: 'https://api.todoist.com/oauth/access_token', scopeSeparator: ',' }, { kind: 'key' }],
  scopes: { default: ['data:read_write'], requireGranted: true },
  http: { baseUrl: 'https://api.todoist.com/api/v1', retry: { wait: { path: 'error_extra.retry_after', unit: 's' } } },
  identify: { request: { path: '/user' }, id: 'id', name: ['full_name', 'email'] },
  errors: { detail: 'error_tag' },
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', send: { query: 'cursor' } } },
  webhook: { kind: 'hmac', header: 'x-todoist-hmac-sha256', encoding: 'base64', deliveryId: { header: 'x-todoist-delivery-id' } },
  operations: {
    'tasks.list': { docs: `${v1}/tasks.md`, path: '/tasks', paging: 'cursor', records: 'results',
      params: { project_id: { in: 'query', type: 'string' }, limit }, result: { results: [task] } },
    'tasks.get': { docs: `${v1}/tasks.md`, path: '/tasks/{task_id}', notFound: 'null', params: { task_id: taskId }, result: task },
    'tasks.create': { docs: `${v1}/tasks.md`, method: 'POST', path: '/tasks',
      params: { content: { in: 'body', type: 'string', required: true }, description, project_id: { in: 'body', type: 'string' },
        parent_id: { in: 'body', type: 'string' } }, result: task },
    'tasks.update': { docs: `${v1}/tasks.md`, method: 'POST', path: '/tasks/{task_id}',
      params: { task_id: taskId, content: { in: 'body', type: 'string' }, description }, result: task },
    'projects.list': { docs: `${v1}/projects.md`, path: '/projects', paging: 'cursor', records: 'results', params: { limit },
      result: { results: [{ id: 'string', name: 'string', is_archived: 'boolean', 'parent_id?': 'string', 'created_at?': 'string',
        'updated_at?': 'string' }] } },
  },
});
