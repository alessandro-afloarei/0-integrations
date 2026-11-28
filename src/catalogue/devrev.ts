import { defineProvider } from '../catalogue.js';

/** DevRev: a dev user's personal access token, which external apps may use on that user's behalf. Tickets are works of
 * `type` ticket. A timeline comment is `external` by default: visible to the customer. Per-user limits over five
 * minutes; a 429 carries `Retry-After` in seconds: https://developer.devrev.ai/about/rate-limits */
const work = { id: 'string', type: 'string', title: 'string', 'display_id?': 'string', 'stage?': { 'name?': 'string' },
  'severity?': 'string', 'created_date?': 'string', 'modified_date?': 'string' } as const;
const entry = { id: 'string', type: 'string', object: 'string', 'body?': 'unknown', 'visibility?': 'string',
  'created_by?': { 'id?': 'string', 'display_name?': 'string' }, 'created_date?': 'string' } as const;
const revUser = { id: 'string', 'display_id?': 'string', 'display_name?': 'string', 'full_name?': 'string', 'email?': 'string',
  'rev_org?': { 'id?': 'string', 'display_name?': 'string' }, 'created_date?': 'string', 'modified_date?': 'string' } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '50 by default.' } } as const;
const ticket = { type: { in: 'body', type: 'ticket' } } as const;
const ref = 'https://developer.devrev.ai/api-reference';

export const devrev = defineProvider({
  id: 'devrev', name: 'DevRev', docs: 'https://developer.devrev.ai/about/authentication',
  categories: ['support'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For your own DevRev organization: Settings > Account > Personal Access Token. It has your privileges on DevRev and the validity you set.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.devrev.ai', retry: {} },
  identify: { request: { path: '/dev-users.self' }, id: 'dev_user.id', name: ['dev_user.display_name', 'dev_user.full_name', 'dev_user.email'] },
  errors: { detail: 'type' },
  // https://developer.devrev.ai/about/pagination
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', send: { query: 'cursor' } } },
  operations: {
    'works.list': { docs: `${ref}/works/list`, path: '/works.list', paging: 'cursor', records: 'works',
      params: { type: { in: 'query', type: 'string', description: '`ticket` for tickets (also `issue`, `opportunity`, `task`).' }, ...limit },
      result: { works: [work] } },
    'works.get': { docs: `${ref}/works/get`, path: '/works.get', notFound: 'null',
      params: { id: { in: 'query', type: 'string', required: true } }, result: { work } },
    'works.create': { docs: `${ref}/works/create`, method: 'POST', path: '/works.create',
      params: { type: { ...ticket.type, required: true }, title: { in: 'body', type: 'string', required: true },
        applies_to_part: { in: 'body', type: 'string', required: true, description: 'The part the ticket applies to.' },
        owned_by: { in: 'body', type: ['string'], required: true, description: 'The users that own the ticket.' },
        body: { in: 'body', type: 'string' }, rev_org: { in: 'body', type: 'string' }, reported_by: { in: 'body', type: ['string'] },
        severity: { in: 'body', type: 'string', enum: ['blocker', 'high', 'low', 'medium'] } },
      result: { work } },
    'works.update': { docs: `${ref}/works/update`, method: 'POST', path: '/works.update',
      params: { id: { in: 'body', type: 'string', required: true }, ...ticket, title: { in: 'body', type: 'string' },
        body: { in: 'body', type: 'string' }, stage: { in: 'body', type: { 'name?': 'string' } },
        owned_by: { in: 'body', type: { set: ['string'] } },
        severity: { in: 'body', type: 'string', enum: ['blocker', 'high', 'low', 'medium'], description: 'With `type` `ticket`.' } },
      result: { work } },
    'timelineEntries.list': { docs: `${ref}/timeline-entries/list`, path: '/timeline-entries.list', paging: 'cursor',
      records: 'timeline_entries',
      params: { object: { in: 'query', type: 'string', required: true, description: 'The ticket\'s ID.' },
        limit: { in: 'query', type: 'integer', description: 'A page may hold fewer entries, even none, before the last.' } },
      result: { timeline_entries: [entry] } },
    'timelineEntries.create': { docs: `${ref}/timeline-entries/create`, method: 'POST', path: '/timeline-entries.create',
      params: { type: { in: 'body', type: 'timeline_comment', required: true },
        object: { in: 'body', type: 'string', required: true, description: 'The ticket\'s ID.' }, body: { in: 'body', type: 'string' },
        visibility: { in: 'body', type: 'string', enum: ['external', 'internal', 'private', 'public'],
          description: '`external` (the default) is visible to the customer; `internal` to your organization only; `private` to the creator.' } },
      result: { timeline_entry: entry } },
    'revUsers.list': { docs: `${ref}/rev-users/list`, path: '/rev-users.list', paging: 'cursor', records: 'rev_users',
      params: { email: { in: 'query', type: 'string', description: 'Rev users with this email.' }, ...limit },
      result: { rev_users: [revUser] } },
  },
});
