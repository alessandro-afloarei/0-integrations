import { defineProvider } from '../catalogue.js';

/** Aircall: 120 requests a minute per company, and an overrun blocks the key for 60 seconds. Basic auth from the
 * API ID and the API token. */
export const aircall = defineProvider({
  id: 'aircall', name: 'Aircall',
  docs: 'https://developers.aircall.io/api-references',
  categories: ['phone'],
  fields: [{ name: 'apiId', title: 'API ID' }, { name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own Aircall account: Aircall keeps API keys for your own tools, and an integration for other companies uses OAuth 2 as an approved Technology Partner.' }],
  auth: [{ kind: 'key', send: { basic: ['{apiId}', '{apiToken}'] } }],
  http: { baseUrl: 'https://api.aircall.io/v1', retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/company' }, id: '{connection.apiId}', name: 'company.name' },
  operations: { 'calls.transcript': { docs: 'https://developers.aircall.io/api-references#retrieve-a-transcription',
    path: '/calls/{callId}/transcription',
    params: { callId: { in: 'path', type: 'integer', required: true } }, result: 'unknown', notFound: 'null' } },
});
