import type { KitScenario } from '../kit.test-support.js';
import { githubClient, type GitHubClient, type GitHubIssue } from './github.js';

/** One repository's issues, two a page, so a small repository still pages. */
export const githubScenario: KitScenario<GitHubClient, GitHubIssue> = {
  provider: 'github',
  client: ({ apiKey, fetch }) => githubClient({ token: apiKey, fetch, minIntervalMs: 0, pageSize: 2 }),
  identify: client => client.user(),
  page: (client, { since, cursor }) => client.issues({ owner: 'octocat', repo: 'Hello-World', since, cursor }),
  id: issue => String(issue.id),
  changedAt: issue => issue.updated_at,
  since: '2026-11-03T00:00:00Z',
  retriesRateLimit: true,
};
