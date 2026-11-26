import { defineProvider } from '../catalogue.js';

/** GitLab, gitlab.com or the person's own: the host is typed, so it is reached only through the address guard unless
 * the app passes its own `fetch`. A personal access token travels in `PRIVATE-TOKEN`; `GET /user` names the account. */
export const gitlab = defineProvider({
  id: 'gitlab', name: 'GitLab', docs: 'https://docs.gitlab.com/api/rest/authentication/',
  fields: [{ name: 'host', title: 'GitLab host', default: 'gitlab.com', help: 'gitlab.com, or the host name of your own GitLab.' },
    { name: 'accessToken', title: 'Personal access token', secret: true }],
  auth: [{ kind: 'key', send: { header: 'private-token' } }],
  http: { baseUrl: 'https://{host}/api/v4', host: '*' },
  identify: { request: { path: '/user' }, id: 'id', name: 'username' },
});
