import { defineProvider } from '../catalogue.js';

export const fireflies = defineProvider({
  id: 'fireflies', name: 'Fireflies', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.fireflies.ai/fundamentals/authorization',
  categories: ['meetings'],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.fireflies.ai/graphql',
    retry: { limit: 0, waitFromBody: { path: 'errors.0.extensions.metadata.retryAfter', unit: 'epochMs' } } },
  // A GraphQL code outranks the status: Fireflies sends auth_failed with HTTP 500.
  errors: { detail: ['errors.0.code', 'errors.0.extensions.code'], failed: { path: 'errors.0' }, rules: [
    { when: { detail: 'auth_failed' }, code: 'rejected' }, { when: { status: 401 }, code: 'rejected' },
    { when: { detail: 'too_many_requests' }, code: 'rate_limited' }, { when: { status: 429 }, code: 'rate_limited' },
    { when: { detail: 'object_not_found' }, code: 'not_found' }, { when: { detail: true }, code: 'request_failed' },
    { when: { status: 'error' }, code: 'unavailable' },
  ] },
  identify: { request: { graphql: 'query FirefliesUser { user { user_id email name } }' }, id: 'data.user.user_id',
    name: 'data.user.name' },
  webhook: { kind: 'hmac', header: 'x-hub-signature', prefix: 'sha256=', deliveryId: { body: ['event', 'meeting_id'] } },
  operations: { user: { docs: 'https://docs.fireflies.ai/graphql-api/query/user',
    kind: 'read', graphql: 'query FirefliesUser { user { user_id email name } }',
    result: { data: { user: { user_id: 'string', email: 'string', name: 'string' } } } } },
});
