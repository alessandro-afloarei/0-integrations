import { defineProvider } from '../catalogue.js';

/** Rollbar: a project access token; listing items (`read`) checks it, no endpoint naming its owner; updates need
 * `write`; one token may hold both (https://docs.rollbar.com/docs/access-tokens). An account token passes that check
 * but needs a `project_id`, and only it lists projects (https://docs.rollbar.com/reference/list-all-projects): no
 * `projects.list`. No error code; a bad token: 403; a 429 past a limit (https://docs.rollbar.com/docs/rate-limits). */
const item = { id: 'integer', 'project_id?': 'integer', 'title?': 'string', 'status?': 'string', 'first_occurrence_timestamp?': 'integer' } as const;
const itemid = { in: 'path', type: 'integer', required: true } as const;

export const rollbar = defineProvider({
  id: 'rollbar', name: 'Rollbar', docs: 'https://docs.rollbar.com/reference/getting-started-1',
  categories: ['monitoring'],
  fields: [{ name: 'accessToken', title: 'Project access token', secret: true,
    help: 'A project access token with the read and write scopes, made in the project settings, under Project Access Tokens.' }],
  auth: [{ kind: 'key', send: { header: 'x-rollbar-access-token' } }],
  http: { baseUrl: 'https://api.rollbar.com/api/1',
    retry: { wait: { header: 'x-rate-limit-remaining-seconds', unit: 's' } } },
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
