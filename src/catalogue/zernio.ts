import { defineProvider } from '../catalogue.js';

/** Zernio (formerly Late): OAuth 2, then an API key. `posts.create` fixes `isDraft: true`: the post is kept, never
 * published, and no schedule is offered; a draft is changed in Zernio's app. A 429 states `Retry-After`:
 * https://docs.zernio.com/guides/rate-limits. Webhooks, https://docs.zernio.com/webhooks: hex HMAC-SHA256 of the raw
 * body, `id` the same on every retry; the body's `timestamp` is not checked: refuse an old delivery yourself. */
const account = { _id: 'string', platform: 'string', profileId: 'unknown', 'username?': 'string', 'displayName?': 'string',
  'profileUrl?': 'string', isActive: 'boolean' } as const;
const post = { _id: 'string', 'title?': 'string', 'content?': 'string', 'status?': 'string', 'scheduledFor?': 'string',
  'platforms?': 'unknown', 'createdAt?': 'string', 'updatedAt?': 'string' } as const;
const postId = { postId: { in: 'path', type: 'string', required: true } } as const;
const written = {
  title: { in: 'body', type: 'string', description: 'Stored for reference only.' },
  content: { in: 'body', type: 'string', description: 'The post\'s text.' },
  platforms: { in: 'body', type: [{ platform: 'string', accountId: 'string', 'customContent?': 'string' }],
    description: 'The accounts the post is for: each `platform` and its account\'s `_id`.' },
  tags: { in: 'body', type: ['string'] },
} as const;
const docs = 'https://docs.zernio.com';

export const zernio = defineProvider({
  id: 'zernio', name: 'Zernio', docs: `${docs}/quickstart`,
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own workspace, from API keys in the dashboard (sk_ followed by 64 hex characters): a key acts in the workspace that was active when you created it. A workspace without billing cannot write.' }],
  // A public client (PKCE, no secret): the app gets its `client_id` by Zernio's open dynamic registration, and the
  // token works on the REST API too: https://zernio.com/auth.md
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://zernio.com/oauth/authorize', tokenUrl: 'https://zernio.com/api/oauth/token',
    clientAuth: 'none', authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  // Each declared read of posts takes `posts:read` or `posts:write`, and `posts.create` `posts:write`; accounts and
  // `/users/me` take `accounts:read` (`x-oauth-scopes`): https://zernio.com/openapi.json
  scopes: { default: ['accounts:read', 'posts:write'] },
  // RFC 7009, "to end the grant": the refresh token, which ends the whole connection.
  revoke: { url: 'https://zernio.com/api/oauth/revoke', token: ['refresh'] },
  http: { baseUrl: 'https://zernio.com/api/v1', retry: {} },
  identify: { request: { path: '/users/me' }, id: '_id', name: ['workspaceName', 'name'] },
  // A stable machine code at the root: https://docs.zernio.com/guides/error-handling
  errors: { detail: 'code' },
  webhook: { kind: 'hmac', header: 'x-zernio-signature', deliveryId: { body: ['id'] } },
  paging: {
    accounts: { kind: 'cursor', next: 'pagination.nextCursor', send: { query: 'cursor' } },
    posts: { kind: 'cursor', next: 'pagination.nextCursor', send: { query: 'cursor' } },
  },
  operations: {
    'accounts.list': { docs: `${docs}/accounts/list-accounts`, path: '/accounts', paging: 'accounts', records: 'accounts',
      params: { profileId: { in: 'query', type: 'string' }, platform: { in: 'query', type: 'string' },
        status: { in: 'query', type: 'string', enum: ['connected', 'disconnected'] },
        limit: { in: 'query', type: 'integer', description: 'At most 500, the size of a page.' } },
      result: { accounts: [account] } },
    'posts.list': { docs: `${docs}/posts/list-posts`, path: '/posts', paging: 'posts', records: 'posts',
      params: { status: { in: 'query', type: 'string',
        enum: ['draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled'] },
      profileId: { in: 'query', type: 'string' }, accountId: { in: 'query', type: 'string' },
      sortBy: { in: 'query', type: 'string', enum: ['scheduled-desc', 'scheduled-asc', 'created-desc', 'created-asc'],
        description: 'scheduled-desc by default.' },
      limit: { in: 'query', type: 'integer', description: '10 by default, at most 500.' } },
      result: { posts: [post] } },
    'posts.get': { docs: `${docs}/posts/get-post`, path: '/posts/{postId}', notFound: 'null', params: postId, result: { post } },
    // Saves a draft (`isDraft: true` wins over any schedule): nothing is published, scheduled or queued; no schedule
    // field is offered, and a draft is changed in Zernio's app.
    'posts.create': { docs: `${docs}/posts/create-post`, method: 'POST', path: '/posts', kind: 'write',
      params: { ...written, isDraft: { in: 'body', type: true, required: true },
        profileId: { in: 'body', type: 'string', description: 'Files a draft with no platforms under this profile.' } },
      result: { post } },
  },
});
