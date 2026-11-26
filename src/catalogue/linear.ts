import { defineProvider } from '../catalogue.js';

/** Linear: a personal API key, bare in `Authorization`, or OAuth 2, its token as Bearer, on one GraphQL endpoint. A 429
 * with `Retry-After` past the limit (https://linear.app/developers/rate-limiting). Webhooks sign the body, hex HMAC-SHA256
 * in `Linear-Signature` (https://linear.app/developers/webhooks). Types from the schema, one page per list
 * (https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql). */
const fields = 'id title url state { id name } team { id } createdAt updatedAt';
const issue = { id: 'string', title: 'string', url: 'string', state: { id: 'string', name: 'string' }, team: { id: 'string' },
  createdAt: 'string', updatedAt: 'string' } as const;
const page = { first: { in: 'variables', type: 'integer' }, after: { in: 'variables', type: 'string' } } as const;
const pageInfo = { hasNextPage: 'boolean', 'endCursor?': 'string' } as const;
const written = { 'issue?': issue, success: 'boolean' } as const;
const guide = 'https://linear.app/developers/graphql';

export const linear = defineProvider({
  id: 'linear', name: 'Linear', docs: `${guide}#authentication`,
  categories: ['tasks'],
  fields: [{ name: 'apiKey', title: 'Personal API key', secret: true, help: 'Create it in Linear under Settings, Security & access.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://linear.app/oauth/authorize', tokenUrl: 'https://api.linear.app/oauth/token',
    scopeSeparator: ',', authorizeParams: { response_type: 'code' } }, { kind: 'key', send: { header: 'authorization' } }],
  scopes: { default: ['read', 'issues:create'] },
  revoke: { url: 'https://api.linear.app/oauth/revoke', token: ['access', 'refresh'] },
  http: { baseUrl: 'https://api.linear.app/graphql', retry: {} },
  identify: { request: { graphql: 'query Me { viewer { id name email } }' }, id: 'data.viewer.id',
    name: ['data.viewer.name', 'data.viewer.email'] },
  errors: { detail: 'errors.0.extensions.code', failed: { path: 'errors.0' } },
  webhook: { kind: 'hmac', header: 'linear-signature', deliveryId: { header: 'linear-delivery' } },
  operations: {
    'issues.list': { docs: 'https://linear.app/developers/pagination', kind: 'read',
      graphql: `query Issues($teamId: ID!, $first: Int, $after: String) { issues(filter: { team: { id: { eq: $teamId } } }, first: $first, after: $after) { nodes { ${fields} } pageInfo { hasNextPage endCursor } } }`,
      params: { teamId: { in: 'variables', type: 'string', required: true }, ...page },
      result: { data: { issues: { nodes: [issue], pageInfo } } } },
    'issues.get': { docs: `${guide}#queries-and-mutations`, kind: 'read',
      graphql: `query Issue($id: String!) { issue(id: $id) { ${fields} } }`,
      params: { id: { in: 'variables', type: 'string', required: true } }, result: { data: { issue } } },
    'issues.create': { docs: `${guide}#creating-and-editing-issues`,
      graphql: `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${fields} } } }`,
      params: { input: { in: 'variables', required: true,
        type: { teamId: 'string', 'title?': 'string', 'description?': 'string', 'stateId?': 'string' } } },
      result: { data: { issueCreate: written } } },
    'issues.update': { docs: `${guide}#creating-and-editing-issues`,
      graphql: `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${fields} } } }`,
      params: { id: { in: 'variables', type: 'string', required: true }, input: { in: 'variables', required: true,
        type: { 'title?': 'string', 'description?': 'string', 'stateId?': 'string', 'teamId?': 'string' } } },
      result: { data: { issueUpdate: written } } },
    'teams.list': { docs: `${guide}#queries-and-mutations`, kind: 'read',
      graphql: 'query Teams($first: Int, $after: String) { teams(first: $first, after: $after) { nodes { id name createdAt updatedAt } pageInfo { hasNextPage endCursor } } }',
      params: page,
      result: { data: { teams: { nodes: [{ id: 'string', name: 'string', createdAt: 'string', updatedAt: 'string' }], pageInfo } } } },
  },
});
