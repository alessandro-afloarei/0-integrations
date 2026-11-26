import { defineProvider } from '../catalogue.js';

export const firecrawl = defineProvider({
  id: 'firecrawl', name: 'Firecrawl', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.firecrawl.dev/api-reference/introduction',
  categories: ['search'],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.firecrawl.dev', timeoutMs: 120_000, retry: { limit: 3, defaultWaitMs: 30_000 } },
});
