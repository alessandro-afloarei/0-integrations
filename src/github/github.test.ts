import { expect, test, vi } from 'vitest';
import { GOOD_KEY, providerKit, type Recording } from '../kit.test-support.js';
import { fakeFetch } from '../testing.js';
import { fakeGitHub, type FakeGitHubAccount, type FakeGitHubRepo } from './fake.js';
import recording from '../catalogue/github.recording.json' with { type: 'json' };
import { githubClient, type GitHubIssue } from './github.js';
import { githubScenario } from './scenario.test-support.js';

const BASE = 'https://api.github.com';
const issue = (n: number, extra: Partial<GitHubIssue> = {}): GitHubIssue => ({
  id: 3100 + n, number: n, title: `Issue ${String(n)}`, body: 'A customer report.', state: 'open', state_reason: null,
  html_url: `https://github.com/lumen/app/issues/${String(n)}`, user: { login: 'ana' }, labels: [{ name: 'bug' }], comments: 1,
  created_at: `2026-11-0${String(n)}T09:00:00Z`, updated_at: `2026-11-0${String(n)}T10:00:00Z`, closed_at: null, ...extra });
const repo = (name: string, issues: GitHubIssue[] = []): FakeGitHubRepo => ({ id: name.length, name, full_name: `lumen/${name}`,
  owner: { login: 'lumen' }, html_url: `https://github.com/lumen/${name}`, has_issues: true, archived: false, issues });
const hello: FakeGitHubRepo = { ...repo('Hello-World', [1, 2, 3, 4, 5].map(n => issue(n))), full_name: 'octocat/Hello-World',
  owner: { login: 'octocat' } };
const account: FakeGitHubAccount = { user: { id: 1, login: 'octocat', name: 'monalisa octocat' }, repos: [hello] };

providerKit(githubScenario, { recording: recording as Recording, fake: fakeGitHub({ account: token => (token === GOOD_KEY ? account : null) }) });

const client = (fetchImpl: typeof fetch, pageSize?: number) =>
  githubClient({ token: 'github_pat_k', fetch: fetchImpl, minIntervalMs: 0, ...(pageSize === undefined ? {} : { pageSize }) });
const answer = (status: number, headers: Record<string, string>, message = 'API rate limit exceeded') => fakeFetch([{
  url: `${BASE}/user`, respond: () => Response.json({ message, documentation_url: 'https://docs.github.com/rest' }, { status, headers }) }]);

test("sends GitHub's version, media type, a User-Agent and the token, and its issues query", async () => {
  const fake = fakeFetch(fakeGitHub({ account: () => ({ ...account, repos: [hello, repo('api')] }) }));
  await client(fake.fetch).user();
  await client(fake.fetch).repos('2');
  await client(fake.fetch).issues({ owner: 'octocat', repo: 'Hello-World', since: '2026-11-03T00:00:00Z', cursor: '3' });
  expect(fake.calls.map(call => call.url)).toEqual([`${BASE}/user`, `${BASE}/user/repos?per_page=100&page=2`,
    `${BASE}/repos/octocat/Hello-World/issues?state=all&sort=created&direction=asc&since=2026-11-03T00%3A00%3A00Z&per_page=100&page=3`]);
  expect(fake.calls[0]?.headers).toMatchObject({ authorization: 'Bearer github_pat_k', accept: 'application/vnd.github+json',
    'x-github-api-version': '2026-03-10', 'user-agent': '0-integrations' });
});

test('reads issues and pull requests, dropping everything else GitHub sends', async () => {
  const listed = (n: number) => (recording as Recording).exchanges[n]?.response;
  const fake = fakeFetch([{ url: `${BASE}/repos/octocat/Hello-World/issues`, respond: request =>
    Response.json(listed(new URL(request.url).searchParams.get('page') === '2' ? 2 : 1)) }]);
  const [first, second] = [await client(fake.fetch).issues({ owner: 'octocat', repo: 'Hello-World' }),
    await client(fake.fetch).issues({ owner: 'octocat', repo: 'Hello-World', cursor: '2' })];
  expect(Object.keys(first.items[0] ?? {}).sort()).toEqual(['body', 'closed_at', 'comments', 'created_at', 'html_url', 'id',
    'labels', 'number', 'state', 'state_reason', 'title', 'updated_at', 'user']);
  expect(first.items[0]).toMatchObject({ number: 1401, user: { login: 'octocat' }, labels: [{ name: 'bug' }] });
  // A merged pull request, then a closed issue without a body.
  expect(second.items.map(item => [item.number, item.pull_request, item.state_reason, item.body])).toEqual([
    [1403, { merged_at: '2026-11-04T16:30:00Z' }, null, 'Fixes #1401.'], [1404, undefined, 'not_planned', null]]);
});

test("reads a deleted author, a label given by name, and a pull request's missing merged_at as null", async () => {
  const raw = { ...issue(1), user: null, labels: ['feature', { name: 'bug', color: 'f29513' }],
    pull_request: { url: `${BASE}/repos/lumen/app/pulls/1`, html_url: 'https://github.com/lumen/app/pull/1' } };
  const fake = fakeFetch([{ url: `${BASE}/repos/lumen/app/issues`, respond: () => Response.json([raw, { id: 9, title: 'no number' }]) }]);
  await expect(client(fake.fetch).issues({ owner: 'lumen', repo: 'app' })).resolves.toEqual({ items: [{ ...issue(1), user: null,
    labels: [{ name: 'feature' }, { name: 'bug' }], pull_request: { merged_at: null } }], skipped: ['9'], cursor: null });
});

test("follows GitHub's next link by its page, whatever its path, and refuses a cursor it did not give", async () => {
  const fake = fakeFetch(fakeGitHub({ account: () => ({ ...account, repos: [repo('b'), repo('a'), repo('c')] }) }));
  const first = await client(fake.fetch, 2).repos();
  expect(first).toMatchObject({ items: [{ full_name: 'lumen/a' }, { full_name: 'lumen/b' }], cursor: '2' });
  await expect(client(fake.fetch, 2).repos('2')).resolves.toMatchObject({ items: [{ full_name: 'lumen/c' }], cursor: null });
  expect(first.items[0]).toEqual({ id: 1, name: 'a', full_name: 'lumen/a', owner: { login: 'lumen' },
    html_url: 'https://github.com/lumen/a', has_issues: true, archived: false });
  await expect(client(fake.fetch).repos('0')).rejects.toThrow('cursor_invalid');
  const pageless = fakeFetch([{ url: `${BASE}/user/repos`, respond: () => Response.json([],
    { headers: { link: `<${BASE}/repositories/1/issues?after=abc>; rel="next"` } }) }]);
  await expect(client(pageless.fetch).repos()).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_missing' });
});

test("reports GitHub's rate limits as rate_limited with the wait GitHub asks for, never as a bad key, and does not call again", async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_793_444_280_000);
  // The hourly limit lasts until its reset, two minutes from now.
  const primary = answer(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793444400' });
  await expect(client(primary.fetch).user()).rejects.toMatchObject({ code: 'rate_limited', status: 403, retryAfterMs: 120000 });
  // A secondary limit's retry-after past a minute is reported; one within it is waited, then the read sent again.
  const secondary = answer(403, { 'x-ratelimit-remaining': '4800', 'retry-after': '90' });
  await expect(client(secondary.fetch).user()).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 90000 });
  // A secondary limit may name no wait in any header: its message says what it is, and GitHub asks for a minute.
  const bare = answer(403, { 'x-ratelimit-remaining': '4800' }, 'You have exceeded a secondary rate limit. Please wait a few minutes.');
  await expect(client(bare.fetch).user()).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 60000 });
  const tooMany = answer(429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793444340' });
  await expect(client(tooMany.fetch).user()).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 60000 });
  expect([primary, secondary, bare, tooMany].map(fake => fake.calls.length)).toEqual([1, 1, 1, 1]);
  const forbidden = answer(403, { 'x-ratelimit-remaining': '4800' }, 'Resource not accessible by personal access token');
  await expect(client(forbidden.fetch).user()).rejects.toMatchObject({ code: 'rejected', status: 403 });
  now.mockRestore();
});

test('never sends a refused token again: repeated bad tokens lock the person out', async () => {
  const fake = fakeFetch(fakeGitHub({ account: () => null }));
  await expect(client(fake.fetch).issues({ owner: 'octocat', repo: 'Hello-World' })).rejects.toMatchObject({ code: 'rejected', status: 401 });
  expect(fake.calls).toHaveLength(1);
});

test('answers a repository the token cannot read as not_found', async () => {
  const fake = fakeFetch(fakeGitHub({ account: () => account }));
  await expect(client(fake.fetch).issues({ owner: 'octocat', repo: 'private' })).rejects.toMatchObject({ code: 'not_found' });
});
