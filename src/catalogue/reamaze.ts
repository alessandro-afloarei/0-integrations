import { defineProvider } from '../catalogue.js';

/** Re:amaze: each user's API token with their login email, HTTP Basic, on the brand's host; identify only checks it on
 * https://www.reamaze.com/api/get_channels. A 429 states no wait. Lists answer one page (`page`, `page_count`).
 * `messages.create` reaches the customer unless `visibility` is 1; `suppress_notifications` (on a message, or in
 * `conversations.create`'s `message`) stops its email and integration notifications, not the message itself. */
const conversation = { slug: 'string', 'subject?': 'string', 'status?': 'integer', 'created_at?': 'string',
  'tag_list?': ['string'], 'category?': { 'slug?': 'string', 'name?': 'string' }, 'author?': { 'name?': 'string', 'email?': 'string' },
  'assignee?': 'unknown' } as const;
const message = { 'body?': 'unknown', 'visibility?': 'integer', 'origin?': 'integer', 'origin_id?': 'string', 'created_at?': 'string',
  'user?': { 'name?': 'string', 'email?': 'string' } } as const;
const slug = { slug: { in: 'path', type: 'string', required: true } } as const;
const page = { page: { in: 'query', type: 'integer', description: 'The page; the answer gives page_size and page_count.' } } as const;
const statuses = '0 Open, 1 Responded, 2 Done, 4 Archived, 5 On Hold, 6 Auto-Done, 7 AI Agent Assigned or 8 AI Agent Done (the entry does not check the value)';
const ref = 'https://www.reamaze.com/api';

export const reamaze = defineProvider({
  id: 'reamaze', name: 'Re:amaze', docs: ref,
  categories: ['support'],
  fields: [{ name: 'brand', title: 'Brand', help: 'The brand\'s host name before .reamaze.io (acme for acme.reamaze.io), on the Brand Settings page.' },
    { name: 'email', title: 'Login email', help: 'The email you sign in to Re:amaze with.' },
    { name: 'apiToken', title: 'API token', secret: true,
      help: 'Your own token: Settings, Developer, API Token, Generate New Token. Every user has one, and the API acts as that user.' }],
  auth: [{ kind: 'key', send: { basic: ['{email}', '{apiToken}'] } }],
  http: { baseUrl: 'https://{brand}.reamaze.io/api/v1', host: '*.reamaze.io', headers: { accept: 'application/json' }, retry: {} },
  identify: { request: { path: '/channels' } },
  operations: {
    'conversations.list': { docs: `${ref}/get_conversations`, path: '/conversations',
      params: { filter: { in: 'query', type: 'string', enum: ['archived', 'open', 'unassigned', 'all'],
        description: 'Unarchived conversations by default.' },
      for: { in: 'query', type: 'string', description: 'A user\'s email: only the conversations relevant to that user.' },
      sort: { in: 'query', type: 'string', enum: ['updated', 'changed'], description: 'By creation time by default.' },
      tag: { in: 'query', type: 'string', description: 'Tags, comma separated.' },
      category: { in: 'query', type: 'string', description: 'A channel\'s slug.' },
      start_date: { in: 'query', type: 'string', description: 'ISO 8601; filters by the latest customer message.' },
      end_date: { in: 'query', type: 'string', description: 'ISO 8601; filters by the latest customer message.' }, ...page },
      result: { 'page_count?': 'integer', 'total_count?': 'integer', conversations: [conversation] } },
    'conversations.get': { docs: `${ref}/get_conversation`, path: '/conversations/{slug}', params: slug, result: conversation },
    'conversations.create': { docs: `${ref}/post_conversations`, method: 'POST', path: '/conversations',
      params: { conversation: { in: 'body', required: true, type: { 'subject?': 'string', 'category?': 'string', 'status?': 'integer',
        'tag_list?': ['string'], 'assignee?': 'string', 'user?': { 'name?': 'string', 'email?': 'string' },
        'message?': { 'body?': 'string', 'recipients?': ['string'], 'suppress_notifications?': 'boolean' } },
      description: `A conversation made on behalf of a customer (user): category should be set to the slug of the channel to create it in; assignee a staff email; status a number: ${statuses}; message.suppress_notifications true sends no email or integration notification.` } },
      result: conversation },
    'conversations.update': { docs: `${ref}/put_conversations`, method: 'PUT', path: '/conversations/{slug}',
      params: { ...slug, conversation: { in: 'body', required: true, type: { 'status?': 'integer', 'tag_list?': ['string'],
        'assignee?': { 'email?': 'string' }, 'category?': 'string' },
      description: `Each key optional. status: ${statuses}. assignee.email: a staff user's email. category: an email channel's slug to move it to.` } },
      result: conversation },
    'messages.list': { docs: `${ref}/get_messages`, path: '/conversations/{slug}/messages',
      params: { ...slug, filter: { in: 'query', type: 'string', enum: ['staff', 'customer'] }, ...page },
      result: { 'page_count?': 'integer', 'total_count?': 'integer', messages: [message] } },
    'messages.create': { docs: `${ref}/post_messages`, method: 'POST', path: '/conversations/{slug}/messages',
      params: { ...slug, message: { in: 'body', required: true, type: { 'body?': 'string', 'visibility?': 'integer',
        'suppress_notifications?': 'boolean', 'recipients?': ['string'], 'origin_id?': 'string' },
      description: 'body may be markdown; visibility 0 (Regular, the customer gets it) or 1 (Internal Note); suppress_notifications true sends no email or integration notification; recipients are email addresses or phone numbers; origin_id helps prevent duplicates.' } },
      result: message },
    'contacts.list': { docs: `${ref}/get_contacts`, path: '/contacts',
      params: { q: { in: 'query', type: 'string', description: 'Searches contacts by name or email.' },
        type: { in: 'query', type: 'string', enum: ['email', 'mobile'] },
        sort: { in: 'query', type: 'date', description: 'By name by default; date orders newest first.' }, ...page },
      result: { 'page_count?': 'integer', 'total_count?': 'integer', contacts: [{ 'name?': 'string', 'email?': 'string', 'friendly_name?': 'string' }] } },
  },
});
