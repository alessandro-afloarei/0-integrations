import { defineProvider } from '../catalogue.js';

/** Buildkite: an API access token as a bearer token. A 429's wait is the seconds in its limit's `RateLimit-*-Reset`
 * (https://buildkite.com/docs/apis/rest-api/rate-limits). Webhooks send a plain token by default: set the webhook's
 * Token to `X-Buildkite-Signature`, the hex HMAC-SHA256 of `timestamp.body`, for `webhook` to verify
 * (https://buildkite.com/docs/apis/webhooks/pipelines). */
const build = { id: 'string', 'number?': 'integer', 'state?': 'string', 'message?': 'string', 'web_url?': 'string',
  'created_at?': 'string', 'pipeline?': { 'id?': 'string' } } as const;
const org = { in: 'path', type: 'string', required: true } as const;
const pipeline = { in: 'path', type: 'string', required: true } as const;
const perPage = { in: 'query', type: 'integer' } as const;
const builds = 'https://buildkite.com/docs/apis/rest-api/builds';

export const buildkite = defineProvider({
  id: 'buildkite', name: 'Buildkite', docs: 'https://buildkite.com/docs/apis/rest-api#authentication',
  categories: ['code'],
  fields: [{ name: 'accessToken', title: 'API access token', secret: true,
    help: 'Give it the read_user, read_builds, write_builds and read_pipelines scopes, and a Token Expiry: it defaults to seven days.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.buildkite.com/v2',
    retry: { wait: { header: ['ratelimit-reset', 'ratelimit-user-reset', 'ratelimit-deepbuildslist-reset'], unit: 's' } } },
  identify: { request: { path: '/user' }, id: 'id', name: ['name', 'email'] },
  paging: { link: { kind: 'linkHeader' } },
  webhook: { kind: 'hmac', header: 'x-buildkite-signature', signed: '{timestamp}.{body}', part: 'signature',
    timestamp: { part: 'timestamp' } },
  operations: {
    'builds.list': { docs: `${builds}#list-builds-for-a-pipeline`, path: '/organizations/{org}/pipelines/{pipeline}/builds',
      paging: 'link', params: { org, pipeline, per_page: perPage }, result: [build] },
    'builds.get': { docs: `${builds}#get-a-build`, path: '/organizations/{org}/pipelines/{pipeline}/builds/{number}',
      params: { org, pipeline, number: { in: 'path', type: 'integer', required: true } }, result: build },
    'builds.create': { docs: `${builds}#create-a-build`, method: 'POST', path: '/organizations/{org}/pipelines/{pipeline}/builds',
      params: { org, pipeline, commit: { in: 'body', type: 'string', required: true }, branch: { in: 'body', type: 'string', required: true },
        message: { in: 'body', type: 'string' } }, result: build },
    'pipelines.list': { docs: 'https://buildkite.com/docs/apis/rest-api/pipelines#list-pipelines', path: '/organizations/{org}/pipelines',
      paging: 'link', params: { org, per_page: perPage },
      result: [{ id: 'string', 'name?': 'string', 'slug?': 'string', 'web_url?': 'string', 'created_at?': 'string' }] },
  },
});
