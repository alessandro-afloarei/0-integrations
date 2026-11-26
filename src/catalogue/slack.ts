import { defineProvider } from '../catalogue.js';

/** Slack: an OAuth v2 bot grant. Events are signed `X-Slack-Signature: v0=<hex HMAC-SHA256 of v0:{timestamp}:{body}>`
 * with the app's signing secret, `X-Slack-Request-Timestamp` within five minutes
 * (https://docs.slack.dev/authentication/verifying-requests-from-slack); a `url_verification` body is answered with its
 * `challenge`, as JSON (https://docs.slack.dev/reference/events/url_verification/). */
export const slack = defineProvider({
  id: 'slack', name: 'Slack',
  docs: 'https://docs.slack.dev/authentication/installing-with-oauth',
  categories: ['chat'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access',
    pkce: false, scopeSeparator: ',', tokenTypes: ['bot'], failed: { path: 'ok', equals: false } }],
  scopes: { default: ['chat:write', 'chat:write.public', 'channels:read', 'groups:read'] },
  revoke: { request: { path: '/auth.revoke' } },
  http: { baseUrl: 'https://slack.com/api', timeoutMs: 15_000 },
  errors: { detail: 'error', failed: { path: 'ok', equals: false },
    revoked: ['invalid_auth', 'token_revoked', 'account_inactive', 'invalid_refresh_token', 'invalid_grant', 'not_authed'] },
  identify: { id: 'tokenAnswer.team.id', name: 'tokenAnswer.team.name' }, save: { botUserId: 'tokenAnswer.bot_user_id' },
  paging: { cursor: { kind: 'cursor', next: 'response_metadata.next_cursor', send: { query: 'cursor' } } },
  webhook: { kind: 'hmac', header: 'x-slack-signature', signed: 'v0:{timestamp}:{body}', prefix: 'v0=',
    timestamp: { header: 'x-slack-request-timestamp' },
    challenge: { when: { path: 'type', equals: 'url_verification' }, echo: 'challenge' } },
});
