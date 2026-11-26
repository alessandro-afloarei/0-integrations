import { defineProvider } from '../catalogue.js';

/** Sentry, sentry.io or self-hosted: the host is typed, so it is reached only through the address guard. Lists page by a
 * `Link` header ending on `results="false"` (https://docs.sentry.io/api/pagination/): one page each, `cursor` by hand.
 * Issues list `is:unresolved` unless `query` says otherwise. Webhooks: hex HMAC-SHA256 of the body in
 * `Sentry-Hook-Signature`, keyed with the client secret (https://docs.sentry.io/integrations/integration-platform/webhooks/). */
const issue = { id: 'string', 'title?': 'string', 'status?': 'string', 'permalink?': 'string', 'firstSeen?': 'string',
  'project?': { 'id?': 'string' } } as const;
const org = { organization_id_or_slug: { in: 'path', type: 'string', required: true } } as const;
const issueId = { in: 'path', type: 'string', required: true } as const;
const cursor = { in: 'query', type: 'string' } as const;
const events = 'https://docs.sentry.io/api/events';

export const sentry = defineProvider({
  id: 'sentry', name: 'Sentry', docs: 'https://docs.sentry.io/api/auth/',
  categories: ['monitoring'],
  fields: [{ name: 'host', title: 'Sentry host', default: 'sentry.io',
    help: 'sentry.io, your region\'s host (us.sentry.io or de.sentry.io), or the host name of your own Sentry, with no port.' },
  { name: 'authToken', title: 'Auth token', secret: true,
    help: 'A personal token (under User settings, then Personal Tokens) or an internal integration\'s token, with the org:read, event:read and event:write scopes: a personal token\'s scopes are chosen when it is made.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{host}/api/0', host: '*' },
  identify: { request: { path: '/organizations/' } },
  webhook: { kind: 'hmac', header: 'sentry-hook-signature', deliveryId: { header: 'request-id' } },
  operations: {
    'issues.list': { docs: `${events}/list-an-organizations-issues/`, path: '/organizations/{organization_id_or_slug}/issues/',
      params: { ...org, project: { in: 'query', type: 'string' }, query: { in: 'query', type: 'string' },
        limit: { in: 'query', type: 'integer' }, cursor }, result: [issue] },
    'issues.get': { docs: `${events}/retrieve-an-issue/`, path: '/organizations/{organization_id_or_slug}/issues/{issue_id}/',
      params: { ...org, issue_id: issueId }, result: issue },
    'issues.update': { docs: `${events}/update-an-issue/`, method: 'PUT',
      path: '/organizations/{organization_id_or_slug}/issues/{issue_id}/',
      params: { ...org, issue_id: issueId,
        status: { in: 'body', type: 'string', enum: ['resolved', 'unresolved', 'ignored', 'resolvedInNextRelease', 'muted'] } } },
    'projects.list': { docs: 'https://docs.sentry.io/api/organizations/list-an-organizations-projects/',
      path: '/organizations/{organization_id_or_slug}/projects/', params: { ...org, per_page: { in: 'query', type: 'integer' }, cursor },
      result: [{ id: 'string', 'slug?': 'string', 'name?': 'string', 'dateCreated?': 'string' }] },
  },
});
