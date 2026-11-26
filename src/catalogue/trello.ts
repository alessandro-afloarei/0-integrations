import { defineProvider } from '../catalogue.js';

/** Trello: the app's API key and the person's token, both in one `Authorization: OAuth …` header; `GET /1/members/me`
 * names the member (`id`, `fullName`, `username`: https://developer.atlassian.com/cloud/trello/rest/api-group-members/). */
export const trello = defineProvider({
  id: 'trello', name: 'Trello', docs: 'https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/',
  categories: ['tasks'],
  fields: [{ name: 'apiKey', title: 'API key' }, { name: 'apiToken', title: 'Token', secret: true }],
  auth: [{ kind: 'key', send: { header: 'authorization',
    value: 'OAuth oauth_consumer_key="{apiKey}", oauth_token="{apiToken}"' } }],
  http: { baseUrl: 'https://api.trello.com/1', retry: {} },
  identify: { request: { path: '/members/me' }, id: 'id', name: ['fullName', 'username'] },
});
