import { defineProvider } from '../catalogue.js';

/** Mailjet Email API: Basic with the public and private API keys; lists page by `Offset`, the first record's index:
 * https://dev.mailjet.com/docs/email-api/email-api-overview/pagination. A 429 asks to wait and back off:
 * https://dev.mailjet.com/docs/email-api/email-api-overview/rate-limits. A send emails its recipients and spends the
 * plan's emails: https://www.mailjet.com/pricing/ */
/** The US host is for an account moved to Mailjet's US architecture: https://github.com/mailjet/mailjet-apiv3-nodejs */
const hosts = ['api.mailjet.com', 'api.us.mailjet.com'] as const;
const message = { ID: 'integer', 'UUID?': 'string', 'Status?': 'string', 'ArrivedAt?': 'string', 'Subject?': 'string',
  'ContactAlt?': 'string', 'SenderID?': 'integer', 'ContactID?': 'integer' } as const;
const limit = { Limit: { in: 'query', type: 'integer', description: '10 by default, at most 1000.' } } as const;
const address = { Email: 'string', 'Name?': 'string' } as const;
const ref = 'https://dev.mailjet.com/openapi/openapi-mailjet';

export const mailjet = defineProvider({
  id: 'mailjet', name: 'Mailjet', docs: `${ref}/settings/get_v3_user`,
  categories: ['mail'],
  fields: [{ name: 'apiHost', title: 'Mailjet host', choices: hosts, default: 'api.mailjet.com',
    help: 'api.mailjet.com, or api.us.mailjet.com for an account moved to Mailjet\'s US architecture.' },
  { name: 'publicKey', title: 'Public API key' },
  { name: 'privateKey', title: 'Private API key', secret: true,
    help: 'For your own Mailjet account: both keys are under Account Settings, then API Keys. A send must come from an active sender, and every email counts toward the plan (Free: 6,000 a month, 200 a day).' }],
  auth: [{ kind: 'key', send: { basic: ['{publicKey}', '{privateKey}'] } }],
  http: { baseUrl: 'https://{apiHost}', host: hosts, retry: {} },
  errors: { detail: ['ErrorCode', 'Messages.0.Errors.0.ErrorCode'] },
  identify: { request: { path: '/v3/REST/user' }, id: 'Data.0.ID', name: ['Data.0.Username', 'Data.0.Email'] },
  paging: { offset: { kind: 'offset', send: { query: 'Offset' }, list: 'Data' } },
  operations: {
    'messages.list': { docs: `${ref}/messages/get_v3_message`, path: '/v3/REST/message', paging: 'offset', records: 'Data',
      params: { ...limit, ShowSubject: { in: 'query', type: 'boolean', description: 'True to read each message\'s Subject.' },
        ShowContactAlt: { in: 'query', type: 'boolean', description: 'True to read each recipient\'s address as ContactAlt.' } },
      result: { Data: [message] } },
    'messages.get': { docs: `${ref}/messages/get_v3_message_id`, path: '/v3/REST/message/{message_ID}', notFound: 'null',
      params: { message_ID: { in: 'path', type: 'integer', required: true } }, result: { Data: [message] } },
    'dns.list': { docs: `${ref}/sender-addresses-and-domains/get_v3_dns`, path: '/v3/REST/dns', paging: 'offset', records: 'Data',
      params: limit,
      result: { Data: [{ ID: 'integer', 'Domain?': 'string', 'DKIMStatus?': 'string', 'SPFStatus?': 'string', 'LastCheckAt?': 'string',
        'IsCheckInProgress?': 'boolean' }] } },
    'messages.create': { docs: `${ref}/send-emails/postsendv31`, method: 'POST', path: '/v3.1/send', kind: 'write',
      params: { Messages: { in: 'body', required: true,
        type: [{ From: address, To: [address], 'Subject?': 'string', 'TextPart?': 'string', 'HTMLPart?': 'string' }],
        description: 'At most 50 messages; each needs a TextPart or an HTMLPart.' } },
      result: { 'Messages?': [{ 'Status?': 'string', 'To?': [{ 'Email?': 'string', 'MessageUUID?': 'string', 'MessageID?': 'integer' }] }] } },
  },
});
