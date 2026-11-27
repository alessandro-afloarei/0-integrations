import { defineProvider } from '../catalogue.js';

export const firecrawl = defineProvider({
  id: 'firecrawl', name: 'Firecrawl', fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Firecrawl team, from the dashboard: Firecrawl asks an app where each person connects their own account to use OAuth.' }],
  docs: 'https://docs.firecrawl.dev/api-reference/v2-introduction',
  categories: ['search'],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.firecrawl.dev', timeoutMs: 120_000, retry: { defaultWaitMs: 60_000 } },
});
