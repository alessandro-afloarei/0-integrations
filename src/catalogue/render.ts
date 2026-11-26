import { defineProvider } from '../catalogue.js';

/** Render: an API key reaches one workspace (https://render.com/docs/api-keys); a 429 past a limit
 * (https://api-docs.render.com/reference/rate-limiting). Lists answer one page: send the last element's `cursor` back
 * (https://api-docs.render.com/reference/pagination). Webhooks follow Standard Webhooks
 * (https://render.com/docs/webhooks). */
const deploy = { id: 'string', 'status?': 'string', 'commit?': { 'id?': 'string', 'message?': 'string' }, 'createdAt?': 'string',
  'updatedAt?': 'string' } as const;
const serviceId = { in: 'path', type: 'string', required: true } as const;
const page = { cursor: { in: 'query', type: 'string' }, limit: { in: 'query', type: 'integer' } } as const;

export const render = defineProvider({
  id: 'render', name: 'Render', docs: 'https://api-docs.render.com/reference/authentication',
  categories: ['code'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Create it in Account Settings for the workspace the app works on, with Read on services and Run on deploys.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.render.com/v1', retry: {} },
  identify: { request: { path: '/users' }, id: 'id', name: ['name', 'email'] },
  errors: { detail: 'code' },
  webhook: { kind: 'standard', deliveryId: { header: 'webhook-id' } },
  operations: {
    'deploys.list': { docs: 'https://api-docs.render.com/reference/list-deploys', path: '/services/{serviceId}/deploys',
      params: { serviceId, ...page }, result: [{ 'deploy?': deploy, 'cursor?': 'string' }] },
    'deploys.get': { docs: 'https://api-docs.render.com/reference/retrieve-deploy', path: '/services/{serviceId}/deploys/{deployId}',
      params: { serviceId, deployId: { in: 'path', type: 'string', required: true } }, result: deploy },
    'deploys.create': { docs: 'https://api-docs.render.com/reference/create-deploy', method: 'POST', path: '/services/{serviceId}/deploys',
      params: { serviceId, commitId: { in: 'body', type: 'string' } } },
    'services.list': { docs: 'https://api-docs.render.com/reference/list-services', path: '/services', params: page,
      result: [{ service: { id: 'string', name: 'string', type: 'string', ownerId: 'string', suspended: 'string', dashboardUrl: 'string',
        createdAt: 'string', updatedAt: 'string' }, cursor: 'string' }] },
  },
});
