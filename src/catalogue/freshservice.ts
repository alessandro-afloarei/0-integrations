import { defineProvider } from '../catalogue.js';

/** Freshservice: an agent's personal API key as the Basic user, any password (`X`); what it can do follows the agent's
 * role. No request names the key's agent, so a sign-in only checks the key. A reply emails the requester (its cc and
 * bcc too); a note may notify agents (`notify_emails`). Lists follow the `link` header; a 429 waits `Retry-After`:
 * https://api.freshservice.com/ */
const ref = 'https://api.freshservice.com/#';
const ticket = { id: 'number', 'subject?': 'string', 'status?': 'number', 'priority?': 'number', 'requester_id?': 'number',
  'responder_id?': 'number', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const conversation = { id: 'number', 'ticket_id?': 'number', 'user_id?': 'number', 'body?': 'unknown', 'private?': 'boolean',
  'incoming?': 'boolean', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const perPage = { per_page: { in: 'query', type: 'integer', description: '30 by default, at most 100.' } } as const;
const id = { id: { in: 'path', type: 'number', required: true } } as const;
const written = { requester_id: { in: 'body', type: 'number' },
  email: { in: 'body', type: 'string', description: 'The requester\'s email address; a new one is added as a contact.' },
  phone: { in: 'body', type: 'string', description: 'With a phone and no email, `name` is required.' },
  name: { in: 'body', type: 'string', description: 'The requester\'s name.' }, subject: { in: 'body', type: 'string' },
  status: { in: 'body', type: 'number', description: '2 open, 3 pending, 4 resolved, 5 closed.' },
  priority: { in: 'body', type: 'number', description: '1 low, 2 medium, 3 high, 4 urgent.' },
  responder_id: { in: 'body', type: 'number', description: 'The agent it is assigned to.' }, group_id: { in: 'body', type: 'number' },
  department_id: { in: 'body', type: 'number' }, tags: { in: 'body', type: ['string'] },
  custom_fields: { in: 'body', type: 'unknown', description: 'Custom field names and values.' } } as const;
const reply = { body: { in: 'body', type: 'string', required: true, description: 'The content, in HTML.' },
  user_id: { in: 'body', type: 'number' } } as const;

export const freshservice = defineProvider({
  id: 'freshservice', name: 'Freshservice', docs: `${ref}authentication`,
  categories: ['support'],
  fields: [{ name: 'domain', title: 'Freshservice domain',
    help: 'The part before .freshservice.com in your service desk\'s address; a custom domain (CNAME) does not reach the API.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Your API key, under Profile settings, below the change password section. What it can do follows your agent role.' }],
  auth: [{ kind: 'key', send: { basic: ['{token}', 'X'] } }],
  http: { baseUrl: 'https://{domain}.freshservice.com/api/v2', host: '*.freshservice.com', retry: {} },
  identify: { request: { path: '/tickets', query: { per_page: '1' } } },
  paging: { link: { kind: 'linkHeader' } },
  operations: {
    'tickets.list': { docs: `${ref}view_all_ticket`, path: '/tickets', paging: 'link', records: 'tickets',
      params: { filter: { in: 'query', type: 'string', enum: ['new_and_my_open', 'watching', 'spam', 'deleted'] },
        requester_id: { in: 'query', type: 'number' }, email: { in: 'query', type: 'string' },
        updated_since: { in: 'query', type: 'string',
          description: 'An ISO 8601 time. Without it, only tickets created in the past 30 days are listed.' },
        type: { in: 'query', type: 'string', description: 'Incident or Service Request.' },
        workspace_id: { in: 'query', type: 'number', description: 'Without it, the primary workspace; 0 lists every workspace.' },
        order_type: { in: 'query', type: 'string', enum: ['asc', 'desc'] }, ...perPage },
      result: { tickets: [ticket] } },
    // One page; `page` asks for another, and the answer's `total` counts the matches.
    'tickets.search': { docs: `${ref}filter_tickets`, path: '/tickets/filter',
      params: { query: { in: 'query', type: 'string', required: true,
        description: 'Ticket fields in double quotes, up to 512 characters: "priority:3 AND status:2".' },
      page: { in: 'query', type: 'integer' } },
      result: { 'total?': 'number', tickets: [ticket] } },
    'tickets.get': { docs: `${ref}view_a_ticket`, path: '/tickets/{id}', notFound: 'null', params: id, result: { ticket } },
    // "Calling Create a Ticket without the mandatory description" is refused; the requester is required.
    'tickets.create': { docs: `${ref}create_ticket`, method: 'POST', path: '/tickets',
      params: { description: { in: 'body', type: 'string', required: true, description: 'The ticket\'s HTML content.' }, ...written },
      anyOf: [['requester_id'], ['email'], ['phone']], result: { ticket } },
    'tickets.update': { docs: `${ref}update_a_ticket`, method: 'PUT', path: '/tickets/{id}',
      params: { ...id, description: { in: 'body', type: 'string' }, ...written }, result: { ticket } },
    'conversations.list': { docs: `${ref}list_all_conversations`, path: '/tickets/{id}/conversations', paging: 'link',
      records: 'conversations', params: { ...id, ...perPage }, result: { conversations: [conversation] } },
    'conversations.create': { docs: `${ref}create_a_reply`, method: 'POST', path: '/tickets/{id}/reply',
      params: { ...id, ...reply, from_email: { in: 'body', type: 'string', description: 'The support address it is sent from.' },
        cc_emails: { in: 'body', type: ['string'] }, bcc_emails: { in: 'body', type: ['string'] } },
      result: { conversation } },
    'notes.create': { docs: `${ref}create_a_note`, method: 'POST', path: '/tickets/{ticket_id}/notes',
      params: { ticket_id: { in: 'path', type: 'number', required: true }, ...reply,
        private: { in: 'body', type: 'boolean', description: 'True by default; false makes a public note the requester sees.' },
        notify_emails: { in: 'body', type: ['string'], description: 'Agents or users to notify about the note.' },
        incoming: { in: 'body', type: 'boolean' } },
      result: { conversation } },
    'requesters.list': { docs: `${ref}list_all_requesters`, path: '/requesters', paging: 'link', records: 'requesters',
      params: { email: { in: 'query', type: 'string' }, mobile_phone_number: { in: 'query', type: 'string' },
        work_phone_number: { in: 'query', type: 'string' },
        include_agents: { in: 'query', type: 'boolean', description: 'True lists agents too.' }, ...perPage },
      result: { requesters: [{ id: 'number', 'first_name?': 'string', 'last_name?': 'string', 'primary_email?': 'string',
        'job_title?': 'string', 'active?': 'boolean', 'created_at?': 'string', 'updated_at?': 'string' }] } },
  },
});
