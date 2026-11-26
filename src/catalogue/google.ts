import { defineProvider } from '../catalogue.js';

/** Gmail and Google Calendar (on its own base) on a member's grant. Google answers a quota limit as 403 as well as 429;
 * `prompt=consent` returns a refresh token on every sign-in, and `access_type=offline` one at all. The consent screen lets
 * a member untick a scope, so every requested one must be granted. */
export const google = defineProvider({
  id: 'google', name: 'Google',
  docs: 'https://developers.google.com/identity/protocols/oauth2/web-server',
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    authorizeParams: { response_type: 'code', access_type: 'offline', prompt: 'consent' } }],
  scopes: { default: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'], requireGranted: true },
  // Google answers a token already revoked as `invalid_token`.
  revoke: { url: 'https://oauth2.googleapis.com/revoke', token: ['refresh', 'access'], goneErrors: ['invalid_token'] },
  // Gmail asks a 5xx to be retried with exponential backoff
  // (https://developers.google.com/workspace/gmail/api/guides/handle-errors), as its reads are.
  http: { baseUrl: 'https://gmail.googleapis.com/gmail/v1', bases: { calendar: 'https://www.googleapis.com/calendar/v3' },
    headers: { accept: 'application/json' }, retry: { limit: 2, maxWaitMs: 30_000, defaultWaitMs: 5000 },
    rateLimit: { defaultWaitMs: 60_000, when: [{ status: 429 }, { status: 403, detail: 'rateLimitExceeded' },
      { status: 403, detail: 'userRateLimitExceeded' }, { status: 403, detail: 'quotaExceeded' }] } },
  errors: { detail: ['error.code', 'error.errors.0.reason', 'error.status'] },
  identify: { request: { path: '/users/me/profile' }, id: 'emailAddress', name: 'emailAddress', lowercase: true },
  paging: { pageToken: { kind: 'cursor', next: 'nextPageToken', send: { query: 'pageToken' } } },
  // Calendar push sends no signature: the channel's own `token` comes back on every notification
  // (https://developers.google.com/workspace/calendar/api/guides/push).
  webhook: { kind: 'token', header: 'x-goog-channel-token' },
});
