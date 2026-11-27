import { defineProvider } from '../catalogue.js';

/** Freshdesk: an agent's personal API key as the Basic user, any password (`X`); what it can do follows the agent's
 * role. A reply emails the requester (its cc and bcc too); a note may notify agents (`notify_emails`). Lists follow the
 * `link` header, a search by page; a 429 waits `Retry-After`; an error names a machine-readable code. All on one page:
 * https://developers.freshdesk.com/api/ */
const ref = 'https://developers.freshdesk.com/api/#';
const ticket = { id: 'number', 'subject?': 'string', 'status?': 'number', 'priority?': 'number', 'requester_id?': 'number',
  'responder_id?': 'number', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const conversation = { id: 'number', 'ticket_id?': 'number', 'user_id?': 'number', 'body?': 'unknown', 'private?': 'boolean',
  'incoming?': 'boolean', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const contact = { id: 'number', 'name?': 'string', 'email?': 'string', 'phone?': 'string', 'mobile?': 'string',
  'company_id?': 'number', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const perPage = { per_page: { in: 'query', type: 'integer', description: '30 by default, at most 100.' } } as const;
const id = { id: { in: 'path', type: 'number', required: true } } as const;
const requester = { requester_id: { in: 'body', type: 'number' },
  email: { in: 'body', type: 'string', description: 'The requester\'s email address; a new one is added as a contact.' },
  facebook_id: { in: 'body', type: 'string' },
  phone: { in: 'body', type: 'string', description: 'With a phone and no email, `name` is required.' },
  twitter_id: { in: 'body', type: 'string' }, unique_external_id: { in: 'body', type: 'string' } } as const;
const written = { name: { in: 'body', type: 'string', description: 'The requester\'s name.' }, subject: { in: 'body', type: 'string' },
  description: { in: 'body', type: 'string', description: 'The ticket\'s HTML content.' },
  status: { in: 'body', type: 'number', description: '2 open, 3 pending, 4 resolved, 5 closed.' },
  priority: { in: 'body', type: 'number', description: '1 low, 2 medium, 3 high, 4 urgent.' },
  type: { in: 'body', type: 'string' }, responder_id: { in: 'body', type: 'number', description: 'The agent it is assigned to.' },
  group_id: { in: 'body', type: 'number' }, tags: { in: 'body', type: ['string'] },
  custom_fields: { in: 'body', type: 'unknown', description: 'Custom field names and values.' } } as const;
const body = { body: { in: 'body', type: 'string', description: 'The content, in HTML.' },
  structured_body: { in: 'body', type: 'unknown', description: 'For a web chat or mobile SDK ticket, in place of `body`: { body_contents: [...] }.' } } as const;

export const freshdesk = defineProvider({
  id: 'freshdesk', name: 'Freshdesk', docs: `${ref}authentication`,
  categories: ['support'],
  fields: [{ name: 'domain', title: 'Freshdesk domain',
    help: 'The part before .freshdesk.com in your helpdesk\'s address; a custom domain (CNAME) does not reach the API.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Your API key, under Profile settings, below the change password section. What it can do follows your agent role.' }],
  auth: [{ kind: 'key', send: { basic: ['{token}', 'X'] } }],
  http: { baseUrl: 'https://{domain}.freshdesk.com/api/v2', host: '*.freshdesk.com', retry: {} },
  identify: { request: { path: '/agents/me' }, id: 'id', name: ['contact.name', 'contact.email'] },
  errors: { detail: 'errors.0.code' },
  paging: { link: { kind: 'linkHeader' }, search: { kind: 'page', send: { query: 'page' }, list: 'results', total: { entries: 'total' } } },
  operations: {
    'tickets.list': { docs: `${ref}list_all_tickets`, path: '/tickets', paging: 'link',
      params: { filter: { in: 'query', type: 'string', enum: ['new_and_my_open', 'watching', 'spam', 'deleted'] },
        requester_id: { in: 'query', type: 'number' }, email: { in: 'query', type: 'string' }, company_id: { in: 'query', type: 'number' },
        updated_since: { in: 'query', type: 'string',
          description: 'An ISO 8601 time. Without it, only tickets created in the past 30 days are listed; a list stops at 300 pages.' },
        order_by: { in: 'query', type: 'string', enum: ['created_at', 'due_by', 'updated_at', 'status'] },
        order_type: { in: 'query', type: 'string', enum: ['asc', 'desc'] }, ...perPage },
      result: [ticket] },
    // Pages of 30 to the answer's `total`; the page number "should not exceed 10" (300 results), and a search with
    // more results than ten pages hold does not end quietly.
    'tickets.search': { docs: `${ref}filter_tickets`, path: '/search/tickets', paging: 'search', records: 'results',
      params: { query: { in: 'query', type: 'string', required: true,
        description: 'Ticket fields in double quotes, up to 512 characters: "priority:3 AND status:2".' } },
      result: { 'total?': 'number', results: [ticket] } },
    'tickets.get': { docs: `${ref}view_a_ticket`, path: '/tickets/{id}', notFound: 'null', params: id, result: ticket },
    'tickets.create': { docs: `${ref}create_ticket`, method: 'POST', path: '/tickets', params: { ...requester, ...written },
      anyOf: [['requester_id'], ['email'], ['facebook_id'], ['phone'], ['twitter_id'], ['unique_external_id']], result: ticket },
    'tickets.update': { docs: `${ref}update_ticket`, method: 'PUT', path: '/tickets/{id}', params: { ...id, ...requester, ...written },
      result: ticket },
    'conversations.list': { docs: `${ref}list_all_ticket_notes`, path: '/tickets/{id}/conversations', paging: 'link',
      params: { ...id, ...perPage }, result: [conversation] },
    'conversations.create': { docs: `${ref}reply_ticket`, method: 'POST', path: '/tickets/{id}/reply',
      params: { ...id, ...body, from_email: { in: 'body', type: 'string', description: 'The support address it is sent from.' },
        cc_emails: { in: 'body', type: ['string'] }, bcc_emails: { in: 'body', type: ['string'] } },
      anyOf: [['body'], ['structured_body']], result: conversation },
    'notes.create': { docs: `${ref}add_note_to_a_ticket`, method: 'POST', path: '/tickets/{ticket_id}/notes',
      params: { ticket_id: { in: 'path', type: 'number', required: true }, ...body,
        private: { in: 'body', type: 'boolean', description: 'True by default; false makes a public note the requester sees.' },
        notify_emails: { in: 'body', type: ['string'], description: 'Agents or users to notify about the note.' } },
      anyOf: [['body'], ['structured_body']], result: conversation },
    'contacts.list': { docs: `${ref}list_all_contacts`, path: '/contacts', paging: 'link',
      params: { email: { in: 'query', type: 'string' }, mobile: { in: 'query', type: 'string' }, phone: { in: 'query', type: 'string' },
        company_id: { in: 'query', type: 'number' },
        state: { in: 'query', type: 'string', enum: ['blocked', 'deleted', 'unverified', 'verified'] },
        updated_since: { in: 'query', type: 'string' }, ...perPage },
      result: [contact] },
    'contacts.search': { docs: `${ref}search_contacts`, path: '/contacts/autocomplete',
      params: { term: { in: 'query', type: 'string', required: true, description: 'The start of a word of the contact\'s name.' } },
      result: [{ id: 'number', 'name?': 'string' }] },
  },
});
