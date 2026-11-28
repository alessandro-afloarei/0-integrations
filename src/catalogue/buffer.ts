import { defineProvider } from '../catalogue.js';

/** Buffer, GraphQL: OAuth 2 for apps other people sign in to, the client registered in your settings, PKCE required;
 * or an API key for your own account: https://developers.buffer.com/guides/building-apps.html
 * Reads only: a mutation reports its failure in its own output. Lists take an organization id (`account { organizations
 * { id } }`). A 429 states `Retry-After`: https://developers.buffer.com/guides/api-limits.html */
const channelFields = 'id name service organizationId isDisconnected externalLink createdAt updatedAt';
const channel = { id: 'string', name: 'string', service: 'string', organizationId: 'string', isDisconnected: 'boolean',
  'externalLink?': 'string', createdAt: 'string', updatedAt: 'string' } as const;
const postFields = 'id text status channelId externalLink dueAt createdAt updatedAt';
const post = { id: 'string', text: 'string', status: 'string', channelId: 'string', 'externalLink?': 'string', 'dueAt?': 'string',
  createdAt: 'string', updatedAt: 'string' } as const;
const organizationId = { organizationId: { in: 'variables', type: 'string', required: true } } as const;
const ref = 'https://developers.buffer.com/reference.html';

export const buffer = defineProvider({
  id: 'buffer', name: 'Buffer', docs: 'https://developers.buffer.com/guides/authentication.html',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Buffer account, from Settings → API: a key acts for you alone, in every organization you belong to. An app other people sign in to uses the OAuth 2 sign-in.' }],
  // The authorization server's own metadata: https://auth.buffer.com/.well-known/oauth-authorization-server
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://auth.buffer.com/auth', tokenUrl: 'https://auth.buffer.com/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  // `offline_access` brings the refresh token; each refresh returns a new one.
  scopes: { default: ['account:read', 'posts:read', 'offline_access'] },
  // No revoke: the server's metadata names a revocation endpoint, and no page states what revoking ends:
  // https://auth.buffer.com/.well-known/openid-configuration
  http: { baseUrl: 'https://api.buffer.com', retry: {} },
  identify: { request: { graphql: 'query Account { account { id name email } }' }, id: 'data.account.id',
    name: ['data.account.name', 'data.account.email'] },
  // A query's failure is the `errors` array of a 200: https://developers.buffer.com/guides/error-handling.html
  errors: { detail: 'errors.0.extensions.code', failed: { path: 'errors.0' }, rules: [
    { when: { detail: 'UNAUTHORIZED' }, code: 'rejected' }, { when: { detail: 'NOT_FOUND' }, code: 'not_found' },
    { when: { detail: 'RATE_LIMIT_EXCEEDED' }, code: 'rate_limited' }, { when: { detail: 'UNEXPECTED' }, code: 'unavailable' },
  ] },
  // Relay paging: https://developers.buffer.com/guides/pagination.html
  paging: { posts: { kind: 'cursor', next: 'data.posts.pageInfo.endCursor', more: 'data.posts.pageInfo.hasNextPage',
    send: { variables: 'after' } } },
  operations: {
    'channels.list': { docs: 'https://developers.buffer.com/examples/get-channels.html', kind: 'read',
      graphql: `query Channels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { ${channelFields} } }`,
      params: organizationId, result: { data: { channels: [channel] } } },
    'posts.list': { docs: 'https://developers.buffer.com/guides/pagination.html', kind: 'read', paging: 'posts',
      records: 'data.posts.edges',
      graphql: `query Posts($organizationId: OrganizationId!, $filter: PostsFiltersInput, $first: Int, $after: String) { posts(first: $first, after: $after, input: { organizationId: $organizationId, filter: $filter }) { edges { node { ${postFields} } } pageInfo { hasNextPage endCursor } } }`,
      params: { ...organizationId,
        filter: { in: 'variables', type: { 'status?': ['string'], 'channelIds?': ['string'] },
          description: 'status: draft, error, needs_approval, scheduled, sending or sent; channelIds: the channels to read.' },
        first: { in: 'variables', type: 'integer', description: 'The page size.' } },
      result: { data: { posts: { edges: [{ node: post }], pageInfo: { hasNextPage: 'boolean', 'endCursor?': 'string' } } } } },
    'posts.get': { docs: `${ref}#field-post`, kind: 'read', notFound: 'null',
      graphql: `query Post($id: PostId!) { post(input: { id: $id }) { ${postFields} } }`,
      params: { id: { in: 'variables', type: 'string', required: true } }, result: { data: { post } } },
  },
});
