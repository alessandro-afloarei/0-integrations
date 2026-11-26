import { defineProvider } from '../catalogue.js';

/** Zulip, zulipchat.com or the organization's own server: the host is typed, so it is reached only through the address
 * guard unless the app passes its own `fetch`. Errors carry a `code` (https://zulip.com/api/rest-error-handling).
 * Sending a message takes a form-encoded body, which the engine cannot send yet. */
const ref = 'https://zulip.com/api';

export const zulip = defineProvider({
  id: 'zulip', name: 'Zulip', docs: `${ref}/http-headers`,
  categories: ['chat'],
  fields: [{ name: 'host', title: 'Zulip host', help: 'Your organization\'s host name, such as your-org.zulipchat.com, with no port.' },
    { name: 'email', title: 'API email', help: 'The email address of the account (or bot) the API key belongs to.' },
    { name: 'apiKey', title: 'API key', secret: true,
      help: 'Under Personal settings, then Account & privacy, with Manage your API key; a bot\'s is under Personal settings, then Bots.' }],
  auth: [{ kind: 'key', send: { basic: ['{email}', '{apiKey}'] } }],
  http: { baseUrl: 'https://{host}/api/v1', host: '*' },
  identify: { request: { path: '/users/me' }, id: 'user_id', name: ['full_name', 'email'] },
  errors: { detail: 'code' },
  operations: {
    'channels.list': { docs: `${ref}/get-streams`, path: '/streams',
      result: { streams: [{ stream_id: 'integer', 'name?': 'string', 'is_archived?': 'boolean', 'date_created?': 'integer' }] } },
    'messages.list': { docs: `${ref}/get-messages`, path: '/messages',
      params: { anchor: { in: 'query', type: 'string', description: 'A message id, or newest or oldest.' },
        num_before: { in: 'query', type: 'integer', required: true }, num_after: { in: 'query', type: 'integer', required: true },
        narrow: { in: 'query', type: 'string', description: 'JSON, such as [{"operator": "channel", "operand": "Denmark"}].' } },
      result: { messages: [{ id: 'integer', 'sender_id?': 'integer', 'stream_id?': 'integer', 'subject?': 'string',
        'content?': 'string', 'timestamp?': 'integer' }], 'found_newest?': 'boolean', 'found_oldest?': 'boolean' } },
    'users.list': { docs: `${ref}/get-users`, path: '/users',
      result: { members: [{ user_id: 'integer', 'full_name?': 'string', 'email?': 'string', 'date_joined?': 'string' }] } },
  },
});
