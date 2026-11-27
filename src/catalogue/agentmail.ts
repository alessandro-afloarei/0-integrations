import { defineProvider } from '../catalogue.js';

/** AgentMail: an API key as Bearer, on the default or the EU host; `messages.create` emails people and counts against
 * the plan's emails a day. A 429 waits `Retry-After`: https://agentmail.to/docs/knowledge-base/rate-limits
 * Errors carry a machine `code`: https://agentmail.to/docs/errors */
const hosts = ['api.agentmail.to', 'api.agentmail.eu'] as const;
const message = { message_id: 'string', thread_id: 'string', inbox_id: 'string', labels: ['string'], timestamp: 'string',
  from: 'string', to: ['string'], 'subject?': 'string' } as const;
const inboxId = { inbox_id: { in: 'path', type: 'string', required: true } } as const;
const page = { limit: { in: 'query', type: 'integer' } } as const;
const written = { to: { in: 'body', type: ['string'] }, cc: { in: 'body', type: ['string'] }, bcc: { in: 'body', type: ['string'] },
  subject: { in: 'body', type: 'string' }, text: { in: 'body', type: 'string' }, html: { in: 'body', type: 'string' } } as const;
const ref = 'https://agentmail.to/docs/api-reference/inboxes';

export const agentmail = defineProvider({
  id: 'agentmail', name: 'AgentMail', docs: 'https://agentmail.to/docs/api-reference/auth/me',
  categories: ['mail'],
  fields: [{ name: 'apiHost', title: 'AgentMail host', choices: hosts, default: 'api.agentmail.to',
    help: 'api.agentmail.to, or api.agentmail.eu for an EU organization.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Create it in the AgentMail Console under API Keys (it starts with am_ and is shown once). An organization key reaches every inbox; a pod or inbox key only its own. Each email sent counts against your plan (Free: 100 a day).' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}/v0', host: hosts, retry: {} },
  identify: { request: { path: '/auth/me' }, id: 'organization_id' },
  errors: { detail: 'code' },
  paging: { cursor: { kind: 'cursor', next: 'next_page_token', send: { query: 'page_token' } } },
  operations: {
    'messages.list': { docs: `${ref}/messages/list`, path: '/inboxes/{inbox_id}/messages', paging: 'cursor', records: 'messages',
      params: { ...inboxId, before: { in: 'query', type: 'string' }, after: { in: 'query', type: 'string' }, ...page },
      result: { messages: [message] } },
    'messages.get': { docs: `${ref}/messages/get`, path: '/inboxes/{inbox_id}/messages/{message_id}', notFound: 'null',
      params: { ...inboxId, message_id: { in: 'path', type: 'string', required: true } }, result: message },
    'inboxes.list': { docs: `${ref}/list`, path: '/inboxes', paging: 'cursor', records: 'inboxes', params: page,
      result: { inboxes: [{ inbox_id: 'string', pod_id: 'string', email: 'string', created_at: 'string', updated_at: 'string',
        'display_name?': 'string', 'status?': 'string' }] } },
    'drafts.create': { docs: `${ref}/drafts/create`, method: 'POST', path: '/inboxes/{inbox_id}/drafts',
      params: { ...inboxId, ...written, in_reply_to: { in: 'body', type: 'string' } },
      result: { draft_id: 'string', inbox_id: 'string', 'subject?': 'string' } },
    'messages.create': { docs: `${ref}/messages/send`, method: 'POST', path: '/inboxes/{inbox_id}/messages/send',
      params: { ...inboxId, ...written }, result: { message_id: 'string', thread_id: 'string' } },
  },
});
