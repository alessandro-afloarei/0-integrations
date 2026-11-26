import { defineProvider } from '../catalogue.js';

/** Intercom: one of three regional hosts, picked by the person (the US by default); `GET /me` names the workspace.
 * Webhooks: `X-Hub-Signature: sha1=<hex HMAC-SHA1 of the body>`, keyed with the app's client secret
 * (https://developers.intercom.com/docs/references/2.13/webhooks/webhook-models, "Signed notifications"). */
export const intercom = defineProvider({
  id: 'intercom', name: 'Intercom',
  docs: 'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/identifyadmin',
  categories: ['support'],
  fields: [{ name: 'apiHost', title: 'Region', choices: ['api.intercom.io', 'api.eu.intercom.io', 'api.au.intercom.io'],
    default: 'api.intercom.io', help: 'Where the workspace is hosted: the US, the EU or Australia.' },
  { name: 'accessToken', title: 'Access token', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}', host: '*.intercom.io' },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/me' }, id: 'app.id_code', name: 'app.name' },
  webhook: { kind: 'hmac', header: 'x-hub-signature', prefix: 'sha1=', hash: 'sha1' },
});
