import { defineProvider } from '../catalogue.js';

/** The three regional API hosts: https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis */
const hosts = ['api.intercom.io', 'api.eu.intercom.io', 'api.au.intercom.io'] as const;

/** Intercom: OAuth 2 on its US hosts, or the access token on one of three regional hosts, picked by the person (the US
 * by default); `GET /me` names the workspace. Webhooks: `X-Hub-Signature: sha1=<hex HMAC-SHA1 of the body>`, keyed with
 * the app's client secret (https://developers.intercom.com/docs/references/2.13/webhooks/webhook-models, "Signed
 * notifications"). */
export const intercom = defineProvider({
  id: 'intercom', name: 'Intercom',
  docs: 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/identifyadmin',
  categories: ['support'],
  // Intercom reviews an app before other workspaces install it; its permissions are ticked in the Developer Hub (/me
  // needs Read one admin). An EU or AU customer signing in with Google needs its region's authorize host (not here):
  // https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth
  // https://developers.intercom.com/docs/publish-to-the-app-store/review-publish-your-app
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.intercom.com/oauth', tokenUrl: 'https://api.intercom.io/auth/eagle/token', pkce: false },
  { kind: 'key', fields: [{ name: 'apiHost', title: 'Region', choices: hosts,
    default: 'api.intercom.io', help: 'Where the workspace is hosted: the US, the EU or Australia.' },
  { name: 'accessToken', title: 'Access token', secret: true,
    help: 'For your own Intercom workspace: the Access Token in your app\'s Configure > Authentication section in the Developer Hub. Intercom requires OAuth for an app that reaches other people\'s workspaces.' }],
  http: { baseUrl: 'https://{apiHost}', host: hosts } }],
  scopes: { default: [] },
  // `api.intercom.io` attempts to route a call to the workspace's region:
  // https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis
  http: { baseUrl: 'https://api.intercom.io', headers: { accept: 'application/json' },
    retry: { defaultWaitMs: 10_000, wait: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } } },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/me' }, id: 'app.id_code', name: 'app.name' },
  webhook: { kind: 'hmac', header: 'x-hub-signature', prefix: 'sha1=', hash: 'sha1' },
});
