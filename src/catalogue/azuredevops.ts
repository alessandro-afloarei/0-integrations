import { defineProvider } from '../catalogue.js';

/** Azure DevOps Services on a Microsoft Entra grant alone; personal access tokens are not for production apps:
 * https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance
 * Register the app for "Multiple Entra ID tenants" with Azure DevOps' delegated permissions; work or school accounts
 * only, as Entra serves no Microsoft account users for Azure DevOps. */
const v = '?api-version=7.1';
const id = { in: 'path', type: 'string', required: true } as const;
const repository = { id: 'string', 'name?': 'string', 'project?': { 'id?': 'string' }, 'defaultBranch?': 'string',
  'webUrl?': 'string' } as const;
const pullRequest = { pullRequestId: 'integer', 'title?': 'string', 'status?': 'string', 'repository?': { 'id?': 'string' },
  'sourceRefName?': 'string', 'targetRefName?': 'string', 'creationDate?': 'string', 'closedDate?': 'string' } as const;
const ref = 'https://learn.microsoft.com/en-us/rest/api/azure/devops';
const view = '?view=azure-devops-rest-7.1';

export const azuredevops = defineProvider({
  id: 'azuredevops', name: 'Azure DevOps',
  docs: 'https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops',
  categories: ['code'],
  fields: [{ name: 'organization', title: 'Organization',
    help: 'The name of your Azure DevOps organization, as in https://dev.azure.com/<organization>.' }],
  // https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    authorizeParams: { response_type: 'code', response_mode: 'query' } }],
  // https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc: the app's permissions, and a refresh token.
  scopes: { default: ['499b84ac-1321-427f-aa17-267ca6975798/.default', 'offline_access'] },
  // A 429 sends Retry-After: https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits
  http: { baseUrl: 'https://dev.azure.com/{organization}', bases: { profile: 'https://app.vssps.visualstudio.com' },
    retry: {} },
  identify: { request: { base: 'profile', path: '/_apis/profile/profiles/me', query: { 'api-version': '7.1' } }, id: 'id',
    name: ['displayName', 'emailAddress'] },
  paging: { skip: { kind: 'offset', send: { query: '$skip' }, list: 'value' } },
  operations: {
    'repositories.list': { docs: `${ref}/git/repositories/list${view}`, path: `/_apis/git/repositories${v}`,
      result: { 'count?': 'integer', value: [repository] } },
    'repositories.get': { docs: `${ref}/git/repositories/get-repository${view}`,
      path: `/_apis/git/repositories/{repositoryId}${v}`, params: { repositoryId: id }, result: repository },
    'pullRequests.list': { docs: `${ref}/git/pull-requests/get-pull-requests${view}`,
      path: `/_apis/git/repositories/{repositoryId}/pullrequests${v}`, paging: 'skip', records: 'value',
      params: { repositoryId: id, $top: { in: 'query', type: 'integer', description: 'The number of pull requests to retrieve.' } },
      result: { value: [pullRequest] } },
    'pullRequests.get': { docs: `${ref}/git/pull-requests/get-pull-request${view}`,
      path: `/_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}${v}`,
      params: { repositoryId: id, pullRequestId: { in: 'path', type: 'integer', required: true } }, result: pullRequest },
    'pullRequests.create': { docs: `${ref}/git/pull-requests/create${view}`, method: 'POST',
      path: `/_apis/git/repositories/{repositoryId}/pullrequests${v}`,
      params: { repositoryId: id, sourceRefName: { in: 'body', type: 'string' }, targetRefName: { in: 'body', type: 'string' },
        title: { in: 'body', type: 'string' }, description: { in: 'body', type: 'string' }, isDraft: { in: 'body', type: 'boolean' } },
      result: pullRequest },
    'projects.list': { docs: `${ref}/core/projects/list${view}`, path: `/_apis/projects${v}`,
      params: { $top: { in: 'query', type: 'integer' }, $skip: { in: 'query', type: 'integer' } },
      result: { 'count?': 'integer', value: [{ id: 'string', 'name?': 'string', 'state?': 'string', 'lastUpdateTime?': 'string' }] } },
  },
});
