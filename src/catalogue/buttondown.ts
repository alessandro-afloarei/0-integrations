import { defineProvider } from '../catalogue.js';

/** Buttondown API v1, pinned to version 2026-11-10 (without `X-API-Version` a request gets the newsletter's pinned
 * version): https://docs.buttondown.com/api-versioning. `/accounts/me` names a username and an email, neither called
 * unique, so a sign-in only checks the key. A 429 waits its `Retry-After`: https://docs.buttondown.com/api-rate-limits
 * Webhooks sign the raw body (HMAC-SHA256, `sha256=` and hex): https://docs.buttondown.com/api-webhooks-introduction */
const subscriber = { id: 'string', email_address: 'string', type: 'string', tags: ['string'], creation_date: 'string',
  'notes?': 'string', 'metadata?': 'unknown', 'unsubscription_date?': 'string' } as const;
const email = { id: 'string', subject: 'string', status: 'string', creation_date: 'string', modification_date: 'string',
  absolute_url: 'string', 'publish_date?': 'string', 'slug?': 'string' } as const;
const subscriberKey = { in: 'path', type: 'string', required: true, description: 'The ID or email address of the subscriber.' } as const;
const ref = 'https://docs.buttondown.com';

export const buttondown = defineProvider({
  id: 'buttondown', name: 'Buttondown', docs: `${ref}/api-authentication`,
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Manage your keys under API, Keys. A key other than the primary one needs subscriber_access and email_access set to write; no call here needs sending_access.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Token {apiKey}' } }],
  http: { baseUrl: 'https://api.buttondown.com/v1', headers: { 'x-api-version': '2026-11-10' }, retry: {} },
  // https://docs.buttondown.com/api-accounts-me
  identify: { request: { path: '/accounts/me' } },
  errors: { detail: 'code' },
  // `id`: "The unique TypeID of the event that triggered this delivery." (the OpenAPI's `webhooks.event`)
  webhook: { kind: 'hmac', header: 'x-buttondown-signature', prefix: 'sha256=', deliveryId: { body: ['id'] } },
  paging: { next: { kind: 'nextUrl', next: 'next' } },
  operations: {
    'tags.list': { docs: `${ref}/api-tags-list`, path: '/tags', paging: 'next', records: 'results',
      params: { page_size: { in: 'query', type: 'integer', description: 'Results a page, 100 by default.' } },
      result: { results: [{ id: 'string', name: 'string', color: 'string', creation_date: 'string', 'description?': 'string' }] } },
    'subscribers.list': { docs: `${ref}/api-subscribers-list`, path: '/subscribers', paging: 'next', records: 'results',
      params: { email_address: { in: 'query', type: 'string', description: 'Subscribers whose email address contains the given string.' },
        tag: { in: 'query', type: 'string', description: 'Subscribers with this tag.' },
        type: { in: 'query', type: 'string', description: 'Subscribers of this type (regular, unsubscribed, unactivated, …).' } },
      result: { results: [subscriber] } },
    'subscribers.get': { docs: `${ref}/api-subscribers-retrieve`, path: '/subscribers/{id_or_email}', notFound: 'null',
      params: { id_or_email: subscriberKey }, result: subscriber },
    // Emails the person a request to confirm (double opt-in), unactivated until they do, unless type is regular; the
    // account's automations on a new, confirmed or tagged subscriber can email them too. One already there is a 400.
    // 100 creates a day (a 400 past them). https://docs.buttondown.com/automation-metadata-sequences
    // https://docs.buttondown.com/automation-tag-triggers
    'subscribers.create': { docs: `${ref}/api-subscribers-create`, method: 'POST', path: '/subscribers', kind: 'write',
      params: { email_address: { in: 'body', type: 'string', required: true }, tags: { in: 'body', type: ['string'],
        description: 'Tag names; a tag that does not exist is created, which needs a plan with tags.' },
        notes: { in: 'body', type: 'string' }, metadata: { in: 'body', type: 'unknown' },
        type: { in: 'body', type: 'regular',
          description: 'Skips the confirmation email: "disable it on a per-subscriber basis by providing a type of regular".' } },
      result: subscriber },
    // Changing tags, metadata or notes can start the account's automations, which can email the subscriber.
    'subscribers.update': { docs: `${ref}/api-subscribers-update`, method: 'PATCH', path: '/subscribers/{id_or_email}', kind: 'write',
      params: { id_or_email: subscriberKey, email_address: { in: 'body', type: 'string' }, tags: { in: 'body', type: ['string'] },
        notes: { in: 'body', type: 'string' }, metadata: { in: 'body', type: 'unknown' },
        type: { in: 'body', type: 'string', enum: ['regular', 'unsubscribed'],
          description: 'regular reactivates an unsubscribed subscriber with no confirmation email; unsubscribed applies only to an active subscriber and cancels a premium one\'s Stripe subscription.' } },
      result: subscriber },
    'emails.list': { docs: `${ref}/api-emails-list`, path: '/emails', paging: 'next', records: 'results',
      params: { status: { in: 'query', type: 'string', description: 'Emails with this status (draft, scheduled, sent, …).' } },
      result: { results: [email] } },
    'emails.get': { docs: `${ref}/api-emails-retrieve`, path: '/emails/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'string', required: true } }, result: email },
    // Creates a draft and sends nothing: `status` is fixed to `draft` ("only visible to you and … not sent out to
    // subscribers"); without it an email is created `about_to_send`. The person sends it from Buttondown.
    'emails.create': { docs: `${ref}/api-emails-create`, method: 'POST', path: '/emails', kind: 'write',
      params: { subject: { in: 'body', type: 'string', required: true }, status: { in: 'body', type: 'draft', required: true },
        body: { in: 'body', type: 'string', description: 'Markdown or HTML.' } }, result: email },
  },
});
