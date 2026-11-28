import { defineProvider } from '../catalogue.js';

/** Attentive: OAuth 2 for a public app made in Attentive, installed on other companies by its distribution URL (only a
 * marketplace listing is approved by Attentive; the company that made the app cannot authorize it), or a custom app's
 * API key. An event can trigger a custom event journey: https://docs.attentive.com/docs/create-and-manage-custom-apps
 * Webhooks: hex HMAC-SHA256 of the body, keyed by the webhook's signing key. */
const ref = 'https://docs.attentive.com/reference';
const user = { 'phone?': 'string', 'email?': 'string' } as const;

export const attentive = defineProvider({
  id: 'attentive', name: 'Attentive', docs: 'https://docs.attentive.com/docs/authentication',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Attentive account: the API key of a custom app you create in Attentive, with Write on Subscribers, Custom Events and Custom Attributes. An app for other Attentive accounts connects with the OAuth 2 sign-in, as Attentive requires of public apps.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://ui.attentivemobile.com/integrations/oauth-install',
    tokenUrl: 'https://api.attentivemobile.com/v1/authorization-codes/tokens', authorizeParams: { response_type: 'code' } },
  { kind: 'key' }],
  // Scopes are set on the app and none is sent: subscriptions:write, events:write, attributes:write
  // (https://docs.attentive.com/docs/authentication), and segments:Read for segments.list.
  scopes: { default: [] },
  // 150 requests a second for most endpoints, fewer on some: https://docs.attentive.com/docs/api-rate-limits
  http: { baseUrl: 'https://api.attentivemobile.com', retry: {} },
  identify: { request: { path: '/v1/me' }, id: 'companyId', name: 'companyName' },
  // https://docs.attentive.com/docs/webhook-authentication
  webhook: { kind: 'hmac', header: 'x-attentive-hmac-sha256' },
  paging: { segments: { kind: 'cursor', next: 'cursor', more: 'hasMore', send: { query: 'cursor' } } },
  operations: {
    'segments.list': { docs: `${ref}/listsegments`, path: '/v2/segments', paging: 'segments', records: 'segments',
      params: { name: { in: 'query', type: 'string', description: 'A part of the segment\'s name.' },
        limit: { in: 'query', type: 'integer', description: '20 by default, at most 1000.' } },
      result: { segments: [{ 'externalId?': 'string', 'name?': 'string', 'description?': 'string', 'created?': 'string',
        'updated?': 'string' }] } },
    // Opts a person in: texts "Reply Y" unless `singleOptIn`, and the mandatory legal message either way; a person
    // already subscribed by TEXT gets a text saying so. A legal disclosure is required.
    'subscriptions.create': { docs: `${ref}/addsubscriptions`, method: 'POST', path: '/v1/subscriptions',
      anyOf: [['signUpSourceId', 'user.phone'], ['signUpSourceId', 'user.email'], ['locale', 'subscriptionType', 'user.phone'],
        ['locale', 'subscriptionType', 'user.email']],
      params: { user: { in: 'body', type: user, required: true, description: 'The phone number in E.164 format, or the email.' },
        signUpSourceId: { in: 'body', type: 'string', description: 'An API sign-up unit\'s id, from the Sign-up Units tab.' },
        locale: { in: 'body', type: { language: 'string', country: 'string' },
          description: 'ISO 639-1 and ISO 3166-1 alpha-2 codes; with subscriptionType it must match exactly one API sign-up unit.' },
        subscriptionType: { in: 'body', type: 'string', enum: ['MARKETING', 'TRANSACTIONAL'] },
        singleOptIn: { in: 'body', type: 'boolean',
          description: 'true opts the subscriber in silently: no "Reply Y" text; the mandatory legal message is still sent.' } },
      result: { 'subscriptionResponses?': [{ 'subscription?': { 'type?': 'string', 'channel?': 'string' },
        'subscriptionCreationStatus?': 'string' }] } },
    // Creates a user or updates an existing one; no subscription is declared, so it opts no one in.
    'users.create': { docs: `${ref}/postuserattributes`, method: 'POST', path: '/v2/user/attributes',
      params: { identifiers: { in: 'body', type: { ...user, 'clientUserId?': 'string' } },
        attributes: { in: 'body', type: { 'firstName?': 'string', 'lastName?': 'string', 'custom?': 'unknown' },
          description: 'custom: up to 100 custom attributes, each a number, boolean, string, date or enum value.' } },
      result: { 'success?': 'boolean', 'message?': 'string' } },
    'events.create': { docs: `${ref}/postcustomevents`, method: 'POST', path: '/v1/events/custom',
      anyOf: [['user.phone'], ['user.email'], ['user.externalIdentifiers']],
      params: { type: { in: 'body', type: 'string', required: true, description: 'The event type, case sensitive.' },
        user: { in: 'body', type: { ...user, 'externalIdentifiers?': { 'clientUserId?': 'string' } }, required: true,
          description: 'An external identifier must already be associated with a phone or email.' },
        properties: { in: 'body', type: 'unknown' }, externalEventId: { in: 'body', type: 'string' },
        occurredAt: { in: 'body', type: 'string' } } },
  },
});
