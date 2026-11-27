import { defineProvider } from '../catalogue.js';

/** Vercel: a full-account token names a team's resources with `teamId` (https://vercel.com/docs/accounts/access-tokens);
 * a 429 past a limit; error codes: https://vercel.com/docs/rest-api/errors. Lists answer one page: send `until` from
 * `pagination.next`, a timestamp. Webhooks: hex HMAC-SHA1 of the body in `x-vercel-signature`
 * (https://vercel.com/docs/webhooks/webhooks-api#securing-webhooks). */
const deployment = { id: 'string', readyState: 'string', 'name?': 'string', 'projectId?': 'string', 'url?': 'string',
  'inspectorUrl?': 'string', 'createdAt?': 'number' } as const;
const teamId = { in: 'query', type: 'string',
  description: 'The team to act on. By default, a request with a full-account token targets your default team.' } as const;
const deployments = 'https://vercel.com/docs/rest-api/deployments';

export const vercel = defineProvider({
  id: 'vercel', name: 'Vercel', docs: 'https://vercel.com/docs/rest-api#authentication',
  categories: ['code'],
  fields: [{ name: 'accessToken', title: 'Access token', secret: true,
    help: 'Create it on the Account Tokens page with the Full Account scope: a project-scoped token cannot read your user, so sign-in fails. It expires on the date you choose when you create it.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.vercel.com', retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/v2/user' }, id: 'user.id', name: ['user.name', 'user.username', 'user.email'],
    rejectWhen: [{ status: 403, path: 'error.invalidToken', equals: true }] },
  errors: { detail: 'error.code' },
  webhook: { kind: 'hmac', header: 'x-vercel-signature', hash: 'sha1', deliveryId: { body: ['id'] } },
  operations: {
    'deployments.list': { docs: `${deployments}/list-deployments`, path: '/v7/deployments',
      params: { projectId: { in: 'query', type: 'string' }, limit: { in: 'query', type: 'number' }, until: { in: 'query', type: 'number' }, teamId },
      result: { deployments: [{ uid: 'string', name: 'string', readyState: 'string', projectId: 'string', 'url?': 'string',
        'inspectorUrl?': 'string', createdAt: 'number' }], pagination: { count: 'number', 'next?': 'number', 'prev?': 'number' } } },
    'deployments.get': { docs: `${deployments}/get-a-deployment-by-id-or-url`, path: '/v13/deployments/{idOrUrl}',
      params: { idOrUrl: { in: 'path', type: 'string', required: true }, teamId }, result: deployment },
    'deployments.create': { docs: `${deployments}/create-a-new-deployment`, method: 'POST', path: '/v13/deployments',
      params: { name: { in: 'body', type: 'string', required: true }, project: { in: 'body', type: 'string' },
        target: { in: 'body', type: 'string' }, deploymentId: { in: 'body', type: 'string' }, gitSource: { in: 'body', type: 'unknown' }, teamId },
      result: deployment },
    'projects.list': { docs: 'https://vercel.com/docs/rest-api/projects/retrieve-a-list-of-projects', path: '/v10/projects',
      params: { limit: { in: 'query', type: 'string' }, teamId } },
  },
});
