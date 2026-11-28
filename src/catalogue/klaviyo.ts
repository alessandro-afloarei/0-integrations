import { defineProvider } from '../catalogue.js';

/** Klaviyo: OAuth 2 with PKCE (an app made at klaviyo.com/manage-apps, installed by its link without a listing), or a
 * private key for your own account. Pinned to revision 2026-10-15: https://developers.klaviyo.com/en/reference; a 429
 * waits `Retry-After`: https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling. Lists are the audience.
 * No call sends a campaign; webhooks are not declared. */
const profile = { 'id?': 'string', attributes: { 'email?': 'string', 'phone_number?': 'string', 'external_id?': 'string',
  'first_name?': 'string', 'last_name?': 'string', 'created?': 'string', 'updated?': 'string' } } as const;
const written = { 'email?': 'string', 'phone_number?': 'string', 'external_id?': 'string', 'first_name?': 'string',
  'last_name?': 'string', 'properties?': 'unknown' } as const;
const campaign = { id: 'string', attributes: { 'created_at?': 'string', 'updated_at?': 'string',
  definition: { 'name?': 'string', 'archived?': 'boolean' } } } as const;
const id = { id: { in: 'path', type: 'string', required: true } } as const;
const size = { in: 'query', type: 'integer' } as const;
const ref = 'https://developers.klaviyo.com/en/reference';

export const klaviyo = defineProvider({
  id: 'klaviyo', name: 'Klaviyo', docs: 'https://developers.klaviyo.com/en/docs/set_up_oauth',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'Private API key', secret: true,
    help: 'For your own Klaviyo account (an app for other accounts connects with the OAuth 2 sign-in, which Klaviyo requires of its published partners): a private key (pk_) made under Settings, API keys, by an Owner, Admin or Manager, with read access to Accounts, Campaigns, Lists and Profiles and write access to Events, Lists, Profiles and Subscriptions. A key\'s scopes cannot be changed once it is made.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://www.klaviyo.com/oauth/authorize', tokenUrl: 'https://a.klaviyo.com/oauth/token',
    clientAuth: 'basic', authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { header: 'authorization', value: 'Klaviyo-API-Key {apiKey}' } }],
  scopes: { default: ['accounts:read', 'profiles:read', 'profiles:write', 'lists:read', 'lists:write', 'campaigns:read',
    'subscriptions:write', 'events:write'] },
  // Revoking the refresh token revokes the install: the access tokens issued to it stop working too.
  revoke: { url: 'https://a.klaviyo.com/oauth/revoke', token: ['refresh'] },
  http: { baseUrl: 'https://a.klaviyo.com/api', headers: { revision: '2026-10-15', 'content-type': 'application/vnd.api+json' },
    retry: { onlyStated: true } },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/accounts' }, id: 'data.0.id', name: 'data.0.attributes.contact_information.organization_name' },
  paging: { next: { kind: 'nextUrl', next: 'links.next' } },
  operations: {
    'profiles.list': { docs: `${ref}/get_profiles`, path: '/profiles', paging: 'next', records: 'data',
      params: { filter: { in: 'query', type: 'string',
        description: 'For example equals(email,\'ada@example.com\'); also on id, phone_number, external_id, created and updated.' },
      'page[size]': { ...size, description: '20 by default, at most 100.' } }, result: { data: [profile] } },
    'profiles.get': { docs: `${ref}/get_profile`, path: '/profiles/{id}', notFound: 'null', params: id, result: { data: profile } },
    // A profile's consent to marketing is given by `subscriptions.create`, not here.
    'profiles.create': { docs: `${ref}/create_profile`, method: 'POST', path: '/profiles',
      params: { data: { in: 'body', required: true, type: { type: 'profile', attributes: written } } }, result: { data: profile } },
    'profiles.update': { docs: `${ref}/update_profile`, method: 'PATCH', path: '/profiles/{id}',
      params: { ...id, data: { in: 'body', required: true, type: { type: 'profile', id: 'string', attributes: written },
        description: 'data.id is the path\'s id; a field left out is unchanged, one set to null is cleared.' } }, result: { data: profile } },
    'lists.list': { docs: `${ref}/get_lists`, path: '/lists', paging: 'next', records: 'data',
      params: { 'page[size]': { ...size, description: '10 by default, at most 10.' } },
      result: { data: [{ id: 'string', attributes: { 'name?': 'string', 'created?': 'string', 'updated?': 'string',
        'opt_in_process?': 'string' } }] } },
    // Subscribes people to email marketing: on a list with double opt-in each is first emailed a confirmation, and the
    // list's "Added to list" flows start; `historical_import: true` sends neither.
    'subscriptions.create': { docs: `${ref}/bulk_subscribe_profiles`, method: 'POST', path: '/profile-subscription-bulk-create-jobs',
      params: { data: { in: 'body', required: true, type: { type: 'profile-subscription-bulk-create-job',
        attributes: { profiles: { data: [{ type: 'profile', 'id?': 'string', attributes: { 'email?': 'string',
          subscriptions: { email: { marketing: { consent: 'SUBSCRIBED', 'consented_at?': 'string' } } } } }] },
        'historical_import?': 'boolean' },
        'relationships?': { list: { data: { type: 'list', id: 'string' } } } },
        description: 'Email marketing for up to 1000 profiles. historical_import true bypasses double opt-in emails and "Added to list" flows; each profile then needs a past consented_at. Without a list the account\'s default opt-in setting applies.' } } },
    'campaigns.list': { docs: `${ref}/get_campaigns`, path: '/campaigns', paging: 'next', records: 'data',
      params: { filter: { in: 'query', type: 'string', description: 'For example contains(name,\'Spring\'), or any(id,[…]).' },
        'page[size]': { ...size, description: '100 by default, at most 100.' } }, result: { data: [campaign] } },
    'campaigns.get': { docs: `${ref}/get_campaign`, path: '/campaigns/{id}', notFound: 'null', params: id, result: { data: campaign } },
    // An event can start its metric's flows, which may email or text the person; `backfill: true` starts none.
    'events.create': { docs: `${ref}/create_event`, method: 'POST', path: '/events',
      params: { data: { in: 'body', required: true, type: { type: 'event', attributes: { properties: 'unknown', 'time?': 'string',
        'value?': 'number', 'unique_id?': 'string', 'backfill?': 'boolean',
        metric: { data: { type: 'metric', attributes: { name: 'string' } } },
        profile: { data: { type: 'profile', 'id?': 'string', attributes: { 'email?': 'string', 'phone_number?': 'string',
          'external_id?': 'string' } } } } },
        description: 'The profile needs an identifier (id, email or phone_number); it is created, or its properties updated. backfill true records the event without triggering flows.' } } },
  },
});
