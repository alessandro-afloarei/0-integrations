import { defineProvider } from '../catalogue.js';

/** lemlist, pages under https://developer.lemlist.com/api-reference/: 20 requests per 2 seconds per key, a 429 with
 * `Retry-After` (getting-started/rate-limits). Campaigns are its sequences; a contact added to one is a lead. A webhook
 * has no signature: its `secret`, if set, comes back in the JSON body (endpoints/webhooks/add-webhook). Error envelopes
 * hold `error.code` (endpoints/contacts/upsert-contact). */
const contact = { _id: 'string', 'fullName?': 'string', 'email?': 'string', 'linkedinUrl?': 'string', 'ownerId?': 'string',
  'createdAt?': 'string' } as const;
const upserted = { 'success?': 'boolean', data: { _id: 'string', 'ownerId?': 'string', 'createdAt?': 'string',
  'created?': 'boolean', 'updated?': 'boolean' } } as const;
const written = { firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string' },
  jobTitle: { in: 'body', type: 'string' }, linkedinUrl: { in: 'body', type: 'string' }, phone: { in: 'body', type: 'string' },
  companyDomain: { in: 'body', type: 'string' } } as const;
const oneOf = 'At least one identifier is required: `email`, `linkedinUrl` or `linkedinUrlSalesNav` (`contactId` only updates).';
const ref = 'https://developer.lemlist.com/api-reference/endpoints';

export const lemlist = defineProvider({
  id: 'lemlist', name: 'lemlist', docs: 'https://developer.lemlist.com/api-reference/getting-started/authentication',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Under Settings, then Integrations: Generate a new API key. A key belongs to one lemlist account (team). Creating a contact or a lead needs the "Create contacts" permission on the key\'s user, and "Create companies" when the lead\'s company is not in lemlist yet.' }],
  auth: [{ kind: 'key', send: { basic: ['', '{apiKey}'] } }],
  http: { baseUrl: 'https://api.lemlist.com/api', minIntervalMs: 100, retry: {} },
  identify: { request: { path: '/team' }, id: '_id', name: 'name' },
  errors: { detail: 'error.code' },
  paging: { contacts: { kind: 'offset', send: { query: 'offset' }, list: 'data' } },
  operations: {
    'campaigns.list': { docs: `${ref}/campaigns/get-many-campaigns`, path: '/campaigns?version=v2',
      params: { limit: { in: 'query', type: 'integer', description: 'At most 100, 100 by default.' },
        offset: { in: 'query', type: 'integer', description: 'Offset from the start; the list answers one page each call.' } },
      result: [{ _id: 'string', 'name?': 'string', 'status?': 'string', 'createdBy?': 'string', 'createdAt?': 'string' }] },
    'contacts.list': { docs: `${ref}/contacts/get-many-contacts-v2`, path: '/v2/contacts', paging: 'contacts', records: 'data',
      params: { limit: { in: 'query', type: 'integer', description: '1 to 500, 100 by default; limit plus offset at most 10,000.' } },
      result: { data: [contact] } },
    'contacts.get': { docs: `${ref}/contacts/get-contact`, path: '/contacts/{idOrEmail}', notFound: 'null',
      params: { idOrEmail: { in: 'path', type: 'string', required: true } }, result: contact },
    'contacts.create': { docs: `${ref}/contacts/upsert-contact`, method: 'POST', path: '/contacts',
      params: { ...written, email: { in: 'body', type: 'string', description: `The primary email, the main unique key. ${oneOf}` },
        linkedinUrl: { in: 'body', type: 'string', description: `The LinkedIn profile URL. ${oneOf}` },
        linkedinUrlSalesNav: { in: 'body', type: 'string', description: `The LinkedIn Sales Navigator profile URL. ${oneOf}` } },
      result: upserted },
    'contacts.update': { docs: `${ref}/contacts/upsert-contact`, method: 'POST', path: '/contacts',
      params: { contactId: { in: 'body', type: 'string', required: true }, email: { in: 'body', type: 'string' }, ...written },
      result: upserted },
    'leads.create': { docs: `${ref}/leads/create-lead-in-campaign`, method: 'POST', path: '/campaigns/{campaignId}/leads/',
      params: { campaignId: { in: 'path', type: 'string', required: true }, email: { in: 'body', type: 'string' },
        firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string' }, companyName: { in: 'body', type: 'string' },
        jobTitle: { in: 'body', type: 'string' }, linkedinUrl: { in: 'body', type: 'string' } },
      result: { _id: 'string', 'contactId?': 'string', 'campaignId?': 'string', 'email?': 'string', 'isPaused?': 'boolean' } },
  },
});
