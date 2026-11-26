import { defineProvider } from '../catalogue.js';

export const unipile = defineProvider({
  id: 'unipile', name: 'Unipile', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.unipile.com/v2', headers: { accept: 'application/json' }, retry: { limit: 3, defaultWaitMs: 30_000 } },
  // A refusal is named by its thrower and type (`provider/insufficient_permissions`); the slash reads as a dot.
  errors: { detail: 'type' },
});
