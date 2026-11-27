import { defineProvider } from '../catalogue.js';

/** Cal.com cloud, the API key alone (OAuth clients wait for review): https://cal.com/docs/api-reference/v2/oauth
 * (its example calls api.cal.com/v2/me: https://cal.com/docs/api-reference/v2/me/get-my-profile). Each operation
 * names its own `cal-api-version`, these two 2026-02-25. A booking sends the attendee its confirmation. Webhooks sign
 * the body: https://cal.com/docs/features/workflow-webhooks, https://cal.com/help/webhooks */
const ref = 'https://cal.com/docs/api-reference/v2/bookings';

export const calcom = defineProvider({
  id: 'calcom', name: 'Cal.com', docs: 'https://cal.com/docs/api-reference/v2/introduction',
  categories: ['calendar'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Under Settings, then Security (cal_live_… for live data, cal_… in test mode). Cal.com recommends OAuth for an app other people use; its OAuth clients wait for Cal.com\'s review.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.cal.com', headers: { 'cal-api-version': '2026-02-25' } },
  identify: { request: { path: '/v2/me' }, id: 'data.id', name: ['data.name', 'data.email'] },
  webhook: { kind: 'hmac', header: 'x-cal-signature-256' },
  operations: {
    'bookings.get': { docs: `${ref}/get-a-booking`, path: '/v2/bookings/{bookingUid}',
      params: { bookingUid: { in: 'path', type: 'string', required: true } }, result: { status: 'string', data: 'unknown' } },
    'bookings.create': { docs: `${ref}/create-a-booking`, method: 'POST', path: '/v2/bookings', kind: 'write',
      anyOf: [['eventTypeId'], ['eventTypeSlug', 'username'], ['eventTypeSlug', 'teamSlug'], ['usernames']],
      params: { start: { in: 'body', type: 'string', required: true, description: 'ISO 8601, in UTC.' },
        attendee: { in: 'body', type: { name: 'string', timeZone: 'string', 'email?': 'string', 'phoneNumber?': 'string', 'language?': 'string' } },
        eventTypeId: { in: 'body', type: 'number' }, eventTypeSlug: { in: 'body', type: 'string' }, username: { in: 'body', type: 'string' },
        teamSlug: { in: 'body', type: 'string' }, organizationSlug: { in: 'body', type: 'string' },
        usernames: { in: 'body', type: ['string'], description: 'A dynamic group booking: 2 to 20 hosts, no event type.' },
        guests: { in: 'body', type: ['string'], description: 'Guest emails.' }, lengthInMinutes: { in: 'body', type: 'number' },
        location: { in: 'body', type: 'unknown' }, bookingFieldsResponses: { in: 'body', type: 'unknown' } },
      result: { status: 'string', data: 'unknown' } },
  },
});
