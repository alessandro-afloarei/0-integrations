import { defineProvider } from '../catalogue.js';

/** Kit (formerly ConvertKit) API v4: OAuth 2 for apps, the V4 API key for your own account. A connection made before
 * the app is published is an "unverified app" (https://developers.kit.com/kit-app-store/authentication). Kit has no
 * lists: subscribers are the account's, tags segment them. A 429 has no `Retry-After`; "A wait of up to 60 seconds
 * resets the limit": https://developers.kit.com/api-reference/rate-limits */
const subscriber = { id: 'integer', 'first_name?': 'string', email_address: 'string', state: 'string', created_at: 'string',
  'fields?': 'unknown' } as const;
const broadcast = { id: 'integer', 'subject?': 'string', 'public?': 'boolean', 'published_at?': 'string', 'send_at?': 'string',
  'public_url?': 'string', 'created_at?': 'string', 'status?': 'string' } as const;
const id = { id: { in: 'path', type: 'integer', required: true } } as const;
const perPage = { per_page: { in: 'query', type: 'integer', description: '500 by default, at most 1000.' } } as const;
const written = { first_name: { in: 'body', type: 'string' },
  fields: { in: 'body', type: 'unknown', description: 'Custom field values keyed by each custom field\'s key.' } } as const;
const ref = 'https://developers.kit.com/api-reference';

export const kit = defineProvider({
  id: 'kit', name: 'Kit', docs: 'https://developers.kit.com/api-reference/authentication',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'V4 API key', secret: true,
    help: 'For your own Kit account, from the Developer tab of your account settings: Kit supports no app that relies on API keys, and an app for other creators connects with the OAuth 2 sign-in. The account\'s plan must be eligible for the API.' }],
  // The token requests are JSON (https://developers.kit.com/api-reference/oauth-refresh-token-flow); the RFC 7009
  // revoke takes a form, which beside them this entry cannot send, so it declares none.
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.kit.com/v4/oauth/authorize', tokenUrl: 'https://api.kit.com/v4/oauth/token',
    json: true, authorizeParams: { response_type: 'code' } }, { kind: 'key', send: { header: 'x-kit-api-key' } }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.kit.com/v4', retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/account' }, id: 'account.id', name: ['account.name', 'user.email'] },
  // `v1` is a hex HMAC-SHA256 of `{t}.{raw_body}` keyed with the endpoint's secret; `delivery_id` is reused by a retry:
  // https://developers.kit.com/webhooks/verifying-signatures, https://developers.kit.com/webhooks/delivery-format
  webhook: { kind: 'hmac', header: 'x-kit-signature', part: 'v1', timestamp: { part: 't' }, signed: '{timestamp}.{body}',
    deliveryId: { body: ['delivery_id'] } },
  paging: { cursor: { kind: 'cursor', next: 'pagination.end_cursor', more: 'pagination.has_next_page', send: { query: 'after' } } },
  operations: {
    'tags.list': { docs: `${ref}/tags/list-tags`, path: '/tags', paging: 'cursor', records: 'tags', params: perPage,
      result: { tags: [{ id: 'integer', name: 'string', created_at: 'string' }] } },
    'subscribers.list': { docs: `${ref}/subscribers/list-subscribers`, path: '/subscribers', paging: 'cursor', records: 'subscribers',
      params: { email_address: { in: 'query', type: 'string' },
        status: { in: 'query', type: 'string', enum: ['active', 'inactive', 'bounced', 'complained', 'cancelled', 'all'],
          description: 'active by default.' }, ...perPage }, result: { subscribers: [subscriber] } },
    'subscribers.get': { docs: `${ref}/subscribers/get-a-subscriber`, path: '/subscribers/{id}', notFound: 'null', params: id,
      result: { subscriber } },
    // An upsert: an existing email address has its first name updated. The page names no email this call sends.
    'subscribers.create': { docs: `${ref}/subscribers/create-a-subscriber`, method: 'POST', path: '/subscribers',
      params: { email_address: { in: 'body', type: 'string', required: true }, ...written,
        state: { in: 'body', type: 'string', enum: ['active', 'inactive', 'cancelled', 'bounced'],
          description: 'The state a new subscriber is created in, active by default; complained is not offered.' } },
      result: { subscriber } },
    'subscribers.update': { docs: `${ref}/subscribers/update-a-subscriber`, method: 'PUT', path: '/subscribers/{id}',
      params: { ...id, email_address: { in: 'body', type: 'string', required: true }, ...written }, result: { subscriber } },
    'broadcasts.list': { docs: `${ref}/broadcasts/list-broadcasts`, path: '/broadcasts', paging: 'cursor', records: 'broadcasts',
      params: { status: { in: 'query', type: 'string', enum: ['draft', 'scheduled', 'sending', 'completed', 'aborted'] }, ...perPage },
      result: { broadcasts: [broadcast] } },
    'broadcasts.get': { docs: `${ref}/broadcasts/get-a-broadcast`, path: '/broadcasts/{id}', notFound: 'null', params: id,
      result: { broadcast } },
    // A draft when `send_at` is null; a time schedules the send for then. The call itself sends nothing, and `public`
    // is fixed false, so nothing is published to the web.
    'broadcasts.create': { docs: `${ref}/broadcasts/create-a-broadcast`, method: 'POST', path: '/broadcasts',
      params: { subject: { in: 'body', type: 'string', required: true }, content: { in: 'body', type: 'string', required: true,
        description: 'The email\'s HTML.' }, description: { in: 'body', type: 'string', required: true },
      preview_text: { in: 'body', type: 'string', required: true },
      published_at: { in: 'body', type: 'string', required: true, description: 'The published timestamp to display, ISO 8601.' },
      public: { in: 'body', type: false, required: true },
      send_at: { in: 'body', type: 'string', required: true, nullable: true,
        description: 'null saves a draft; a future ISO 8601 time schedules the broadcast to send to its subscribers then.' },
      subscriber_filter: { in: 'body', type: [{ 'all?': [{ type: 'string', ids: ['integer'] }], 'any?': [{ type: 'string', ids: ['integer'] }],
        'none?': [{ type: 'string', ids: ['integer'] }] }],
      description: 'One filter group (all, any or none) of segment or tag ids, each `type` segment or tag; all subscribers when left out (the schema marks it required).' } },
      result: { broadcast } },
  },
});
