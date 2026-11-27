import { defineProvider } from '../catalogue.js';

/** HappyFox Help Desk: an API key and its auth code as HTTP Basic; no request names the key's owner, so a sign-in only
 * checks the key. `tickets.update` adds a staff update, which emails the contact only with `update_customer`; a private
 * note may alert agents. A 429's wait is written in its body, so only a `Retry-After` is waited for:
 * https://support.happyfox.com/kb/article/1148-rate-limiting-for-public-api/ */
const ref = 'https://support.happyfox.com/kb/article/1039-happyfox-api-documentation/';
const named = { 'id?': 'integer', 'name?': 'string' } as const;
const ticket = { id: 'integer', 'display_id?': 'string', 'subject?': 'string', 'status?': named, 'priority?': named,
  'user?': { 'id?': 'integer', 'email?': 'string' }, 'created_at?': 'string', 'last_updated_at?': 'string' } as const;
const pageInfo = { 'page_info?': { 'count?': 'integer', 'page_count?': 'integer', 'start_index?': 'integer', 'end_index?': 'integer' } } as const;
const page = { size: { in: 'query', type: 'integer', description: '10 by default, at most 50.' },
  page: { in: 'query', type: 'integer', description: 'From 1; `page_info.page_count` is the last.' } } as const;
const ticketNumber = { ticket_number: { in: 'path', type: 'string', required: true, description: 'The ticket number, or its ID such as HFS00000001.' } } as const;
const staff = { staff: { in: 'body', type: 'integer', required: true, description: 'The ID of the agent adding it (from /staff/).' } } as const;
const changes = { status: { in: 'body', type: 'integer', description: 'A status ID (from /statuses/).' },
  priority: { in: 'body', type: 'integer', description: 'A priority ID (from /priorities/).' },
  assignee: { in: 'body', type: 'integer', nullable: true, description: 'An agent ID; null leaves the ticket unassigned.' },
  due_date: { in: 'body', type: 'string', description: 'yyyy-mm-dd or dd/mm/yyyy.' },
  tags: { in: 'body', type: 'string', description: 'Tags separated by commas.' },
  time_spent: { in: 'body', type: 'integer', description: 'Minutes; required when the category asks for it.' },
  html: { in: 'body', type: 'string' }, plaintext: { in: 'body', type: 'string' } } as const;

export const happyfox = defineProvider({
  id: 'happyfox', name: 'HappyFox', docs: ref,
  categories: ['support'],
  fields: [{ name: 'host', title: 'HappyFox host',
    help: 'Your HappyFox account\'s host, such as acme.happyfox.com, or acme.happyfox.net for an account hosted in the EU.' },
  { name: 'apiKey', title: 'API key', help: 'The API key HappyFox shows with its auth code.' },
  { name: 'authCode', title: 'Auth code', secret: true }],
  auth: [{ kind: 'key', send: { basic: ['{apiKey}', '{token}'] } }],
  http: { baseUrl: 'https://{host}/api/1.1/json', host: ['*.happyfox.com', '*.happyfox.net'], retry: { onlyStated: true } },
  identify: { request: { path: '/statuses/' } },
  // A ticket's updates come only inside `tickets.get`: no messages list. A contact's reply is sent as the customer.
  operations: {
    // One page: a list's paging ends at `page_info.page_count`.
    'tickets.list': { docs: ref, path: '/tickets/',
      params: { ...page, status: { in: 'query', type: 'string', description: '_all (the default), or a status ID.' },
        category: { in: 'query', type: 'integer' },
        q: { in: 'query', type: 'string', description: 'A search, such as contact:"james@example.com" or status:"New".' },
        sort: { in: 'query', type: 'string' } },
      result: { ...pageInfo, data: [ticket] } },
    'tickets.get': { docs: ref, path: '/ticket/{ticket_number}/', params: ticketNumber, result: ticket },
    'tickets.create': { docs: ref, method: 'POST', path: '/tickets/',
      params: { subject: { in: 'body', type: 'string', required: true },
        category: { in: 'body', type: 'integer', required: true, description: 'The ID of a public category.' },
        text: { in: 'body', type: 'string' }, html: { in: 'body', type: 'string' },
        name: { in: 'body', type: 'string', description: 'The contact\'s name; required for a new contact.' },
        email: { in: 'body', type: 'string', description: 'The contact\'s email address; required for a new contact.' },
        phone: { in: 'body', type: 'string' }, priority: { in: 'body', type: 'integer' },
        assignee: { in: 'body', type: 'integer', nullable: true }, tags: { in: 'body', type: 'string' },
        cc: { in: 'body', type: 'string' }, bcc: { in: 'body', type: 'string' }, due_date: { in: 'body', type: 'string' },
        visible_only_staff: { in: 'body', type: 'boolean', description: 'True makes the ticket private.' } },
      anyOf: [['text'], ['html']], result: ticket },
    // Not two updates to one ticket at once.
    'tickets.update': { docs: ref, method: 'POST', path: '/ticket/{ticket_number}/staff_update/',
      params: { ...ticketNumber, ...staff, ...changes,
        update_customer: { in: 'body', type: 'boolean', description: 'True sends the reply to the ticket\'s contact; false by default.' },
        subject: { in: 'body', type: 'string', description: 'The reply\'s subject.' },
        cc: { in: 'body', type: 'string' }, bcc: { in: 'body', type: 'string' } },
      result: ticket },
    'notes.create': { docs: ref, method: 'POST', path: '/ticket/{ticket_number}/staff_pvtnote/',
      params: { ...ticketNumber, ...staff, ...changes,
        alert: { in: 'body', type: 'string', description: 's alerts all subscribers, c the category\'s agents, or an agent ID.' } } },
    'users.list': { docs: 'https://support.happyfox.com/kb/article/1092-contacts-and-contact-groups-api-endpoints/', path: '/users/',
      params: { ...page, q: { in: 'query', type: 'string', description: 'A search, such as email:adam@example.com.' } },
      result: { ...pageInfo, data: [{ id: 'integer', 'name?': 'string', 'email?': 'string', 'tickets_count?': 'integer',
        'created_at?': 'string', 'updated_at?': 'string' }] } },
  },
});
