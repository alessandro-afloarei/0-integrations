import { defineProvider } from '../catalogue.js';

/** GetResponse API v3 (retail accounts; GetResponse MAX's hosts and `X-Domain` header are left out): OAuth 2, an app
 * registered at https://app.getresponse.com/authorizations, then the API key, "our primary method". A 429 is retried
 * only after the wait its `X-RateLimit-Reset` states (10-minute time frames). Limits and errors:
 * https://apidocs.getresponse.com/v3/limits https://apidocs.getresponse.com/v3/errors */
const contact = { contactId: 'string', email: 'string', 'name?': 'string', 'campaign?': { campaignId: 'string', 'name?': 'string' },
  'origin?': 'string', 'createdOn?': 'string', 'changedOn?': 'string', href: 'string' } as const;
const newsletter = { newsletterId: 'string', href: 'string', 'name?': 'string', 'subject?': 'string', 'type?': 'string',
  'status?': 'unknown', 'sendOn?': 'string', 'createdOn?': 'string' } as const;
const perPage = { in: 'query', type: 'integer', description: 'Results a page, 100 by default.' } as const;
const ref = 'https://apireference.getresponse.com/#operation';

export const getresponse = defineProvider({
  id: 'getresponse', name: 'GetResponse', docs: 'https://apidocs.getresponse.com/v3/authentication/oauth2',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Find it at https://app.getresponse.com/api. An API key unused for 90 days expires.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.getresponse.com/oauth2_authorize.html', tokenUrl: 'https://api.getresponse.com/v3/token',
    clientAuth: 'basic', authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { header: 'x-auth-token', value: 'api-key {apiKey}' } }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.getresponse.com/v3', headers: { 'content-type': 'application/json' },
    retry: { onlyStated: true, wait: { header: 'x-ratelimit-reset', unit: 's' } } },
  identify: { request: { path: '/accounts' }, id: 'accountId', name: ['companyName', 'email'] },
  errors: { detail: 'code' },
  paging: { page: { kind: 'page', send: { query: 'page' } } },
  operations: {
    // A GetResponse campaign is a contact list.
    'campaigns.list': { docs: `${ref}/getCampaignList`, path: '/campaigns', paging: 'page',
      params: { 'query[name]': { in: 'query', type: 'string' }, perPage },
      result: [{ campaignId: 'string', 'name?': 'string', 'languageCode?': 'string', 'isDefault?': 'unknown',
        'createdOn?': 'string', 'href?': 'string' }] },
    'contacts.list': { docs: `${ref}/getContactList`, path: '/contacts', paging: 'page',
      params: { 'query[email]': { in: 'query', type: 'string', description: 'Contacts by email (a like match unless additionalFlags is exactMatch).' },
        'query[campaignId]': { in: 'query', type: 'string', description: 'Contacts of one campaign (contact list).' },
        additionalFlags: { in: 'query', type: 'string', description: 'exactMatch matches the email and name given exactly.' },
        perPage }, result: [contact] },
    'contacts.get': { docs: `${ref}/getContactById`, path: '/contacts/{contactId}', notFound: 'null',
      params: { contactId: { in: 'path', type: 'string', required: true } }, result: contact },
    // Adds the contact to a campaign (contact list) through a queue: a 202 with no body. On a double opt-in list the
    // contact is emailed a confirmation message, whose link they must click to be added.
    'contacts.create': { docs: `${ref}/createContact`, method: 'POST', path: '/contacts', kind: 'write',
      params: { email: { in: 'body', type: 'string', required: true },
        campaign: { in: 'body', type: { campaignId: 'string' }, required: true, description: 'The campaign (contact list) to add the contact to.' },
        name: { in: 'body', type: 'string' } } },
    // Fields left out stay; a new `campaign.campaignId` moves the contact to that campaign (contact list).
    'contacts.update': { docs: `${ref}/updateContact`, method: 'POST', path: '/contacts/{contactId}',
      params: { contactId: { in: 'path', type: 'string', required: true }, name: { in: 'body', type: 'string' },
        note: { in: 'body', type: 'string' }, campaign: { in: 'body', type: { campaignId: 'string' } } }, result: contact },
    'newsletters.list': { docs: `${ref}/getNewsletterList`, path: '/newsletters', paging: 'page',
      params: { 'query[campaignId]': { in: 'query', type: 'string' }, perPage }, result: [newsletter] },
    'newsletters.get': { docs: `${ref}/getNewsletter`, path: '/newsletters/{newsletterId}', notFound: 'null',
      params: { newsletterId: { in: 'path', type: 'string', required: true } }, result: newsletter },
  },
});
