import { defineProvider } from '../catalogue.js';

/** Honeybadger API v3, on the US or EU host: a user or account API token, Bearer; `GET /token` names the account it is
 * bound to. 360 requests an hour per person or account unless raised, a 429 with `Retry-After`; errors carry
 * `error.code`; lists follow `links.next` (https://docs.honeybadger.io/api/v3/). */
const fault = { id: 'string', project_id: 'string', message: 'string', 'resolved?': 'boolean', 'ignored?': 'boolean',
  created_at: 'string', 'last_notice_at?': 'string', links: { web: 'string' } } as const;
const projectId = { in: 'path', type: 'string', required: true } as const;
const faultId = { in: 'path', type: 'string', required: true } as const;
const perPage = { in: 'query', type: 'integer' } as const;
const faults = 'https://docs.honeybadger.io/api/v3/faults';

export const honeybadger = defineProvider({
  id: 'honeybadger', name: 'Honeybadger', docs: 'https://docs.honeybadger.io/api/v3/authentication/',
  categories: ['monitoring'],
  fields: [{ name: 'apiHost', title: 'Region', choices: ['app.honeybadger.io', 'eu-app.honeybadger.io'],
    default: 'app.honeybadger.io', help: 'Where the account is hosted: the US (app.honeybadger.io) or the EU (eu-app.honeybadger.io).' },
  { name: 'apiToken', title: 'API token', secret: true,
    help: 'A user (hbu_) or account (hba_) API token, not the API v2 personal auth token, with the faults:read, faults:write and projects:read scopes: each scope is checked on its own. A token can be limited to some projects and can expire.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}/v3', host: '*.honeybadger.io', retry: {} },
  identify: { request: { path: '/token' }, id: 'data.account_id', name: 'data.name' },
  paging: { next: { kind: 'nextUrl', next: 'links.next' } },
  errors: { detail: 'error.code' },
  operations: {
    'faults.list': { docs: `${faults}/list-faults/`, path: '/projects/{project_id}/faults', paging: 'next',
      params: { project_id: projectId, per_page: perPage }, records: 'data', result: { data: [fault] } },
    'faults.get': { docs: `${faults}/get-fault/`, path: '/projects/{project_id}/faults/{fault_id}', notFound: 'null',
      params: { project_id: projectId, fault_id: faultId }, result: { data: fault } },
    'faults.update': { docs: `${faults}/update-fault/`, method: 'PATCH', path: '/projects/{project_id}/faults/{fault_id}',
      params: { project_id: projectId, fault_id: faultId, resolved: { in: 'body', type: 'boolean' }, ignored: { in: 'body', type: 'boolean' } },
      result: { data: fault } },
    'projects.list': { docs: 'https://docs.honeybadger.io/api/v3/projects/list-projects/', path: '/projects', paging: 'next',
      params: { per_page: perPage }, records: 'data',
      result: { data: [{ id: 'string', account_id: 'string', name: 'string', created_at: 'string', links: { web: 'string' } }] } },
  },
});
