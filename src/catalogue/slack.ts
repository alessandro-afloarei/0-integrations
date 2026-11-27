import { defineProvider } from '../catalogue.js';

/** Slack: an OAuth v2 bot grant, on slack.com or GovSlack's slack-gov.com (https://docs.slack.dev/govslack). Events
 * are signed `X-Slack-Signature: v0=<hex HMAC-SHA256 of v0:{timestamp}:{body}>`, `X-Slack-Request-Timestamp` within
 * five minutes (https://docs.slack.dev/authentication/verifying-requests-from-slack); `url_verification` is answered
 * with its `challenge`, as JSON: https://docs.slack.dev/reference/events/url_verification/ */
export const slack = defineProvider({
  id: 'slack', name: 'Slack',
  docs: 'https://docs.slack.dev/authentication/installing-with-oauth',
  categories: ['chat'],
  fields: [{ name: 'domain', title: 'Slack instance', choices: ['slack.com', 'slack-gov.com'], default: 'slack.com',
    help: 'slack.com, or slack-gov.com for GovSlack, whose app is registered apart on api.slack-gov.com.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://{domain}/oauth/v2/authorize', tokenUrl: 'https://{domain}/api/oauth.v2.access',
    pkce: false, scopeSeparator: ',', tokenTypes: ['bot'], failed: { path: 'ok', equals: false } }],
  scopes: { default: ['chat:write', 'chat:write.public', 'channels:read', 'groups:read'] },
  revoke: { request: { path: '/auth.revoke' } },
  http: { baseUrl: 'https://{domain}/api', host: ['slack.com', 'slack-gov.com'], timeoutMs: 15_000, retry: {} },
  errors: { detail: 'error', failed: { path: 'ok', equals: false },
    revoked: ['invalid_auth', 'token_revoked', 'account_inactive', 'invalid_refresh_token', 'invalid_grant', 'not_authed'] },
  // An org-level install answers `team: null`: its account is the organization's `enterprise.id`.
  identify: { id: ['tokenAnswer.team.id', 'tokenAnswer.enterprise.id'],
    name: ['tokenAnswer.team.name', 'tokenAnswer.enterprise.name'] },
  save: { botUserId: 'tokenAnswer.bot_user_id' },
  paging: { cursor: { kind: 'cursor', next: 'response_metadata.next_cursor', send: { query: 'cursor' } } },
  webhook: { kind: 'hmac', header: 'x-slack-signature', signed: 'v0:{timestamp}:{body}', prefix: 'v0=',
    timestamp: { header: 'x-slack-request-timestamp' },
    challenge: { when: { path: 'type', equals: 'url_verification' }, echo: 'challenge' } },
});
