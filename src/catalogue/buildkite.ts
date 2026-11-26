import { defineProvider } from '../catalogue.js';

/** Buildkite: an API access token as a bearer token. 50 requests a minute per user by default, a 429 past it, whose wait
 * is the seconds in `RateLimit-Reset` (https://buildkite.com/docs/apis/rest-api/limits). A webhook may be signed:
 * `X-Buildkite-Signature: timestamp=…,signature=…`, the hex HMAC-SHA256 of `timestamp.body` keyed with the webhook's
 * token (https://buildkite.com/docs/apis/webhooks/pipelines). */
const build = { id: 'string', 'number?': 'integer', 'state?': 'string', 'message?': 'string', 'web_url?': 'string',
  'created_at?': 'string' } as const;
const org = { in: 'path', type: 'string', required: true } as const;
const pipeline = { in: 'path', type: 'string', required: true } as const;
const perPage = { in: 'query', type: 'integer' } as const;
const builds = 'https://buildkite.com/docs/apis/rest-api/builds';

export const buildkite = defineProvider({
  id: 'buildkite', name: 'Buildkite', docs: 'https://buildkite.com/docs/apis/rest-api#authentication',
  categories: ['code'],
  fields: [{ name: 'accessToken', title: 'API access token', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.buildkite.com/v2', minIntervalMs: 1200, retry: {} },
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
