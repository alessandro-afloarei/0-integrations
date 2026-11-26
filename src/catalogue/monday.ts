import { defineProvider } from '../catalogue.js';

/** monday.com: OAuth 2.1 or a personal API token, bare. API version 2026-10 (https://developer.monday.com/api-reference/docs/api-versioning),
 * schema https://api.monday.com/v2/get_schema?format=sdl&version=2026-10. Errors: `errors[].extensions.code`, often in a
 * 200; a 429 with `Retry-After` (https://developer.monday.com/api-reference/docs/error-handling). Webhooks are signed
 * as a JWT, not declared (https://developer.monday.com/api-reference/reference/webhooks). */
const fields = 'id name state board { id } url created_at updated_at';
const item = { id: 'string', name: 'string', 'state?': 'string', 'board?': { id: 'string' }, url: 'string',
  'created_at?': 'unknown', 'updated_at?': 'unknown' } as const;
const reference = 'https://developer.monday.com/api-reference/reference';

export const monday = defineProvider({
  id: 'monday', name: 'monday.com', docs: 'https://developer.monday.com/api-reference/docs/authentication',
  categories: ['tasks'],
  fields: [{ name: 'apiToken', title: 'Personal API token', secret: true,
    help: 'For your own account or your team\'s own app (monday.com does not approve marketplace apps that store personal tokens): profile picture > Developers > API token. It can do what you can in monday.com; guests have none and viewers cannot use the API.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.monday.com/oauth2/authorize',
    tokenUrl: 'https://auth.monday.com/oauth_ms/oauth/token', json: true }, { kind: 'key', send: { header: 'authorization' } }],
  scopes: { default: ['me:read', 'boards:read', 'boards:write'] },
  revoke: { url: 'https://auth.monday.com/oauth_ms/oauth/revoke', token: ['refresh', 'access'] },
  http: { baseUrl: 'https://api.monday.com/v2', headers: { 'api-version': '2026-10' }, retry: {} },
  identify: { request: { graphql: 'query Me { me { id name email } }' }, id: 'data.me.id', name: ['data.me.name', 'data.me.email'] },
  errors: { detail: 'errors.0.extensions.code', failed: { path: 'errors.0' } },
  operations: {
    'items.list': { docs: `${reference}/items-page`, kind: 'read',
      graphql: `query Items($boardId: ID!, $limit: Int!, $cursor: String) { boards(ids: [$boardId]) { items_page(limit: $limit, cursor: $cursor) { cursor items { ${fields} } } } }`,
      params: { boardId: { in: 'variables', type: 'string', required: true }, limit: { in: 'variables', type: 'integer', required: true },
        cursor: { in: 'variables', type: 'string' } },
      result: { data: { boards: [{ items_page: { 'cursor?': 'string', items: [item] } }] } } },
    'items.get': { docs: `${reference}/items`, kind: 'read',
      graphql: `query Item($id: ID!) { items(ids: [$id]) { ${fields} } }`,
      params: { id: { in: 'variables', type: 'string', required: true } }, result: { data: { items: [item] } } },
    'items.create': { docs: `${reference}/items`,
      graphql: `mutation CreateItem($board_id: ID!, $item_name: String!, $group_id: String, $column_values: JSON) { create_item(board_id: $board_id, item_name: $item_name, group_id: $group_id, column_values: $column_values) { ${fields} } }`,
      params: { board_id: { in: 'variables', type: 'string', required: true }, item_name: { in: 'variables', type: 'string', required: true },
        group_id: { in: 'variables', type: 'string' }, column_values: { in: 'variables', type: 'string' } },
      result: { data: { 'create_item?': item } } },
    'items.update': { docs: `${reference}/columns`,
      graphql: `mutation ($board_id: ID!, $item_id: ID!, $column_value: JSON!) {change_multiple_column_values (item_id: $item_id, board_id: $board_id, column_values: $column_value) { ${fields} }}`,
      params: { board_id: { in: 'variables', type: 'string', required: true }, item_id: { in: 'variables', type: 'string', required: true },
        column_value: { in: 'variables', type: 'string', required: true } },
      result: { data: { 'change_multiple_column_values?': item } } },
    'boards.list': { docs: `${reference}/boards`, kind: 'read',
      graphql: 'query Boards($limit: Int, $page: Int) { boards(limit: $limit, page: $page) { id name state workspace_id url updated_at } }',
      params: { limit: { in: 'variables', type: 'integer' }, page: { in: 'variables', type: 'integer' } },
      result: { data: { boards: [{ id: 'string', name: 'string', state: 'string', 'workspace_id?': 'string', url: 'string',
        'updated_at?': 'unknown' }] } } },
  },
});
