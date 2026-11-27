import { defineProvider } from '../catalogue.js';

/** Shortcut: an API token in `Shortcut-Token`; 200 requests a minute, a 429 past it. A search answers its next page as a
 * path and query string on the origin. A webhook with a secret is signed: the hex HMAC-SHA256 of the body in
 * `Payload-Signature` (https://developer.shortcut.com/api/webhook/v1#Signature). */
const story = { id: 'integer', name: 'string', story_type: 'string', workflow_state_id: 'integer', 'epic_id?': 'integer',
  app_url: 'string', created_at: 'string', 'updated_at?': 'string' } as const;
const storyId = { in: 'path', type: 'integer', required: true } as const;
const workflowStateId = { in: 'body', type: 'integer' } as const;
const fields = { epic_id: { in: 'body', type: 'integer', nullable: true },
  story_type: { in: 'body', type: 'string', enum: ['feature', 'chore', 'bug'] }, description: { in: 'body', type: 'string' } } as const;
const v3 = 'https://developer.shortcut.com/api/rest/v3';

export const shortcut = defineProvider({
  id: 'shortcut', name: 'Shortcut', docs: `${v3}#Authentication`,
  categories: ['tasks'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'A Read + Write token, made by a member who can change data: an Observer cannot through the API. Tokens may expire.' }],
  auth: [{ kind: 'key', send: { header: 'shortcut-token' } }],
  http: { baseUrl: 'https://api.app.shortcut.com', headers: { 'content-type': 'application/json' }, retry: { defaultWaitMs: 60_000 } },
  errors: { detail: 'error' },
  identify: { request: { path: '/api/v3/member' }, id: 'id', name: ['name', 'mention_name'] },
  paging: { next: { kind: 'nextUrl', next: 'next' } },
  webhook: { kind: 'hmac', header: 'payload-signature', deliveryId: { body: ['id'] } },
  operations: {
    'stories.search': { docs: `${v3}#Search-Stories`, path: '/api/v3/search/stories', paging: 'next', records: 'data',
      params: { query: { in: 'query', type: 'string', required: true }, page_size: { in: 'query', type: 'integer' } },
      result: { data: [story] } },
    'stories.get': { docs: `${v3}#Get-Story`, path: '/api/v3/stories/{storyId}', notFound: 'null', params: { storyId },
      result: story },
    'stories.create': { docs: `${v3}#Create-Story`, method: 'POST', path: '/api/v3/stories',
      params: { name: { in: 'body', type: 'string', required: true }, workflow_state_id: { ...workflowStateId, required: true },
        ...fields }, result: story },
    'stories.update': { docs: `${v3}#Update-Story`, method: 'PUT', path: '/api/v3/stories/{storyId}',
      params: { storyId, name: { in: 'body', type: 'string' }, workflow_state_id: workflowStateId, ...fields }, result: story },
    'workflows.list': { docs: `${v3}#List-Workflows`, path: '/api/v3/workflows',
      result: [{ id: 'integer', name: 'string', team_id: 'integer', states: [{ id: 'integer', name: 'string' }],
        created_at: 'string', updated_at: 'string' }] },
  },
});
