import { defineProvider } from '../catalogue.js';

/** Postmark: a server's Server Token, no OAuth 2; a third-party application that interacts with the Service needs
 * Postmark's prior written consent: https://postmarkapp.com/terms-of-service. Domains need the whole account's token,
 * so are left out; a 429 asks to slow down; ErrorCode is a number: https://postmarkapp.com/developer/api/overview
 * Lists are one page; a send emails its recipients, spending the plan's emails: https://postmarkapp.com/pricing.txt */
const message = { MessageID: 'string', 'Subject?': 'string', 'From?': 'string', 'Recipients?': 'unknown', 'Status?': 'string',
  'ReceivedAt?': 'string', 'Tag?': 'string', 'MessageStream?': 'string' } as const;
const ref = 'https://postmarkapp.com/developer/api';

export const postmark = defineProvider({
  id: 'postmark', name: 'Postmark', docs: 'https://postmarkapp.com/developer/api/overview',
  categories: ['mail'],
  fields: [{ name: 'serverToken', title: 'Server API token', secret: true,
    help: 'For your own Postmark server: its Server API Token, on the server\'s API Tokens tab (Account Owners, Account Admins and Server Admins see it). A send needs a confirmed sender signature; while the account is pending approval, every recipient must share the From address\'s domain. Every email counts toward the plan (Free: 100 a month, no overages).' }],
  auth: [{ kind: 'key', send: { header: 'x-postmark-server-token' } }],
  http: { baseUrl: 'https://api.postmarkapp.com', headers: { accept: 'application/json' }, retry: {} },
  errors: { detail: 'ErrorCode', rules: [{ when: { detail: '701' }, code: 'not_found' }] },
  identify: { request: { path: '/server' }, id: 'ID', name: 'Name' },
  // Nothing is signed: the app puts a user and password in the webhook's URL and passes
  // `user:password` as the secret; X-PM-Webhook-Trace-Id stays the same across retries of one event:
  // https://postmarkapp.com/developer/webhooks/webhooks-overview
  webhook: { kind: 'basic', deliveryId: { header: 'x-pm-webhook-trace-id' } },
  operations: {
    'messages.list': { docs: `${ref}/messages-api#outbound-message-search`, path: '/messages/outbound',
      params: { count: { in: 'query', type: 'integer', required: true, description: 'At most 500; count and offset together at most 10,000.' },
        offset: { in: 'query', type: 'integer', required: true, description: 'Messages to skip, 0 for the first page.' },
        messagestream: { in: 'query', type: 'string', description: 'The stream; outbound, the transactional one, by default.' } },
      result: { 'TotalCount?': 'integer', Messages: [message] } },
    'messages.get': { docs: `${ref}/messages-api#outbound-message-details`, path: '/messages/outbound/{messageid}/details',
      notFound: 'null', params: { messageid: { in: 'path', type: 'string', required: true } }, result: message },
    'messages.create': { docs: `${ref}/email-api#send-a-single-email`, method: 'POST', path: '/email', kind: 'write',
      params: { From: { in: 'body', type: 'string', required: true, description: 'A confirmed sender signature\'s address.' },
        To: { in: 'body', type: 'string', required: true, description: 'Comma-separated; at most 50 recipients with Cc and Bcc.' },
        Subject: { in: 'body', type: 'string' }, HtmlBody: { in: 'body', type: 'string' }, TextBody: { in: 'body', type: 'string' },
        MessageStream: { in: 'body', type: 'string', description: 'The stream it is sent on; outbound by default.' } },
      anyOf: [['HtmlBody'], ['TextBody']],
      result: { 'To?': 'string', 'SubmittedAt?': 'string', MessageID: 'string' } },
  },
});
