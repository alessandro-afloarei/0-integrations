import { defineProvider } from '../catalogue.js';

/** incident.io: an API key, Bearer; `GET /v1/identity` names the key. 1,200 requests a minute per key, 60 for listing
 * incidents, 10 incidents created an hour when a Slack or Teams channel is made (300 otherwise), a 429 with `Retry-After`;
 * errors carry `errors[].code` (https://docs.incident.io/api-reference/introduction). Webhooks come from Svix; the page
 * states no hash or secret form, so none is declared. */
const incident = { id: 'string', reference: 'string', name: 'string', incident_status: { id: 'string', name: 'string', category: 'string' },
  'severity?': { id: 'string', name: 'string' }, 'permalink?': 'string', created_at: 'string', updated_at: 'string' } as const;
const id = { in: 'path', type: 'string', required: true } as const;
const text = { in: 'body', type: 'string' } as const;
const api = 'https://docs.incident.io/api-reference';

export const incidentio = defineProvider({
  id: 'incidentio', name: 'incident.io', docs: `${api}/introduction`,
  categories: ['monitoring'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'An organization API key made for the app under Settings → API keys, not a user API key (user credentials may not be shared), with the View data, Create incidents and Edit incidents permissions, and View all incident data for private incidents.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.incident.io', minIntervalMs: 50, retry: {} },
  identify: { request: { path: '/v1/identity' }, name: 'identity.name' },
  paging: { after: { kind: 'cursor', next: 'pagination_meta.after', send: { query: 'after' } } },
  errors: { detail: 'errors.0.code' },
  operations: {
    'incidents.list': { docs: `${api}/incidents-v2/list`, path: '/v2/incidents', paging: 'after',
      params: { page_size: { in: 'query', type: 'integer' } }, records: 'incidents', result: { incidents: [incident] } },
    'incidents.get': { docs: `${api}/incidents-v2/show`, path: '/v2/incidents/{id}', notFound: 'null', params: { id },
      result: { incident } },
    'incidents.create': { docs: `${api}/incidents-v2/create`, method: 'POST', path: '/v2/incidents',
      params: { idempotency_key: { ...text, required: true }, visibility: { ...text, required: true, enum: ['public', 'private'] },
        name: text, summary: text, severity_id: text, incident_status_id: text }, result: { incident } },
    'incidents.update': { docs: `${api}/incidents-v2/edit`, method: 'POST', path: '/v2/incidents/{id}/actions/edit',
      params: { id, notify_incident_channel: { in: 'body', type: 'boolean', required: true }, incident: { in: 'body', required: true,
        type: { 'name?': 'string', 'summary?': 'string', 'severity_id?': 'string', 'incident_status_id?': 'string' } } },
      result: { incident } },
    'severities.list': { docs: `${api}/severities-v1/list`, path: '/v1/severities',
      result: { severities: [{ id: 'string', name: 'string', rank: 'integer', created_at: 'string', updated_at: 'string' }] } },
  },
});
