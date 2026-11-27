import { defineProvider } from '../catalogue.js';

/** Crisp: a workspace's website token keypair, Basic, with `X-Crisp-Tier: website`; 429 or 420 past a rate limit
 * (https://docs.crisp.chat/guides/rest-api/rate-limits/), 423 past the daily quota. Lists answer one page (the page
 * number is in the path). A `text` from the operator reaches the visitor; a `note` stays with the team:
 * https://help.crisp.chat/en/article/how-do-i-use-private-notes-and-mentions-54srwi/ Website hooks are unsigned. */
const conversation = { session_id: 'string', 'state?': 'string', 'people_id?': 'string', 'inbox_id?': 'string',
  'created_at?': 'number', 'updated_at?': 'number', 'meta?': { 'nickname?': 'string', 'email?': 'string', 'subject?': 'string' },
  'assigned?': { 'user_id?': 'string' } } as const;
const sessionId = { session_id: { in: 'path', type: 'string', required: true } } as const;
const pageNumber = { page_number: { in: 'path', type: 'string', required: true, description: 'The page number to read.' } } as const;
const perPage = { per_page: { in: 'query', type: 'string', description: 'The page size, from 20 to 50, 20 by default.' } } as const;
const ref = 'https://docs.crisp.chat/references/rest-api/v1';

export const crisp = defineProvider({
  id: 'crisp', name: 'Crisp', docs: 'https://docs.crisp.chat/guides/rest-api/authentication/website-token/',
  categories: ['support'],
  fields: [{ name: 'websiteId', title: 'Website ID', help: 'Your workspace identifier, in Settings, Workspace Settings, Setup Instructions.' },
    { name: 'tokenIdentifier', title: 'Token identifier' },
    { name: 'tokenKey', title: 'Token key', secret: true,
      help: 'For your own Crisp workspace: a workspace owner generates the website token in Settings, Workspace Settings, Advanced configuration; it is shown once.' }],
  auth: [{ kind: 'key', send: { basic: ['{tokenIdentifier}', '{tokenKey}'] } }],
  http: { baseUrl: 'https://api.crisp.chat/v1/website/{websiteId}', headers: { 'x-crisp-tier': 'website' },
    retry: {}, rateLimit: { when: [{ status: 420 }] } },
  // The website token's daily quota (10,000 requests) answers 423 `quota_limit_exceeded`: reported, never retried.
  errors: { detail: 'reason', rules: [{ when: { status: 423, detail: 'quota_limit_exceeded' }, code: 'rate_limited' }] },
  identify: { request: {}, id: 'data.website_id', name: 'data.name' },
  operations: {
    'conversations.list': { docs: `${ref}/#list-conversations`, path: '/conversations/{page_number}',
      params: { ...pageNumber, ...perPage, search_query: { in: 'query', type: 'string' },
        search_type: { in: 'query', type: 'string', enum: ['text', 'segment', 'filter'] },
        filter_unread: { in: 'query', type: 'string', enum: ['0', '1'] }, filter_resolved: { in: 'query', type: 'string', enum: ['0', '1'] },
        filter_not_resolved: { in: 'query', type: 'string', enum: ['0', '1'] } },
      result: { data: [conversation] } },
    'conversations.get': { docs: `${ref}/#get-a-conversation`, path: '/conversation/{session_id}', notFound: 'null',
      params: sessionId, result: { data: conversation } },
    'conversations.create': { docs: `${ref}/#create-a-new-conversation`, method: 'POST', path: '/conversation',
      result: { data: { session_id: 'string' } } },
    'conversations.update': { docs: `${ref}/#change-conversation-state`, method: 'PATCH', path: '/conversation/{session_id}/state',
      params: { ...sessionId, state: { in: 'body', type: 'string', required: true, enum: ['pending', 'unresolved', 'resolved'] } } },
    'messages.list': { docs: `${ref}/#get-messages-in-conversation`, path: '/conversation/{session_id}/messages',
      params: { ...sessionId, timestamp_before: { in: 'query', type: 'string',
        description: 'The batch ends before this timestamp: pages towards older messages.' } },
      result: { data: [{ fingerprint: 'number', 'type?': 'string', 'from?': 'string', 'origin?': 'string', 'content?': 'unknown',
        'timestamp?': 'number', 'session_id?': 'string', 'user?': { 'nickname?': 'string' } }] } },
    'messages.create': { docs: `${ref}/#send-a-message-in-conversation`, method: 'POST', path: '/conversation/{session_id}/message',
      params: { ...sessionId, type: { in: 'body', type: 'string', required: true, enum: ['text', 'note'],
        description: '`note` is a private note: visible to the team, never to the customer.' },
      from: { in: 'body', type: 'string', required: true, enum: ['operator'], description: 'operator: your team sends it.' },
      origin: { in: 'body', type: 'string', required: true, description: '`chat`, `email` or `urn:` and a channel.' },
      content: { in: 'body', type: 'string', required: true },
      stealth: { in: 'body', type: 'boolean', description: 'true does not send the message to the other party.' } },
      result: { data: { 'fingerprint?': 'number' } } },
    'people.list': { docs: `${ref}/#list-people-profiles`, path: '/people/profiles/{page_number}',
      params: { ...pageNumber, ...perPage, search_text: { in: 'query', type: 'string' } },
      result: { data: [{ people_id: 'string', 'email?': 'string', 'person?': { 'nickname?': 'string', 'phone?': 'string' },
        'company?': { 'name?': 'string' }, 'created_at?': 'number', 'updated_at?': 'number' }] } },
  },
});
