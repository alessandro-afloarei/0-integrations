import { defineProvider } from '../catalogue.js';

/** Figma: OAuth 2, refreshed at its own URL, which answers no new refresh token; an app serves its own team or
 * organization, or anyone once Figma reviews it as public. Then a personal access token in `X-Figma-Token`. `/me` names
 * the account (https://developers.figma.com/docs/rest-api/users-endpoints/). */
export const figma = defineProvider({
  id: 'figma', name: 'Figma', docs: 'https://developers.figma.com/docs/rest-api/oauth-apps/',
  categories: ['design'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For your own Figma account: generate it under Settings, then Security, with the current_user:read scope.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://www.figma.com/oauth', tokenUrl: 'https://api.figma.com/v1/oauth/token',
    refreshUrl: 'https://api.figma.com/v1/oauth/refresh', clientAuth: 'basic',
    authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { header: 'x-figma-token' } }],
  scopes: { default: ['current_user:read'] },
  http: { baseUrl: 'https://api.figma.com/v1', retry: {} },
  identify: { request: { path: '/me' }, id: 'id' },
});
