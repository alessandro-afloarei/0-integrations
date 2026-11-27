import { defineProvider } from '../catalogue.js';

/** Krisp's Personal API: a person's key, Bearer, acting as them; on paid plans (Core, Advanced, Trial). A meeting's
 * transcript comes with `meetings.get` when `fields` names it. Webhooks carry only the headers a person sets, no
 * signature: https://help.krisp.ai/hc/en-us/articles/24514911804316-Webhook-API */
const meeting = { id: 'string', 'title?': 'string', 'started_at?': 'string', 'duration?': 'integer', 'status?': 'string',
  'source?': 'string', 'ownership?': 'string', 'transcript?': 'unknown' } as const;
const ref = 'https://meeting-api-docs.krisp.ai/reference';

export const krisp = defineProvider({
  id: 'krisp', name: 'Krisp', docs: 'https://meeting-api-docs.krisp.ai/reference/get_me',
  categories: ['meetings'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'A personal API key from Settings, Integrations, API (krsp_u_…) with the Read scope. It acts as you, can expire after 90 days, and needs a paid plan (Core, Advanced or Trial).' }],
  auth: [{ kind: 'key' }],
  // 5 requests a second and 25 per 5 seconds per account; a 429 states no wait.
  http: { baseUrl: 'https://meeting-api.krisp.ai/v1', retry: { defaultWaitMs: 5_000 } },
  identify: { request: { path: '/me' }, id: 'id', name: 'email' },
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', send: { query: 'cursor' } } },
  // The webhook is set up in Krisp's settings: its Request Headers must hold `Authorization` with the app's secret as
  // the whole value, which the app then passes as the secret.
  webhook: { kind: 'token', header: 'authorization' },
  operations: {
    'meetings.list': { docs: `${ref}/get_meetings`, path: '/meetings', paging: 'cursor', records: 'meetings',
      params: { ownership: { in: 'query', type: 'string', enum: ['all', 'mine', 'shared'], description: 'all by default.' },
        from: { in: 'query', type: 'string' }, to: { in: 'query', type: 'string' },
        limit: { in: 'query', type: 'integer', description: '20 by default, at most 100.' } },
      result: { meetings: [meeting] } },
    'meetings.get': { docs: `${ref}/get_meetings-id`, path: '/meetings/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true },
        fields: { in: 'query', type: 'string', description: 'Comma-separated; transcript and notes come only when named.' } },
      result: meeting },
  },
});
