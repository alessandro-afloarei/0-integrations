import { defineProvider } from '../catalogue.js';

/** The three regional API hosts, Europe by default: https://docs.meetgeek.ai/api/getting-started/introduction */
const hosts = ['api.meetgeek.ai', 'api-eu.meetgeek.ai', 'api-us.meetgeek.ai'] as const;

/** MeetGeek: an API key on its region's host; its sign-in checks the key on the user's teams, naming no account. A 429
 * waits Business's one-minute window (Free and Pro: 100 a day): https://docs.meetgeek.ai/api/getting-started/limits
 * Webhooks: https://docs.meetgeek.ai/api/api-reference/v1/appendix-webhooks
 * Identify: https://docs.meetgeek.ai/api/api-reference/v1/teams */
const cursor = { limit: { in: 'query', type: 'integer', description: 'From 1 to 500.' } } as const;
const meetingId = { meetingId: { in: 'path', type: 'string', required: true } } as const;
const ref = 'https://docs.meetgeek.ai/api/api-reference/v1';

export const meetgeek = defineProvider({
  id: 'meetgeek', name: 'MeetGeek', docs: 'https://docs.meetgeek.ai/api/getting-started/authorization',
  categories: ['meetings'],
  fields: [{ name: 'apiHost', title: 'Region', choices: hosts, default: 'api.meetgeek.ai',
    help: 'Where the account lives: api.meetgeek.ai or api-eu.meetgeek.ai for Europe, api-us.meetgeek.ai for the US.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'From Integrations, the Public API card. Each region has its own key: use the one made in the region chosen above.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}', host: hosts, retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/v1/teams' } },
  webhook: { kind: 'hmac', header: 'x-mg-signature' },
  paging: { cursor: { kind: 'cursor', next: 'pagination.next_cursor', send: { query: 'cursor' } } },
  operations: {
    'meetings.list': { docs: `${ref}/meetings`, path: '/v1/meetings', paging: 'cursor', records: 'meetings', params: cursor,
      result: { meetings: [{ meeting_id: 'string', 'timestamp_start_utc?': 'string', 'timestamp_end_utc?': 'string' }] } },
    'meetings.get': { docs: `${ref}/meeting`, path: '/v1/meetings/{meetingId}', params: meetingId,
      result: { meeting_id: 'string', 'title?': 'string', 'host_email?': 'string', 'source?': 'string', 'join_link?': 'string',
        'timestamp_start_utc?': 'string', 'timestamp_end_utc?': 'string', 'timezone?': 'string' } },
    'transcripts.get': { docs: `${ref}/transcript`, path: '/v1/meetings/{meetingId}/transcript', paging: 'cursor', records: 'sentences',
      params: { ...meetingId, ...cursor },
      result: { 'meeting_id?': 'string', sentences: [{ id: 'integer', 'speaker?': 'string', 'timestamp?': 'string', 'transcript?': 'string' }] } },
  },
});
