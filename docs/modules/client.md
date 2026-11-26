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
- `fetch`: the global one by default, or `guardedFetch` for an entry whose host the person types (`http.host: '*'`,
  GitLab). See [The address guard](#the-address-guard).
- `values`: the connection's plain values, for a credential or a base built from them (Aircall's `{apiId}`,
  Intercom's `{apiHost}`). A value the entry names that is missing, blank or neither a string nor a finite
  number takes its field's `default`, else is `TypeError('template_missing: <entry id> {<name>}')`, before anything is
  sent. A base is filled and checked on the first request (see [catalogue](catalogue.md)), not when the client is built.
- `baseUrl` replaces the entry's, used as given: an app's own base is neither filled nor checked against `http.host`.
- `minIntervalMs` replaces the entry's.
- `headers` are merged with the entry's, a header of the same name winning, and the credential is set last.
- `beforeRequest(url)` runs once per call before anything is sent (an app's metering). What it throws reaches the caller.
  The URL it sees never holds a credential sent in the query.

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
`TypeError('url_outside_origin')`, and a redirect is followed only on the same origin, at most five hops. A credential
sent in the query (SerpApi's `api_key`) is set on every hop, replacing a value of the same name from the caller
or the redirect, and no error the library builds holds the URL. A call times out after the entry's `timeoutMs` (30
seconds by default) and is paced `minIntervalMs` apart. A 429 is waited out and sent again only on a read, only when
the entry declares `http.retry`, never with a caller's `signal`, and never longer than `retry.maxWaitMs`. A GET is a
read unless `idempotent` says otherwise. An error answer is a `ProviderHttpError` or a `GrantRevoked`
([errors](errors.md)), classified by the entry's rules.

## The address guard

`guardedFetch` (`import { guardedFetch } from '0-integrations/client'`) is a `fetch` that refuses private, loopback,
link-local, unique-local and metadata addresses (the ranges are in the
[design](../design/entries-and-engine.md#the-address-guard)): a URL that is not https, a host that is such an
address, and a name that resolves to one, as
`ProviderHttpError('request_failed', null, 'address_blocked')`, never retried. It dials only an address its own lookup
checked, and checks the connected address again before a byte is written, so a name rebound to a private address
between the two is refused. It answers a redirect without following it, as `redirect: 'manual'` does.

An entry whose host the person types uses it when the app passes no `fetch`:

```ts
import { gitlab } from '0-integrations/catalogue/gitlab';
import { client } from '0-integrations/client';

const api = client(gitlab, { token: accessToken, values: { host } }); // `host` as the person typed it
const user = await api.json('/user');
```

What the guard does not cover:

- An app's own `fetch` (a test fake, a wrapper, a proxy): the library cannot see what it resolves, so for a typed host
  it refuses only an address literal (`127.0.0.1`, `2130706433`) before the token is read. Pass `guardedFetch`, or no
  `fetch`, in production for an entry whose host is typed.
- A proxy: `guardedFetch` ignores the proxy variables, and a proxy an app's own `fetch` sends through dials for it.
- An app's own `baseUrl`, used as given.

## Raw calls

Each takes a path after the base URL and `RequestOptions`: `method`, `query`, `json`, `form`, `idempotent`, `signal`. A
path must start with `/` (or `?`, or be empty for the base itself); one that does not is refused before the token is
read, as `TypeError('url_outside_origin')` when it would change the host and `TypeError('url_path_relative')` otherwise.

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
