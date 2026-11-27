import { defineProvider } from '../catalogue.js';

/** Missive: a personal API token, Productive plan only; identify only checks it. A 429 waits `Retry-After`:
 * https://missiveapp.com/docs/developers/rest-api/rate-limits. `conversations.list` answers one page: pass `until`, the
 * oldest conversation's `last_activity_at`. `drafts.create` never sends (no `send`); its 201 may have no body (null).
 * Webhooks: https://missiveapp.com/docs/developers/webhooks */
const conversation = { id: 'string', 'subject?': 'string', 'latest_message_subject?': 'string', 'messages_count?': 'integer',
  'created_at?': 'integer', 'last_activity_at?': 'integer', 'web_url?': 'string' } as const;
const address = { address: 'string', 'name?': 'string' } as const;
const on = { in: 'query', type: 'boolean' } as const;
const id = { in: 'query', type: 'string' } as const;
const ref = 'https://missiveapp.com/docs/developers/rest-api/endpoints';

export const missive = defineProvider({
  id: 'missive', name: 'Missive', docs: 'https://missiveapp.com/docs/developers/rest-api',
  categories: ['mail'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'Create it in Missive\'s preferences, API tab, Create a new token; your organization needs the Productive plan. The token is yours and reaches every account you can open in Missive.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://public.missiveapp.com/v1', retry: {} },
  identify: { request: { path: '/organizations' } },
  webhook: { kind: 'hmac', header: 'x-hook-signature', prefix: 'sha256=' },
  paging: { offset: { kind: 'offset', send: { query: 'offset' }, list: 'shared_labels' } },
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
      params: { drafts: { in: 'body', type: { 'subject?': 'string', 'body?': 'string', 'from_field?': address, 'to_fields?': [address],
        'cc_fields?': [address], 'bcc_fields?': [address], 'conversation?': 'string' }, required: true,
        description: 'An email draft: from_field must be one of your aliases; conversation appends it to that conversation.' } } },
  },
});
