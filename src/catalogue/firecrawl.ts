import { defineProvider } from '../catalogue.js';

/** Firecrawl: OAuth 2 for apps, a public client (no secret, PKCE, refresh tokens that work once), or an API key, each
 * sent as Bearer to the REST API (https://docs.firecrawl.dev/oauth). The app gets its `client_id` by Dynamic Client
 * Registration or a client ID metadata document, neither approved by Firecrawl; the library registers none. */
export const firecrawl = defineProvider({
  id: 'firecrawl', name: 'Firecrawl', fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Firecrawl team, from the dashboard: Firecrawl asks an app where each person connects their own account to use OAuth.' }],
  docs: 'https://docs.firecrawl.dev/api-reference/v2-introduction',
  categories: ['search'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://www.firecrawl.dev/api/oauth/authorize', tokenUrl: 'https://www.firecrawl.dev/api/oauth/token',
    clientAuth: 'none', authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  // `offline_access` tells the person the app stays connected until they revoke it.
  scopes: { default: ['firecrawl:global', 'offline_access'] },
  // The refresh token ends the whole connection; an access token ends only itself.
  revoke: { url: 'https://www.firecrawl.dev/api/oauth/revoke', token: ['refresh'] },
  http: { baseUrl: 'https://api.firecrawl.dev', timeoutMs: 120_000, retry: { defaultWaitMs: 60_000 } },
});
