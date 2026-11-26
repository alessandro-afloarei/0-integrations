import { defineProvider } from '../catalogue.js';

/** Chatwork: OAuth 2, or an API token in `x-chatworktoken`; a 429 past 300 requests in five minutes
 * (https://developer.chatwork.com/docs/endpoints). A refresh token lasts 14 days unless the grant holds `offline_access`
 * (confidential clients only, https://developer.chatwork.com/docs/oauth). Posting a message takes a form-encoded body,
 * and the message and contact lists answer 204 when empty, so they declare no result. */
const ref = 'https://developer.chatwork.com/reference';

export const chatwork = defineProvider({
  id: 'chatwork', name: 'Chatwork', docs: 'https://developer.chatwork.com/docs/endpoints',
  categories: ['chat'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://www.chatwork.com/packages/oauth2/login.php',
    tokenUrl: 'https://oauth.chatwork.com/token', clientAuth: 'basic', authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { header: 'x-chatworktoken' } }],
  scopes: { default: ['users.profile.me:read', 'rooms.info:read', 'rooms.messages:read', 'contacts.all:read'] },
  http: { baseUrl: 'https://api.chatwork.com/v2', retry: {} },
  identify: { request: { path: '/me' }, id: 'account_id', name: ['name', 'login_mail'] },
  operations: {
    'rooms.list': { docs: `${ref}/get-rooms`, path: '/rooms',
      result: [{ room_id: 'integer', name: 'string', type: 'string', last_update_time: 'integer' }] },
    'messages.list': { docs: `${ref}/get-rooms-room_id-messages`, path: '/rooms/{room_id}/messages',
      params: { room_id: { in: 'path', type: 'integer', required: true }, force: { in: 'query', type: 'integer' } } },
    'contacts.list': { docs: `${ref}/get-contacts`, path: '/contacts' },
  },
});
