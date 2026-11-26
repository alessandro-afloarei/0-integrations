import { defineProvider } from '../catalogue.js';

/** Zoom's Server-to-Server OAuth app: a token an hour long, requested again when it runs out (there is no refresh token).
 * The account is the account ID entered. */
export const zoom = defineProvider({
  id: 'zoom', name: 'Zoom', docs: 'https://developers.zoom.us/docs/internal-apps/s2s-oauth/',
  categories: ['meetings'],
  fields: [{ name: 'accountId', title: 'Account ID' }, { name: 'clientId', title: 'Client ID' },
    { name: 'clientSecret', title: 'Client secret', secret: true }],
  auth: [{ kind: 'token', request: { url: 'https://zoom.us/oauth/token',
    body: { grant_type: 'account_credentials', account_id: '{accountId}' }, basic: ['{clientId}', '{clientSecret}'] } }],
  http: { baseUrl: 'https://api.zoom.us/v2' },
  identify: { id: '{connection.accountId}' },
});
