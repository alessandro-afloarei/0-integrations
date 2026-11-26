import { defineProvider } from '../catalogue.js';

/** Jira Cloud on a member's 3LO grant. The account is the first site the grant reaches: its cloud id is saved, and the
 * API base takes it as a path segment. */
export const jira = defineProvider({
  id: 'jira', name: 'Jira', docs: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
  categories: ['tasks'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token',
    json: true, pkce: false, authorizeParams: { audience: 'api.atlassian.com', prompt: 'consent', response_type: 'code' } }],
  scopes: { default: ['read:jira-work', 'read:jira-user', 'offline_access'] },
  http: { baseUrl: 'https://api.atlassian.com/ex/jira/{cloudId}', bases: { api: 'https://api.atlassian.com' },
    headers: { accept: 'application/json' } },
  identify: { request: { base: 'api', path: '/oauth/token/accessible-resources' }, id: '0.id', name: '0.name' },
  save: { cloudId: '0.id' },
});
