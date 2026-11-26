import { defineProvider } from '../catalogue.js';

/** Lusha: the Free and Starter plans allow 40 calls a minute (account usage 5), and no `Retry-After` is documented. */
export const lusha = defineProvider({
  id: 'lusha', name: 'Lusha', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.lusha.com/authentication',
  auth: [{ kind: 'key', send: { header: 'api_key' } }],
  http: { baseUrl: 'https://api.lusha.com', minIntervalMs: 1500, retry: { defaultWaitMs: 60_000 } },
  // An account without v3 access is refused like an inactive one; only the message tells them apart.
  errors: { rules: [{ when: { path: 'message', startsWith: 'V3 API access is not enabled' }, code: 'request_failed',
    detail: 'v3_not_enabled' }] },
  identify: { request: { path: '/v3/account/usage' } },
});
