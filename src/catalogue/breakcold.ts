import { defineProvider } from '../catalogue.js';

/** Breakcold's documented error object is `{ error: { code, message, requestId, retryAfterMs? } }`. */
export const breakcold = defineProvider({
  id: 'breakcold', name: 'Breakcold', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.breakcold.com/api/authentication',
  categories: ['crm'],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://rest.breakcold.com/api/v1',
    retry: { defaultWaitMs: 60_000, wait: { path: 'error.retryAfterMs', unit: 'ms' } } },
  errors: { detail: 'error.code' },
  identify: { request: { path: '/workspaces', query: { limit: '100' } } },
  webhook: { kind: 'hmac', header: 'x-webhook-signature', signed: '{timestamp}.{body}', prefix: 'sha256=',
    timestamp: { header: 'x-webhook-timestamp' }, deliveryId: { header: 'x-webhook-delivery-id' } },
  paging: { cursor: { kind: 'cursor', next: 'pagination.cursor', more: 'pagination.hasMore', send: { query: 'cursor' } } },
});
