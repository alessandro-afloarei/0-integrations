import { defineProvider } from '../catalogue.js';

/** Fathom's External API: 60 calls a minute per account, a transcript 30 (Fathom may lower it to 5). */
export const fathom = defineProvider({
  id: 'fathom', name: 'Fathom', fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Fathom account, from User Settings, then API Access: Fathom asks an app other people install to use OAuth. The key reads the meetings you recorded or that were shared with you or your team.' }],
  docs: 'https://developers.fathom.ai/quickstart',
  categories: ['meetings'],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.fathom.ai/external/v1', minIntervalMs: 1000, retry: { defaultWaitMs: 5000 } },
  identify: { request: { path: '/meetings' } },
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', send: { query: 'cursor' } } },
});
