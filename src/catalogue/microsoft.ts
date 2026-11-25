import { defineProvider } from '../catalogue.js';

/** Microsoft Graph on a member's delegated grant (Outlook mail and calendar). A 429 names its wait in `Retry-After`. */
export const microsoft = defineProvider({
  id: 'microsoft', name: 'Microsoft',
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', authorizeParams: { response_type: 'code', response_mode: 'query' } }],
  scopes: { default: ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'] },
  // No revoke: Microsoft has no endpoint that revokes one app's delegated grant.
  http: { baseUrl: 'https://graph.microsoft.com/v1.0', headers: { accept: 'application/json' },
    retry: { limit: 2, maxWaitMs: 30_000, defaultWaitMs: 5000 } },
  errors: { detail: ['error.code', 'error.errors.0.reason', 'error.status'] },
  // The address names the account; only the immutable id says who it is.
  identify: { request: { path: '/me', query: { $select: 'id,mail,userPrincipalName' } }, id: 'id',
    name: ['mail', 'userPrincipalName'], lowercase: true },
});
