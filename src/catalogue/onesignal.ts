import { defineProvider } from '../catalogue.js';

/** OneSignal: an App API key as `Key <key>`, on its app's own path; identify reads the app. A 429 is retried only after
 * its `Retry-After`: https://documentation.onesignal.com/reference/rate-limits. `users.create` makes a user or changes an
 * existing user's subscriptions (no page names a message it sends); a custom event can enter users into Journeys:
 * https://documentation.onesignal.com/reference/rest-api-overview */
const ref = 'https://documentation.onesignal.com/reference';
const alias = { alias_label: { in: 'path', type: 'string', required: true,
  description: 'The alias that finds the user: external_id, onesignal_id or a custom alias.' },
alias_id: { in: 'path', type: 'string', required: true } } as const;
const properties = { 'tags?': 'unknown', 'language?': 'string', 'timezone_id?': 'string', 'country?': 'string' } as const;
const user = { 'identity?': { 'external_id?': 'string', 'onesignal_id?': 'string' },
  'properties?': { ...properties, 'first_active?': 'integer', 'last_active?': 'integer' },
  'subscriptions?': [{ id: 'string', 'type?': 'string', 'token?': 'string', 'enabled?': 'boolean' }] } as const;

export const onesignal = defineProvider({
  id: 'onesignal', name: 'OneSignal', docs: 'https://documentation.onesignal.com/docs/en/keys-and-ids',
  categories: ['marketing'],
  fields: [{ name: 'appId', title: 'App ID', help: 'Your OneSignal app\'s App ID, a public UUID, in Settings > Keys & IDs.' },
    { name: 'apiKey', title: 'App API key', secret: true,
      help: 'An App API key of that app, from its Settings > Keys & IDs (it starts with os_v2_app_ and is shown once), not an Organization API key.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Key {apiKey}' } }],
  // View an app (identify) marks Content-Type required.
  http: { baseUrl: 'https://api.onesignal.com/apps/{appId}', headers: { 'content-type': 'application/json' },
    retry: { onlyStated: true } },
  identify: { request: { query: { view: 'config' } }, id: 'id', name: 'name' },
  paging: { segments: { kind: 'offset', send: { query: 'offset' }, list: 'segments' } },
  operations: {
    'segments.list': { docs: `${ref}/view-segments`, path: '/segments', paging: 'segments', records: 'segments',
      params: { limit: { in: 'query', type: 'integer', description: '300 by default, at most 300.' } },
      result: { segments: [{ id: 'string', 'name?': 'string', 'description?': 'string', 'is_active?': 'boolean', 'read_only?': 'boolean',
        'created_at?': 'string', 'updated_at?': 'string' }] } },
    'users.get': { docs: `${ref}/view-user`, path: '/users/by/{alias_label}/{alias_id}', notFound: 'null', params: alias, result: user },
    'users.create': { docs: `${ref}/create-user`, method: 'POST', path: '/users',
      anyOf: [['identity.external_id'], ['subscriptions']],
      params: { identity: { in: 'body', type: { 'external_id?': 'string' },
        description: 'external_id, the user\'s main id, unique across users.' },
      properties: { in: 'body', type: properties, description: 'tags: string keys and values.' },
      subscriptions: { in: 'body', type: [{ type: 'string', token: 'string', 'enabled?': 'boolean' }],
        description: 'Each subscription a type (Email, SMS, iOSPush, AndroidPush, ChromePush and the other push types) and its token: the email address, the E.164 phone number or the push token.' } },
      result: user },
    'users.update': { docs: `${ref}/update-user`, method: 'PATCH', path: '/users/by/{alias_label}/{alias_id}',
      params: { ...alias, properties: { in: 'body', type: properties, description: 'tags: string keys and values.' } },
      result: { 'properties?': properties } },
    'events.create': { docs: `${ref}/create-custom-events`, method: 'POST', path: '/custom_events',
      params: { events: { in: 'body', required: true, type: [{ name: 'string', 'external_id?': 'string', 'onesignal_id?': 'string',
        'timestamp?': 'string', 'idempotency_key?': 'string', 'properties?': 'unknown' }],
      description: 'Each event names its user by external_id or onesignal_id; timestamp is ISO 8601; an event repeated with the same idempotency_key is not processed again.' } } },
  },
});
