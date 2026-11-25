import { github } from '../providers.js';
import type { Route } from '../testing.js';
import type { GitHubIssue, GitHubRepo, GitHubUser } from './github.js';

export type FakeGitHubRepo = GitHubRepo & { issues: readonly GitHubIssue[] };
export type FakeGitHubAccount = { user: GitHubUser; repos: readonly FakeGitHubRepo[] };

const BASE = github.baseUrl ?? '';
const ISSUES = new RegExp(`^${BASE.replaceAll('.', '\\.')}/repos/([^/]+)/([^/]+)/issues$`, 'u');
const refusal = (status: number, message: string) => Response.json({ message, documentation_url: 'https://docs.github.com/rest',
  status: String(status) }, { status });

/** One page of a list, `per_page` long, and GitHub's Link header naming the next and last pages while more remain. */
function paged(request: Request, items: readonly unknown[]): Response {
  const url = new URL(request.url);
  const size = Math.min(Number(url.searchParams.get('per_page') ?? '30'), 100);
  const page = Number(url.searchParams.get('page') ?? '1');
  const last = Math.max(1, Math.ceil(items.length / size));
  const link = (target: number, rel: string) => {
    const address = new URL(url);
    address.searchParams.set('page', String(target));
    return `<${address.href}>; rel="${rel}"`;
  };
  return Response.json(items.slice((page - 1) * size, page * size),
    { headers: page < last ? { link: `${link(page + 1, 'next')}, ${link(last, 'last')}` } : {} });
}

/**
 * GitHub for one token at a time: `account(token)` is what the token reads, null a token GitHub refuses (401). Issues
 * answer by `state` (open by default), updated at or after `since`, in creation order (newest first unless `direction=asc`).
 */
export function fakeGitHub(data: { account: (token: string) => FakeGitHubAccount | null }): Route[] {
  const read = (request: Request) => data.account((request.headers.get('authorization') ?? '').replace(/^Bearer /u, ''));
  const refused = () => refusal(401, 'Bad credentials');
  return [
    { method: 'GET', url: `${BASE}/user`, respond(request) {
      const account = read(request);
      return account ? Response.json({ ...account.user, type: 'User', site_admin: false }) : refused();
    } },
    { method: 'GET', url: `${BASE}/user/repos`, respond(request) {
      const account = read(request);
      if (!account) return refused();
      return paged(request, account.repos.map(({ id, name, full_name, owner, html_url, has_issues, archived }) =>
        ({ id, name, full_name, owner, html_url, has_issues, archived })).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    } },
    { method: 'GET', url: url => ISSUES.test(`${url.origin}${url.pathname}`), respond(request) {
      const account = read(request);
      if (!account) return refused();
      const url = new URL(request.url);
      const [, owner = '', name = ''] = ISSUES.exec(`${url.origin}${url.pathname}`) ?? [];
      const repo = account.repos.find(item => item.full_name.toLowerCase()
        === `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`.toLowerCase());
      if (!repo) return refusal(404, 'Not Found');
      const state = url.searchParams.get('state') ?? 'open';
      const since = url.searchParams.get('since');
      const order = url.searchParams.get('direction') === 'asc' ? 1 : -1;
      return paged(request, repo.issues
        .filter(issue => (state === 'all' || issue.state === state) && (since === null || Date.parse(issue.updated_at) >= Date.parse(since)))
        .sort((a, b) => order * (Date.parse(a.created_at) - Date.parse(b.created_at))));
    } },
  ];
}
