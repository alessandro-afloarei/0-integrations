import { defineProvider } from '../catalogue.js';

/** Aircall: 120 requests a minute per company, and an overrun blocks the key for 60 seconds. Basic auth from the
 * API ID and the API token. */
export const aircall = defineProvider({
  id: 'aircall', name: 'Aircall',
  fields: [{ name: 'apiId', title: 'API ID' }, { name: 'apiToken', title: 'API token', secret: true }],
  auth: [{ kind: 'key', send: { basic: ['{apiId}', '{apiToken}'] } }],
  http: { baseUrl: 'https://api.aircall.io/v1', minIntervalMs: 500, retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/company' }, id: '{connection.apiId}', name: 'company.name' },
});
