import { defineProvider } from '../catalogue.js';

export const granola = defineProvider({
  id: 'granola', name: 'Granola', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.granola.ai/introduction',
  categories: ['meetings'],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://public-api.granola.ai/v1', minIntervalMs: 200 },
  paging: { cursor: { kind: 'cursor', next: 'cursor', more: 'hasMore', send: { query: 'cursor' } } },
});
