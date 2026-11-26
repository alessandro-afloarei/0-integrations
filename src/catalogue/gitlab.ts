import { defineProvider } from '../catalogue.js';

/** GitLab, gitlab.com or the person's own: the host is typed, so it is reached only through the address guard unless
 * the app passes its own `fetch`. A personal access token travels in `PRIVATE-TOKEN`; `GET /user` names the account,
 * whose id is local to that host: an app keys the connection by host and account id. */
export const gitlab = defineProvider({
  id: 'gitlab', name: 'GitLab', docs: 'https://docs.gitlab.com/api/rest/authentication/',
  categories: ['code'],
  fields: [{ name: 'host', title: 'GitLab host', default: 'gitlab.com', help: 'gitlab.com, or the host name of your own GitLab, with no port.' },
    { name: 'accessToken', title: 'Personal access token', secret: true }],
  // OAuth 2 on that host, the app's client registered there (https://docs.gitlab.com/api/oauth2/); then the token.
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://{host}/oauth/authorize', tokenUrl: 'https://{host}/oauth/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key', send: { header: 'private-token' } }],
  scopes: { default: ['read_user'] },
  revoke: { url: 'https://{host}/oauth/revoke', token: ['refresh', 'access'] },
  http: { baseUrl: 'https://{host}/api/v4', host: '*', retry: {} },
  identify: { request: { path: '/user' }, id: 'id', name: 'username' },
  // A signing token follows Standard Webhooks; `webhook-id` stays the same across retries
  // (https://docs.gitlab.com/user/project/integrations/webhooks/).
  webhook: { kind: 'standard', deliveryId: { header: 'webhook-id' } },
});
