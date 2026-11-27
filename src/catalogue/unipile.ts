import { defineProvider } from '../catalogue.js';

export const unipile = defineProvider({
  id: 'unipile', name: 'Unipile', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://developer.unipile.com/v2.0/docs/api-keys',
  categories: ['mail', 'calendar'],
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.unipile.com/v2', headers: { accept: 'application/json' }, retry: { onlyStated: true } },
  // A refusal is named by its thrower and type (`provider/insufficient_permissions`); the slash reads as a dot.
  errors: { detail: 'type' },
});
