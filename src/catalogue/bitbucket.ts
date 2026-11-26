import { defineProvider } from '../catalogue.js';

/** Bitbucket Cloud: OAuth 2, or a person's API token as a bearer token. An OAuth consumer's scopes are set on the consumer,
 * not asked for: give it account and pullrequest:write, which grants pullrequest and repository
 * (https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/). Webhooks with a secret sign the body,
 * `X-Hub-Signature: sha256=<hex HMAC-SHA256>` (https://support.atlassian.com/bitbucket-cloud/docs/manage-webhooks/). */
const link = { 'links?': { 'html?': { 'href?': 'string' } } } as const;
const repository = { uuid: 'string', 'full_name?': 'string', 'name?': 'string', ...link, 'created_on?': 'string',
  'updated_on?': 'string' } as const;
const pullRequest = { id: 'integer', 'title?': 'string', 'state?': 'string', ...link, 'created_on?': 'string',
  'updated_on?': 'string' } as const;
const path = { in: 'path', type: 'string', required: true } as const;
const branch = { branch: { name: 'string' } } as const;
const ref = 'https://developer.atlassian.com/cloud/bitbucket/rest';

export const bitbucket = defineProvider({
  id: 'bitbucket', name: 'Bitbucket', docs: `${ref}/intro/#authentication`,
  categories: ['code'],
  fields: [{ name: 'apiToken', title: 'API token', secret: true,
    help: 'For your own account: an app for other people connects with the OAuth 2 sign-in, as Atlassian recommends. Give it read:user:bitbucket, read:repository:bitbucket, read:pullrequest:bitbucket and write:pullrequest:bitbucket, and an expiry of at most a year.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
    tokenUrl: 'https://bitbucket.org/site/oauth2/access_token', clientAuth: 'basic', pkce: false,
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.bitbucket.org/2.0' },
  identify: { request: { path: '/user' }, id: 'uuid', name: ['display_name', 'nickname'] },
  paging: { next: { kind: 'nextUrl', next: 'next' } },
  webhook: { kind: 'hmac', header: 'x-hub-signature', prefix: 'sha256=' },
  operations: {
    'repositories.list': { docs: `${ref}/api-group-repositories/#api-repositories-workspace-get`,
      path: '/repositories/{workspace}', paging: 'next', records: 'values', params: { workspace: path },
      result: { values: [repository], 'next?': 'string' } },
    'repositories.get': { docs: `${ref}/api-group-repositories/#api-repositories-workspace-repo-slug-get`,
      path: '/repositories/{workspace}/{repo_slug}', notFound: 'null', params: { workspace: path, repo_slug: path },
      result: repository },
    'pullRequests.list': { docs: `${ref}/api-group-pullrequests/#api-repositories-workspace-repo-slug-pullrequests-get`,
      path: '/repositories/{workspace}/{repo_slug}/pullrequests', paging: 'next', records: 'values',
      params: { workspace: path, repo_slug: path,
        state: { in: 'query', type: 'string', enum: ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'] } },
      result: { values: [pullRequest], 'next?': 'string' } },
    'pullRequests.get': { docs: `${ref}/api-group-pullrequests/#api-repositories-workspace-repo-slug-pullrequests-pull-request-id-get`,
      path: '/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}', notFound: 'null',
      params: { workspace: path, repo_slug: path, pull_request_id: { in: 'path', type: 'integer', required: true } },
      result: pullRequest },
    'pullRequests.create': { docs: `${ref}/api-group-pullrequests/#api-repositories-workspace-repo-slug-pullrequests-post`,
      method: 'POST', path: '/repositories/{workspace}/{repo_slug}/pullrequests',
      params: { workspace: path, repo_slug: path, title: { in: 'body', type: 'string', required: true },
        source: { in: 'body', type: branch, required: true }, destination: { in: 'body', type: branch },
        description: { in: 'body', type: 'string' }, close_source_branch: { in: 'body', type: 'boolean' } },
      result: pullRequest },
  },
});
