import { defineProvider } from '../catalogue.js';

/** Zernio (formerly Late): an API key, acting in one workspace. `posts.create` fixes `isDraft: true`: the post is kept,
 * never published, and no schedule is offered. A 429 states `Retry-After`: https://docs.zernio.com/guides/rate-limits
 * Webhooks, https://docs.zernio.com/webhooks: the lowercase hex HMAC-SHA256 of the raw body; `id` is the same on every
 * retry. The body's `timestamp` is not checked: refuse an old delivery yourself. */
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
    help: 'From API keys in the dashboard (sk_ followed by 64 hex characters). A key acts in the workspace that was active when you created it; a workspace without billing cannot write.' }],
  auth: [{ kind: 'key' }],
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
    'posts.create': { docs: `${docs}/posts/create-post`, method: 'POST', path: '/posts',
      params: { ...written, isDraft: { in: 'body', type: true, required: true },
        profileId: { in: 'body', type: 'string', description: 'Files a draft with no platforms under this profile.' } },
      result: { post } },
    // A draft stays a draft, and a scheduled post keeps its time: nothing here publishes or schedules.
    'posts.update': { docs: `${docs}/posts/update-post`, method: 'PUT', path: '/posts/{postId}',
      params: { ...postId, ...written,
        externalId: { in: 'body', type: 'string', nullable: true, description: 'Your own id for the post; null clears it.' } },
      result: { post } },
  },
});
