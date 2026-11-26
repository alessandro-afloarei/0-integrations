import { defineProvider } from '../catalogue.js';

/** Instantly API v2: a key scoped when it is made (https://developer.instantly.ai/getting-started/getting-started); a
 * 429 past limits shared by the whole workspace (https://developer.instantly.ai/getting-started/rate-limit). Campaigns
 * are its sequences, a lead joins one through `leads.create`'s `campaign`; no company object. Types:
 * https://api.instantly.ai/openapi/api_v2.json */
const lead = { id: 'string', 'email?': 'string', 'first_name?': 'string', 'last_name?': 'string', 'company_name?': 'string',
  'campaign?': 'string', timestamp_created: 'string', timestamp_updated: 'string' } as const;
const written = { first_name: { in: 'body', type: 'string' }, last_name: { in: 'body', type: 'string' },
  company_name: { in: 'body', type: 'string' }, job_title: { in: 'body', type: 'string' }, phone: { in: 'body', type: 'string' },
  website: { in: 'body', type: 'string' } } as const;
const limit = { in: 'query', type: 'integer', description: '1 to 100.' } as const;
const id = { in: 'path', type: 'string', required: true } as const;
const ref = 'https://developer.instantly.ai/api-reference';

export const instantly = defineProvider({
  id: 'instantly', name: 'Instantly', docs: 'https://developer.instantly.ai/getting-started/authorization',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'An API v2 key, under Settings, then Integrations, then API Keys, with the workspaces:read, campaigns:read, leads:read, leads:create and leads:update scopes.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.instantly.ai/api/v2', retry: {} },
  identify: { request: { path: '/workspaces/current' }, id: 'id', name: 'name' },
  paging: { query: { kind: 'cursor', next: 'next_starting_after', send: { query: 'starting_after' } },
    body: { kind: 'cursor', next: 'next_starting_after', send: { body: 'starting_after' } } },
  operations: {
    'campaigns.list': { docs: `${ref}/campaign/list-campaign`, path: '/campaigns', paging: 'query', records: 'items',
      params: { limit }, result: { items: [{ id: 'string', name: 'string', status: 'number', timestamp_created: 'string',
        timestamp_updated: 'string' }] } },
    'leads.list': { docs: `${ref}/lead/list-leads`, method: 'POST', path: '/leads/list', kind: 'read', paging: 'body', records: 'items',
      params: { campaign: { in: 'body', type: 'string' }, limit: { in: 'body', type: 'integer', description: '1 to 100.' } },
      result: { items: [lead] } },
    'leads.get': { docs: `${ref}/lead/get-lead`, path: '/leads/{id}', notFound: 'null', params: { id }, result: lead },
    'leads.create': { docs: `${ref}/lead/create-lead`, method: 'POST', path: '/leads',
      params: { email: { in: 'body', type: 'string' }, campaign: { in: 'body', type: 'string' }, ...written }, result: lead },
    'leads.update': { docs: `${ref}/lead/patch-lead`, method: 'PATCH', path: '/leads/{id}', params: { id, ...written }, result: lead },
  },
});
