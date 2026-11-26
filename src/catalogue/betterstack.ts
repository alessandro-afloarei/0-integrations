import { defineProvider } from '../catalogue.js';

/** Better Stack Incidents: a team-based Incidents API token, Bearer; no endpoint names its owner, so listing monitors checks
 * it. JSON:API records; lists follow `pagination.next` (https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/).
 * A create with a token names its `requester_email`; an update replaces the incident's `metadata`, its one changeable part. */
const incident = { id: 'string', 'attributes?': { 'name?': 'string', 'status?': 'string', 'started_at?': 'string', 'resolved_at?': 'string' } } as const;
const incidentId = { in: 'path', type: 'string', required: true } as const;
const perPage = { in: 'query', type: 'integer' } as const;
const api = 'https://betterstack.com/docs/uptime/api';

export const betterstack = defineProvider({
  id: 'betterstack', name: 'Better Stack', docs: `${api}/getting-started-with-uptime-api/`,
  categories: ['monitoring'],
  fields: [{ name: 'apiToken', title: 'Incidents API token', secret: true,
    help: 'A team-based token from Better Stack → API tokens → Team-based tokens, labeled Incidents: a global token would need a team named on each call.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://incidents.betterstack.com/api' },
  identify: { request: { path: '/v2/monitors' } },
  paging: { next: { kind: 'nextUrl', next: 'pagination.next' } },
  operations: {
    'incidents.list': { docs: `${api}/list-all-incidents/`, path: '/v5/incidents', paging: 'next',
      params: { monitor_id: { in: 'query', type: 'integer' }, per_page: perPage }, records: 'data', result: { data: [incident] } },
    'incidents.get': { docs: `${api}/list-a-single-incident/`, path: '/v5/incidents/{incident_id}',
      params: { incident_id: incidentId }, result: { data: incident } },
    'incidents.create': { docs: `${api}/create-a-new-incident/`, method: 'POST', path: '/v5/incidents',
      params: { requester_email: { in: 'body', type: 'string', required: true }, summary: { in: 'body', type: 'string', required: true },
        name: { in: 'body', type: 'string' } }, result: { data: incident } },
    'incidents.update': { docs: `${api}/update-an-existing-incident/`, method: 'PATCH', path: '/v5/incidents/{incident_id}',
      params: { incident_id: incidentId, metadata: { in: 'body', type: 'unknown', required: true } }, result: { data: incident } },
    'monitors.list': { docs: `${api}/list-all-existing-monitors/`, path: '/v2/monitors', paging: 'next', params: { per_page: perPage },
      records: 'data', result: { data: [{ id: 'string', 'attributes?': { 'pronounceable_name?': 'string', 'status?': 'string',
        'created_at?': 'string', 'updated_at?': 'string' } }] } },
  },
});
