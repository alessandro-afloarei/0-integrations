import { defineProvider } from '../catalogue.js';

/** Fellow: a person's API key on the workspace's host; the API is on paid plans, enabled by an admin:
 * https://help.fellow.ai/en/articles/11817206-developer-api. 3 requests a second and 10,000 a day per key:
 * https://developers.fellow.ai/reference/request-limits. Lists page by the cursor in the body's `pagination`, until it is
 * null: https://developers.fellow.ai/reference/pagination; the transcript is the recording's. Webhooks:
 * https://developers.fellow.ai/reference/webhooks */
const recording = { id: 'string', 'title?': 'string', 'created_at?': 'string', 'updated_at?': 'string', 'started_at?': 'string',
  'ended_at?': 'string', 'note_id?': 'string', 'transcript?': 'unknown' } as const;
const ref = 'https://developers.fellow.ai/reference';

export const fellow = defineProvider({
  id: 'fellow', name: 'Fellow', docs: 'https://developers.fellow.ai/reference/authentication-1',
  categories: ['meetings'],
  fields: [{ name: 'subdomain', title: 'Workspace subdomain', help: 'The part of your Fellow address before .fellow.app.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'From User settings, Developer tools; it reads what you can see in Fellow. The Developer API needs a paid plan, and a workspace admin enables it.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://{subdomain}.fellow.app', host: '*.fellow.app', retry: { defaultWaitMs: 1_000 } },
  identify: { request: { path: '/api/v1/me' }, id: 'user.id', name: ['user.full_name', 'user.email'] },
  // Svix's `svix-*` headers, the webhook's `whsec_` secret, 5 minutes; dedupe on `svix-id`. The URL verification echoes
  // `challenge` as plain text and is not signed.
  webhook: { kind: 'standard', deliveryId: { header: 'svix-id' },
    challenge: { when: { path: 'type', equals: 'url_verification' }, echo: 'challenge', text: true, unsigned: true } },
  paging: { cursor: { kind: 'cursor', next: 'recordings.page_info.cursor', send: { body: 'pagination.cursor' } } },
  operations: {
    'recordings.list': { docs: `${ref}/apps_developer_api_api_get_recordings`, method: 'POST', path: '/api/v1/recordings', kind: 'read',
      paging: 'cursor', records: 'recordings.data',
      params: { pagination: { in: 'body', type: { 'page_size?': 'integer' }, description: 'page_size: 20 by default, 1 to 50.' },
      filters: { in: 'body', type: { 'event_guid?': 'string', 'created_at_start?': 'string', 'created_at_end?': 'string',
        'updated_at_start?': 'string', 'updated_at_end?': 'string', 'channel_id?': 'string', 'title?': 'string' } },
      include: { in: 'body', type: { 'transcript?': 'boolean', 'ai_notes?': 'boolean' } } },
      result: { recordings: { page_info: { 'cursor?': 'string', page_size: 'integer' }, data: [recording] } } },
    'recordings.get': { docs: `${ref}/apps_developer_api_api_get_recording_by_id`, path: '/api/v1/recording/{recording_id}',
      notFound: 'null', params: { recording_id: { in: 'path', type: 'string', required: true } }, result: { recording } },
  },
});
