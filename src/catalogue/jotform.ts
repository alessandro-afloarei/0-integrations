import { defineProvider } from '../catalogue.js';

/** Jotform API v1, "written for Jotform users and 3rd party developers who would like to serve Jotform users": the
 * key in the `APIKEY` header, on the standard, EU or HIPAA host; every answer wraps its data in `content`. API keys
 * are limited to a number of calls a day by plan, and no page names the status past it. */
const form = { id: 'string', 'title?': 'string', 'status?': 'string', 'url?': 'string', 'count?': 'string',
  'created_at?': 'string', 'updated_at?': 'string' } as const;
const submission = { id: 'string', 'form_id?': 'string', 'status?': 'string', 'new?': 'string', 'created_at?': 'string',
  'updated_at?': 'string', 'answers?': 'unknown' } as const;
const formId = { id: { in: 'path', type: 'string', required: true, description: 'The form id, the number in the form\'s URL.' } } as const;
const limit = { in: 'query', type: 'number', description: '20 by default, at most 1000.' } as const;
const hosts = ['api.jotform.com', 'eu-api.jotform.com', 'hipaa-api.jotform.com'] as const;
const reference = 'https://api.jotform.com/docs/';

export const jotform = defineProvider({
  id: 'jotform', name: 'Jotform', docs: reference,
  categories: ['marketing'],
  fields: [{ name: 'apiHost', title: 'API URL', choices: hosts, default: 'api.jotform.com',
    help: 'api.jotform.com for standard use, eu-api.jotform.com for EU, hipaa-api.jotform.com for HIPAA. An Enterprise domain is not supported.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'From My Account > API: Create a new API Key. Calls a day are limited by plan (1,000 for Starter, 100,000 for Gold; Enterprise has none).' }],
  auth: [{ kind: 'key', send: { header: 'apikey' } }],
  http: { baseUrl: 'https://{apiHost}', host: hosts },
  identify: { request: { path: '/user' }, id: 'content.username', name: ['content.name', 'content.email'] },
  paging: { offset: { kind: 'offset', send: { query: 'offset' }, list: 'content' } },
  operations: {
    'forms.list': { docs: reference, path: '/user/forms', paging: 'offset', records: 'content',
      params: { limit }, result: { content: [form] } },
    // Its sample answers a list in `content`, where the text says it gets one form's details.
    'forms.get': { docs: reference, path: '/form/{id}', params: formId, result: { content: 'unknown' } },
    'submissions.list': { docs: reference, path: '/form/{id}/submissions', paging: 'offset',
      records: 'content', params: { ...formId, limit }, result: { content: [submission] } },
    'submissions.get': { docs: reference, path: '/submission/{id}',
      params: { id: { in: 'path', type: 'string', required: true, description: 'The submission id.' } },
      result: { content: submission } },
  },
});
