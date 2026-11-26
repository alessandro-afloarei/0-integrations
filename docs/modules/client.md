# `client`

`client(entry, options)` returns an entry's client: the operations the entry declares, typed from it, and `json`,
`request` and `paginate` for raw calls. Any [entry](catalogue.md) has the raw calls, so an entry with only `auth` and
`http` is already useful.

```ts
import { notion } from '0-integrations/catalogue/notion';
import { client } from '0-integrations/client';

const api = client(notion, { token: apiKey });
const page = await api.pages.markdown({ pageId }); // { markdown: string; truncated: boolean }
const me = await api.json('/users/me');
```

## Options

- `token`: a string, or a function `(rejected?: string) => Promise<string>`. The client calls the function once, and
  again with the refused token after a 401, so it can renew the token and the request is sent once more. A missing or
  blank token is `TypeError('token_missing')`, thrown when a request needs it, before anything is sent.
- `fetch`: the global one by default. In production pass the app's own guarded `fetch`: the library does not refuse
  private addresses yet.
- `values`: the connection's plain values, for a credential built from them (Aircall's `{apiId}`).
- `baseUrl` and `minIntervalMs` replace the entry's. `headers` are merged with the entry's, a header of the same name
  winning, and the credential is set last.
- `beforeRequest(url)` runs once per call before anything is sent (an app's metering). What it throws reaches the caller.

An OAuth connection passes a function that reads the grant and refreshes it under a lock:

```ts
import { google } from '0-integrations/catalogue/google';
import { client } from '0-integrations/client';
import { accessToken } from '0-integrations/credentials';
import { refreshGrant } from '0-integrations/oauth';

const refresh = (refreshToken: string) => refreshGrant(google, oauthClient, refreshToken, { fetch });
const gmail = client(google, {
  token: rejected => accessToken({ connectionId, secrets, vault, withLock, provider: google, refresh, rejected }),
});
```

## Every call

The credential travels as the entry says and never leaves the base URL's origin: a path that would leave it is
`TypeError('url_outside_origin')`, and a redirect is followed only on the same origin, at most five hops. A call times
out after the entry's `timeoutMs` (30 seconds by default) and is paced `minIntervalMs` apart. A 429 is waited out and
sent again only on a read, only when the entry declares `http.retry`, never with a caller's `signal`, and never longer
than `retry.maxWaitMs`. A GET is a read unless `idempotent` says otherwise. An error answer is a `ProviderHttpError` or a
`GrantRevoked` ([errors](errors.md)), classified by the entry's rules.

## Raw calls

Each takes a path after the base URL and `RequestOptions`: `method`, `query`, `json`, `form`, `idempotent`, `signal`. A
path starts with `/` (or `?`, or is empty for the base itself); any other is `TypeError('url_path_relative')`, before the
token is read or anything is sent.

- `json(path, options?)` answers the parsed answer, and throws on an error answer.
- `request(path, options?)` answers `{ status, headers, data }` as it came, whatever the status.
- `paginate(paging, path, options?)` yields each page's parsed answer, following the entry's paging shape of that name.
  A cursor that comes back is `invalid_response` (`cursor_repeated`), and a next link outside the base's path is
  `invalid_response` (`next_link_foreign`).

## Operations

An operation's dotted id is a path on the client: `'pages.markdown'` is `api.pages.markdown(args, { signal })`. Three
entries declare operations today: notion `pages.markdown`, fireflies `user` and aircall `calls.transcript`.

- Each argument is checked by its declared type before anything is sent: `TypeError('param_missing: <name>')` or
  `TypeError('param_invalid: <name>')`. An argument that is not declared, or is `undefined`, is not sent. An operation
  with no required parameter may be called with no argument.
- The answer is read by the operation's `result`: undeclared keys are dropped, and an answer that does not fit is
  `invalid_response`. With no `result` the answer is `unknown`, and a 204 answers `null`; any other answer without JSON is
  `invalid_response`. With `notFound: 'null'` a 404 answers `null`.
- A paged operation is read with `for await`. It yields the records at `records`, page by page; a record that does not
  fit is skipped, and the `onSkipped(ids)` option hears once from each page that skipped any.

The client's own calls take some names. An operation id whose first dot-separated segment equals `json`, `request` or
`paginate` (`requests.list` is fine), an id `then`, an id with an empty segment, and an id that is a dotted prefix of
another (`pages` beside `pages.markdown`) are refused: the reserved names by `defineProvider` at compile time, and all of
them by `client` as `TypeError('operation_clash: <id>')` for an app's own entry.

A wrong entry throws when its client is built: besides a clashing id, a parameter with no place in the request, such
as a body parameter on a GET (`param_unplaced: <id> <name>`), a paging shape the entry does not declare
(`paging_unknown: <name>`), `notFound` on a paged operation (`not_found_paged: <id>`) and a `records` path that leads
to no list in the `result` (`records_unshaped: <id>`). A wrong value throws when the call is made, before anything is
sent.

An app's own entry declares operations the same way:

```ts
import { defineProvider } from '0-integrations/catalogue';
import { client } from '0-integrations/client';

const tasks = defineProvider({
  id: 'tasks', name: 'Tasks', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.tasks.example/v1' },
  paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'cursor' } } },
  operations: {
    'issues.list': { path: '/teams/{teamId}/issues', paging: 'cursor', records: 'items',
      params: { teamId: { in: 'path', type: 'string', required: true } },
      result: { items: [{ id: 'string', title: 'string' }], 'next?': 'string' } },
  },
});

for await (const issue of client(tasks, { token }).issues.list({ teamId }, { onSkipped: ids => { skipped.push(...ids); } })) {
  titles.push(issue.title);
}
```
