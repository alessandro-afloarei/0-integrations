import { defineProvider } from '../catalogue.js';

/** LiveAgent API v3: an API key in the `apikey` header, its permissions chosen when an admin makes it; anyone holding
 * it reaches the whole account. A sign-in only checks the key (`/ping`). A ticket's create emails its recipient unless
 * `do_not_send_mail` is Y. Every operation, its parameters and its answer are in the API's definition:
 * https://support.ladesk.com/docs/api/v3/api-docs-generator.php */
const ref = 'https://support.ladesk.com/docs/api/v3/#';
const ticket = { id: 'string', 'subject?': 'string', 'status?': 'string', 'owner_contactid?': 'string', 'owner_email?': 'string',
  'agentid?': 'string', 'date_created?': 'string', 'date_changed?': 'string' } as const;
const list = { _perPage: { in: 'query', type: 'integer', description: '10 by default.' },
  _sortDir: { in: 'query', type: 'string', enum: ['ASC', 'DESC'] },
  _filters: { in: 'query', type: 'string', description: 'A JSON object {"column":"value"} or a JSON list [["column","operator","value"]].' } } as const;
const ticketId = { ticketId: { in: 'path', type: 'string', required: true } } as const;
const status = 'N new, T chatting, P calling, R resolved, X deleted, B spam, A answered, C open, W postponed.';

export const liveagent = defineProvider({
  id: 'liveagent', name: 'LiveAgent', docs: 'https://support.liveagent.com/741982-API-key',
  categories: ['support'],
  fields: [{ name: 'account', title: 'LiveAgent account', help: 'The part before .ladesk.com in your LiveAgent address.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'An admin makes it under Configuration, System, API (v3), with permission to read, create and update tickets and to read contacts.' }],
  auth: [{ kind: 'key', send: { header: 'apikey' } }],
  http: { baseUrl: 'https://{account}.ladesk.com/api/v3', host: '*.ladesk.com' },
  identify: { request: { path: '/ping' } },
  paging: { page: { kind: 'page', send: { query: '_page' } } },
  // v3 adds no reply to an existing ticket, and its ticket note is an attribute, not a note: neither is declared.
  operations: {
    'tickets.list': { docs: `${ref}/tickets/getTicketsList`, path: '/tickets', paging: 'page',
      params: { ...list, _sortField: { in: 'query', type: 'string', enum: ['importance', 'date_created', 'date_changed'] } },
      result: [ticket] },
    'tickets.get': { docs: `${ref}/tickets/getTicket`, path: '/tickets/{ticketId}', notFound: 'null', params: ticketId, result: ticket },
    'tickets.create': { docs: `${ref}/tickets/createTicket`, method: 'POST', path: '/tickets',
      params: { useridentifier: { in: 'body', type: 'string', required: true }, subject: { in: 'body', type: 'string', required: true },
        departmentid: { in: 'body', type: 'string', required: true }, recipient: { in: 'body', type: 'string', required: true },
        message: { in: 'body', type: 'string', required: true }, recipient_name: { in: 'body', type: 'string' },
        carbon_copies: { in: 'body', type: 'string' }, blind_carbon_copies: { in: 'body', type: 'string' },
        status: { in: 'body', type: 'string', enum: ['N', 'T', 'P', 'R', 'X', 'B', 'A', 'C', 'W'], description: `N by default: ${status}` },
        do_not_send_mail: { in: 'body', type: 'string', enum: ['Y', 'N'], description: 'Y sends no email; N, the default, sends it.' },
        is_html_message: { in: 'body', type: 'string', enum: ['Y', 'N'] }, tags: { in: 'body', type: ['string'], description: 'Tag IDs.' } },
      result: { id: 'string', 'subject?': 'string', 'status?': 'string', 'owner_contactid?': 'string', 'departmentid?': 'string',
        'agentid?': 'string', 'code?': 'string', 'date_created?': 'string' } },
    'tickets.update': { docs: `${ref}/tickets/updateTicket`, method: 'PUT', path: '/tickets/{ticketId}',
      params: { ...ticketId, subject: { in: 'body', type: 'string' }, departmentid: { in: 'body', type: 'string' },
        agentid: { in: 'body', type: 'string' }, owner_contactid: { in: 'body', type: 'string' },
        status: { in: 'body', type: 'string', enum: ['I', 'N', 'T', 'P', 'R', 'X', 'B', 'A', 'C', 'W'], description: `I init, ${status}` },
        tags: { in: 'body', type: ['string'] } },
      result: ticket },
    'messages.list': { docs: `${ref}/tickets/getTicketMessageGroups`, path: '/tickets/{ticketId}/messages', paging: 'page',
      params: { ...ticketId, ...list, includeQuotedMessages: { in: 'query', type: 'boolean' } },
      result: [{ id: 'string', 'parent_id?': 'string', 'userid?': 'string', 'user_full_name?': 'string', 'type?': 'string',
        'status?': 'string', 'datecreated?': 'string', 'messages?': 'unknown' }] },
    'contacts.list': { docs: `${ref}/contacts/getContactsList`, path: '/contacts', paging: 'page', params: list,
      result: [{ id: 'string', 'firstname?': 'string', 'lastname?': 'string', 'system_name?': 'string', 'emails?': 'unknown',
        'company_id?': 'string', 'date_created?': 'string', 'date_changed?': 'string' }] },
  },
});
