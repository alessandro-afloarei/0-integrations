import { defineProvider } from '../catalogue.js';

/** Unthread (Integrations & API on every plan: https://www.unthread.io/pricing): a message reaches the customer in
 * the Slack thread, or by email, unless it is a private note; a Slack conversation's create posts its details in Slack.
 * Webhooks: hex HMAC-SHA256 of the body, which carries `webhookTimestamp` in milliseconds; answer the
 * `url_verification` event with a 200: https://docs.unthread.io/docs/webhooks */
const conversation = { id: 'string', 'friendlyId?': 'number', 'title?': 'string', 'status?': 'string', 'customerId?': 'string',
  'priority?': 'number', 'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const message = { id: 'string', 'ts?': 'string', 'text?': 'unknown', 'userId?': 'string', 'conversationId?': 'string',
  'threadTs?': 'string', 'timestamp?': 'string' } as const;
const conversationId = { conversationId: { in: 'path', type: 'string', required: true } } as const;
const list = { where: { in: 'body', type: 'unknown', description: 'A list of `{ field, operator, value }` filters.' },
  order: { in: 'body', type: ['string'] }, descending: { in: 'body', type: 'boolean' },
  limit: { in: 'body', type: 'number', description: 'At most 100 a page.' } } as const;
const status = { in: 'body', type: 'string', enum: ['open', 'in_progress', 'on_hold', 'closed'] } as const;
const written = { title: { in: 'body', type: 'string' }, priority: { in: 'body', type: 'integer', description: '3, 5, 7 or 9.' },
  assignedToUserId: { in: 'body', type: 'string' }, customerId: { in: 'body', type: 'string' }, notes: { in: 'body', type: 'string' } } as const;
const ref = 'https://docs.unthread.io/docs/api-reference';

export const unthread = defineProvider({
  id: 'unthread', name: 'Unthread', docs: ref,
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'Service account API key', secret: true,
    help: 'A service account\'s key: project-scoped from Setup > Service Accounts, or tenant-wide from Workspace Settings > Service Accounts (platform admins and owners). It has the permissions you give the service account.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.unthread.io/api' },
  // No account endpoint: a credential check on the conversations list.
  identify: { request: { method: 'POST', path: '/conversations/list' } },
  webhook: { kind: 'hmac', header: 'x-unthread-signature', deliveryId: { body: ['eventId'] } },
  paging: { cursor: { kind: 'cursor', next: 'cursors.next', more: 'cursors.hasNext', send: { body: 'cursor' } } },
  operations: {
    'conversations.list': { docs: `${ref}#list-conversations`, method: 'POST', path: '/conversations/list', kind: 'read', paging: 'cursor', records: 'data',
      params: list, result: { data: [conversation] } },
    'conversations.get': { docs: `${ref}#get-conversation-by-id`, path: '/conversations/{conversationId}', params: conversationId, result: conversation },
    'conversations.create': { docs: `${ref}#create-conversation`, method: 'POST', path: '/conversations',
      params: { type: { in: 'body', type: 'string', required: true, enum: ['triage', 'email', 'slack'],
        description: '`slack` talks to the customer in Slack, `email` by email replies; `triage` is internal only.' },
        markdown: { in: 'body', type: 'string', required: true }, status: { ...status, required: true },
        channelId: { in: 'body', type: 'string', description: 'For `slack`: the channel; without it, a DM through the Unthread app.' },
        triageChannelId: { in: 'body', type: 'string', description: 'Required when `type` is `triage`.' },
        emailInboxId: { in: 'body', type: 'string', description: 'Required when `type` is `email`.' },
        onBehalfOf: { in: 'body', type: { 'email?': 'string', 'name?': 'string', 'id?': 'string' },
          description: 'Required when `type` is `email`: the end user, by `email` or `id`.' },
        ...written },
      result: conversation },
    'conversations.update': { docs: `${ref}#update-conversation`, method: 'PATCH', path: '/conversations/{conversationId}',
      params: { ...conversationId, status, subStatusId: { in: 'body', type: 'string' }, ...written }, result: conversation },
    'messages.list': { docs: `${ref}#list-messages-for-conversation`, method: 'POST', path: '/conversations/{conversationId}/messages/list', kind: 'read', paging: 'cursor',
      records: 'data', params: { ...conversationId, ...list }, result: { data: [message] } },
    'messages.create': { docs: `${ref}#create-message-in-conversation`, method: 'POST', path: '/conversations/{conversationId}/messages',
      params: { ...conversationId,
        body: { in: 'body', required: true, type: { type: 'string', value: 'string' },
          description: '`type` is `html` or `markdown`. Unthread also takes `blocks`, which this entry does not declare.' },
        isPrivateNote: { in: 'body', type: 'boolean', description: 'Email and in-app chat conversations: a private note in the Slack thread, not sent to the customer.' },
        triageThreadTs: { in: 'body', type: 'string', description: 'Posts to that triage thread instead of sending to the customer.' } } },
  },
});
