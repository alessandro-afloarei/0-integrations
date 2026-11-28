import { defineProvider } from '../catalogue.js';

/** Omnisend: the brand's API key; its OAuth 2 credentials come only from Omnisend, by a form
 * (https://api-docs.omnisend.com/reference/oauth). Pinned to version 2026-03-15. A 429 waits the body's `retryAfter`
 * (seconds), else its per-brand window's minute: https://api-docs.omnisend.com/reference/rate-limit-timeouts-errors
 * Segments are the audience. Nothing here sends a campaign; webhooks are not declared. */
const contact = { id: 'string', 'email?': 'string', 'firstName?': 'string', 'lastName?': 'string', 'status?': 'string',
  'tags?': ['string'], 'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const channel = { status: 'string', 'statusChangedAt?': 'string' } as const;
const written = { firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string' },
  tags: { in: 'body', type: ['string'] },
  identifiers: { in: 'body', type: [{ id: 'string', type: 'string', 'channels?': { 'email?': channel, 'sms?': channel },
    'sendWelcomeMessage?': 'boolean' }],
  description: 'Each an email or a phone (type email or phone; E.164 with its country code), its channel (email for an email, sms for a phone) subscribed, unsubscribed or nonSubscribed. The status with the latest status date is kept, and one dated earlier than the stored one is not applied; no page says more about setting subscribed on a contact who unsubscribed. sendWelcomeMessage false sends no welcome message for it (true by default, when the welcome workflow is on).' } } as const;
const campaign = { id: 'string', 'name?': 'string', 'status?': 'string', 'channel?': 'string', 'type?': 'string',
  'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const ref = 'https://api-docs.omnisend.com/reference';

export const omnisend = defineProvider({
  id: 'omnisend', name: 'Omnisend', docs: `${ref}/authentication`,
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From the API keys section of your Omnisend brand. Every key, token and integration of the brand shares its rate limit.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Omnisend-API-Key {apiKey}' } }],
  http: { baseUrl: 'https://api.omnisend.com/api', headers: { 'omnisend-version': '2026-03-15' },
    retry: { defaultWaitMs: 60_000, wait: { path: 'retryAfter', unit: 's' } } },
  identify: { request: { path: '/brands/current' }, id: 'brandID', name: 'name' },
  paging: { after: { kind: 'cursor', next: 'paging.cursors.after', more: 'paging.hasMore', send: { query: 'after' } } },
  operations: {
    'segments.list': { docs: `${ref}/get_segments`, path: '/segments', paging: 'after', records: 'segments',
      params: { limit: { in: 'query', type: 'integer', description: '50 by default, 1 to 250.' } },
      result: { segments: [{ segmentID: 'string', 'name?': 'string', 'status?': 'string', 'url?': 'string', 'createdAt?': 'string',
        'updatedAt?': 'string' }] } },
    'contacts.list': { docs: `${ref}/get_contacts`, path: '/contacts', paging: 'after', records: 'contacts',
      params: { limit: { in: 'query', type: 'integer', description: '100 by default, 1 to 250.' },
        email: { in: 'query', type: 'string' }, segmentID: { in: 'query', type: 'string' },
        status: { in: 'query', type: 'string', enum: ['subscribed', 'unsubscribed', 'nonSubscribed'], description: 'Not with tag.' },
        tag: { in: 'query', type: 'string', description: 'Not with status.' } },
      result: { contacts: [contact] } },
    'contacts.get': { docs: `${ref}/get_contacts-id`, path: '/contacts/{id}', notFound: 'null', params: id, result: contact },
    // An upsert: a contact with the email given is updated. An identifier sends a welcome message when the welcome
    // workflow is on, unless its `sendWelcomeMessage` is false; a contact that enters a segment starts the automations
    // triggered on it: https://api-docs.omnisend.com/reference/post_automations
    'contacts.create': { docs: `${ref}/post_contacts`, method: 'POST', path: '/contacts', kind: 'write', params: written, result: contact },
    // An identifier added here sends a welcome message as on create, unless its `sendWelcomeMessage` is false; a
    // contact that enters a segment starts its automations, as on create.
    'contacts.update': { docs: `${ref}/patch_contacts-id`, method: 'PATCH', path: '/contacts/{id}', kind: 'write', params: { ...id, ...written },
      result: contact },
    'campaigns.list': { docs: `${ref}/get_campaigns`, path: '/campaigns', paging: 'after', records: 'campaigns',
      params: { limit: { in: 'query', type: 'integer', description: '100 by default, 1 to 250.' },
        view: { in: 'query', type: 'summary', description: 'summary leaves out each campaign\'s content and A/B test sections.' } },
      result: { campaigns: [campaign] } },
    'campaigns.get': { docs: `${ref}/get_campaigns-id`, path: '/campaigns/{id}', notFound: 'null', params: id, result: campaign },
    // A contact's event can trigger the automations that start on it, which may email or text the contact.
    'events.create': { docs: `${ref}/post_events`, method: 'POST', path: '/events', kind: 'write',
      params: { eventName: { in: 'body', type: 'string', required: true },
        origin: { in: 'body', type: 'string', required: true, description: 'api for your own store; an app sets its own name.' },
        contact: { in: 'body', required: true, type: { 'id?': 'string', 'email?': 'string', 'phone?': 'string' },
          description: 'Created or updated from what is given here.' },
        properties: { in: 'body', type: 'unknown' }, eventTime: { in: 'body', type: 'string', description: 'ISO 8601; now by default.' },
        eventVersion: { in: 'body', type: 'string',
          description: 'Only for a recommended event, its documented version; leave it out for a custom event.' },
        eventID: { in: 'body', type: 'string', description: 'A UUID; with eventTime it dedupes historical events, not real-time ones.' } },
      anyOf: [['contact.id'], ['contact.email'], ['contact.phone']] },
  },
});
