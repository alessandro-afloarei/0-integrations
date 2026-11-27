import { defineProvider } from '../catalogue.js';

/** Pylon: an Admin's API token on its region's host; the REST API is on every plan (https://www.usepylon.com/pricing).
 * A reply reaches the customer, and so does a created issue given a `destination_metadata`; a note posted to an
 * internal email thread is sent as email. */
const issue = { id: 'string', title: 'string', state: 'string', link: 'string', 'account?': { id: 'string' },
  'requester?': { id: 'string', 'email?': 'string' }, created_at: 'string', updated_at: 'string' } as const;
const contact = { id: 'string', name: 'string', 'email?': 'string', 'emails?': ['string'], 'primary_phone_number?': 'string',
  'account?': { id: 'string' } } as const;
const message = { id: 'string', message_html: 'unknown', is_private: 'boolean', source: 'string', 'thread_id?': 'string',
  timestamp: 'string' } as const;
const posted = { data: { id: 'string', issue_id: 'string' } } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const recipients = { 'to_emails?': ['string'], 'cc_emails?': ['string'], 'bcc_emails?': ['string'] } as const;
const search = { filter: { in: 'body', type: 'unknown', description: 'A search filter: `field`, `operator` and `value`, or `subfilters`.' },
  search_text: { in: 'body', type: 'string' },
  limit: { in: 'body', type: 'integer', description: '100 by default, 1 to 1000.' } } as const;
const ref = 'https://docs.usepylon.com/pylon-docs/developer/api/api-reference';

export const pylon = defineProvider({
  id: 'pylon', name: 'Pylon', docs: 'https://docs.usepylon.com/pylon-docs/developer/api/authentication',
  categories: ['support'],
  fields: [{ name: 'apiHost', title: 'Region', choices: ['api.usepylon.com', 'api.eu.usepylon.com'], default: 'api.usepylon.com',
    help: 'Where your Pylon tenant is hosted: api.usepylon.com for the US, api.eu.usepylon.com for the EU (a token starting pylon_api_eu_).' },
  { name: 'apiToken', title: 'API token', secret: true,
    help: 'Only Admins create API tokens, in Settings > Integrations & dev > API. A token can do what its role (or the user or bot it acts as) can; there are no separate scopes.' }],
  auth: [{ kind: 'key' }],
  // Per-minute limits; a 429 carries `Retry-After` in seconds:
  // https://docs.usepylon.com/pylon-docs/developer/api/rate-limits
  http: { baseUrl: 'https://{apiHost}', host: ['api.usepylon.com', 'api.eu.usepylon.com'], retry: {} },
  identify: { request: { path: '/me' }, id: 'data.id', name: 'data.name' },
  // `code` is stable: https://docs.usepylon.com/pylon-docs/developer/api/errors
  errors: { detail: 'code' },
  // Signed over `<timestamp>.<body>`, no delivery id: https://docs.usepylon.com/pylon-docs/developer/webhooks
  webhook: { kind: 'hmac', header: 'x-pylon-signature-v2', signed: '{timestamp}.{body}', timestamp: { header: 'x-pylon-timestamp' } },
  // https://docs.usepylon.com/pylon-docs/developer/api/conventions#pagination
  paging: { query: { kind: 'cursor', next: 'pagination.cursor', more: 'pagination.has_next_page', send: { query: 'cursor' } },
    body: { kind: 'cursor', next: 'pagination.cursor', more: 'pagination.has_next_page', send: { body: 'cursor' } } },
  operations: {
    'issues.list': { docs: `${ref}/issues#get-issues`, path: '/issues', paging: 'query', records: 'data',
      params: { start_time: { in: 'query', type: 'string', required: true, description: 'RFC 3339; issues created from this time (inclusive), at most 365 days before end_time.' },
        end_time: { in: 'query', type: 'string', required: true, description: 'RFC 3339; issues created before this time (exclusive).' },
        limit: { in: 'query', type: 'integer', description: '20000 by default, at most 20000.' } },
      result: { data: [issue] } },
    'issues.search': { docs: `${ref}/issues#post-issues-search`, method: 'POST', path: '/issues/search', kind: 'read', paging: 'body',
      records: 'data', params: search, result: { data: [issue] } },
    'issues.get': { docs: `${ref}/issues#get-issues-id`, path: '/issues/{id}', params: id, result: { data: issue } },
    'issues.create': { docs: `${ref}/issues#post-issues`, method: 'POST', path: '/issues',
      params: { title: { in: 'body', type: 'string', required: true }, body_html: { in: 'body', type: 'string', required: true },
        account_id: { in: 'body', type: 'string' }, requester_id: { in: 'body', type: 'string' },
        requester_email: { in: 'body', type: 'string', description: 'A contact is found or created for it.' },
        requester_name: { in: 'body', type: 'string' }, assignee_id: { in: 'body', type: 'string' }, team_id: { in: 'body', type: 'string' },
        priority: { in: 'body', type: 'string', enum: ['urgent', 'high', 'medium', 'low'] }, tags: { in: 'body', type: ['string'] },
        destination_metadata: { in: 'body', type: { destination: 'string', 'email?': 'string', 'slack_channel_id?': 'string', 'chat_widget_app_id?': 'string' },
          description: '`email`, `slack` or `in_app_chat` deliver the first message to the requester; `customer_portal` makes it customer-visible with no external delivery (`sms` and `whatsapp` need fields this entry does not declare). Left out, or `internal`, the first message is an internal note and no customer is contacted.' } },
      anyOf: [['account_id'], ['requester_id'], ['requester_email']], result: { data: issue } },
    'issues.update': { docs: `${ref}/issues#patch-issues-id`, method: 'PATCH', path: '/issues/{id}',
      params: { ...id, title: { in: 'body', type: 'string' },
        state: { in: 'body', type: 'string', description: '`new`, `waiting_on_you`, `waiting_on_customer`, `on_hold`, `closed`, or a custom status slug.' },
        assignee_id: { in: 'body', type: 'string', description: 'An empty string unassigns the issue.' },
        team_id: { in: 'body', type: 'string' }, tags: { in: 'body', type: ['string'] },
        tags_apply_mode: { in: 'body', type: 'string', enum: ['append_only', 'remove_only', 'replace'] } },
      result: { data: issue } },
    'messages.list': { docs: `${ref}/messages#get-issues-id-messages`, path: '/issues/{id}/messages', paging: 'query', records: 'data',
      params: { ...id, limit: { in: 'query', type: 'integer', description: 'At most 1000; left out, every message comes in one page.' },
        public_only: { in: 'query', type: 'boolean', description: 'Only customer-visible messages, no internal notes.' } },
      result: { data: [message] } },
    'messages.create': { docs: `${ref}/messages#post-issues-id-reply`, method: 'POST', path: '/issues/{id}/reply',
      params: { ...id, body_html: { in: 'body', type: 'string', required: true },
        message_id: { in: 'body', type: 'string', required: true, description: 'The customer-visible message to reply to: its top-level `id` from messages.list.' },
        email_info: { in: 'body', type: recipients, description: 'Required in an email conversation: at least one recipient.' } },
      result: posted },
    'notes.create': { docs: `${ref}/messages#post-issues-id-note`, method: 'POST', path: '/issues/{id}/note',
      params: { ...id, body_html: { in: 'body', type: 'string', required: true },
        thread_id: { in: 'body', type: 'string', description: 'The internal thread to post to; not with message_id.' },
        message_id: { in: 'body', type: 'string', description: 'An internal note whose thread receives the note; not with thread_id.' },
        email_info: { in: 'body', type: recipients, description: 'Required on an internal email thread, whose notes are sent as email.' } },
      result: posted },
    'contacts.list': { docs: `${ref}/contacts#get-contacts`, path: '/contacts', paging: 'query', records: 'data',
      params: { limit: { in: 'query', type: 'integer', description: '100 by default, less than 1000.' } }, result: { data: [contact] } },
    'contacts.search': { docs: `${ref}/contacts#post-contacts-search`, method: 'POST', path: '/contacts/search', kind: 'read',
      paging: 'body', records: 'data', params: search, result: { data: [contact] } },
  },
});
