import { defineProvider } from '../catalogue.js';

/** Brevo: OAuth 2 as a public app, which Brevo reviews before other accounts authorize it, or an API key for your own
 * account; its Developer Terms bar an app from collecting other accounts' API keys:
 * https://developers.brevo.com/docs/apps-developer-terms. The email list answers one page; a send emails its
 * recipients, spending the plan's email credits: https://developers.brevo.com/reference/get-account */
const email = { 'uuid?': 'string', 'messageId?': 'string', 'email?': 'string', 'subject?': 'string', 'date?': 'string',
  'from?': 'string', 'templateId?': 'integer' } as const;
const recipient = { email: 'string', 'name?': 'string' } as const;
const ref = 'https://developers.brevo.com/reference';

export const brevo = defineProvider({
  id: 'brevo', name: 'Brevo', docs: 'https://developers.brevo.com/docs/apps-public-apps',
  categories: ['mail'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Brevo account (an app for other Brevo accounts connects with the OAuth 2 sign-in): an API key from SMTP & API settings, then API keys (shown once). Every send uses the plan\'s email credits.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://oauth.brevo.com/realms/partner/oauth/authorize',
    tokenUrl: 'https://oauth.brevo.com/realms/partner/oauth/token', clientAuth: 'none', authorizeParams: { response_type: 'code' } },
  { kind: 'key', send: { header: 'api-key' } }],
  // Each must be registered on the app (a new app has the contacts and CRM ones; else `invalid_scope`), and `:write`
  // does not include `:read`: https://developers.brevo.com/docs/oauth-scopes
  scopes: { default: ['account:read', 'transactional.email:read', 'transactional.email:write'] },
  // A 429's reset header counts in the limit's own unit: https://developers.brevo.com/docs/limit-headers
  http: { baseUrl: 'https://api.brevo.com/v3', retry: { onlyStated: true } },
  errors: { detail: 'code' },
  identify: { request: { path: '/account' }, id: 'organization_id', name: ['companyName', 'email'] },
  operations: {
    'emails.list': { docs: `${ref}/get-transac-emails-list`, path: '/smtp/emails',
      params: { email: { in: 'query', type: 'string', description: 'The recipient.' }, templateId: { in: 'query', type: 'integer' },
        messageId: { in: 'query', type: 'string' }, limit: { in: 'query', type: 'integer', description: '500 by default.' },
        offset: { in: 'query', type: 'integer', description: 'The index of the first email, 0 by default.' } },
      anyOf: [['email'], ['templateId'], ['messageId']],
      result: { 'count?': 'integer', 'transactionalEmails?': [email] } },
    'emails.get': { docs: `${ref}/get-transac-email-content`, path: '/smtp/emails/{uuid}', notFound: 'null',
      params: { uuid: { in: 'path', type: 'string', required: true } }, result: { date: 'string', email: 'string',
        events: [{ name: 'string', time: 'string' }], subject: 'string', 'attachmentCount?': 'integer', 'body?': 'string',
        'templateId?': 'integer' } },
    'domains.list': { docs: `${ref}/get-domains`, path: '/senders/domains',
      result: { domains: [{ id: 'string', 'domain_name?': 'string', 'authenticated?': 'boolean', 'verified?': 'boolean',
        'provider?': 'string' }] } },
    'emails.create': { docs: `${ref}/send-transac-email`, method: 'POST', path: '/smtp/email', kind: 'write',
      params: { sender: { in: 'body', type: { email: 'string', 'name?': 'string' }, required: true,
        description: 'The sender\'s address, and its name.' },
      to: { in: 'body', type: [recipient], required: true }, subject: { in: 'body', type: 'string', required: true },
      htmlContent: { in: 'body', type: 'string', required: true }, textContent: { in: 'body', type: 'string' } },
      result: { 'messageId?': 'string' } },
  },
});
