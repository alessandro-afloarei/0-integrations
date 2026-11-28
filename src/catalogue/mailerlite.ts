import { defineProvider } from '../catalogue.js';

/** MailerLite: an API key as Bearer, JSON on every request; no endpoint names the account, so identify only checks the
 * key. 120 requests a minute; a 429 may carry `Retry-After`: https://developers.mailerlite.com/getting-started
 * Webhooks sign the JSON payload with the webhook's secret (hex HMAC-SHA256 in `Signature`); no timestamp or delivery
 * id is named, and a failed delivery is retried: https://developers.mailerlite.com/api/webhooks */
const subscriber = { id: 'string', 'email?': 'string', 'status?': 'string', 'source?': 'string', 'subscribed_at?': 'string',
  'created_at?': 'string', 'updated_at?': 'string', 'fields?': 'unknown' } as const;
const campaign = { id: 'string', 'name?': 'string', 'type?': 'string', 'status?': 'string', 'created_at?': 'string',
  'updated_at?': 'string', 'scheduled_for?': 'string', 'finished_at?': 'string' } as const;
const fields = { fields: { in: 'body', type: 'unknown', description: 'Custom field values keyed by each field\'s key.' } } as const;
const ref = 'https://developers.mailerlite.com/api';

export const mailerlite = defineProvider({
  id: 'mailerlite', name: 'MailerLite', docs: 'https://developers.mailerlite.com/getting-started',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Generate it in MailerLite under Integrations, MailerLite API. A key is bound to the user who created it and stops working if that user is removed.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://connect.mailerlite.com/api', headers: { 'content-type': 'application/json', accept: 'application/json' },
    retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/groups', query: { limit: '1' } } },
  webhook: { kind: 'hmac', header: 'signature' },
  // Groups and campaigns page by number, "Counting starts from 1"; subscribers by `meta.next_cursor`.
  paging: { cursor: { kind: 'cursor', next: 'meta.next_cursor', send: { query: 'cursor' } },
    page: { kind: 'page', send: { query: 'page' }, list: 'data' } },
  operations: {
    'groups.list': { docs: `${ref}/groups#list-all-groups`, path: '/groups', paging: 'page', records: 'data',
      params: { 'filter[name]': { in: 'query', type: 'string' },
        limit: { in: 'query', type: 'integer', description: '1000 by default, the most groups an account can have.' } },
      result: { data: [{ id: 'string', 'name?': 'string', 'active_count?': 'integer', 'created_at?': 'string' }] } },
    'subscribers.list': { docs: `${ref}/subscribers#list-all-subscribers`, path: '/subscribers', paging: 'cursor', records: 'data',
      params: { 'filter[status]': { in: 'query', type: 'string',
        description: 'One or several of active, unsubscribed, unconfirmed, bounced and junk, separated by commas.' },
      'filter[group]': { in: 'query', type: 'string', description: 'A group id or name.' },
      limit: { in: 'query', type: 'integer', description: '25 by default, at most 1000.' } },
      result: { data: [subscriber] } },
    'subscribers.get': { docs: `${ref}/subscribers#fetch-a-subscriber`, path: '/subscribers/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true, description: 'A subscriber id or an email address.' } },
      result: { data: subscriber } },
    // An upsert: an existing email address is updated, its omitted fields and groups kept. On an account with double
    // opt-in a new subscriber starts unconfirmed and receives a confirmation email, which no parameter stops; a group
    // can start automations for the people who join it (https://developers.mailerlite.com/api/groups).
    'subscribers.create': { docs: `${ref}/subscribers#createupsert-subscriber`, method: 'POST', path: '/subscribers', kind: 'write',
      params: { email: { in: 'body', type: 'string', required: true }, ...fields,
        groups: { in: 'body', type: ['string'], description: 'Group ids to add the subscriber to; none is removed.' },
        status: { in: 'body', type: 'string', enum: ['active', 'unsubscribed', 'unconfirmed', 'bounced'],
          description: 'New subscribers default to active, or unconfirmed with double opt-in; junk is not offered. For an existing unsubscribed, bounced or junk subscriber the request fails with 422 if status is left out; active is ignored and any other status is applied (resubscribe, which reactivates them, is not declared; subscribers.update changes their other fields).' } },
      result: { data: subscriber } },
    // Adding a group or changing a field can start an automation the account set up, which can email the subscriber:
    // https://developers.mailerlite.com/api/automation-triggers
    'subscribers.update': { docs: `${ref}/subscribers#update-a-subscriber`, method: 'PUT', path: '/subscribers/{id}',
      params: { id: { in: 'path', type: 'string', required: true }, email: { in: 'body', type: 'string' }, ...fields,
        groups: { in: 'body', type: ['string'], description: 'The complete set of group ids: the subscriber leaves any group not listed.' },
        status: { in: 'body', type: 'string', enum: ['active', 'unsubscribed', 'bounced'],
          description: 'unconfirmed and junk are not offered. Setting active on an unsubscribed, bounced or junk subscriber is ignored.' } },
      result: { data: subscriber } },
    'campaigns.list': { docs: `${ref}/campaigns#campaign-list`, path: '/campaigns', paging: 'page', records: 'data',
      params: { 'filter[status]': { in: 'query', type: 'string', enum: ['sent', 'draft', 'ready'],
        description: 'Without it every status is returned (unless another filter is set, which then returns ready ones).' },
      limit: { in: 'query', type: 'integer', description: '25 by default, at most 100.' } },
      result: { data: [campaign] } },
    'campaigns.get': { docs: `${ref}/campaigns#get-a-campaign`, path: '/campaigns/{campaign_id}', notFound: 'null',
      params: { campaign_id: { in: 'path', type: 'string', required: true } }, result: { data: campaign } },
    // Creates a draft campaign; it is not sent until scheduled, which this entry does not declare.
    'campaigns.create': { docs: `${ref}/campaigns#create-a-campaign`, method: 'POST', path: '/campaigns',
      params: { name: { in: 'body', type: 'string', required: true },
        type: { in: 'body', type: 'regular', required: true,
          description: 'A single email; the A/B, resend and multivariate types need settings this entry does not declare.' },
        emails: { in: 'body', type: [{ subject: 'string', from_name: 'string', from: 'string', 'reply_to?': 'string', 'content?': 'string' }],
          required: true, description: 'One email; from must already be verified on MailerLite.' },
        groups: { in: 'body', type: ['string'] },
        segments: { in: 'body', type: ['string'], description: 'Segment ids, used instead of groups when both are given.' } },
      result: { data: campaign } },
  },
});
