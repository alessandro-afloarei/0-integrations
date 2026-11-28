import { defineProvider } from '../catalogue.js';

/** AWeber API 1.0, OAuth 2 alone, an app made in a free AWeber Labs developer account. The account is the first one the
 * grant's `/accounts` lists, its id saved for every other path. A rate-limited request answers 403 "Rate Limit Error",
 * and none is answered for 60 seconds: https://docs.aweber.com/api/api/does-aweber-throttle-or-rate-limit-api-requests
 * Webhooks sign the `Date` header beside the body: https://api.aweber.com/#tag/Webhooks */
const subscriber = { id: 'integer', 'email?': 'string', 'name?': 'string', 'status?': 'string', 'is_verified?': 'boolean',
  'subscribed_at?': 'string', 'unsubscribed_at?': 'string', 'tags?': ['string'] } as const;
const broadcast = { broadcast_id: 'integer', 'uuid?': 'string', 'subject?': 'string', 'status?': 'string',
  'scheduled_for?': 'string', 'sent_at?': 'string' } as const;
const listId = { in: 'path', type: 'integer', required: true } as const;
const size = { in: 'query', type: 'integer', description: 'Entries a page, 100 by default.' } as const;
const ref = 'https://api.aweber.com/#tag';

export const aweber = defineProvider({
  id: 'aweber', name: 'AWeber', docs: `${ref}/Authentication-Overview`,
  categories: ['marketing'],
  // No PKCE: "Confidential Client MUST NOT Use PKCE" ("code_challenge and code_challenge_method are disallowed for
  // confidential clients"), and this sign-in is a confidential client: https://api.aweber.com/#tag/Troubleshooting
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.aweber.com/oauth2/authorize', tokenUrl: 'https://auth.aweber.com/oauth2/token',
    pkce: false, clientAuth: 'basic', authorizeParams: { response_type: 'code' } }],
  scopes: { default: ['account.read', 'list.read', 'subscriber.read', 'subscriber.write', 'email.read'] },
  http: { baseUrl: 'https://api.aweber.com/1.0/accounts/{accountId}', bases: { api: 'https://api.aweber.com/1.0' },
    retry: { defaultWaitMs: 60_000 },
    rateLimit: { when: [{ status: 403, path: 'error.message', equals: 'Rate Limit Error' }], defaultWaitMs: 60_000 } },
  identify: { request: { base: 'api', path: '/accounts' }, id: 'entries.0.id', name: 'entries.0.company' },
  save: { accountId: 'entries.0.id' },
  errors: { detail: 'error.type' },
  paging: { next: { kind: 'nextUrl', next: 'next_collection_link' } },
  operations: {
    'lists.list': { docs: `${ref}/Lists`, path: '/lists', paging: 'next', records: 'entries', params: { 'ws.size': size },
      result: { entries: [{ id: 'integer', 'name?': 'string', 'unique_list_id?': 'string', 'total_subscribers?': 'integer',
        'total_subscribed_subscribers?': 'integer' }] } },
    'subscribers.list': { docs: `${ref}/Subscribers`, path: '/lists/{listId}/subscribers', paging: 'next', records: 'entries',
      params: { listId, 'ws.size': size, sort_order: { in: 'query', type: 'string', enum: ['asc', 'desc'],
        description: 'By the order the subscribers were added to the list; asc by default.' } },
      result: { entries: [subscriber] } },
    'subscribers.get': { docs: `${ref}/Subscribers`, path: '/lists/{listId}/subscribers/{subscriberId}', notFound: 'null',
      params: { listId, subscriberId: { in: 'path', type: 'integer', required: true } }, result: subscriber },
    // Emails the person a confirmation message unless the list turns confirmation off for integrations (a paid plan):
    // https://docs.aweber.com/subscriber-management/subscribers/why-was-a-confirmation-message-sent-when-confirmat
    // Then the list's follow-ups start, the first an autoresponse, unless last_followup_message_number_sent is 1001.
    // update_existing 'true' updates a subscriber already on the list (else a 400); a 201 answers no body.
    'subscribers.create': { docs: `${ref}/Subscribers`, method: 'POST', path: '/lists/{listId}/subscribers', kind: 'write',
      params: { listId, email: { in: 'body', type: 'string', required: true }, name: { in: 'body', type: 'string' },
        misc_notes: { in: 'body', type: 'string' },
        last_followup_message_number_sent: { in: 'body', type: 'integer',
          description: 'The follow-up last sent: 0 (the default) sends the 1st (autoresponse) follow-up, and on an existing subscriber (update_existing) restarts its follow-ups; 1001 sends no follow-ups.' },
        update_existing: { in: 'body', type: 'string', enum: ['true', 'false'],
          description: 'true updates a subscriber already on the list (tags appended, its status unchanged) instead of answering 400.' } } },
    'subscribers.update': { docs: `${ref}/Subscribers`, method: 'PATCH', path: '/lists/{listId}/subscribers/{subscriberId}', kind: 'write',
      params: { listId, subscriberId: { in: 'path', type: 'integer', required: true }, name: { in: 'body', type: 'string' },
        email: { in: 'body', type: 'string' }, misc_notes: { in: 'body', type: 'string' },
        status: { in: 'body', type: 'string', enum: ['subscribed', 'unsubscribed'],
          description: 'The page lists both as writable ("you cannot set a subscriber\'s status to unconfirmed"); no page says what subscribed does for a person who unsubscribed.' } },
      result: subscriber },
    'broadcasts.list': { docs: `${ref}/Broadcasts`, path: '/lists/{listId}/broadcasts', paging: 'next', records: 'entries',
      params: { listId, status: { in: 'query', type: 'string', enum: ['draft', 'scheduled', 'sent'], required: true,
        description: 'draft returns only broadcast drafts made through the API.' }, 'ws.size': size },
      result: { entries: [broadcast] } },
    'broadcasts.get': { docs: `${ref}/Broadcasts`, path: '/lists/{listId}/broadcasts/{broadcastId}', notFound: 'null',
      params: { listId, broadcastId: { in: 'path', type: 'integer', required: true } }, result: broadcast },
  },
});
