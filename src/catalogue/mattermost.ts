import { defineProvider } from '../catalogue.js';

/** Mattermost, on the person's own server: the host is typed, so it is reached only through the address guard unless the
 * app passes its own `fetch`. A personal access token as a bearer token; `me` stands for its user; `channels.list` needs
 * server 6.1 or later. Errors carry an `id`; a 429 past the server's own limit
 * (https://docs.mattermost.com/api/reference/mattermost-api). Types: https://github.com/mattermost/mattermost/tree/master/api/v4/source */
const time = 'integer';
const perPage = { in: 'query', type: 'integer', description: 'At most 200.' } as const;
const post = { id: 'string', 'message?': 'string', 'channel_id?': 'string', 'root_id?': 'string', 'user_id?': 'string',
  'create_at?': time, 'update_at?': time } as const;
const ref = 'https://docs.mattermost.com/api/reference';

export const mattermost = defineProvider({
  id: 'mattermost', name: 'Mattermost', docs: `${ref}/mattermost-api`,
  categories: ['chat'],
  fields: [{ name: 'host', title: 'Mattermost host', help: 'The host name of your Mattermost server, with no port.' },
    { name: 'accessToken', title: 'Personal access token', secret: true,
      help: 'A System Admin enables them under System Console, then Integrations, then Integration Management; by default only System Admins can create one. It does not expire.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{host}/api/v4', host: '*', retry: {} },
  identify: { request: { path: '/users/me' }, id: 'id', name: ['username', 'email'] },
  errors: { detail: 'id' },
  paging: { page: { kind: 'page', send: { query: 'page' }, zeroBased: true } },
  operations: {
    'channels.list': { docs: `${ref}/get-channels-for-user`, path: '/users/me/channels',
      result: [{ id: 'string', 'name?': 'string', 'display_name?': 'string', 'type?': 'string', 'team_id?': 'string',
        'create_at?': time, 'update_at?': time }] },
    'posts.list': { docs: `${ref}/get-posts-for-channel`, path: '/channels/{channel_id}/posts',
      params: { channel_id: { in: 'path', type: 'string', required: true }, page: { in: 'query', type: 'integer' }, per_page: perPage },
      result: { 'order?': ['string'], 'posts?': 'unknown', 'has_next?': 'boolean', 'next_post_id?': 'string',
        'prev_post_id?': 'string' } },
    'posts.create': { docs: `${ref}/create-post`, method: 'POST', path: '/posts',
      params: { channel_id: { in: 'body', type: 'string', required: true }, message: { in: 'body', type: 'string', required: true },
        root_id: { in: 'body', type: 'string' } }, result: post },
    'users.list': { docs: `${ref}/get-users`, path: '/users', paging: 'page',
      params: { in_channel: { in: 'query', type: 'string' }, per_page: perPage },
      result: [{ id: 'string', 'username?': 'string', 'first_name?': 'string', 'last_name?': 'string', 'email?': 'string',
        'create_at?': time, 'update_at?': time }] },
  },
});
