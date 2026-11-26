import { defineProvider } from '../catalogue.js';

/** Metabase signed in as a person, self-hosted or Metabase Cloud. Each process signs in its own session, which lasts
 * 14 days by default (`MAX_SESSION_AGE`); Metabase documents no limit on a person's sessions, so processes do not end
 * each other's. The host is typed, so it is reached only through the address guard unless the app passes its own `fetch`.
 * The account is the email entered, local to that host: an app keys the connection by host and account id. */
export const metabase = defineProvider({
  id: 'metabase', name: 'Metabase', docs: 'https://www.metabase.com/articles/set-up-metabase-from-code-with-the-api',
  fields: [{ name: 'host', title: 'Metabase host', help: 'The host name of your Metabase, such as metabase.example.com.' },
    { name: 'username', title: 'Email' }, { name: 'password', title: 'Password', secret: true }],
  auth: [{ kind: 'token', send: { header: 'x-metabase-session' }, request: { url: 'https://{host}/api/session',
    json: true, token: 'id', body: { username: '{username}', password: '{password}' } } }],
  http: { baseUrl: 'https://{host}/api', host: '*' },
  identify: { id: '{connection.username}' },
});
