import { defineProvider } from '../catalogue.js';

/** GitHub: 5,000 requests an hour per person, shared with their other tokens and apps, and calling on while limited can get
 * an integration banned: no retry. A limit answers 403 or 429. The hourly one has `x-ratelimit-remaining: 0` and lasts until
 * `x-ratelimit-reset` (epoch seconds); a secondary one says so in its message and asks for a minute when no Retry-After
 * names its wait. */
export const github = defineProvider({
  id: 'github', name: 'GitHub', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api',
  auth: [{ kind: 'key' }],
  // The latest API version: it drops `assignee` and `merge_commit_sha`, which the client never reads. GitHub refuses a
  // request without a User-Agent.
  http: { baseUrl: 'https://api.github.com', minIntervalMs: 250,
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', 'user-agent': '0-integrations' },
    rateLimit: { defaultWaitMs: 60_000, when: [
      { status: 403, header: 'x-ratelimit-remaining', equals: '0', resetAt: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } },
      { status: 429, header: 'x-ratelimit-remaining', equals: '0', resetAt: { header: 'x-ratelimit-reset', unit: 'epochSeconds' } },
      { status: 429 }, { status: 403, header: 'retry-after' }, { status: 403, path: 'message', contains: 'rate limit' },
    ] } },
  identify: { request: { path: '/user' }, id: 'id', name: 'login' },
});
