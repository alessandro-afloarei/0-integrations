import { z } from 'zod';
import { signInWith } from '../catalogue.js';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { responseJson } from '../http-response.js';
import type { Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { github } from '../catalogue/github.js';
import { datetime, orNull } from '../shapes.js';

// GitHub's own field names: an app stores these values and reads them back with its own schema.
export type GitHubUser = { id: number; login: string; name: string | null };
export type GitHubRepo = { id: number; name: string; full_name: string; owner: { login: string }; html_url: string;
  /** A repository without issues, or archived, has nothing new to read. */
  has_issues: boolean; archived: boolean };
export type GitHubIssue = {
  id: number; number: number; title: string; body: string | null; state: 'open' | 'closed';
  /** `completed`, `not_planned`, `duplicate`, `reopened`, or null. */
  state_reason: string | null;
  html_url: string;
  /** Null for a deleted account. */
  user: { login: string } | null;
  labels: { name: string }[]; comments: number; created_at: string; updated_at: string; closed_at: string | null;
  /** Only on a pull request, which GitHub lists as an issue; `merged_at` is null until it merges. */
  pull_request?: { merged_at: string | null } | undefined;
};
export type GitHubClient = {
  /** The token's person: the key proof. */
  user(): Promise<GitHubUser>;
  /** One page of the repositories the token can read. */
  repos(cursor?: string): Promise<Page<GitHubRepo>>;
  /** One page of a repository's issues and pull requests, open and closed, oldest created first; with `since`, only those
   * updated since then. */
  issues(query: { owner: string; repo: string; since?: string | undefined; cursor?: string | undefined }): Promise<Page<GitHubIssue>>;
};

const PAGE = /^[1-9]\d*$/u;

const userSchema = z.object({ id: z.number().int(), login: z.string(), name: z.string().nullable() });
const repoSchema = z.object({ id: z.number().int(), name: z.string(), full_name: z.string(), owner: z.object({ login: z.string() }),
  html_url: z.string(), has_issues: z.boolean(), archived: z.boolean() });
// Every key it does not name is dropped: assignees, milestones, reactions and the API links never leave the client.
const issueSchema = z.object({
  id: z.number().int(), number: z.number().int().positive(), title: z.string(),
  body: orNull(z.string()), state: z.enum(['open', 'closed']),
  state_reason: orNull(z.string()), html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  // A label is an object, or in GitHub's schema also a bare name.
  labels: z.array(z.union([z.string(), z.object({ name: z.string() })]))
    .transform(labels => labels.map(label => ({ name: typeof label === 'string' ? label : label.name }))),
  comments: z.number().int(), created_at: datetime, updated_at: datetime, closed_at: datetime.nullable(),
  pull_request: z.object({ merged_at: orNull(datetime) }).optional(),
});

/** The page GitHub's `rel="next"` link names, or null on the last page. */
function nextPage(link: string | null): string | null {
  const next = link === null ? undefined : /<([^>]+)>;\s*rel="next"/u.exec(link)?.[1];
  if (next === undefined) return null;
  const page = URL.canParse(next) ? new URL(next).searchParams.get('page') : null;
  if (page === null || !PAGE.test(page)) throw new ProviderHttpError('invalid_response', null, 'cursor_missing');
  return page;
}

/** `pageSize` is for tests: GitHub answers at most 100 a page. */
export function githubClient(input: { token: string; fetch: typeof fetch; minIntervalMs?: number; pageSize?: number }): GitHubClient {
  const http = createClient(signInWith(github, 'key'), { token: () => Promise.resolve(input.token), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  /** GitHub pages by number and names the next one in its Link header, which `request` reads. */
  async function paged<T>(path: string, schema: z.ZodType<T>, cursor: string | undefined,
    query: Record<string, string> = {}): Promise<Page<T>> {
    if (cursor !== undefined && !PAGE.test(cursor)) throw new TypeError('cursor_invalid');
    const response = await http.request(path, { query: { ...query, per_page: String(input.pageSize ?? 100),
      ...(cursor === undefined ? {} : { page: cursor }) } });
    const entries = parseAnswer(z.array(z.unknown()), responseJson(github, response));
    return { ...parseEntries(schema, entries), cursor: nextPage(response.headers.get('link')) };
  }
  return {
    async user() {
      return parseAnswer(userSchema, await http.json('/user'));
    },
    repos(cursor) {
      return paged('/user/repos', repoSchema, cursor);
    },
    issues({ owner, repo, since, cursor }) {
      // Creation order, not `sort=updated`: there an item updated mid-read moves to the end and pulls the unread ones up
      // past the cursor, so one is never read. In creation order an edit moves nothing, and a new item lands at the end.
      return paged(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, issueSchema, cursor,
        { state: 'all', sort: 'created', direction: 'asc', ...(since ? { since } : {}) });
    },
  };
}
