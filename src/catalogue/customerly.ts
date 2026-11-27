import { defineProvider } from '../catalogue.js';

/** Customerly: the project's access token, Bearer (Project Settings, Installation, Public API:
 * https://docs.customerly.io/en/api/how-to-obtain-your-api-access-token-in-customerly). Errors name a code:
 * https://customerly.readme.io/reference/intro-to-the-customerly-api. A conversation created or a message sent by an
 * account reaches the contact (in the app or by email). The webhooks are not signed. */
const conversation = { conversation_id: 'integer', 'is_open?': 'boolean', 'tag?': 'string', 'origin_channel?': 'string',
  'conversation_url?': 'string', 'created_at?': 'integer', 'last_activity_at?': 'integer',
  'contact?': { 'contact_id?': 'integer', 'name?': 'string', 'email?': 'string' } } as const;
const message = { id: 'integer', 'conversation_id?': 'integer', 'type?': 'string', 'channel?': 'string', 'content?': 'unknown',
  'sent_date?': 'integer', 'account?': { 'account_id?': 'integer', 'name?': 'string' },
  'contact?': { 'contact_id?': 'integer', 'name?': 'string' } } as const;
const conversationId = { conversation_id: { in: 'path', type: 'integer', required: true } } as const;
const sent = { sender_type: { in: 'body', type: 'string', required: true, enum: ['account'],
  description: 'The account (team member) account_id sends the message.' },
account_id: { in: 'body', type: 'integer', required: true }, content: { in: 'body', type: 'string', description: 'HTML.' },
attachments: { in: 'body', type: [{ filename: 'string', base64: 'string' }] } } as const;
const ref = 'https://customerly.readme.io/reference';

export const customerly = defineProvider({
  id: 'customerly', name: 'Customerly', docs: `${ref}/get_officialcustomerly_apipublic_v2_me_me_getme`,
  categories: ['support'],
  fields: [{ name: 'accessToken', title: 'Access token', secret: true,
    help: 'Your project\'s access token, under Project Settings, Installation, Public API.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.customerly.io/v2' },
  errors: { detail: 'error.code' },
  identify: { request: { path: '/me' }, id: 'project.project_id', name: 'project.name' },
  paging: { cursor: { kind: 'cursor', next: 'cursor', send: { query: 'cursor' } } },
  operations: {
    'conversations.list': { docs: `${ref}/get_officialcustomerly_apipublic_v2_conversations_list_listall`, path: '/conversations',
      paging: 'cursor', records: 'conversations',
      params: { status: { in: 'query', type: 'string', enum: ['opened', 'snoozed', 'closed'] },
        account_id: { in: 'query', type: 'integer' }, team_id: { in: 'query', type: 'integer' }, keyword: { in: 'query', type: 'string' },
        search_type: { in: 'query', type: 'string', enum: ['contacts', 'messages'] },
        order: { in: 'query', type: 'string', enum: ['newest_first', 'oldest_first'] },
        per_page: { in: 'query', type: 'integer', description: '15 by default.' } },
      result: { conversations: [conversation] } },
    'conversations.get': { docs: `${ref}/get_officialcustomerly_apipublic_v2_conversations_list_getone`,
      path: '/conversations/{conversation_id}', notFound: 'null', params: conversationId, result: conversation },
    'conversations.create': { docs: `${ref}/post_officialcustomerly_apipublic_v2_conversations_conversations_create`,
      method: 'POST', path: '/conversations',
      params: { polymorphic_contact_id: { in: 'body', type: 'string', required: true,
        description: 'A contact id, or cuid:, clid:, wa:, uem: or lem: and the value.' }, ...sent,
      channel: { in: 'body', type: 'string', enum: ['in_app', 'email'], description: 'in_app by default.' },
      assignee_type: { in: 'body', type: 'string', enum: ['account', 'team'], description: 'Given with assignee_id.' },
      assignee_id: { in: 'body', type: 'integer' } },
      anyOf: [['content'], ['attachments']], result: conversation },
    'conversations.update': { docs: `${ref}/patch_officialcustomerly_apipublic_v2_conversations_conversations_updatestatus`,
      method: 'PATCH', path: '/conversations/{conversation_id}/status',
      params: { ...conversationId, status: { in: 'body', type: 'string', required: true, enum: ['opened', 'snoozed', 'closed'] },
        snooze_time: { in: 'body', type: 'integer', description: 'Seconds; required only when status is snoozed.' } },
      result: conversation },
    'messages.list': { docs: `${ref}/get_officialcustomerly_apipublic_v2_conversations_messages_listall`,
      path: '/conversations/{conversation_id}/messages', paging: 'cursor', records: 'messages',
      params: { ...conversationId, order: { in: 'query', type: 'string', enum: ['newest_first', 'oldest_first'] },
        per_page: { in: 'query', type: 'integer', description: '15 by default, at most 100.' } },
      result: { messages: [message] } },
    'messages.create': { docs: `${ref}/post_officialcustomerly_apipublic_v2_conversations_messages_create`,
      method: 'POST', path: '/conversations/{conversation_id}/messages',
      params: { ...conversationId, ...sent,
        is_note: { in: 'body', type: 'boolean', description: 'true keeps the message an internal note, seen only by team members.' } },
      anyOf: [['content'], ['attachments']], result: message },
    'contacts.list': { docs: `${ref}/get_officialcustomerly_apipublic_v2_contacts_contacts_listcontacts`, path: '/contacts',
      paging: 'cursor', records: 'contacts',
      params: { per_page: { in: 'query', type: 'integer', description: '20 by default, at most 100.' },
        keyword: { in: 'query', type: 'string', description: 'At least 3 characters.' },
        role: { in: 'query', type: 'string', enum: ['lead', 'user'] }, sort_by: { in: 'query', type: 'string', enum: ['name', 'email'] },
        order: { in: 'query', type: 'string', enum: ['ascending', 'descending'] } },
      result: { contacts: [{ contact_id: 'integer', 'name?': 'string', 'role?': 'string', 'email?': 'string',
        'custom_contact_id?': 'string', 'whatsapp_number?': 'string' }] } },
  },
});
