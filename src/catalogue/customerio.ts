import { defineProvider } from '../catalogue.js';

/** Customer.io App API: a private key, Bearer, on its region's host: https://docs.customer.io/files/journeys-app.json
 * No endpoint names the key's account, so a sign-in checks it. A 429 waits `Retry-After`, which a daily quota does not
 * set: https://docs.customer.io/integrations/api/customerio-apis. Segments are the audience. The Track API (people,
 * events) is not declared; nothing here sends a one-time send or triggers a broadcast. */
const hosts = ['api.customer.io', 'api-eu.customer.io'] as const;
const identifiers = { 'cio_id?': 'string', 'email?': 'string', 'id?': 'string' } as const;
const newsletter = { id: 'integer', 'name?': 'string', 'type?': 'string', 'send_state?': 'string', 'created?': 'integer',
  'updated?': 'integer', 'scheduled_at?': 'integer', 'sent_at?': 'integer' } as const;
const ref = 'https://docs.customer.io/integrations/api/app/tag';

export const customerio = defineProvider({
  id: 'customerio', name: 'Customer.io', docs: 'https://docs.customer.io/accounts/settings/managing-credentials',
  categories: ['marketing'],
  fields: [{ name: 'apiHost', title: 'Region', choices: hosts, default: 'api.customer.io',
    help: 'Where the account\'s data is: api.customer.io for the US, api-eu.customer.io for the EU (a key starting sk_eu_).' },
  { name: 'apiKey', title: 'Private API key', secret: true,
    help: 'A private key (sk_) from Account Settings, API Credentials, which needs the Manage API credentials permission; not one limited to audit logs. It is shown once, and reaches its one workspace.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}/v1', host: hosts, retry: { onlyStated: true } },
  errors: { detail: 'errors.0.code' },
  // Reporting webhooks: a hex HMAC-SHA256 of `v0:{timestamp}:{body}` keyed with the webhook's signing key; the page
  // states no tolerance, so the 300 s is this library's.
  // https://docs.customer.io/integrations/data-out/connections/webhooks
  webhook: { kind: 'hmac', header: 'x-cio-signature', signed: 'v0:{timestamp}:{body}', timestamp: { header: 'x-cio-timestamp' },
    deliveryId: { body: ['event_id'] } },
  identify: { request: { path: '/workspaces' } },
  paging: { start: { kind: 'cursor', next: 'next', send: { query: 'start' } } },
  operations: {
    'segments.list': { docs: `${ref}/segments/listSegments`, path: '/segments',
      result: { segments: [{ id: 'integer', 'name?': 'string', 'description?': 'string', 'type?': 'string', 'state?': 'string',
        'created_at?': 'integer', 'updated_at?': 'integer' }] } },
    'customers.search': { docs: `${ref}/customers/getPeopleFilter`, method: 'POST', path: '/customers', kind: 'read',
      paging: 'start', records: 'identifiers',
      params: { filter: { in: 'body', type: 'unknown', required: true,
        description: 'One of and, or, not, segment ({ id }) or attribute ({ field, operator: eq or exists, value }), nested.' },
      limit: { in: 'query', type: 'integer', description: '50 by default, at most 1000.' } },
      result: { identifiers: [{ cio_id: 'string', 'email?': 'string', 'id?': 'string' }] } },
    'customers.get': { docs: `${ref}/customers/getPersonAttributes`, path: '/customers/{customer_id}/attributes', notFound: 'null',
      params: { customer_id: { in: 'path', type: 'string', required: true,
        description: 'The person\'s id, or with id_type their email, phone or cio_id.' },
      id_type: { in: 'query', type: 'string', enum: ['id', 'email', 'phone', 'cio_id'],
        description: 'id by default; email and phone only where the workspace has them as identifiers.' } },
      result: { customer: { 'id?': 'string', 'identifiers?': identifiers, 'attributes?': 'unknown' } } },
    'newsletters.list': { docs: `${ref}/newsletters/listNewsletters`, path: '/newsletters', paging: 'start', records: 'newsletters',
      params: { limit: { in: 'query', type: 'integer' }, sort: { in: 'query', type: 'string', enum: ['asc', 'desc'] } },
      result: { newsletters: [newsletter] } },
    'newsletters.get': { docs: `${ref}/newsletters/getNewsletters`, path: '/newsletters/{newsletter_id}', notFound: 'null',
      params: { newsletter_id: { in: 'path', type: 'integer', required: true } }, result: { newsletter } },
  },
});
