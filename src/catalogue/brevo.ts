import { defineProvider } from '../catalogue.js';

/** Brevo: an API key for your own account; its Developer Terms bar an app from collecting or disclosing other accounts'
 * API keys (https://developers.brevo.com/docs/apps-developer-terms), and an app for other accounts is a public app
 * Brevo reviews: https://developers.brevo.com/docs/apps-public-apps. The email list answers one page; a send emails
 * its recipients, spending the plan's email credits: https://developers.brevo.com/reference/get-account */
const email = { 'uuid?': 'string', 'messageId?': 'string', 'email?': 'string', 'subject?': 'string', 'date?': 'string',
  'from?': 'string', 'templateId?': 'integer' } as const;
const recipient = { email: 'string', 'name?': 'string' } as const;
const ref = 'https://developers.brevo.com/reference';

export const brevo = defineProvider({
  id: 'brevo', name: 'Brevo', docs: 'https://developers.brevo.com/docs/api-key-authentication',
  categories: ['mail'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Brevo account: an API key from SMTP & API settings, then API keys (shown once). Every send uses the plan\'s email credits.' }],
  auth: [{ kind: 'key', send: { header: 'api-key' } }],
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
      params: { uuid: { in: 'path', type: 'string', required: true } }, result: email },
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
