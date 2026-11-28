import { defineProvider } from '../catalogue.js';

/** Tally: an API key as Bearer, 100 requests a minute and a 429 past them:
 * https://developers.tally.so/api-reference/introduction
 * Every request names the version the entry reads (`items` and paging arrived in 2025-02-01; a key otherwise reads
 * the version it was made on): https://developers.tally.so/api-reference/versioning */
const form = { id: 'string', name: 'string', workspaceId: 'string', status: 'string', numberOfSubmissions: 'number',
  isClosed: 'boolean', createdAt: 'string', updatedAt: 'string' } as const;
const submission = { id: 'string', 'formId?': 'string', 'isCompleted?': 'boolean', 'submittedAt?': 'string',
  'responses?': 'unknown' } as const;
const formId = { formId: { in: 'path', type: 'string', required: true } } as const;
const reference = 'https://developers.tally.so/api-reference/endpoint';

export const tally = defineProvider({
  id: 'tally', name: 'Tally', docs: 'https://developers.tally.so/api-reference/api-keys',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From Settings > API keys. It is tied to your own user: it has your permissions and reaches all of your resources.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.tally.so', headers: { 'tally-version': '2025-02-01' }, retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/users/me' }, id: 'id', name: ['fullName', 'email'] },
  paging: { forms: { kind: 'page', send: { query: 'page' }, list: 'items', more: 'hasMore' },
    submissions: { kind: 'page', send: { query: 'page' }, list: 'submissions', more: 'hasMore' } },
  operations: {
    'forms.list': { docs: `${reference}/forms/list`, path: '/forms', paging: 'forms', records: 'items',
      params: { limit: { in: 'query', type: 'number', description: '50 by default, at most 500.' } },
      result: { items: [form] } },
    'forms.get': { docs: `${reference}/forms/get`, path: '/forms/{formId}', notFound: 'null', params: formId, result: form },
    'submissions.list': { docs: `${reference}/forms/submissions/list`, path: '/forms/{formId}/submissions', paging: 'submissions',
      records: 'submissions', params: { ...formId, limit: { in: 'query', type: 'integer', description: '50 by default, at most 500.' } },
      result: { submissions: [submission] } },
    'submissions.get': { docs: `${reference}/forms/submissions/get`, path: '/forms/{formId}/submissions/{submissionId}',
      notFound: 'null', params: { ...formId, submissionId: { in: 'path', type: 'string', required: true } },
      result: { submission } },
  },
});
