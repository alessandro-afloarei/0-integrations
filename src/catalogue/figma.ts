import { defineProvider } from '../catalogue.js';

/** Figma on a member's OAuth grant: refreshed at its own URL, which answers no new refresh token. */
export const figma = defineProvider({
  id: 'figma', name: 'Figma', docs: 'https://developers.figma.com/docs/rest-api/oauth-apps/',
  categories: ['design'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://www.figma.com/oauth', tokenUrl: 'https://api.figma.com/v1/oauth/token',
    refreshUrl: 'https://api.figma.com/v1/oauth/refresh', clientAuth: 'basic', authorizeParams: { response_type: 'code' } }],
  scopes: { default: ['current_user:read', 'file_content:read'] },
  http: { baseUrl: 'https://api.figma.com/v1' },
  identify: { id: 'tokenAnswer.user_id_string' },
});
