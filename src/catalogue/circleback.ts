import { defineProvider } from '../catalogue.js';

/** Circleback: an account's API key, Bearer; no endpoint names the account. Limits are per account and plan; a 429
 * carries `Retry-After` in seconds. Webhooks (automations): `X-Signature`, the hex HMAC-SHA256 of the raw body keyed
 * with the step's signing secret, no timestamp:
 * https://circleback.ai/docs/support/automations/export-meeting-data-with-webhooks */
const meeting = { id: 'string', 'name?': 'string', createdAt: 'string', updatedAt: 'string', 'duration?': 'number', 'url?': 'string',
  'recordingUrl?': 'string', 'notes?': 'unknown' } as const;
const ref = 'https://circleback.ai/docs/api/meetings';

export const circleback = defineProvider({
  id: 'circleback', name: 'Circleback', docs: 'https://circleback.ai/docs/api',
  categories: ['meetings'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From Settings, API keys (cb_…), shown once; it reads your Circleback account.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://circleback.ai/api', retry: {} },
  errors: { detail: 'code' },
  identify: { request: { path: '/tag' } },
  webhook: { kind: 'hmac', header: 'x-signature' },
  paging: { link: { kind: 'linkHeader' } },
  operations: {
    'meetings.list': { docs: `${ref}/list-meetings`, path: '/meetings', paging: 'link',
      params: { ownership: { in: 'query', type: 'string', enum: ['All', 'Mine', 'Shared'], description: 'Mine by default.' },
        createdAtGte: { in: 'query', type: 'string' }, createdAtLte: { in: 'query', type: 'string' },
        folderId: { in: 'query', type: 'string' } },
      result: [meeting] },
    'meetings.search': { docs: `${ref}/search-meetings`, path: '/search', paging: 'link',
      params: { searchTerm: { in: 'query', type: 'string', description: 'Searched in meeting names and content.' } }, result: [meeting] },
    'meetings.get': { docs: `${ref}/get-meeting`, path: '/meeting/{meetingId}',
      params: { meetingId: { in: 'path', type: 'string', required: true } }, result: meeting },
    'transcripts.get': { docs: `${ref}/get-meeting-transcript`, path: '/meeting/{meetingId}/transcript',
      params: { meetingId: { in: 'path', type: 'string', required: true } },
      result: [{ 'speaker?': 'string', text: 'string', timestamp: 'number' }] },
  },
});
