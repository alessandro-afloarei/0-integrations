import { defineProvider } from '../catalogue.js';

/** Discord: a bot token sent as `Authorization: Bot <token>`; `GET /users/@me` names the bot. Interactions are signed
 * with Ed25519 over `X-Signature-Timestamp` and the raw body, checked against the application's public key (hex)
 * (https://docs.discord.com/developers/interactions/overview); the user object is at
 * https://docs.discord.com/developers/resources/user. */
export const discord = defineProvider({
  id: 'discord', name: 'Discord', docs: 'https://docs.discord.com/developers/reference',
  fields: [{ name: 'botToken', title: 'Bot token', secret: true }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Bot {token}' } }],
  http: { baseUrl: 'https://discord.com/api/v10' },
  identify: { request: { path: '/users/@me' }, id: 'id', name: ['global_name', 'username'] },
  webhook: { kind: 'ed25519', header: 'x-signature-ed25519', signed: '{timestamp}{body}',
    timestamp: { header: 'x-signature-timestamp' } },
});
