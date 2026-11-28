import { defineProvider } from '../catalogue.js';

/** Sprout Social API v1: an API token on a paid plan with API access; identify checks it on the customer's profiles.
 * A publishing post is created only as a draft (`is_draft: true`): nothing is published or scheduled. A 429 means
 * slow down; the limit refills at one request a second. There are no webhooks. */
const publishing = { publishing_post_id: 'integer', 'group_id?': 'integer', 'is_draft?': 'boolean', 'text?': 'string',
  'perma_link?': 'string', 'created_time?': 'string', 'updated_time?': 'string' } as const;
// One record per profile (and send time) the post is for: the post as each network would show it.
const fanned = { data: [{ 'post_type?': 'string', 'customer_profile_id?': 'string', internal: { publishing } }] } as const;
const docs = 'https://api.sproutsocial.com/docs/';

export const sproutsocial = defineProvider({
  id: 'sproutsocial', name: 'Sprout Social', docs: `${docs}#accessing-the-apis`,
  categories: ['marketing'],
  fields: [
    { name: 'apiToken', title: 'API token', secret: true,
      help: 'An API token of your own Sprout account (Settings > Global Features > API, API Token Management). Your plan must include API access, you need the API Permissions permission, and the Analytics API Terms of Service must be accepted on that page.' },
    { name: 'customerId', title: 'Customer ID',
      help: 'Your Sprout customer ID: the customer_id that GET https://api.sproutsocial.com/v1/metadata/client answers.' },
  ],
  auth: [{ kind: 'key' }],
  // Every request sends both headers: https://api.sproutsocial.com/docs/#request-headers
  http: { baseUrl: 'https://api.sproutsocial.com/v1/{customerId}',
    headers: { accept: 'application/json', 'content-type': 'application/json' }, retry: {} },
  identify: { request: { path: '/metadata/customer' } },
  operations: {
    'profiles.list': { docs: `${docs}#customer-profiles-endpoint`, path: '/metadata/customer',
      result: { data: [{ customer_profile_id: 'integer', 'network_type?': 'string', 'name?': 'string', 'native_name?': 'string',
        'native_id?': 'string', 'groups?': ['integer'] }] } },
    'publishingPosts.get': { docs: `${docs}#retrieve-publishing-post-endpoint`, path: '/publishing/posts/{publishing_post_id}',
      params: { publishing_post_id: { in: 'path', type: 'integer', required: true } }, result: fanned },
    'publishingPosts.create': { docs: `${docs}#create-publishing-post-endpoint`, method: 'POST', path: '/publishing/posts',
      params: {
        group_id: { in: 'body', type: 'integer', required: true, description: 'The group to create the post in.' },
        customer_profile_ids: { in: 'body', type: ['integer'], required: true,
          description: 'The profiles the post is for, all in the same group; a profile whose network cannot take the post is dropped.' },
        is_draft: { in: 'body', type: true, required: true },
        text: { in: 'body', type: 'string' },
        tag_ids: { in: 'body', type: ['integer'] },
      },
      result: fanned },
  },
});
