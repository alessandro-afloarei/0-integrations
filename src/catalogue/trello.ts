import { defineProvider } from '../catalogue.js';

/** Trello: the key and the token travel as `key=` and `token=` in the query; a revoked token is a 401. */
export const trello = defineProvider({
  id: 'trello', name: 'Trello', docs: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/',
  fields: [{ name: 'apiKey', title: 'API key' }, { name: 'apiToken', title: 'Token', secret: true }],
  auth: [{ kind: 'key', send: { query: { key: '{apiKey}', token: '{apiToken}' } } }],
  http: { baseUrl: 'https://api.trello.com/1' },
  identify: { request: { path: '/members/me' }, id: 'id', name: ['fullName', 'username'] },
});
