import { defineProvider } from '../catalogue.js';

/** Ayrshare Social API: the Primary Profile's API key. `posts.create` fixes `requiresApproval: true`: the post is held
 * "awaiting approval" and nothing is published until someone approves it. No `retry`: repeated 429s within a
 * 5-minute window can suspend the profile (https://www.ayrshare.com/docs/errors/errors-http). X needs two more secret
 * headers this entry cannot send. Webhooks: the digest's encoding is not stated. */
const post = { id: 'string', 'post?': 'string', 'status?': 'string', 'platforms?': ['string'], 'type?': 'string',
  'created?': 'string', 'scheduleDate?': 'unknown', 'postIds?': 'unknown' } as const;
const ref = 'https://www.ayrshare.com/docs/apis';

export const ayrshare = defineProvider({
  id: 'ayrshare', name: 'Ayrshare', docs: `${ref}/overview`,
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'The API Key of your Primary Profile, on the API Key page of the Ayrshare dashboard.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.ayrshare.com/api', headers: { 'content-type': 'application/json' } },
  identify: { request: { path: '/user' }, id: 'refId', name: ['title', 'email'] },
  // Each error names an Ayrshare code, at the root or per network: https://www.ayrshare.com/docs/errors/errors-ayrshare
  errors: { detail: ['code', 'errors.0.code'] },
  operations: {
    // The networks linked to the profile, from its details.
    'accounts.list': { docs: `${ref}/user/profile-details`, path: '/user',
      result: { 'activeSocialAccounts?': ['string'], 'displayNames?': [{ platform: 'string', 'id?': 'unknown', 'displayName?': 'string',
        'username?': 'string', 'profileUrl?': 'string', 'created?': 'string' }] } },
    // One page of the newest posts, at most `limit`.
    'posts.list': { docs: `${ref}/history/get-history`, path: '/history',
      params: { limit: { in: 'query', type: 'integer', description: '25 by default, at most 1000.' },
        lastDays: { in: 'query', type: 'integer', description: 'The last n days by publish date, 30 by default; 0 for every post.' },
        status: { in: 'query', type: 'string', enum: ['success', 'error', 'processing', 'pending', 'paused', 'deleted', 'awaiting approval'] } },
      result: { history: [post] } },
    'posts.get': { docs: `${ref}/post/get-post`, path: '/post/{id}',
      params: { id: { in: 'path', type: 'string', required: true, description: 'The Ayrshare Post ID.' } }, result: post },
    'posts.create': { docs: `${ref}/post/post`, method: 'POST', path: '/post',
      params: {
        post: { in: 'body', type: 'string', required: true, description: 'The post\'s text; an empty string for none.' },
        platforms: { in: 'body', type: ['string'], required: true,
          description: 'The linked networks to post to: bluesky, facebook, gmb, instagram, linkedin, pinterest, reddit, snapchat, telegram, threads, tiktok, twitter, youtube, or all.' },
        requiresApproval: { in: 'body', type: true, required: true },
        notes: { in: 'body', type: 'string', description: 'For reference only; returned by the history.' },
        idempotencyKey: { in: 'body', type: 'string', description: 'A unique id: a duplicate is refused.' },
      } },
  },
});
