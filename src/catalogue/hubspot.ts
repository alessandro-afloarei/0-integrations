import { defineProvider } from '../catalogue.js';

export const hubspot = defineProvider({
  id: 'hubspot', name: 'HubSpot',
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.hubspot.com/oauth/authorize', tokenUrl: 'https://api.hubapi.com/oauth/2026-03/token',
    pkce: false, reusesGrant: true }],
  scopes: { default: ['oauth', 'crm.objects.companies.read', 'crm.objects.contacts.read', 'crm.objects.deals.read', 'crm.objects.owners.read'] },
  // Only a refresh token is revoked: a grant with an access token alone expires on its own.
  revoke: { url: 'https://api.hubapi.com/oauth/2026-03/token/revoke', token: ['refresh'] },
  http: { baseUrl: 'https://api.hubapi.com', minIntervalMs: 250, retry: { maxWaitMs: 10_000 } },
  // Known categories only: a credential can also look like a short error code.
  errors: { detail: 'category', allow: ['MISSING_SCOPES', 'VALIDATION_ERROR'] },
  identify: { request: { path: '/account-info/2026-09/details' }, id: ['tokenAnswer.hub_id', 'portalId'], name: 'Portal {id}' },
  paging: { after: { kind: 'cursor', next: 'paging.next.after', send: { query: 'after' } } },
});
