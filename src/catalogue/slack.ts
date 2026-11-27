import { defineProvider } from '../catalogue.js';

/** Slack: an OAuth v2 bot grant on slack.com, or GovSlack's slack-gov.com, whose page asks an app to be "approved and
 * published in the GovSlack Marketplace" (its FAQ: public distribution installs it): https://docs.slack.dev/govslack
 * Events signed v0 HMAC-SHA256, five minutes: https://docs.slack.dev/authentication/verifying-requests-from-slack
 * `url_verification` is answered with its `challenge`: https://docs.slack.dev/reference/events/url_verification/ */
export const slack = defineProvider({
  id: 'slack', name: 'Slack',
  docs: 'https://docs.slack.dev/authentication/installing-with-oauth',
  categories: ['chat'],
  fields: [{ name: 'domain', title: 'Slack instance', choices: ['slack.com', 'slack-gov.com'], default: 'slack.com',
    help: 'slack.com, or slack-gov.com for GovSlack, an instance of Slack designed for U.S. public sector use, whose app is registered apart on api.slack-gov.com.' }],
  // No PKCE: Slack refuses it (`pkce_not_allowed`) unless the app turns it on, which makes the app a public client, one
  // way (only Slack support undoes it): https://docs.slack.dev/reference/methods/oauth.v2.access/,
  // https://docs.slack.dev/authentication/using-pkce/
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
