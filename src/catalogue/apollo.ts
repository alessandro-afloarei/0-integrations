import { defineProvider } from '../catalogue.js';

/** Apollo: limits are per team and endpoint, the Free plan's enrichment 50 a minute. A plan window's 429 names its wait in
 * `retry-after`; a platform one names none and asks for 60 seconds. */
export const apollo = defineProvider({
  id: 'apollo', name: 'Apollo', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.apollo.io/reference/authentication',
  auth: [{ kind: 'key', send: { header: 'x-api-key' } }],
  http: { baseUrl: 'https://api.apollo.io/api/v1', minIntervalMs: 1200, retry: { defaultWaitMs: 60_000 } },
  // `error_details.code` (`AUTH.AUTHENTICATION.API_KEY_INVALID`), Apollo's only error payload from 2027-02-16.
  errors: { detail: 'error_details.code' },
  identify: { request: { path: '/users/api_profile' } },
});
