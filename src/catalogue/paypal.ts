import { defineProvider } from '../catalogue.js';

/** PayPal's REST API with an app's client ID and secret: a token from `/v1/oauth2/token`, live or sandbox, requested
 * again when it runs out. The account is the app the token answer names. */
export const paypal = defineProvider({
  id: 'paypal', name: 'PayPal', docs: 'https://developer.paypal.com/api/rest/authentication/',
  fields: [{ name: 'apiHost', title: 'Environment', choices: ['api-m.paypal.com', 'api-m.sandbox.paypal.com'],
    default: 'api-m.paypal.com', help: 'Live, or the sandbox for testing.' },
  { name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Secret', secret: true }],
  auth: [{ kind: 'token', request: { url: 'https://{apiHost}/v1/oauth2/token', body: { grant_type: 'client_credentials' },
    basic: ['{clientId}', '{clientSecret}'] } }],
  http: { baseUrl: 'https://{apiHost}', host: '*.paypal.com' },
  identify: { id: 'tokenAnswer.app_id' },
});
