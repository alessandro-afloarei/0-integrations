import { defineProvider } from '../catalogue.js';

/** Ayrshare Social API: the Primary Profile's API key (a paid plan). `posts.create` fixes `requiresApproval: true`:
 * the post waits "awaiting approval" until an update approves it: https://www.ayrshare.com/docs/apis/post/overview
 * No `retry`: repeated 429s can suspend the profile (https://www.ayrshare.com/docs/errors/errors-http). X needs two
 * more secret headers this entry cannot send. Webhooks: the digest's encoding is not stated. */
const post = { id: 'string', 'post?': 'string', 'status?': 'string', 'platforms?': ['string'], 'type?': 'string',
  'created?': 'string', 'scheduleDate?': 'unknown', 'postIds?': 'unknown' } as const;
const ref = 'https://www.ayrshare.com/docs/apis';

export const ayrshare = defineProvider({
  id: 'ayrshare', name: 'Ayrshare', docs: `${ref}/overview`,
  categories: ['marketing'],
  // The plans: https://www.ayrshare.com/docs/help-center/product/what-is-the-basic-plan-post-limit
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'The API Key of your Primary Profile, on the API Key page of the Ayrshare dashboard. New accounts need a paid plan: Premium, or Launch, whose 28-day free trial takes a card.' }],
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
    // Holds the post "awaiting approval" (`requiresApproval: true`): nothing is published until a person approves it in
    // the dashboard or by `PATCH /api/post` (not declared); approved, it publishes then (no `scheduleDate` is offered).
    'posts.create': { docs: `${ref}/post/post`, method: 'POST', path: '/post', kind: 'write',
      params: {
        post: { in: 'body', type: 'string', required: true, description: 'The post\'s text; an empty string for none.' },
        platforms: { in: 'body', type: ['string'], required: true,
          description: 'The linked networks to post to: bluesky, facebook, gmb, instagram, linkedin, pinterest, reddit, snapchat, telegram, threads, tiktok, twitter, youtube, or all; twitter needs two headers this entry does not send.' },
        requiresApproval: { in: 'body', type: true, required: true },
        notes: { in: 'body', type: 'string', description: 'For reference only; returned by the history.' },
        idempotencyKey: { in: 'body', type: 'string', description: 'A unique id: a duplicate is refused.' },
      } },
  },
});
