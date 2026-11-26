import { defineProvider } from '../catalogue.js';

/** Rollbar: a project access token (`read` scope, and `write` to update) in `X-Rollbar-Access-Token`. No endpoint names
 * the token's owner, so listing items checks it (https://docs.rollbar.com/reference/list-all-items). An error body is
 * `{ err: 1, message }`, with no code; a 429 means the token's rate limit, which its owner sets. */
const item = { id: 'integer', project_id: 'integer', title: 'string', status: 'string', first_occurrence_timestamp: 'integer' } as const;
const itemid = { in: 'path', type: 'integer', required: true } as const;

export const rollbar = defineProvider({
  id: 'rollbar', name: 'Rollbar', docs: 'https://docs.rollbar.com/reference/getting-started-1',
  categories: ['monitoring'],
  fields: [{ name: 'accessToken', title: 'Project access token', secret: true }],
  auth: [{ kind: 'key', send: { header: 'x-rollbar-access-token' } }],
  http: { baseUrl: 'https://api.rollbar.com/api/1', retry: {} },
  identify: { request: { path: '/items' } },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'result.items' } },
  operations: {
    'items.list': { docs: 'https://docs.rollbar.com/reference/list-all-items', path: '/items', paging: 'page',
      records: 'result.items', result: { result: { items: [item] } } },
    'items.get': { docs: 'https://docs.rollbar.com/reference/get-an-item-by-id', path: '/item/{itemid}', notFound: 'null',
      params: { itemid }, result: { result: item } },
    'items.update': { docs: 'https://docs.rollbar.com/reference/update-an-item', method: 'PATCH', path: '/item/{itemid}',
      params: { itemid, status: { in: 'body', type: 'string', enum: ['active', 'resolved', 'muted'] }, title: { in: 'body', type: 'string' } },
      result: { result: { 'status?': 'string', 'title?': 'string' } } },
  },
});
