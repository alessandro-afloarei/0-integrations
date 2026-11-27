import { defineProvider } from '../catalogue.js';

/** Dixa: an administrator's API token, sent bare (https://docs.dixa.io/docs/tutorial-create-an-api-token); 10 requests
 * a second per token, then a 429: https://docs.dixa.io/docs/api-standards-rules. An Outbound message (`agentId`) on
 * `messages.create` or `conversations.create` reaches the customer. No conversation list but the search, no update.
 * Webhooks sign `t` (13 digits in its example), not declared: https://docs.dixa.io/docs/webhooks/webhooks-security */
const conversation = { id: 'integer', requesterId: 'string', channel: 'string', createdAt: 'string', 'state?': 'string',
  'direction?': 'string', 'subject?': 'string', 'assignment?': { 'agentId?': 'string', 'assignedAt?': 'string' } } as const;
const content = { value: 'string', '_type?': 'string' } as const;
const conversationId = { conversationId: { in: 'path', type: 'integer', required: true } } as const;
const pageLimit = { pageLimit: { in: 'query', type: 'integer', description: 'Results per page.' } } as const;
const ref = 'https://docs.dixa.io/openapi/dixa-api/v1';

export const dixa = defineProvider({
  id: 'dixa', name: 'Dixa', docs: 'https://docs.dixa.io/openapi/dixa-api/v1/organization/getorganization',
  categories: ['support'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'Only a Dixa administrator can make one: Settings > Integrations > API Tokens > Add API token, with "Dixa API" as the API version; creating conversations, messages and notes needs the conversation.reply permission.' }],
  auth: [{ kind: 'key', send: { header: 'authorization' } }],
  http: { baseUrl: 'https://dev.dixa.io', minIntervalMs: 100, retry: { defaultWaitMs: 1_000 } },
  identify: { request: { path: '/v1/organization' }, id: 'data.id', name: 'data.name' },
  paging: { next: { kind: 'nextUrl', next: 'meta.next' } },
  operations: {
    'conversations.search': { docs: `${ref}/conversations/postsearchconversations`, method: 'POST', path: '/v1/search/conversations',
      kind: 'read', paging: 'next', records: 'data',
      params: { ...pageLimit, query: { in: 'body', type: { value: 'string', 'exactMatch?': 'boolean' }, description: 'The text to find.' },
        filters: { in: 'body', type: 'unknown', description: 'A strategy and its conditions (tags, custom attributes and others), as the page shows.' } },
      result: { data: [{ id: 'integer', 'highlights?': 'unknown' }] } },
    'conversations.get': { docs: `${ref}/conversations/getconversationsconversationid`, path: '/v1/conversations/{conversationId}',
      notFound: 'null', params: conversationId, result: { data: conversation } },
    'conversations.create': { docs: `${ref}/conversations/postconversations`, method: 'POST', path: '/v1/conversations',
      params: { requesterId: { in: 'body', type: 'string', required: true, description: 'The end user\'s id.' },
        _type: { in: 'body', type: 'string', description: 'The channel: Email, ContactForm, Sms or Whatsapp; each needs its own fields.' },
        emailIntegrationId: { in: 'body', type: 'string', description: 'Required for Email and ContactForm.' },
        subject: { in: 'body', type: 'string', description: 'Required for Email and ContactForm.' },
        contactEndpointId: { in: 'body', type: 'string', description: 'Required for Sms and Whatsapp: the provisioned phone number.' },
        message: { in: 'body', type: 'unknown', required: true,
          description: 'Required: Inbound (content) from the end user, or Outbound (content, agentId) to the customer; for Whatsapp, agentId and a template.' },
        language: { in: 'body', type: 'string' } },
      result: { data: { id: 'integer' } } },
    'messages.list': { docs: `${ref}/messages/getconversationsconversationidmessages`, path: '/v1/conversations/{conversationId}/messages',
      params: conversationId,
      result: { data: [{ id: 'string', authorId: 'string', createdAt: 'string', 'externalId?': 'string', attributes: 'unknown' }] } },
    'messages.create': { docs: `${ref}/messages/postconversationsconversationidmessages`, method: 'POST',
      path: '/v1/conversations/{conversationId}/messages',
      params: { ...conversationId, content: { in: 'body', type: content, required: true, description: 'value, and _type Html, Markdown or Text.' },
        agentId: { in: 'body', type: 'string', required: true, description: 'The agent who sends it to the customer.' },
        _type: { in: 'body', type: 'string', enum: ['Outbound'] },
        cc: { in: 'body', type: ['string'] }, bcc: { in: 'body', type: ['string'] } },
      result: { data: { 'messageId?': 'string', direction: 'string', authorId: 'string', 'createdAt?': 'string', content: 'unknown' } } },
    'notes.create': { docs: `${ref}/internal-notes/postconversationsconversationidnotes`, method: 'POST',
      path: '/v1/conversations/{conversationId}/notes',
      params: { ...conversationId, message: { in: 'body', type: 'string', required: true }, agentId: { in: 'body', type: 'string' } },
      result: { data: { id: 'string', authorId: 'string', createdAt: 'string', csid: 'integer', message: 'string' } } },
    'endUsers.list': { docs: `${ref}/end-users/getendusers`, path: '/v1/endusers', paging: 'next', records: 'data',
      params: { ...pageLimit, email: { in: 'query', type: 'string', description: 'Not with phone: the two together are an error.' },
        phone: { in: 'query', type: 'string', description: 'Not with email: the two together are an error.' },
        externalId: { in: 'query', type: 'string' } },
      result: { data: [{ id: 'string', createdAt: 'string', 'displayName?': 'string', 'email?': 'string', 'phoneNumber?': 'string',
        'firstName?': 'string', 'lastName?': 'string', 'externalId?': 'string' }] } },
  },
});
