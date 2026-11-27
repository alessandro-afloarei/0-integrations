# GitHub

`githubClient({ token, fetch })` reads issues and pull requests with a fine-grained personal access token (Issues, Pull
requests and Metadata, read). It sends `X-GitHub-Api-Version: 2026-03-10` and a User-Agent, which GitHub requires. `user()` is
the key proof, `repos(cursor?)` pages the repositories the token can read, and `issues({ owner, repo, since?, cursor? })` pages
a repository's issues and pull requests, open and closed, updated since `since`, 100 a page. GitHub lists a pull request
as an issue with `pull_request: { merged_at }`. The list runs in creation order, oldest first, and not by update: under
`sort=updated` an item edited during a read moves to the end and pulls an unread one back past the cursor, never to be read,
while in creation order an edit moves nothing. The cursor is the page GitHub's `Link` header names next. GitHub gives a person
5,000 calls an hour, shared with their other tools, and answers a limit as 403 or 429. Since calling on while limited
can get an integration banned, the client tries a read once more only after a `Retry-After` of at most a minute (a 429
or a 5xx that names one); every other limit, a 403 included, is `rate_limited` at once, with `retryAfterMs` when GitHub
names a wait. A 401 is never sent again: repeated bad tokens lock the person out, valid tokens included. A repository the token
cannot read is `not_found`, as GitHub hides private repositories. `github/fake` exports `fakeGitHub({ account: token => … })`.
