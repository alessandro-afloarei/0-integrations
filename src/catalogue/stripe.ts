import { defineProvider } from '../catalogue.js';

/** Stripe: a secret or restricted key as a bearer token; `GET /v1/balance` checks it. Webhooks sign `t.body` with
 * HMAC-SHA256 in `Stripe-Signature: t=…,v1=…`, one `v1` per active secret while one rolls. */
export const stripe = defineProvider({
  id: 'stripe', name: 'Stripe', docs: 'https://docs.stripe.com/api/authentication',
  fields: [{ name: 'secretKey', title: 'Secret key', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.stripe.com/v1' },
  errors: { detail: 'error.code' },
  identify: { request: { path: '/balance' } },
  webhook: { kind: 'hmac', header: 'stripe-signature', signed: '{timestamp}.{body}', part: 'v1', timestamp: { part: 't' },
    deliveryId: { body: ['id'] } },
});
