import { defineProvider } from '../catalogue.js';

/** Ortto: a custom API key in `X-Api-Key` on the instance's region; reads are POSTs too. No endpoint names the account:
 * identify checks the key on the audiences list. A 429 states its wait in `error.try-in-seconds` (seconds).
 * `people.create` creates people, subscribed to email by default, or updates existing ones; their fields and tags, and
 * an activity, can enter a person into journeys: https://help.ortto.com/a-733-journey-entry-criteria */
const ref = 'https://help.ortto.com';
/** The default, Australian and European service endpoints: https://help.ortto.com/a-250-api-reference */
const hosts = ['api.ap3api.com', 'api.au.ap3api.com', 'api.eu.ap3api.com'] as const;
const people = { in: 'body', required: true, type: [{ 'fields?': 'unknown', 'tags?': ['string'], 'unset_tags?': ['string'] }],
  description: 'Up to 100 people, each its person fields by field id (str::email, str::first, str:cm:<custom>), tags to apply and to remove; bol::p and bol::sp the email and SMS permissions (bol::p true sets a person\'s email permission back to true); null clears a field.' } as const;

export const ortto = defineProvider({
  id: 'ortto', name: 'Ortto', docs: `${ref}/a-223-developer-guide`,
  categories: ['marketing'],
  fields: [{ name: 'apiHost', title: 'Region', choices: hosts, default: 'api.ap3api.com',
    help: 'Your instance region: api.au.ap3api.com for Australia, api.eu.ap3api.com for Europe, api.ap3api.com for every other.' },
  { name: 'apiKey', title: 'Custom API key', secret: true,
    help: 'The private API key of a Custom API (advanced) data source in your Ortto account; Ortto asks for a separate key for each application. Its Merge strategy setting (the default merge_by fields) applies when a request names none.' }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://{apiHost}/v1', host: hosts, headers: { 'content-type': 'application/json' },
    // https://help.ortto.com/a-235-rate-limits
    retry: { wait: { path: 'error.try-in-seconds', unit: 's' } } },
  errors: { detail: 'error.code' },
  identify: { request: { method: 'POST', path: '/audiences/get' } },
  // The Basic auth username and password set on the webhook in Ortto; nothing is signed, and Ortto names campaign_id,
  // contact_id and run_id together as the dedupe key: https://help.ortto.com/a-251-configuring-a-webhook
  webhook: { kind: 'basic' },
  paging: { people: { kind: 'offset', send: { body: 'offset' }, list: 'contacts', more: 'has_more' },
    audiences: { kind: 'offset', send: { body: 'offset' } } },
  operations: {
    'audiences.list': { docs: `${ref}/a-268-retrieve-a-list-of-audiences-get`, method: 'POST', path: '/audiences/get', kind: 'read',
      paging: 'audiences',
      params: { search_term: { in: 'body', type: 'string' }, limit: { in: 'body', type: 'integer', description: 'At most 40 a page.' },
        archived: { in: 'body', type: 'boolean' }, retention: { in: 'body', type: 'boolean' } },
      result: [{ id: 'string', 'name?': 'string', 'type?': 'string', 'ready?': 'boolean', 'members?': 'integer', 'subscribers?': 'integer',
        'created?': 'string', 'edited_at?': 'string' }] },
    'people.list': { docs: `${ref}/a-258-retrieve-one-or-more-people-get`, method: 'POST', path: '/person/get', kind: 'read',
      paging: 'people', records: 'contacts',
      params: { limit: { in: 'body', type: 'integer', description: '1 to 500, 50 by default.' },
        fields: { in: 'body', type: ['string'], description: 'The person field ids to answer (str::email, str::first), at most 150.' },
        filter: { in: 'body', type: 'unknown', description: 'A filter on person fields, such as { "$str::is": { field_id, value } }.' },
        q: { in: 'body', type: 'string' }, sort_by_field_id: { in: 'body', type: 'string' },
        sort_order: { in: 'body', type: 'string', enum: ['asc', 'desc'] } },
      result: { contacts: [{ id: 'string', 'fields?': 'unknown' }] } },
    // A new person's email permission is true unless fields set bol::p false; Ortto asks for the person's consent:
    // https://help.ortto.com/a-225-configuring-peoples-subscription-permissions
    'people.create': { docs: `${ref}/a-257-create-or-update-one-or-more-people-merge`, method: 'POST', kind: 'write', path: '/person/merge',
      params: { people, merge_by: { in: 'body', type: ['string'], description: 'The field ids that find an existing person to update; the key\'s defaults when left out.' },
        merge_strategy: { in: 'body', type: 'integer', description: '1 append only, 2 overwrite existing (the default), 3 ignore existing people.' },
        skip_non_existing: { in: 'body', type: 'boolean', description: 'true updates existing people and adds none.' },
        async: { in: 'body', type: 'boolean' } } },
    // Subscribes each person to the audience's email, again for one who unsubscribed from it; audiences are a journey
    // entry criterion: https://help.ortto.com/a-269-subscribe-or-unsubscribe-people-to-from-an-audience-subscribe
    // https://help.ortto.com/a-733-journey-entry-criteria
    'subscriptions.create': { docs: `${ref}/a-269-subscribe-or-unsubscribe-people-to-from-an-audience-subscribe`, method: 'PUT', kind: 'write',
      path: '/audience/subscribe',
      params: { audience_id: { in: 'body', type: 'string', required: true, description: 'The audience\'s id, from its URL in Ortto.' },
        people: { in: 'body', required: true, type: [{ 'email?': 'string', 'external_id?': 'string', 'person_id?': 'string', subscribed: true }],
          description: 'Up to 1000 people, each named by email, external_id or person_id and subscribed to the audience\'s email (true subscribes a person who unsubscribed from it again); a person must already be a member of the audience.' },
        async: { in: 'body', type: 'boolean' } } },
    // An activity can enter its person into journeys, and can create that person:
    // https://help.ortto.com/a-733-journey-entry-criteria
    'events.create': { docs: `${ref}/a-271-create-a-custom-activity-event-create`, method: 'POST', kind: 'write', path: '/activities/create',
      params: { activities: { in: 'body', required: true, type: [{ activity_id: 'string', 'attributes?': 'unknown', 'fields?': 'unknown' }],
        description: 'Each activity names its custom activity id, its attributes and the person fields that find or create its person.' },
      merge_by: { in: 'body', type: ['string'] } },
      result: { 'activities?': [{ 'person_id?': 'string', 'status?': 'string', 'person_status?': 'string', 'activity_id?': 'string' }] } },
    'campaigns.list': { docs: `${ref}/a-695-retrieve-a-list-of-sent-campaigns-calendar`, method: 'POST', path: '/campaign/calendar',
      kind: 'read',
      params: { start: { in: 'body', type: { year: 'integer', month: 'integer' }, required: true },
        end: { in: 'body', type: { year: 'integer', month: 'integer' }, required: true },
        timezone: { in: 'body', type: 'string', required: true } },
      result: { campaigns: [{ id: 'string', 'name?': 'string', 'type?': 'string', 'state?': 'string', 'asset_id?': 'string',
        'sending_at?': 'string', 'sent_at?': 'string' }] } },
  },
});
