import { defineProvider } from '../catalogue.js';

/** SavvyCal: OAuth 2, its app made alone under Settings > Developers, or a personal access token. The operations are in
 * https://api.savvycal.com/v1/spec. A booking emails the people on it, which no request can turn off:
 * https://docs.savvycal.com/emails-savvycal-sends */
const event = { id: 'string', summary: 'string', state: 'string', start_at: 'string', end_at: 'string', url: 'string',
  created_at: 'string', 'link?': { 'id?': 'string' } } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '20 by default, at most 100.' } } as const;
const ref = 'https://docs.savvycal.com/developers/v1/api';

export const savvycal = defineProvider({
  id: 'savvycal', name: 'SavvyCal', docs: 'https://docs.savvycal.com/developers/authentication',
  categories: ['calendar'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For testing and controlling your own SavvyCal account (pt_secret_…, from Developer Settings): an app acting for other people connects with the OAuth 2 sign-in.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://savvycal.com/oauth/authorize', tokenUrl: 'https://savvycal.com/oauth/token', pkce: false,
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.savvycal.com' },
  identify: { request: { path: '/v1/me' }, id: 'id', name: ['display_name', 'email'] },
  paging: { after: { kind: 'cursor', next: 'metadata.after', send: { query: 'after' } } },
  operations: {
    'links.list': { docs: `${ref}/list-scheduling-links`, path: '/v1/links', paging: 'after', records: 'entries',
      params: { state: { in: 'query', type: 'string', enum: ['active', 'pending', 'disabled', 'archived'],
        description: 'Active, pending and disabled links when left out.' }, ...limit },
      result: { entries: [{ id: 'string', name: 'string', slug: 'string', state: 'string', default_duration: 'integer',
        'private_name?': 'string', 'description?': 'string' }] } },
    'events.list': { docs: `${ref}/list-events`, path: '/v1/events', paging: 'after', records: 'entries',
      params: { link: { in: 'query', type: 'string', description: 'A link ID, or any (the default).' },
        period: { in: 'query', type: 'string', enum: ['past', 'upcoming', 'fixed', 'all'], description: 'upcoming by default.' },
        state: { in: 'query', type: 'string', enum: ['all', 'any', 'confirmed', 'canceled', 'awaiting_reschedule', 'awaiting_checkout',
          'checkout_expired', 'awaiting_approval', 'declined', 'tentative'] }, ...limit },
      result: { entries: [event] } },
    'events.get': { docs: `${ref}/get-event`, path: '/v1/events/{event_id}', notFound: 'null',
      params: { event_id: { in: 'path', type: 'string', required: true, description: 'The event\'s ID or UUID.' } }, result: event },
    'events.create': { docs: `${ref}/create-event`, method: 'POST', path: '/v1/links/{link_id}/events', kind: 'write',
      params: { link_id: { in: 'path', type: 'string', required: true },
        email: { in: 'body', type: 'string', required: true }, start_at: { in: 'body', type: 'string', required: true },
        end_at: { in: 'body', type: 'string', required: true }, time_zone: { in: 'body', type: 'string', required: true },
        display_name: { in: 'body', type: 'string', description: 'Required unless the link asks for first_name and last_name.' },
        first_name: { in: 'body', type: 'string' }, last_name: { in: 'body', type: 'string' }, phone_number: { in: 'body', type: 'string' },
        fields: { in: 'body', type: 'unknown', description: 'Answers to the link\'s custom fields.' } },
      result: event },
  },
});
