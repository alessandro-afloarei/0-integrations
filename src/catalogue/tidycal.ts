import { defineProvider } from '../catalogue.js';

/** TidyCal: a personal access token; its sign-in checks the credential, `/me` naming no id. A booking emails the
 * booker. A 429 waits its `Retry-After`; webhooks sign `t.body`, on the reference page too. */
const booking = { id: 'integer', 'booking_type_id?': 'integer', 'starts_at?': 'string', 'ends_at?': 'string',
  'cancelled_at?': 'string', 'timezone?': 'string', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const ref = 'https://tidycal.com/developer/docs#tag';

export const tidycal = defineProvider({
  id: 'tidycal', name: 'TidyCal', docs: 'https://tidycal.com/developer/docs',
  categories: ['calendar'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For your own TidyCal account (Integrations, Advanced, Manage API keys, Personal tokens): an integration that other people sign in to needs its own OAuth 2.0 client.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://tidycal.com/api', retry: {} },
  identify: { request: { path: '/me' } },
  webhook: { kind: 'hmac', header: 'tidycal-signature', signed: '{timestamp}.{body}', part: 'v1', timestamp: { part: 't' },
    deliveryId: { header: 'tidycal-event-id' } },
  paging: { next: { kind: 'nextUrl', next: 'next_page_url' } },
  operations: {
    'bookingTypes.list': { docs: `${ref}/Booking-Types/operation/list-booking-types`, path: '/booking-types', paging: 'next',
      records: 'data', result: { data: [{ id: 'integer', 'title?': 'string', 'url_slug?': 'string', 'duration_minutes?': 'integer',
        'url?': 'string', 'disabled_at?': 'string', 'created_at?': 'string', 'updated_at?': 'string' }] } },
    'bookings.list': { docs: `${ref}/Bookings/operation/list-bookings`, path: '/bookings', paging: 'next', records: 'data',
      params: { starts_at: { in: 'query', type: 'string', description: 'Bookings starting from this ISO 8601 time.' },
        ends_at: { in: 'query', type: 'string', description: 'Bookings ending before this ISO 8601 time.' },
        cancelled: { in: 'query', type: 'boolean', description: 'Only cancelled bookings.' } },
      result: { data: [booking] } },
    'bookings.get': { docs: `${ref}/Bookings/operation/get-booking`, path: '/bookings/{booking}', notFound: 'null',
      params: { booking: { in: 'path', type: 'integer', required: true } }, result: booking },
    'bookings.create': { docs: `${ref}/Booking-Types/operation/create-booking`, method: 'POST', path: '/booking-types/{bookingType}/bookings',
      kind: 'write', anyOf: [['starts_at'], ['bookings']],
      params: { bookingType: { in: 'path', type: 'integer', required: true }, name: { in: 'body', type: 'string', required: true },
        email: { in: 'body', type: 'string', required: true }, timezone: { in: 'body', type: 'string', required: true },
        starts_at: { in: 'body', type: 'string', description: 'In UTC, for one booking.' },
        bookings: { in: 'body', type: [{ starts_at: 'string' }], description: 'The sessions of a package booking.' },
        booking_questions: { in: 'body', type: ['unknown'] }, coupon_code: { in: 'body', type: 'string' } },
      result: { data: 'unknown' } },
  },
});
