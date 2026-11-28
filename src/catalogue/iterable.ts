import { defineProvider } from '../catalogue.js';

/** Iterable: a project's server-side API key in `Api-Key`, on the project's data center. No endpoint names the
 * project: identify checks the key on its lists. A user update's 429 states its wait in `params.rateLimitReset`
 * (seconds). `users.create` adds a user or updates an existing one; an event can enter users into a journey triggered
 * by it; `campaigns.create` makes a blast campaign with `scheduleSend: false`, so nothing is scheduled or sent. */
const spec = 'https://api.iterable.com/api-docs';
/** The US and the EU data centers: https://api.iterable.com/api-docs and https://api.eu.iterable.com/api-docs */
const hosts = ['api.iterable.com', 'api.eu.iterable.com'] as const;
const campaign = { id: 'number', 'name?': 'string', 'campaignState?': 'string', 'type?': 'string', 'messageMedium?': 'string',
  'createdAt?': 'integer', 'updatedAt?': 'integer', 'startAt?': 'integer' } as const;
const user = { email: { in: 'body', type: 'string' }, userId: { in: 'body', type: 'string' } } as const;
const answer = { code: 'string', msg: 'string' } as const;

export const iterable = defineProvider({
  id: 'iterable', name: 'Iterable', docs: 'https://api.iterable.com/api/docs',
  categories: ['marketing'],
  fields: [{ name: 'apiHost', title: 'Data center', choices: hosts, default: 'api.iterable.com',
    help: 'Where the project is hosted: api.iterable.com in the US, api.eu.iterable.com in the EU.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'A Server-side API key of the project (a Read-only key reads lists and campaigns but cannot get or write users), not a key that requires a JWT Authorization header. The key reads the project\'s lists to sign in.' }],
  auth: [{ kind: 'key', send: { header: 'api-key' } }],
  http: { baseUrl: 'https://{apiHost}', host: hosts, retry: { wait: { path: 'params.rateLimitReset', unit: 's' } } },
  errors: { detail: 'code' },
  identify: { request: { path: '/api/lists' } },
  // The Authorization header set on a system webhook, compared whole: "Basic <token>" as entered, or "Bearer <token>"
  // for its OAuth 2.0 option; nothing is signed and no id dedupes a retry:
  // https://support.iterable.com/hc/en-us/articles/208013936-System-Webhooks
  webhook: { kind: 'token', header: 'authorization' },
  paging: { campaigns: { kind: 'page', send: { query: 'page' }, list: 'campaigns' } },
  operations: {
    'lists.list': { docs: spec, path: '/api/lists',
      result: { lists: [{ id: 'integer', 'name?': 'string', 'listType?': 'string', 'description?': 'string', 'createdAt?': 'integer' }] } },
    'users.get': { docs: spec, path: '/api/users/{email}',
      params: { email: { in: 'path', type: 'string', required: true, description: 'The user\'s email address.' } },
      result: { 'user?': { email: 'string', 'userId?': 'string', 'dataFields?': 'unknown' } } },
    // Can enter the user into a journey whose entry source is a profile update or a new user, which can message them:
    // https://support.iterable.com/hc/en-us/articles/15934993720468-Start-Tile
    'users.create': { docs: spec, method: 'POST', path: '/api/users/update', anyOf: [['email'], ['userId']],
      params: { ...user, dataFields: { in: 'body', type: 'unknown', description: 'The data stored on the user profile; merged, so missing fields are kept.' },
        mergeNestedObjects: { in: 'body', type: 'boolean' },
        preferUserId: { in: 'body', type: 'boolean', description: 'Creates a user whose new userId the request names (email-based projects).' } },
      result: answer },
    // Can enter each subscriber into a journey started by subscribing to the list (a welcome series, same page).
    'subscriptions.create': { docs: spec, method: 'POST', path: '/api/lists/subscribe',
      params: { listId: { in: 'body', type: 'integer', required: true },
        subscribers: { in: 'body', type: [{ 'email?': 'string', 'userId?': 'string', 'dataFields?': 'unknown' }], required: true,
          description: 'Each subscriber names an email or a userId, as the project identifies users.' },
        updateExistingUsersOnly: { in: 'body', type: 'boolean', description: 'true skips users who do not exist yet (userID-based and hybrid projects).' } },
      result: { successCount: 'integer', failCount: 'integer' } },
    'events.create': { docs: spec, method: 'POST', path: '/api/events/track', anyOf: [['email'], ['userId']],
      params: { eventName: { in: 'body', type: 'string', required: true }, ...user, dataFields: { in: 'body', type: 'unknown' },
        createdAt: { in: 'body', type: 'integer', description: 'When the event happened, a Unix timestamp; the time received by default.' },
        id: { in: 'body', type: 'string', description: 'An event of that id is updated.' } },
      result: answer },
    'campaigns.list': { docs: spec, path: '/api/campaigns', paging: 'campaigns', records: 'campaigns',
      params: { pageSize: { in: 'query', type: 'integer', required: true,
        description: 'Campaigns a page, at most 1000. It turns paging on: a project may answer every campaign without it.' },
      sort: { in: 'query', type: 'string', description: 'id, name, createdAt, updatedAt or startAt, - first for descending.' } },
      result: { campaigns: [campaign] } },
    'campaigns.get': { docs: spec, path: '/api/campaigns/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'integer', required: true } }, result: campaign },
    'campaigns.create': { docs: spec, method: 'POST', path: '/api/campaigns/create',
      params: { name: { in: 'body', type: 'string', required: true },
        templateId: { in: 'body', type: 'number', required: true, description: 'The campaign gets a copy of this template.' },
        listIds: { in: 'body', type: ['integer'], required: true, description: 'The lists the campaign is for (a blast campaign).' },
        scheduleSend: { in: 'body', type: false, required: true, description: 'false: the campaign is created without being scheduled.' },
        suppressionListIds: { in: 'body', type: ['integer'], description: 'Global suppression lists are not added on their own.' } },
      result: { campaignId: 'number' } },
  },
});
