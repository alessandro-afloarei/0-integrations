import { defineProvider } from '../catalogue.js';

/** Breakcold's documented error object is `{ error: { code, message, requestId, retryAfterMs? } }`. */
export const breakcold = defineProvider({
  id: 'breakcold', name: 'Breakcold', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://rest.breakcold.com/api/v1',
    retry: { defaultWaitMs: 0, waitFromBody: { path: 'error.retryAfterMs', unit: 'ms' } } },
  errors: { detail: 'error.code' },
  identify: { request: { path: '/workspaces', query: { limit: '100' } } },
  webhook: { kind: 'hmac', header: 'x-webhook-signature', signed: '{timestamp}.{body}', prefix: 'sha256=',
    timestamp: { header: 'x-webhook-timestamp' }, deliveryId: { header: 'x-webhook-delivery-id' } },
});
