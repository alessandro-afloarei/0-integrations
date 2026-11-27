import { defineProvider } from '../catalogue.js';

/** SerpApi: the private key travels only as `api_key` in the query. The Account API counts no search; a bad key is 401. */
export const serpapi = defineProvider({
  id: 'serpapi', name: 'SerpApi', docs: 'https://serpapi.com/account-api',
  categories: ['search'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key', send: { query: { api_key: '{token}' } } }],
  http: { baseUrl: 'https://serpapi.com', retry: {} },
  identify: { request: { path: '/account' }, id: 'account_id', name: 'account_email' },
});
