import { defineProvider } from '../catalogue.js';

/** Twilio SendGrid v3: an API key, on the global or the EU host. A 429 holds until X-RateLimit-Reset (an epoch time):
 * https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api/rate-limits
 * Email Activity (messages) is a paid add-on with no data for EU subusers. A send emails its recipients and spends the
 * account's emails: https://www.twilio.com/docs/sendgrid/api-reference/users-api/retrieve-your-credit-balance */
const message = { msg_id: 'string', 'from_email?': 'string', 'to_email?': 'string', 'subject?': 'string', 'status?': 'string',
  'last_event_time?': 'string' } as const;
const address = { email: 'string', 'name?': 'string' } as const;
const hosts = ['api.sendgrid.com', 'api.eu.sendgrid.com'] as const;
const contact = { id: 'string', 'email?': 'string', 'first_name?': 'string', 'last_name?': 'string', list_ids: ['string'],
  created_at: 'string', updated_at: 'string' } as const;
const singleSend = { id: 'string', 'name?': 'string', 'status?': 'string', 'send_at?': 'string', 'categories?': ['string'],
  'created_at?': 'string', 'updated_at?': 'string' } as const;
const ref = 'https://www.twilio.com/docs/sendgrid/api-reference';

export const sendgrid = defineProvider({
  id: 'sendgrid', name: 'Twilio SendGrid', docs: `${ref}/users-api/retrieve-your-username`,
  categories: ['mail', 'marketing'],
  fields: [{ name: 'apiHost', title: 'Region', choices: hosts, default: 'api.sendgrid.com',
    help: 'api.sendgrid.com for global users and subusers; api.eu.sendgrid.com for EU regional subusers (Pro plan or above). The marketing operations need a global account: Marketing Campaigns and related features aren\'t supported in the EU environment.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'A Full Access key, or one with at least whitelabel.read, user.username.read, mail.send and marketing.read (Email Marketing, which also allows its writes). Reading messages needs the paid Email Activity add-on and a key with Email Activity access.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}/v3', host: hosts,
    retry: { onlyStated: true, wait: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } } },
  identify: { request: { path: '/user/username' }, id: 'user_id', name: 'username' },
  paging: { offset: { kind: 'offset', send: { query: 'offset' } }, next: { kind: 'nextUrl', next: '_metadata.next' } },
  operations: {
    'messages.search': { docs: `${ref}/email-activity/filter-all-messages`, path: '/messages',
      params: { query: { in: 'query', type: 'string', required: true, description: 'Filter conditions, such as to_email="ada@example.com".' },
        limit: { in: 'query', type: 'integer', description: '10 by default, 1 to 1000.' } },
      result: { messages: [message] } },
    'messages.get': { docs: `${ref}/email-activity/filter-messages-by-message-id`, path: '/messages/{msg_id}', notFound: 'null',
      params: { msg_id: { in: 'path', type: 'string', required: true } }, result: message },
    'domains.list': { docs: `${ref}/domain-authentication/list-all-authenticated-domains`, path: '/whitelabel/domains',
      paging: 'offset', params: { limit: { in: 'query', type: 'integer' } },
      result: [{ id: 'number', 'user_id?': 'number', 'subdomain?': 'string', 'domain?': 'string', 'username?': 'string',
        'valid?': 'boolean', 'default?': 'boolean' }] },
    'emails.create': { docs: `${ref}/mail-send/mail-send`, method: 'POST', path: '/mail/send', kind: 'write',
      params: { personalizations: { in: 'body', type: [{ to: [address], 'subject?': 'string' }], required: true,
        description: 'One envelope per message, 1 to 1000; at most 1000 recipients in all.' },
      from: { in: 'body', type: address, required: true, description: 'A verified sender of the account.' },
      subject: { in: 'body', type: 'string', description: 'Required unless every personalization has its own.' },
      content: { in: 'body', type: [{ type: 'string', value: 'string' }], required: true,
        description: 'At least one body, each a MIME type and its value: text/plain first, then text/html. (A template send is not declared.)' } } },
    // Marketing Campaigns: global users and subusers only; EU subusers cannot use Marketing:
    // https://www.twilio.com/docs/sendgrid/data-residency/faq
    'lists.list': { docs: `${ref}/lists/get-all-lists`, path: '/marketing/lists', paging: 'next', records: 'result',
      params: { page_size: { in: 'query', type: 'number', description: '100 by default, at most 1000.' } },
      result: { result: [{ id: 'string', 'name?': 'string', 'contact_count?': 'integer' }] } },
    'contacts.search': { docs: `${ref}/contacts/search-contacts`, method: 'POST', path: '/marketing/contacts/search', kind: 'read',
      params: { query: { in: 'body', type: 'string', required: true,
        description: 'An SGQL condition, such as email = \'ada@example.com\' (emails are stored in lower case). The first 50 matches.' } },
      result: { 'result?': [contact], contact_count: 'number' } },
    'contacts.get': { docs: `${ref}/contacts/get-a-contact-by-id`, path: '/marketing/contacts/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true } }, result: contact },
    // An upsert: an existing contact is updated, omitted fields kept. Adding contacts might affect your Twilio SendGrid
    // bill: https://www.twilio.com/docs/sendgrid/ui/managing-contacts/create-and-manage-contacts. It can start emails:
    // an Automation sends its series to each contact added to its list or segment (All Contacts by default); no
    // parameter stops it: https://www.twilio.com/docs/sendgrid/ui/sending-email/getting-started-with-automation
    'contacts.create': { docs: `${ref}/contacts/add-or-update-a-contact`, method: 'PUT', path: '/marketing/contacts', kind: 'write',
      params: { contacts: { in: 'body', type: [{ email: 'string', 'first_name?': 'string', 'last_name?': 'string' }], required: true,
        description: 'Up to 30,000 contacts, each identified here by its email (the page also takes other identifiers); an existing contact is updated only when all its identifiers are sent.' },
      list_ids: { in: 'body', type: ['string'], description: 'The lists every contact is added to. This re-subscribes no one: a send to an address on the Global or Group Unsubscribes suppression lists is suppressed.' } },
      result: { 'job_id?': 'string' } },
    'singleSends.list': { docs: `${ref}/single-sends/get-all-single-sends`, path: '/marketing/singlesends', paging: 'next',
      records: 'result', params: { page_size: { in: 'query', type: 'integer' } }, result: { result: [singleSend] } },
    'singleSends.get': { docs: `${ref}/single-sends/get-single-send-by-id`, path: '/marketing/singlesends/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true } }, result: singleSend },
  },
});
