import { defineProvider } from '../catalogue.js';

/** LINE Messaging API: a channel access token as a bearer token; a 429 past a per-channel limit. A bot lists no chats and
 * reads no messages (they arrive by webhook), and lists its followers only on a verified or premium account. Webhooks
 * sign the body, base64 HMAC-SHA256 with the channel secret, in `x-line-signature`
 * (https://developers.line.biz/en/reference/messaging-api/#signature-validation). */
const ref = 'https://developers.line.biz/en/reference/messaging-api/';

export const line = defineProvider({
  id: 'line', name: 'LINE', docs: `${ref}#get-bot-info`,
  categories: ['chat'],
  fields: [{ name: 'channelAccessToken', title: 'Channel access token', secret: true,
    help: 'The long-lived channel access token of your own LINE Official Account\'s channel, from its Messaging API tab in the LINE Developers Console. A channel has one: reissuing it invalidates the current one.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.line.me', retry: {} },
  identify: { request: { path: '/v2/bot/info' }, id: 'userId', name: ['displayName', 'basicId'] },
  paging: { next: { kind: 'cursor', next: 'next', send: { query: 'start' } } },
  webhook: { kind: 'hmac', header: 'x-line-signature', encoding: 'base64' },
  operations: {
    'messages.create': { docs: `${ref}#send-push-message`, method: 'POST', path: '/v2/bot/message/push',
      params: { to: { in: 'body', type: 'string', required: true }, messages: { in: 'body', type: ['unknown'], required: true },
        notificationDisabled: { in: 'body', type: 'boolean' } },
      result: { 'sentMessages?': [{ id: 'unknown', 'quoteToken?': 'string' }] } },
    'followers.list': { docs: `${ref}#get-follower-ids`, path: '/v2/bot/followers/ids', paging: 'next', records: 'userIds',
      params: { limit: { in: 'query', type: 'number' } }, result: { userIds: ['string'], 'next?': 'string' } },
  },
});
