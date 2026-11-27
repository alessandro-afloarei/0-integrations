import { defineProvider } from '../catalogue.js';

/** PagerDuty: OAuth 2 (Classic User OAuth, Bearer) or an API token as `Token token=`; every account's requests, EU ones
 * too, go to api.pagerduty.com (https://docs.pagerduty.com/developer/rest-api-overview). A created or reopened incident
 * notifies its on-call users (https://docs.pagerduty.com/developer/api-concepts). Webhooks: `v1=` hex HMAC-SHA256
 * pieces, deduped on the signed body's `event.id` (`X-Webhook-Id` is not signed). */
const incident = { id: 'string', 'title?': 'string', 'status?': 'string', 'html_url?': 'string', 'created_at?': 'string',
  'updated_at?': 'string', 'service?': { 'id?': 'string' } } as const;
const limit = { limit: { in: 'query', type: 'integer', description: 'Results per page, at most 100.' } } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const from = { from: { in: 'header', type: 'string', required: true,
  description: 'The email address of a valid user associated with the account making the request.' } } as const;
const service = { id: 'string', type: 'string' } as const;
const rest = 'https://docs.pagerduty.com/developer/api/reference/rest';

export const pagerduty = defineProvider({
  id: 'pagerduty', name: 'PagerDuty', docs: 'https://docs.pagerduty.com/developer/authentication',
  categories: ['monitoring'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own PagerDuty account: an account API token with full access (a read-only one cannot create or update incidents; only account admins make one) or a user API token. An app for other people connects with the OAuth 2 sign-in.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://identity.pagerduty.com/oauth/authorize', tokenUrl: 'https://identity.pagerduty.com/oauth/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key', send: { header: 'authorization', value: 'Token token={token}' } }],
  scopes: { default: ['write'], requireGranted: true },
  // 960 requests a minute per key: https://docs.pagerduty.com/developer/rest-api-rate-limits/
  http: { baseUrl: 'https://api.pagerduty.com', headers: { accept: 'application/vnd.pagerduty+json;version=2' }, minIntervalMs: 63,
    retry: { defaultWaitMs: 60_000, wait: { header: 'ratelimit-reset', unit: 's' } } },
  errors: { detail: 'error.code' },
  identify: { request: { path: '/abilities' } },
  // Deduped on the signed body's `event.id`, "The unique id of the event": two subscriptions' copies of one event
  // dedupe as one. https://docs.pagerduty.com/developer/webhooks-overview
  webhook: { kind: 'hmac', header: 'x-pagerduty-signature', part: 'v1', deliveryId: { body: ['event.id'] } },
  // A list pages up to 10,000 records; past them PagerDuty answers 400 and the walk fails: narrow it with a filter.
  // https://docs.pagerduty.com/developer/pagination
  paging: { incidents: { kind: 'offset', send: { query: 'offset' }, list: 'incidents', more: 'more' },
    services: { kind: 'offset', send: { query: 'offset' }, list: 'services', more: 'more' } },
  operations: {
    'incidents.list': { docs: `${rest}/incidents/list-incidents`, path: '/incidents', paging: 'incidents', records: 'incidents',
      params: { 'service_ids[]': { in: 'query', type: 'string' }, ...limit }, result: { incidents: [incident] } },
    'incidents.get': { docs: `${rest}/incidents/get-incident`, path: '/incidents/{id}', notFound: 'null', params: id, result: { incident } },
    'incidents.create': { docs: `${rest}/incidents/create-incident`, method: 'POST', path: '/incidents',
      params: { ...from, incident: { in: 'body', required: true, type: { type: 'string', title: 'string', service },
        description: '`type` is `incident`, `service.type` is `service_reference`.' } }, result: { incident } },
    'incidents.update': { docs: `${rest}/incidents/update-incident`, method: 'PUT', path: '/incidents/{id}',
      params: { ...id, ...from, incident: { in: 'body', required: true,
        type: { type: 'string', 'status?': 'string', 'title?': 'string', 'service?': service },
        description: '`type` is `incident` or `incident_reference`; `status` is `triggered`, `acknowledged` or `resolved`; `service.type` is `service_reference`.' } },
      result: { incident } },
    'services.list': { docs: `${rest}/services/list-services`, path: '/services', paging: 'services', records: 'services',
      params: limit,
      result: { services: [{ id: 'string', 'name?': 'string', 'status?': 'string', 'html_url?': 'string', 'created_at?': 'string' }] } },
  },
});
