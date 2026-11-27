import { defineProvider } from '../catalogue.js';

/** Missive: a personal API token, Productive plan only; identify only checks it. A 429 waits `Retry-After`:
 * https://missiveapp.com/docs/developers/rest-api/rate-limits. Lists of conversations and messages answer one page.
 * `messages.create` is the draft with `send: true`: it emails its recipients at once and runs matching outgoing rules;
 * `drafts.create` never sends; a 201 may be empty (null). Webhooks: https://missiveapp.com/docs/developers/webhooks */
const conversation = { id: 'string', 'subject?': 'string', 'latest_message_subject?': 'string', 'messages_count?': 'integer',
  'created_at?': 'integer', 'last_activity_at?': 'integer', 'web_url?': 'string' } as const;
const address = { address: 'string', 'name?': 'string' } as const;
const on = { in: 'query', type: 'boolean' } as const;
const id = { in: 'query', type: 'string' } as const;
const message = { id: 'string', 'type?': 'string', 'subject?': 'string', 'preview?': 'string', 'from_field?': { 'name?': 'string', 'address?': 'string' },
  'delivered_at?': 'integer', 'created_at?': 'integer', 'updated_at?': 'integer' } as const;
const ref = 'https://missiveapp.com/docs/developers/rest-api/endpoints';
const draft = { 'subject?': 'string', 'body?': 'string', 'from_field?': address, 'to_fields?': [address], 'cc_fields?': [address],
  'bcc_fields?': [address], 'conversation?': 'string' } as const;

export const missive = defineProvider({
  id: 'missive', name: 'Missive', docs: 'https://missiveapp.com/docs/developers/rest-api',
  categories: ['mail', 'support'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'Create it in Missive\'s preferences, API tab, Create a new token; your organization needs the Productive plan. The token is yours and reaches every account you can open in Missive.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://public.missiveapp.com/v1', retry: {} },
  identify: { request: { path: '/organizations' } },
  webhook: { kind: 'hmac', header: 'x-hook-signature', prefix: 'sha256=' },
  paging: { offset: { kind: 'offset', send: { query: 'offset' }, list: 'shared_labels' },
    contacts: { kind: 'offset', send: { query: 'offset' }, list: 'contacts' } },
  operations: {
    'conversations.list': { docs: `${ref}#list-conversations`, path: '/conversations',
      params: { inbox: on, all: on, assigned: on, closed: on, snoozed: on, flagged: on, trashed: on, junked: on, drafts: on,
        shared_label: id, team_inbox: id, team_closed: id, team_all: id,
        limit: { in: 'query', type: 'integer', description: '25 by default, at most 50.' },
        until: { in: 'query', type: 'integer', description: 'The last_activity_at of the oldest conversation of the page before.' } },
      anyOf: [['inbox'], ['all'], ['assigned'], ['closed'], ['snoozed'], ['flagged'], ['trashed'], ['junked'], ['drafts'],
        ['shared_label'], ['team_inbox'], ['team_closed'], ['team_all']], result: { conversations: [conversation] } },
    'conversations.get': { docs: `${ref}#get-a-conversation`, path: '/conversations/{id}',
      params: { id: { in: 'path', type: 'string', required: true } }, result: { conversations: [conversation] } },
    'sharedLabels.list': { docs: `${ref}#list-shared-labels`, path: '/shared_labels', paging: 'offset', records: 'shared_labels',
      params: { organization: { in: 'query', type: 'string' }, limit: { in: 'query', type: 'integer', description: '50 by default, at most 200.' } },
      result: { shared_labels: [{ id: 'string', name: 'string', name_with_parent_names: 'string', organization: 'string',
        'color?': 'string', 'parent?': 'string' }] } },
    'drafts.create': { docs: `${ref}#create-a-draft`, method: 'POST', path: '/drafts',
      params: { drafts: { in: 'body', type: draft, required: true,
        description: 'An email draft: from_field must be one of your aliases; conversation appends it to that conversation.' } } },
    'messages.create': { docs: `${ref}#send-a-message`, method: 'POST', path: '/drafts', kind: 'write',
      params: { drafts: { in: 'body', type: { send: true, ...draft, 'from_field?': { address: 'string' } }, required: true,
        description: 'An email sent at once: from_field must be one of your aliases; conversation sends it as a reply in that conversation.' } } },
    'conversations.update': { docs: `${ref}#update-conversations`, method: 'PATCH', path: '/conversations/{id}',
      params: { id: { in: 'path', type: 'string', required: true }, conversations: { in: 'body', required: true,
        type: [{ id: 'string', 'subject?': 'string', 'close?': 'boolean', 'reopen?': 'boolean', 'add_to_inbox?': 'boolean',
          'organization?': 'string', 'add_assignees?': ['string'], 'remove_assignees?': ['string'], 'add_shared_labels?': ['string'],
          'remove_shared_labels?': ['string'], 'team?': 'string', 'add_to_team_inbox?': 'boolean' }],
        description: 'One object, its id the path\'s; no post is created (system events can still appear; label change rules still run). organization is required with add_assignees, remove_assignees or add_shared_labels; team with add_to_team_inbox.' } },
      result: { conversations: [conversation] } },
    'messages.list': { docs: `${ref}#list-conversation-messages`, path: '/conversations/{id}/messages',
      params: { id: { in: 'path', type: 'string', required: true },
        limit: { in: 'query', type: 'integer', description: '10 by default, at most 10.' },
        until: { in: 'query', type: 'integer', description: 'The delivered_at of the oldest message of the page before.' } },
      result: { messages: [message] } },
    'contacts.list': { docs: `${ref}#list-contacts`, path: '/contacts', paging: 'contacts', records: 'contacts',
      params: { contact_book: { in: 'query', type: 'string', required: true, description: 'A contact book id.' },
        search: { in: 'query', type: 'string', description: 'Matched against every contact info: name, email, phone, organization.' },
        modified_since: { in: 'query', type: 'integer', description: 'A Unix time: contacts modified or created since.' },
        limit: { in: 'query', type: 'integer', description: '50 by default, at most 200.' } },
      result: { contacts: [{ id: 'string', 'first_name?': 'string', 'last_name?': 'string', 'starred?': 'boolean',
        'contact_book?': 'string', 'deleted?': 'boolean', 'modified_at?': 'integer' }] } },
  },
});
