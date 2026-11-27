import { defineProvider } from '../catalogue.js';

/** Regions are separate deployments with their own keys: https://docs.recall.ai/docs/regions */
const hosts = ['us-east-1.recall.ai', 'us-west-2.recall.ai', 'eu-central-1.recall.ai', 'ap-northeast-1.recall.ai'] as const;

/** Recall.ai: a workspace's API key on its region's host; no endpoint names the account. Bots, billed by active time,
 * are not here. A 429 carries `Retry-After` in seconds: https://docs.recall.ai/reference/errors. Webhooks: `webhook-*`
 * headers, the workspace verification secret (accounts made from 15 December 2025; older Svix headers fail):
 * https://docs.recall.ai/docs/authenticating-requests-from-recallai */
const status = { code: 'string', 'sub_code?': 'string', updated_at: 'string' } as const;
const recording = { id: 'string', created_at: 'string', 'started_at?': 'string', 'completed_at?': 'string', expires_at: 'string',
  status, 'bot?': { id: 'string' }, media_shortcuts: { 'transcript?': { id: 'string' } } } as const;
const ref = 'https://docs.recall.ai/reference';

export const recallai = defineProvider({
  id: 'recallai', name: 'Recall.ai', docs: 'https://docs.recall.ai/reference/authentication',
  categories: ['meetings'],
  fields: [{ name: 'apiHost', title: 'Region', choices: hosts,
    help: 'The region your Recall.ai account is in (US East, US West, EU or Asia): each region has its own account and keys.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'From the dashboard of your region, Developers, API keys. A key belongs to a user and reaches the whole workspace.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Token {token}' } }],
  http: { baseUrl: 'https://{apiHost}', host: hosts, retry: {} },
  errors: { detail: 'code' },
  identify: { request: { path: '/api/v1/recording/' } },
  webhook: { kind: 'standard' },
  paging: { next: { kind: 'nextUrl', next: 'next' } },
  operations: {
    'recordings.list': { docs: `${ref}/recording_list`, path: '/api/v1/recording/', paging: 'next', records: 'results',
      params: { bot_id: { in: 'query', type: 'string' }, created_at_after: { in: 'query', type: 'string' },
        created_at_before: { in: 'query', type: 'string' },
        status_code: { in: 'query', type: 'string', enum: ['done', 'failed', 'paused', 'processing'] } },
      result: { results: [recording] } },
    'recordings.get': { docs: `${ref}/recording_retrieve`, path: '/api/v1/recording/{id}/',
      params: { id: { in: 'path', type: 'string', required: true } }, result: recording },
    'transcripts.get': { docs: `${ref}/transcript_retrieve`, path: '/api/v1/transcript/{id}/',
      params: { id: { in: 'path', type: 'string', required: true } },
      result: { id: 'string', created_at: 'string', status, recording: { id: 'string' }, data: { 'download_url?': 'string' } } },
  },
});
