import { defineProvider } from '../catalogue.js';

/** Discord: OAuth 2 (scope `identify`: the user), then the app's bot token, sent `Authorization: Bot <token>`; both on
 * `GET /users/@me`. Interactions are signed with Ed25519 over `X-Signature-Timestamp` and the raw body, checked against
 * the application's public key (hex) (https://docs.discord.com/developers/interactions/overview), where a PING
 * (`type: 1`) is answered `{ "type": 1 }`; the user object is at https://docs.discord.com/developers/resources/user. */
export const discord = defineProvider({
  id: 'discord', name: 'Discord', docs: 'https://docs.discord.com/developers/reference',
  categories: ['chat'],
  fields: [{ name: 'botToken', title: 'Bot token', secret: true }],
  // https://docs.discord.com/developers/topics/oauth2
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token', authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { header: 'authorization', value: 'Bot {token}' } }],
  scopes: { default: ['identify'] },
  revoke: { url: 'https://discord.com/api/oauth2/token/revoke', token: ['refresh', 'access'] },
  // Every request names its client library in `User-Agent` and sends a `Content-Type` (the reference, "HTTP API").
  http: { baseUrl: 'https://discord.com/api/v10', headers: { 'content-type': 'application/json',
    'user-agent': 'DiscordBot (https://www.npmjs.com/package/0-integrations, 0.13.0)' } },
  identify: { request: { path: '/users/@me' }, id: 'id', name: ['global_name', 'username'] },
  webhook: { kind: 'ed25519', header: 'x-signature-ed25519', signed: '{timestamp}{body}',
    timestamp: { header: 'x-signature-timestamp' }, challenge: { when: { path: 'type', equals: 1 }, echo: 'type' } },
});
