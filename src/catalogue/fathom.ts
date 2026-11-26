import { defineProvider } from '../catalogue.js';

/** Fathom's External API: 60 calls a minute per account, a transcript 30 (Fathom may lower it to 5). */
export const fathom = defineProvider({
  id: 'fathom', name: 'Fathom', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://developers.fathom.ai/quickstart',
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.fathom.ai/external/v1', minIntervalMs: 1000, retry: { defaultWaitMs: 5000 } },
  identify: { request: { path: '/meetings' } },
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', send: { query: 'cursor' } } },
});
