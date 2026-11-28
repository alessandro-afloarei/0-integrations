import { defineProvider } from '../catalogue.js';

/** Typefully Public API v2: an API key for your own account. A draft create or update never sends `publish_at` (its
 * "now" publishes at once) nor `share`: the draft is saved and nothing is published or scheduled. A 429 waits
 * `X-RateLimit-User-Reset`, a Unix timestamp. The webhook names no event or delivery id, so it is not declared. */
const socialSet = { id: 'integer', name: 'string', username: 'string', 'profile_image_url?': 'string', 'team?': 'unknown' } as const;
const draft = { id: 'integer', social_set_id: 'integer', status: 'string', 'draft_title?': 'string', 'preview?': 'string',
  private_url: 'string', created_at: 'string', 'updated_at?': 'string' } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '10 by default, at most 50.' } } as const;
const socialSetId = { social_set_id: { in: 'path', type: 'integer', required: true } } as const;
const draftPath = { ...socialSetId, draft_id: { in: 'path', type: 'integer', required: true } } as const;
const written = {
  draft_title: { in: 'body', type: 'string', description: 'For internal organization only; not posted.' },
  scratchpad_text: { in: 'body', type: 'string', description: 'Plain text notes for the draft.' },
  tags: { in: 'body', type: ['string'], description: 'Tag slugs (not names) that already exist in the social set.' },
} as const;
const platforms = 'Each platform\'s configuration by name (x, linkedin, mastodon, threads, bluesky, substack, x_article): `{ enabled, posts: [{ text }] }`.';
const docs = 'https://typefully.com/docs/api';

export const typefully = defineProvider({
  id: 'typefully', name: 'Typefully', docs,
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Typefully account, from Settings → API: Typefully meant its API for personal automations and workflows. The key has the permissions of the user who made it; creating and editing drafts needs write access to the social set, and an account that is paused or needs a paid plan cannot create them.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.typefully.com', retry: { wait: { header: 'x-ratelimit-user-reset', unit: 'epochSeconds' } } },
  identify: { request: { path: '/v2/me' }, id: 'id', name: ['name', 'email'] },
  errors: { detail: 'error.code' },
  paging: { offset: { kind: 'offset', send: { query: 'offset' }, list: 'results' } },
  operations: {
    'socialSets.list': { docs, path: '/v2/social-sets', paging: 'offset', records: 'results', params: limit,
      result: { results: [socialSet] } },
    'drafts.list': { docs, path: '/v2/social-sets/{social_set_id}/drafts', paging: 'offset', records: 'results',
      params: { ...socialSetId,
        status: { in: 'query', type: 'string', enum: ['draft', 'published', 'scheduled', 'planned', 'error', 'publishing'] },
        order_by: { in: 'query', type: 'string', enum: ['created_at', '-created_at', 'updated_at', '-updated_at', 'scheduled_date',
          '-scheduled_date', 'published_at', '-published_at'] }, ...limit },
      result: { results: [draft] } },
    'drafts.get': { docs, path: '/v2/social-sets/{social_set_id}/drafts/{draft_id}', notFound: 'null', params: draftPath,
      result: draft },
    'drafts.create': { docs, method: 'POST', path: '/v2/social-sets/{social_set_id}/drafts',
      params: { ...socialSetId, platforms: { in: 'body', type: 'unknown', required: true, description: platforms }, ...written },
      result: draft },
    'drafts.update': { docs, method: 'PATCH', path: '/v2/social-sets/{social_set_id}/drafts/{draft_id}',
      params: { ...draftPath, platforms: { in: 'body', type: 'unknown', description: `${platforms} Only the platforms sent change.` },
        ...written },
      result: draft },
  },
});
