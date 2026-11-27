import { defineProvider } from '../catalogue.js';

/** Calendly: OAuth 2 with PKCE, its app made alone in Developer tools; a booking emails the invitee and sends calendar
 * invites as a booking on Calendly does. A 429 waits `X-RateLimit-Reset`, seconds, as the page asks:
 * https://developer.calendly.com/api-docs/overview/rate-limits; webhooks sign `t.body`:
 * https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures */
const eventType = { uri: 'string', 'name?': 'string', active: 'boolean', 'slug?': 'string', scheduling_url: 'string',
  duration: 'number', created_at: 'string', updated_at: 'string' } as const;
const event = { uri: 'string', 'name?': 'string', status: 'string', start_time: 'string', end_time: 'string',
  event_type: 'string', created_at: 'string', updated_at: 'string' } as const;
const invitee = { uri: 'string', email: 'string', name: 'string', status: 'string', event: 'string', 'timezone?': 'string',
  created_at: 'string', updated_at: 'string' } as const;
const count = { count: { in: 'query', type: 'integer', description: '20 by default, at most 100.' } } as const;
const ref = 'https://developer.calendly.com/api-docs/calendly-api';

export const calendly = defineProvider({
  id: 'calendly', name: 'Calendly', docs: 'https://developer.calendly.com/docs/authentication/creating-an-oauth-app',
  categories: ['calendar'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For your own or your company\'s Calendly account: an app for other Calendly users connects with the OAuth 2 sign-in, as Calendly asks. Give it the scopes users:read, event_types:read and scheduled_events:write. An organization admin\'s token reaches everyone in the organization.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.calendly.com/oauth/authorize', tokenUrl: 'https://auth.calendly.com/oauth/token',
    clientAuth: { exchange: 'basic', refresh: 'basic' }, authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: ['users:read', 'event_types:read', 'scheduled_events:write'] },
  http: { baseUrl: 'https://api.calendly.com', retry: { onlyStated: true, wait: { header: 'x-ratelimit-reset', unit: 's' } } },
  identify: { request: { path: '/users/me' }, id: 'resource.uri', name: ['resource.name', 'resource.email'] },
  webhook: { kind: 'hmac', header: 'calendly-webhook-signature', signed: '{timestamp}.{body}', part: 'v1',
    timestamp: { part: 't', toleranceSeconds: 180 } },
  paging: { next: { kind: 'nextUrl', next: 'pagination.next_page' } },
  operations: {
    'eventTypes.list': { docs: `${ref}/event-types/list-event-types`, path: '/event_types', paging: 'next', records: 'collection',
      anyOf: [['organization'], ['user']],
      params: { organization: { in: 'query', type: 'string', description: 'The organization\'s URI.' },
        user: { in: 'query', type: 'string', description: 'The user\'s URI.' }, active: { in: 'query', type: 'boolean' }, ...count },
      result: { collection: [eventType] } },
    'scheduledEvents.list': { docs: `${ref}/scheduled-events/list-scheduled-events`, path: '/scheduled_events', paging: 'next',
      records: 'collection',
      params: { user: { in: 'query', type: 'string', description: 'The user\'s URI; alone, only your own events.' },
        organization: { in: 'query', type: 'string', description: 'The organization\'s URI (an admin or owner).' },
        invitee_email: { in: 'query', type: 'string' }, status: { in: 'query', type: 'string', enum: ['active', 'canceled'] },
        min_start_time: { in: 'query', type: 'string' }, max_start_time: { in: 'query', type: 'string' }, ...count },
      result: { collection: [event] } },
    'scheduledEvents.get': { docs: `${ref}/scheduled-events/get-scheduled-event`, path: '/scheduled_events/{uuid}', notFound: 'null',
      params: { uuid: { in: 'path', type: 'string', required: true } }, result: { resource: event } },
    'invitees.create': { docs: `${ref}/scheduled-events/create-event-invitee`, method: 'POST', path: '/invitees', kind: 'write',
      anyOf: [['invitee.name'], ['invitee.first_name']],
      params: { event_type: { in: 'body', type: 'string', required: true, description: 'The event type\'s URI.' },
        start_time: { in: 'body', type: 'string', required: true, description: 'In UTC.' },
        invitee: { in: 'body', required: true,
          type: { email: 'string', timezone: 'string', 'name?': 'string', 'first_name?': 'string', 'last_name?': 'string' } },
        location: { in: 'body', type: 'unknown' }, questions_and_answers: { in: 'body', type: ['unknown'] },
        event_guests: { in: 'body', type: ['string'], description: 'At most 10.' } },
      result: { resource: invitee } },
  },
});
