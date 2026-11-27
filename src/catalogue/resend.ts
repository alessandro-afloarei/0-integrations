import { defineProvider } from '../catalogue.js';

/** Resend: OAuth 2 with PKCE, its client registered by the developer at /oauth/register as client_secret_basic, with no
 * review (it stays unverified): https://resend.com/docs/guides/building-a-resend-oauth-client; or an API key. A bad key
 * reads 400: https://resend.com/docs/api-reference/errors. Lists walk by `after`, the last record's id. A send emails
 * its recipients and counts toward the email quotas: https://resend.com/docs/api-reference/rate-limit */
const email = { id: 'string', 'message_id?': 'string', 'from?': 'string', 'to?': ['string'], 'subject?': 'string',
  'created_at?': 'string', 'last_event?': 'string' } as const;
const ref = 'https://resend.com/docs/api-reference';

export const resend = defineProvider({
  id: 'resend', name: 'Resend', docs: 'https://resend.com/docs/api-reference/introduction',
  categories: ['mail'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Resend team: a Full access key (a Sending access key cannot read emails or domains). It sends mail from the team\'s verified domains, and every send counts toward the plan\'s email quotas.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.resend.com/oauth/authorize', tokenUrl: 'https://api.resend.com/oauth/token',
    clientAuth: 'basic', authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: ['full_access'] },
  revoke: { url: 'https://api.resend.com/oauth/revoke', token: ['refresh'] },
  http: { baseUrl: 'https://api.resend.com', headers: { 'user-agent': '0-integrations' }, retry: {} },
  errors: { detail: 'name' },
  paging: { after: { kind: 'last', next: 'id', send: { query: 'after' }, list: 'data', more: 'has_more' } },
  // Svix's `svix-*` headers; the 300-second tolerance is the library's own:
  // https://resend.com/docs/webhooks/verify-webhooks-requests. The webhook's `whsec_` signing secret:
  // https://resend.com/docs/api-reference/webhooks/create-webhook. Signed as Svix signs:
  // https://docs.svix.com/receiving/verifying-payloads/how-manual. Deduped on `svix-id`:
  // https://resend.com/docs/webhooks/create-webhook
  webhook: { kind: 'standard', deliveryId: { header: 'svix-id' } },
  identify: { request: { path: '/domains' }, rejectWhen: [{ status: 400 }] },
  operations: {
    'emails.list': { docs: `${ref}/emails/list-emails`, path: '/emails', paging: 'after', records: 'data',
      params: { limit: { in: 'query', type: 'integer', description: '20 by default, at most 100.' } },
      result: { 'has_more?': 'boolean', data: [email] } },
    'emails.get': { docs: `${ref}/emails/retrieve-email`, path: '/emails/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true } }, result: email },
    'domains.list': { docs: `${ref}/domains/list-domains`, path: '/domains', paging: 'after', records: 'data',
      params: { limit: { in: 'query', type: 'integer', description: 'At most 100; without it every domain is returned in one page.' } },
      result: { 'has_more?': 'boolean', data: [{ id: 'string', 'name?': 'string', 'status?': 'string', 'created_at?': 'string',
        'region?': 'string' }] } },
    'emails.create': { docs: `${ref}/emails/send-email`, method: 'POST', path: '/emails', kind: 'write',
      params: { from: { in: 'body', type: 'string', required: true, description: 'The sender, an address or "Name <address>".' },
        to: { in: 'body', type: ['string'], required: true, description: 'A list of recipient addresses, one to 50.' },
        subject: { in: 'body', type: 'string', required: true }, html: { in: 'body', type: 'string' },
        text: { in: 'body', type: 'string' },
        'idempotency-key': { in: 'header', type: 'string',
          description: 'Up to 256 characters, unique per send: within 24 hours a repeat answers as the first did and sends nothing; another body is a 409.' } },
      result: { id: 'string' } },
  },
});
