import { defineProvider } from '../catalogue.js';

/** Acuity Scheduling: OAuth 2 (a client needs a paid plan: https://secure.acuityscheduling.com/oauth2/register; no
 * refresh), or the API key with the User ID: https://developers.acuityscheduling.com/reference/quick-start. Lists are
 * unpaged; a booking sends confirmations unless `noEmail`. A 429 waits its one-second window; errors name a code:
 * https://developers.acuityscheduling.com/reference/api-errors */
const appointment = { id: 'integer', 'datetime?': 'string', 'endTime?': 'string', 'type?': 'string', 'appointmentTypeID?': 'integer',
  'calendarID?': 'integer', 'email?': 'string', 'confirmationPage?': 'string' } as const;
const ref = 'https://developers.acuityscheduling.com/reference';

export const acuity = defineProvider({
  id: 'acuity', name: 'Acuity Scheduling', docs: 'https://developers.acuityscheduling.com/docs/oauth2',
  categories: ['calendar'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://acuityscheduling.com/oauth2/authorize', tokenUrl: 'https://acuityscheduling.com/oauth2/token',
    pkce: false, authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { basic: ['{userId}', '{apiKey}'] }, fields: [{ name: 'userId', title: 'User ID', help: 'Your numeric User ID, under Integrations in Acuity.' },
    { name: 'apiKey', title: 'API key', secret: true,
      help: 'Under Integrations in Acuity: for one Acuity account. An app that many Acuity users connect to uses the OAuth 2 sign-in, as Acuity recommends.' }] }],
  scopes: { default: ['api-v1'] },
  http: { baseUrl: 'https://acuityscheduling.com/api/v1', retry: { defaultWaitMs: 1_000 } },
  identify: { request: { path: '/me' }, id: 'id', name: ['name', 'email'] },
  errors: { detail: 'error' },
  operations: {
    'appointmentTypes.list': { docs: `${ref}/appointment-types`, path: '/appointment-types',
      params: { includeDeleted: { in: 'query', type: 'boolean' } },
      result: [{ id: 'integer', 'name?': 'string', 'active?': 'string', 'duration?': 'integer', 'type?': 'string', 'private?': 'boolean',
        'category?': 'string', 'calendarIDs?': ['integer'] }] },
    'appointments.list': { docs: `${ref}/get-appointments`, path: '/appointments',
      params: { max: { in: 'query', type: 'integer', description: 'The most appointments answered: 100 by default (one answer, unpaged).' },
        minDate: { in: 'query', type: 'string' }, maxDate: { in: 'query', type: 'string' },
        calendarID: { in: 'query', type: 'integer' }, appointmentTypeID: { in: 'query', type: 'integer' },
        canceled: { in: 'query', type: 'boolean', description: 'Canceled appointments only; left out by default.' } },
      result: [appointment] },
    'appointments.get': { docs: `${ref}/get-appointments-id`, path: '/appointments/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'integer', required: true } }, result: appointment },
    'appointments.create': { docs: `${ref}/post-appointments`, method: 'POST', path: '/appointments', kind: 'write',
      params: { datetime: { in: 'body', type: 'string', required: true }, appointmentTypeID: { in: 'body', type: 'integer', required: true },
        firstName: { in: 'body', type: 'string', required: true }, lastName: { in: 'body', type: 'string', required: true },
        email: { in: 'body', type: 'string', required: true }, calendarID: { in: 'body', type: 'integer' }, phone: { in: 'body', type: 'string' },
        timezone: { in: 'body', type: 'string' }, certificate: { in: 'body', type: 'string' }, fields: { in: 'body', type: ['unknown'] },
        noEmail: { in: 'query', type: 'boolean', description: 'true sends no confirmation email or SMS.' } },
      result: appointment },
  },
});
