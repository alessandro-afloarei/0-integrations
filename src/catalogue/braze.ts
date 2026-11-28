import { defineProvider } from '../catalogue.js';

/** Braze: a REST API key as Bearer on the workspace's instance, checked on the campaigns list (no endpoint names the
 * workspace). A 429 waits `X-RateLimit-Retry-After` seconds or is reported: https://www.braze.com/docs/api/api_limits
 * `users.create` creates or updates users; on a contract billed by data points (older multi-year contracts only), each
 * custom attribute it sends consumes one: https://www.braze.com/docs/user_guide/data/infrastructure/data_points */
const ref = 'https://www.braze.com/docs/api/endpoints';
/** The 15 instances' REST endpoints: https://www.braze.com/docs/api/basics */
const hosts = ['rest.iad-01.braze.com', 'rest.iad-02.braze.com', 'rest.iad-03.braze.com', 'rest.iad-04.braze.com',
  'rest.iad-05.braze.com', 'rest.iad-06.braze.com', 'rest.iad-07.braze.com', 'rest.iad-08.braze.com', 'rest.us-10.braze.com',
  'rest.fra-01.braze.eu', 'rest.fra-02.braze.eu', 'rest.au-01.braze.com', 'rest.id-01.braze.com', 'rest.jp-01.braze.com',
  'rest.kr-01.braze.com'] as const;
const sortDirection = { in: 'query', type: 'string', enum: ['asc', 'desc'], description: 'By creation time; asc by default.' } as const;

export const braze = defineProvider({
  id: 'braze', name: 'Braze', docs: 'https://www.braze.com/docs/api/basics',
  categories: ['marketing'],
  fields: [{ name: 'restHost', title: 'REST endpoint', choices: hosts, default: 'rest.iad-01.braze.com',
    help: 'Your instance\'s REST endpoint, shown with your API keys in Settings > APIs and Identifiers > API Keys.' },
  { name: 'apiKey', title: 'REST API key', secret: true,
    help: 'A REST API key from Settings > APIs and Identifiers, with the campaigns.list, campaigns.details, segments.list, users.export.ids and users.track permissions: a key\'s permissions cannot be edited later. On a contract billed by data points (older, multi-year contracts), each custom attribute sent to /users/track consumes one.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{restHost}', host: hosts, retry: { onlyStated: true, wait: { header: 'x-ratelimit-retry-after', unit: 's' } } },
  identify: { request: { path: '/campaigns/list' } },
  paging: { campaigns: { kind: 'page', send: { query: 'page' }, list: 'campaigns', zeroBased: true },
    segments: { kind: 'page', send: { query: 'page' }, list: 'segments', zeroBased: true } },
  operations: {
    'segments.list': { docs: `${ref}/export/segments/get_segment`, path: '/segments/list', paging: 'segments', records: 'segments',
      params: { sort_direction: sortDirection },
      result: { segments: [{ id: 'string', 'name?': 'string', 'analytics_tracking_enabled?': 'boolean', 'tags?': ['string'] }] } },
    'users.search': { docs: `${ref}/export/user_data/post_users_identifier`, method: 'POST', path: '/users/export/ids', kind: 'read',
      anyOf: [['external_ids'], ['email_address'], ['phone'], ['braze_id']],
      params: { external_ids: { in: 'body', type: ['string'], description: 'Up to 50.' }, email_address: { in: 'body', type: 'string' },
        phone: { in: 'body', type: 'string', description: 'In E.164 format.' }, braze_id: { in: 'body', type: 'string' },
        fields_to_export: { in: 'body', type: ['string'],
          description: 'The fields to answer; required for a workspace onboarded on or after 22 August 2024.' } },
      result: { message: 'string', 'users?': [{ 'external_id?': 'string', 'braze_id?': 'string', 'email?': 'string', 'phone?': 'string',
        'first_name?': 'string', 'last_name?': 'string', 'email_subscribe?': 'string', 'created_at?': 'string' }] } },
    // Creates or updates each user its attributes name. A new email, a changed custom attribute or a subscription
    // change can trigger an action-based campaign or Canvas that messages the user; an SMS group set subscribed enters
    // the double opt-in workflow only with use_double_opt_in_logic: true:
    // https://www.braze.com/docs/user_guide/messaging/campaigns/schedule_your_campaign/triggered_delivery
    'users.create': { docs: `${ref}/user_data/post_user_track`, method: 'POST', kind: 'write', path: '/users/track',
      params: { attributes: { in: 'body', type: ['unknown'], required: true,
        description: 'Up to 75 user attribute objects, each naming one of external_id, user_alias, braze_id, email or phone; other keys are profile or custom attributes; email_subscribe and push_subscribe take opted_in, unsubscribed or subscribed (no page says whether a value here re-subscribes a user who unsubscribed); events and purchases are not declared.' } },
      result: { message: 'string', request_id: 'string', 'attributes_processed?': 'integer' } },
    'campaigns.list': { docs: `${ref}/export/campaigns/get_campaigns`, path: '/campaigns/list', paging: 'campaigns', records: 'campaigns',
      params: { include_archived: { in: 'query', type: 'boolean' }, sort_direction: sortDirection },
      result: { campaigns: [{ id: 'string', 'name?': 'string', 'is_api_campaign?': 'boolean', 'tags?': ['string'], 'last_edited?': 'string' }] } },
    'campaigns.get': { docs: `${ref}/export/campaigns/get_campaign_details`, path: '/campaigns/details',
      params: { campaign_id: { in: 'query', type: 'string', required: true } },
      result: { 'name?': 'string', 'draft?': 'boolean', 'enabled?': 'boolean', 'archived?': 'boolean', 'schedule_type?': 'string',
        'channels?': ['string'], 'created_at?': 'string', 'updated_at?': 'string' } },
  },
});
