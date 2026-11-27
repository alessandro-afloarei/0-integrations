import { defineProvider } from '../catalogue.js';

export const exa = defineProvider({
  id: 'exa', name: 'Exa', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://exa.ai/docs/reference/search',
  categories: ['search'],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.exa.ai', retry: {} },
});
