import { defineProvider } from '../catalogue.js';

/** CircleCI Cloud's API v3, the version the docs recommend (Server installations have no v3,
 * https://circleci.com/docs/AGENTS.md): a 429 names its wait in `Retry-After`. Webhooks sign only when given a secret:
 * the `v1` piece of `circleci-signature` is the hex HMAC-SHA256 of the body
 * (https://circleci.com/docs/guides/integration/outbound-webhooks/). Identify: https://circleci.com/docs/api/v3/users.md */
const run = { id: 'string', 'attributes?': { 'number?': 'integer', 'phase?': 'string', 'current_outcome?': 'string', 'created_at?': 'string' },
  'references?': { 'project?': { 'id?': 'string' }, 'pipeline?': { 'id?': 'string' } } } as const;
const runs = 'https://circleci.com/docs/api/v3/runs.md';
const limit = { in: 'query', type: 'integer' } as const;
const ref = { 'branch?': 'string', 'tag?': 'string' } as const;

export const circleci = defineProvider({
  id: 'circleci', name: 'CircleCI', docs: 'https://circleci.com/docs/api/v3/conventions.md',
  categories: ['code'],
  fields: [{ name: 'apiToken', title: 'Personal API token', secret: true,
    help: 'Create it under User Settings, then Personal API Tokens: it has your full read and write permissions and expires on the date you set, at most a year ahead. In an organization that uses SSO, select the organization in the token\'s SSO column, or it reaches none of its resources.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://circleci.com/api/v3', retry: {} },
  identify: { request: { path: '/users', query: { 'filter[user_id]': 'me' } }, id: 'data.0.id',
    name: ['data.0.attributes.name', 'data.0.attributes.login'] },
  paging: { cursor: { kind: 'cursor', next: 'page.next', send: { query: 'page[cursor]' } } },
  errors: { detail: 'error.type' },
  webhook: { kind: 'hmac', header: 'circleci-signature', part: 'v1', deliveryId: { body: ['id'] } },
  operations: {
    'runs.list': { docs: runs, path: '/runs', paging: 'cursor', records: 'data',
      params: { 'filter[project_id]': { in: 'query', type: 'string' }, 'page[limit]': limit }, result: { data: [run] } },
    'runs.get': { docs: runs, path: '/runs/{id}', params: { id: { in: 'path', type: 'string', required: true } }, result: { data: run } },
    'runs.create': { docs: runs, method: 'POST', path: '/runs',
      params: { data: { in: 'body', required: true, type: { attributes: { 'checkout?': ref, 'config?': ref, 'parameters?': 'unknown' },
        references: { pipeline: { id: 'string' } } } } }, result: { data: run } },
    'projects.list': { docs: 'https://circleci.com/docs/api/v3/projects.md', path: '/projects', paging: 'cursor', records: 'data',
      params: { 'filter[org_id]': { in: 'query', type: 'string' }, 'page[limit]': limit },
      result: { data: [{ id: 'string', 'attributes?': { 'name?': 'string' }, 'references?': { 'org?': { 'id?': 'string' } } }] } },
  },
});
