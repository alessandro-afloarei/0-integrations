import { defineProvider } from '../catalogue.js';

/** Trengo: a personal or service account API key, Bearer; identify only checks it. A 429 waits `Retry-After` seconds.
 * `messages.create` sends on the ticket's channel, so it reaches the customer, unless `internal_note`. Trengo has no
 * ticket update (only assign and close) and no list of the channels a create needs. Webhooks sign `<timestamp>;<hex>`,
 * which is not declared: https://developers.trengo.com/docs/verifiying-request */
const ticket = { id: 'integer', 'status?': 'string', 'subject?': 'string', 'contact_id?': 'integer', 'user_id?': 'integer',
  'team_id?': 'integer', 'created_at?': 'string', 'closed_at?': 'string' } as const;
const person = { 'id?': 'integer', 'full_name?': 'string', 'email?': 'string' } as const;
const ticketId = { ticket_id: { in: 'path', type: 'integer', required: true } } as const;
const ref = 'https://developers.trengo.com/reference';

export const trengo = defineProvider({
  id: 'trengo', name: 'Trengo', docs: 'https://developers.trengo.com/docs/rate-limiting',
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Made in Trengo under Settings > Integrations > Rest API: a personal API key (trpat_), which acts as you with your permissions, or a service account key (trsa_), a separate user for an integration. Keys without either prefix stop working after 31 January 2027.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://app.trengo.com/api/v2', headers: { 'content-type': 'application/json' }, retry: {} },
  identify: { request: { path: '/tickets' } },
  paging: { links: { kind: 'nextUrl', next: 'links.next' } },
  operations: {
    'tickets.list': { docs: `${ref}/list-all-tickets`, path: '/tickets',
      params: { status: { in: 'query', type: 'string', description: 'OPEN, ASSIGNED, CLOSED or INVALID.' },
        contact_id: { in: 'query', type: 'integer' }, sort: { in: 'query', type: 'string', description: 'Orders by the last message; date orders oldest first. -date by default.' },
        updated_at_gt: { in: 'query', type: 'string', description: 'Only tickets updated after this date and time.' },
        page: { in: 'query', type: 'string', description: 'The page number, 1 by default.' } },
      result: { data: [ticket] } },
    'tickets.get': { docs: `${ref}/get-a-ticket`, path: '/tickets/{ticket_id}', params: ticketId, result: ticket },
    'tickets.create': { docs: `${ref}/create-a-ticket`, method: 'POST', path: '/tickets',
      params: { channel_id: { in: 'body', type: 'integer', required: true }, contact_id: { in: 'body', type: 'string', required: true },
        subject: { in: 'body', type: 'string' } },
      result: ticket },
    'messages.list': { docs: `${ref}/list-all-messages`, path: '/tickets/{ticket_id}/messages', paging: 'links', records: 'data',
      params: ticketId,
      result: { data: [{ id: 'integer', 'ticket_id?': 'integer', 'type?': 'string', 'body_type?': 'string', 'message?': 'unknown',
        'created_at?': 'string', 'contact?': person, 'agent?': person }] } },
    'messages.create': { docs: `${ref}/send-a-message`, method: 'POST', path: '/tickets/{ticket_id}/messages',
      params: { ...ticketId, message: { in: 'body', type: 'string', required: true, description: 'May contain HTML when sending emails.' },
        internal_note: { in: 'body', type: 'boolean', description: 'true keeps the message an internal note: the customer does not get it.' },
        subject: { in: 'body', type: 'string', description: 'Emails only; Trengo prepends Re: when replying to a ticket.' } },
      result: { message: { id: 'integer', 'message?': 'unknown', 'ticket?': { 'id?': 'integer' } } } },
    'contacts.list': { docs: `${ref}/list-all-contacts`, path: '/contacts',
      params: { term: { in: 'query', type: 'string', description: 'Finds a contact by email, phone number or name.' },
        page: { in: 'query', type: 'string', description: 'The page number, 1 by default.' } } },
  },
});
