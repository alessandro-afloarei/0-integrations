import { defineProvider } from '../catalogue.js';

/** Microsoft Graph on a member's delegated grant (Outlook mail and calendar). A 429 names its wait in `Retry-After`. */
export const microsoft = defineProvider({
  id: 'microsoft', name: 'Microsoft',
  docs: 'https://learn.microsoft.com/en-us/graph/auth-v2-user',
  categories: ['mail', 'calendar'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', authorizeParams: { response_type: 'code', response_mode: 'query' } }],
  scopes: { default: ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'] },
  // No revoke: deleting one app's grant (DELETE /oAuth2PermissionGrants/{id}) needs a Microsoft Entra role.
  // Graph asks a 503 to be backed off as a 429 is (https://learn.microsoft.com/en-us/graph/best-practices-concept), so
  // its reads retry a 5xx with the backoff too.
  http: { baseUrl: 'https://graph.microsoft.com/v1.0', headers: { accept: 'application/json' },
    retry: { limit: 2, maxWaitMs: 30_000, defaultWaitMs: 5000 } },
  errors: { detail: ['error.code', 'error.errors.0.reason', 'error.status'] },
  // The address names the account; only the immutable id says who it is.
  identify: { request: { path: '/me', query: { $select: 'id,mail,userPrincipalName' } }, id: 'id',
    name: ['mail', 'userPrincipalName'], lowercase: true },
  paging: { nextLink: { kind: 'nextUrl', next: '@odata.nextLink', pathPrefix: '/me/' } },
});
