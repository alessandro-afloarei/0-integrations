import { defineProvider } from '../catalogue.js';

/** Typeform: OAuth 2 (an app registered under Organization > Developer Apps), or a personal access token; `GET /me`
 * is a credential check (https://www.typeform.com/developers/get-started/scopes/). Errors carry a `code`:
 * https://www.typeform.com/developers/troubleshooting/ */
const form = { id: 'string', 'title?': 'string', '_links?': { 'display?': 'string', 'responses?': 'string' },
  'settings?': { 'is_public?': 'boolean' } } as const;
const formId = { form_id: { in: 'path', type: 'string', required: true,
  description: 'The form\'s id, in its URL: u6nXL7 in https://mysite.typeform.com/to/u6nXL7.' } } as const;
/** Accounts on the EU Responses Data Center read their responses on its host, and tokens work on both; the new EU
 * data center (api.typeform.eu) has its own sign-in:
 * https://www.typeform.com/developers/get-started/responses-data-center/ */
const hosts = ['api.typeform.com', 'api.eu.typeform.com'] as const;
const reference = 'https://www.typeform.com/developers';

export const typeform = defineProvider({
  id: 'typeform', name: 'Typeform', docs: 'https://www.typeform.com/developers/get-started/applications/',
  categories: ['marketing'],
  fields: [{ name: 'apiHost', title: 'Responses Data Center', choices: hosts, default: 'api.typeform.com',
    help: 'api.typeform.com, or api.eu.typeform.com for an account configured to store responses in the EU Data Center (Typeform Enterprise with the EU Responses Data Center enabled). On the other host the responses come back empty. An account under the new EU data center (api.typeform.eu) is not supported.' },
  { name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'From Account > Personal tokens: Generate a new token with the accounts:read, forms:read and responses:read scopes. It is unique to you and reaches your own typeforms and their responses.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.typeform.com/oauth/authorize', tokenUrl: 'https://api.typeform.com/oauth/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  // `offline` is what returns a refresh token; each refresh replaces it.
  scopes: { default: ['offline', 'accounts:read', 'forms:read', 'responses:read'] },
  http: { baseUrl: 'https://{apiHost}', host: hosts },
  errors: { detail: 'code' },
  identify: { request: { path: '/me' } },
  // `Typeform-Signature: sha256=<base64 HMAC-SHA256>` of the body, keyed by the secret set on the webhook:
  // https://www.typeform.com/developers/webhooks/secure-your-webhooks/
  // No delivery id: the payload's `event_id` is "Unique ID for the webhook", the words of the webhook's own `id`:
  // https://www.typeform.com/developers/webhooks/example-payload/
  webhook: { kind: 'hmac', header: 'typeform-signature', prefix: 'sha256=', encoding: 'base64' },
  paging: { forms: { kind: 'page', send: { query: 'page' }, list: 'items', total: { pages: 'page_count' } },
    responses: { kind: 'last', next: 'token', send: { query: 'before' }, list: 'items' } },
  operations: {
    'forms.list': { docs: `${reference}/create/reference/retrieve-forms/`, path: '/forms', paging: 'forms', records: 'items',
      params: { page_size: { in: 'query', type: 'number', description: '10 by default, at most 200.' },
        workspace_id: { in: 'query', type: 'string', description: 'Only the forms of this workspace.' } },
      result: { items: [{ ...form, 'created_at?': 'string', 'last_updated_at?': 'string' }] } },
    'forms.get': { docs: `${reference}/create/reference/retrieve-form/`, path: '/forms/{form_id}', notFound: 'null', params: formId,
      result: form },
    // Each next page sends `before` the last response's `token`, until all are read:
    // https://www.typeform.com/developers/responses/walkthroughs/
    'responses.list': { docs: `${reference}/responses/reference/retrieve-responses/`, path: '/forms/{form_id}/responses',
      paging: 'responses', records: 'items',
      params: { ...formId, page_size: { in: 'query', type: 'integer', description: '25 by default, at most 1000.' },
        since: { in: 'query', type: 'string', description: 'Submitted at or after: epoch seconds, or ISO 8601 in UTC (2020-03-20T14:00:59).' },
        until: { in: 'query', type: 'string', description: 'Submitted at or before: epoch seconds, or ISO 8601 in UTC.' },
        after: { in: 'query', type: 'string',
          description: 'Only responses submitted after this response\'s token (a cursor, exclusive).' } },
      result: { items: [{ response_id: 'string', 'token?': 'string', 'landed_at?': 'string', 'submitted_at?': 'string',
        'answers?': 'unknown', 'hidden?': 'unknown', 'calculated?': { 'score?': 'number' } }] } },
  },
});
