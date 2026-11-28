import { defineProvider } from '../catalogue.js';

/** Loops: an API key as Bearer; `GET /v1/api-key` names the team and no id, so a sign-in checks the key. A 429 is
 * retried once (10 requests a second per team; campaigns 60 a minute): https://loops.so/docs/api-reference/intro.
 * Mailing lists are the audience; contacts are found, not listed; nothing here sends a campaign. Webhooks: Standard
 * Webhooks, deduped on `webhook-id`: https://loops.so/docs/webhooks */
const contact = { id: 'string', 'email?': 'string', 'firstName?': 'string', 'lastName?': 'string', 'subscribed?': 'boolean',
  'userGroup?': 'string', 'userId?': 'string', 'optInStatus?': 'string' } as const;
const fields = { firstName: { in: 'body', type: 'string' }, lastName: { in: 'body', type: 'string' },
  subscribed: { in: 'body', type: 'boolean', description: 'Whether the contact gets campaign and workflow emails; new contacts are subscribed. On an update false unsubscribes and true re-subscribes one who unsubscribed; leave it out otherwise.' },
  userGroup: { in: 'body', type: 'string' }, source: { in: 'body', type: 'string', description: 'API by default.' },
  mailingLists: { in: 'body', type: 'unknown', description: 'Mailing list ids, each true to add the contact or false to remove it.' } } as const;
const campaign = { id: 'string', url: 'string', name: 'string', status: 'string', createdAt: 'string', updatedAt: 'string',
  'emailMessageId?': 'string', 'mailingListId?': 'string' } as const;
const audience = { mailingListId: { in: 'body', type: 'string', nullable: true }, audienceSegmentId: { in: 'body', type: 'string', nullable: true },
  campaignGroupId: { in: 'body', type: 'string' } } as const;
const ref = 'https://loops.so/docs/api-reference';

export const loops = defineProvider({
  id: 'loops', name: 'Loops', docs: `${ref}/intro`,
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true, help: 'From Settings, API in Loops; it is shown once.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://app.loops.so/api', retry: {} },
  identify: { request: { path: '/v1/api-key' }, name: 'teamName' },
  webhook: { kind: 'standard', deliveryId: { header: 'webhook-id' } },
  paging: { cursor: { kind: 'cursor', next: 'pagination.nextCursor', send: { query: 'cursor' } } },
  operations: {
    'lists.list': { docs: `${ref}/list-mailing-lists`, path: '/v1/lists',
      result: [{ id: 'string', name: 'string', 'description?': 'string', isPublic: 'boolean' }] },
    'contacts.get': { docs: `${ref}/find-contact`, path: '/v1/contacts/find',
      params: { email: { in: 'query', type: 'string', description: 'Not with userId.' }, userId: { in: 'query', type: 'string', description: 'Not with email.' } },
      anyOf: [['email'], ['userId']], result: [contact] },
    // A new contact starts the "Contact added" workflows, and a list it joins through `mailingLists` its "Contact added
    // to list" ones; they email the contact, and no parameter stops them (the API has no double opt-in).
    'contacts.create': { docs: `${ref}/create-contact`, method: 'POST', path: '/v1/contacts/create',
      params: { email: { in: 'body', type: 'string', required: true }, userId: { in: 'body', type: 'string' }, ...fields },
      result: { success: 'boolean', id: 'string' } },
    // An upsert: it updates the contact found by email or userId, else creates one; a change starts the "Contact
    // updated" workflows (a new contact or list, as on create), which email the contact; no parameter stops them.
    'contacts.update': { docs: `${ref}/update-contact`, method: 'PUT', path: '/v1/contacts/update',
      params: { email: { in: 'body', type: 'string' }, userId: { in: 'body', type: 'string' }, ...fields },
      anyOf: [['email'], ['userId']], result: { success: 'boolean', id: 'string' } },
    'campaigns.list': { docs: `${ref}/list-campaigns`, path: '/v1/campaigns', paging: 'cursor', records: 'data',
      params: { perPage: { in: 'query', type: 'string', description: '10 to 50, 20 by default.' }, campaignGroupId: { in: 'query', type: 'string' } },
      result: { data: [campaign] } },
    'campaigns.get': { docs: `${ref}/get-campaign`, path: '/v1/campaigns/{campaignId}', notFound: 'null',
      params: { campaignId: { in: 'path', type: 'string', required: true } }, result: campaign },
    // Creates a draft campaign and its empty email message; nothing is sent, and no schedule is set here.
    'campaigns.create': { docs: `${ref}/create-campaign`, method: 'POST', path: '/v1/campaigns',
      params: { name: { in: 'body', type: 'string', required: true }, ...audience }, result: campaign },
    // An event starts the workflows it triggers, which email the contact, and no parameter stops them; the contact is
    // created or updated with it.
    'events.create': { docs: `${ref}/send-event`, method: 'POST', path: '/v1/events/send',
      params: { eventName: { in: 'body', type: 'string', required: true }, email: { in: 'body', type: 'string' },
        userId: { in: 'body', type: 'string' }, eventProperties: { in: 'body', type: 'unknown' },
        mailingLists: { in: 'body', type: 'unknown', description: 'Mailing list ids, each true to add the contact or false to remove it.' },
        'idempotency-key': { in: 'header', type: 'string', description: 'Up to 100 characters, unique per request, to avoid duplicate emails.' } },
      anyOf: [['email'], ['userId']], result: { success: 'boolean' } },
  },
});
