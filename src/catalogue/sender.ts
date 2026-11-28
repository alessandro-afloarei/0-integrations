import { defineProvider } from '../catalogue.js';

/** Sender.net API v2, an API access token. No request names the account, so a sign-in checks the token on the groups
 * list. A 429 waits its `Retry-After`: https://api.sender.net/errors/. Lists page from 1 to `meta.last_page`:
 * https://api.sender.net/pagination/. Webhooks (a paid feature) sign the raw body alone: no timestamp, no event id, and
 * an event may come twice: https://api.sender.net/account-webhooks/webhook-payload-example/ */
const subscriber = { id: 'string', 'email?': 'string', 'firstname?': 'string', 'lastname?': 'string', 'phone?': 'string',
  'created?': 'string', 'status?': { 'email?': 'string', 'temail?': 'string' }, 'subscriber_tags?': [{ 'id?': 'string', 'title?': 'string' }] } as const;
const campaign = { id: 'string', 'title?': 'string', 'subject?': 'string', 'status?': 'string', 'schedule_time?': 'string',
  'sent_time?': 'string', 'created?': 'string', 'modified?': 'string' } as const;
const limit = { in: 'query', type: 'integer', description: 'How many records a page.' } as const;
const subscriberKey = { in: 'path', type: 'string', required: true, description: "The subscriber's email address, phone number or ID." } as const;
const automation = { in: 'body', type: 'boolean',
  description: 'true by default, which activates an automation; false activates none.' } as const;
const ref = 'https://api.sender.net';

export const sender = defineProvider({
  id: 'sender', name: 'Sender.net', docs: `${ref}/authentication/`,
  categories: ['marketing'],
  fields: [{ name: 'apiToken', title: 'API access token', secret: true,
    help: 'Create it in Sender under Settings, API access tokens. A token has full access to your account.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.sender.net/v2', retry: {} },
  identify: { request: { path: '/groups', query: { limit: '1' } } },
  webhook: { kind: 'hmac', header: 'x-sender-hmac-sha256' },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'data', total: { pages: 'meta.last_page' } } },
  operations: {
    'groups.list': { docs: `${ref}/groups/list-all/`, path: '/groups', paging: 'page', records: 'data', params: { limit },
      result: { data: [{ id: 'string', 'title?': 'string', 'recipient_count?': 'integer', 'active_subscribers?': 'integer',
        'created?': 'string', 'modified?': 'string' }] } },
    'subscribers.list': { docs: `${ref}/subscribers/list-all/`, path: '/subscribers', paging: 'page', records: 'data', params: { limit },
      result: { data: [subscriber] } },
    'subscribers.get': { docs: `${ref}/subscribers/get-one/`, path: '/subscribers/{subscriber}', notFound: 'null',
      params: { subscriber: subscriberKey }, result: { data: subscriber } },
    // Activates an automation for the new subscriber (which may email them) unless `trigger_automation` is false.
    'subscribers.create': { docs: `${ref}/subscribers/add-subscriber/`, method: 'POST', path: '/subscribers', kind: 'write',
      params: { email: { in: 'body', type: 'string', required: true }, firstname: { in: 'body', type: 'string' },
        lastname: { in: 'body', type: 'string' },
        groups: { in: 'body', type: ['string'], description: 'The ids of the groups to add the subscriber to.' },
        trigger_automation: automation }, result: { data: subscriber } },
    // May activate an automation, as a create does, unless `trigger_automation` is false.
    'subscribers.update': { docs: `${ref}/subscribers/update-subscriber/`, method: 'PATCH', path: '/subscribers/{subscriber}',
      kind: 'write', params: { subscriber: subscriberKey, firstname: { in: 'body', type: 'string' }, lastname: { in: 'body', type: 'string' },
        groups: { in: 'body', type: ['string'], description: 'The group ids assigned to the subscriber.' },
        subscriber_status: { in: 'body', type: 'string', enum: ['ACTIVE', 'UNSUBSCRIBED'],
          description: 'No page says whether ACTIVE subscribes again a person who unsubscribed. The page also takes BOUNCED and SPAM_REPORTED, which the entry does not offer.' },
        trigger_automation: automation } },
    'campaigns.list': { docs: `${ref}/campaigns/get-all/`, path: '/campaigns', paging: 'page', records: 'data', params: { limit },
      result: { data: [campaign] } },
    'campaigns.get': { docs: `${ref}/campaigns/get-one/`, path: '/campaigns/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true } }, result: { data: campaign } },
  },
});
