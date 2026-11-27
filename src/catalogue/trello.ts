import { defineProvider } from '../catalogue.js';

/** Trello: OAuth 2.0 (3LO), its client set to confidential with the Read members scope, the token Bearer on the API;
 * or the app's API key and the person's token in one `Authorization: OAuth …` header. The client is set up on the
 * app's OAuth 2.0 tab: https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-client-configuration/
 * `GET /1/members/me` names the member: https://developer.atlassian.com/cloud/trello/rest/api-group-members/ */
export const trello = defineProvider({
  id: 'trello', name: 'Trello', docs: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-confidential-client-usage/',
  categories: ['tasks'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token',
    json: true, authorizeParams: { prompt: 'consent', response_type: 'code' } },
  { kind: 'key', fields: [{ name: 'apiKey', title: 'API key' }, { name: 'apiToken', title: 'Token', secret: true }],
    send: { header: 'authorization', value: 'OAuth oauth_consumer_key="{apiKey}", oauth_token="{apiToken}"' } }],
  scopes: { default: ['read:member:trello', 'offline_access'] },
  http: { baseUrl: 'https://api.trello.com/1', retry: { defaultWaitMs: 10_000 } },
  identify: { request: { path: '/members/me' }, id: 'id', name: ['fullName', 'username'] },
});
