import { defineProvider } from '../catalogue.js';

/** eDesk: an API token as Bearer; the API is the eDesk Connector add-on (https://www.edesk.com/pricing/). A `Message`
 * with `send` is queued to the buyer on the ticket's channel; a `Note` is internal. A create opens a real conversation
 * on some marketplaces. A 429 states no wait (https://developers.edesk.com/reference/rate-limit). Channels answer one
 * page: a page past the last answers the last one again. */
const ref = 'https://developers.edesk.com/reference';
const ticket = { id: 'integer', 'subject?': 'string', 'status?': 'string', 'channel_id?': 'integer', 'contact_id?': 'integer',
  'uri?': 'string', 'created_at?': 'string', 'last_updated_at?': 'string' } as const;
const message = { id: 'number', 'ticket_id?': 'number', 'type?': 'string', 'direction?': 'string', 'body?': 'unknown',
  'from_consumer_id?': 'integer', 'delivered?': 'boolean', 'created_at?': 'integer' } as const;
const ticketId = { ticketId: { in: 'path', type: 'integer', required: true } } as const;
const statuses = ['Scheduled', 'Spam', 'Archived', 'Open', 'Pending', 'Closed'];
const settable = ['Scheduled', 'Archived', 'Open', 'Pending', 'Closed'];
const perPage = { itemsPerPage: { in: 'query', type: 'integer', description: '20 by default, at most 1000.' } } as const;
const written = { subject: { in: 'body', type: 'string' }, contact_id: { in: 'body', type: 'integer' },
  tag_ids: { in: 'body', type: ['integer'], description: 'Tag ids, as GET /tags lists them.' } } as const;

export const edesk = defineProvider({
  id: 'edesk', name: 'eDesk', docs: `${ref}/whoami`,
  categories: ['support'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'Create it at dashboard.edesk.com/api-token, with full access to Tickets and Messages and read access to Contacts and Channels. The API is the paid eDesk Connector add-on.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.edesk.com/v1', retry: {} },
  identify: { request: { path: '/whoami' }, id: '{data.token.client_id}:{data.user.id}', name: ['data.user.name', 'data.user.email'] },
  paging: { cursor: { kind: 'cursor', next: 'paginator.nextCursor', send: { query: 'cursor' } },
    page: { kind: 'page', send: { query: 'page' }, list: 'data' } },
  operations: {
    'tickets.list': { docs: `${ref}/listtickets`, path: '/tickets', paging: 'cursor', records: 'data',
      params: { ...perPage, order_by: { in: 'query', type: 'string', enum: ['id', 'created_at', 'last_updated_at'] },
        order_direction: { in: 'query', type: 'string', enum: ['asc', 'desc'] },
        filter_status_equals: { in: 'query', type: 'string',
          enum: [...statuses, 'Locked', 'ToDo', 'Waiting', 'Resolved', 'Snoozed'] },
        filter_contact_id_equals: { in: 'query', type: 'integer' }, filter_channel_id_equals: { in: 'query', type: 'integer' },
        fsf_query: { in: 'query', type: 'string', description: 'Full-text search, as the eDesk app\'s search box.' } },
      result: { data: [ticket] } },
    'tickets.get': { docs: `${ref}/getticket`, path: '/tickets/{ticketId}', notFound: 'null', params: ticketId, result: { data: ticket } },
    'tickets.create': { docs: `${ref}/createticket`, method: 'POST', path: '/tickets',
      params: { ...written, subject: { in: 'body', type: 'string', required: true },
        channel_id: { in: 'body', type: 'integer', required: true, description: 'The channel to open it on, as GET /channels lists them.' },
        status: { in: 'body', type: 'string', required: true, enum: settable },
        sales_order_id: { in: 'body', type: 'integer', description: 'Required when the channel is Kaufland, Fnac, Veepee or Mirakl.' },
        external_order_id: { in: 'body', type: 'string', description: 'The marketplace order id, when you do not have the sales_order_id.' } },
      result: { data: ticket } },
    'tickets.update': { docs: `${ref}/updateticket`, method: 'PUT', path: '/tickets/{ticketId}',
      params: { ...ticketId, ...written, status: { in: 'body', type: 'string', enum: settable },
        owner_user_id: { in: 'body', type: 'integer', description: 'The user it is assigned to.' } },
      result: { data: ticket } },
    'messages.list': { docs: `${ref}/listticketmessages`, path: '/tickets/{ticketId}/messages', paging: 'page', records: 'data',
      params: { ...ticketId, itemsPerPage: { in: 'query', type: 'integer', description: '20 by default, at most 100.' } }, result: { data: [message] } },
    'messages.create': { docs: `${ref}/createmessage`, method: 'POST', path: '/messages',
      params: { ticket_id: { in: 'body', type: 'number', required: true }, body: { in: 'body', type: 'string', required: true },
        type: { in: 'body', type: 'string', required: true, enum: ['Message', 'Note'],
          description: 'Message: a reply to the buyer; Note: an internal note, never sent.' },
        send: { in: 'body', type: 'boolean', description: 'true queues a Message for delivery to the channel.' },
        subject: { in: 'body', type: 'string' },
        status: { in: 'body', type: 'string', enum: ['Open', 'Pending', 'Closed', 'Archived'],
          description: 'The ticket\'s status once it is added.' } },
      result: { data: message } },
    // A searched walk may return again contacts sharing the last one's name: deduplicate on id and channel_id.
    'contacts.list': { docs: `${ref}/contacts_list`, path: '/contacts', paging: 'cursor', records: 'data',
      params: { ...perPage, email: { in: 'query', type: 'string' }, name: { in: 'query', type: 'string' },
        fsf_query: { in: 'query', type: 'string', description: 'Searches the contacts\' name and email.' },
        filter_channel_id_equals: { in: 'query', type: 'integer' } },
      result: { data: [{ id: 'integer', 'channel_id?': 'integer', 'full_name?': 'string', 'email?': 'string',
        'phone_number?': 'string' }] } },
    // One page: a page past the last answers the last page again.
    'channels.list': { docs: `${ref}/listchannels`, path: '/channels',
      params: { page: { in: 'query', type: 'integer', description: 'From 1.' },
        itemsPerPage: { in: 'query', type: 'integer', description: '20 (the default), 50, 100, 500 or 1000.' } },
      result: { data: [{ id: 'integer', 'type?': 'string', 'name?': 'string', 'brand?': 'string', 'country?': 'string',
        'currency?': 'string' }] } },
  },
});
