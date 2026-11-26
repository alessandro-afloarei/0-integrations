# `testing`

`testing` provides scripted `fakeFetch` routes, repeating `sequence` responses, `memoryStores`, `memoryLock` and
`openLock`. Each provider module has a fake beside it at `<id>/fake` (`fakeHubSpot` from `hubspot/fake`, `fakeNotion`
from `notion/fake`), whose routes answer the calls its client makes, from data the app passes. Each client's own tests
pin its exact requests. `respondFrom(routes)` answers a request from routes or returns null, for an app's fixture mode.

## A fake derived from an entry

Any entry, with no module, gives an app a fake: `fakeProvider(entry, { key, values?, account?, client?, code?,
operations? })` returns routes for `fakeFetch`. They answer for one credential, `key`, sent as the entry sends it (a
header, Basic or the query, the base filled from `values` with the engine's own rules): a request without it is 401
`{ "error": "unauthorized" }`. For a `token` entry, `key` is the value of its secret field (a client secret, a
password); for an OAuth 2 entry, the access token its token URL gives.

- Identify's request answers `account`, or by default `kit-account` at the answer paths of `identify.id` and
  `kit-name` at those of `name`: every path a template reads (`'{org.id}/{user.id}'`), else the first of a list.
- A `token` entry's token request answers `kit-token` (at its `token` path), `expires_in: 3600` and, at every
  `tokenAnswer.<path>` the entry reads, `kit-<path>` or the value `values` gives the `save` key that reads it (never
  over the token or `expires_in`). One whose Basic or body differs
  from the request the engine sends for `key` is 400 `{ "error": "invalid_client" }`. Its calls then carry `kit-token`.
- An OAuth 2 entry's token, refresh and RFC 7009 revoke URLs, filled from `values`, take a form body, or a JSON one
  with `json`, and check the client authentication `clientAuth` declares (a Basic header and no `client_secret` in the
  body, else `client_id` and `client_secret` in the body and no Basic header) against `client`, by default
  `{ clientId: 'kit-client', clientSecret: 'kit-secret' }`: another is 401 `{ "error": "invalid_client" }`.
  - A grant whose `content-type` is not the entry's encoding (`application/x-www-form-urlencoded`, or
    `application/json` with `json`) is 400 `{ "error": "invalid_request" }`, before its client is checked.
  - The token URL answers an `authorization_code` grant of `code` (by default `kit-code`) with a `redirect_uri`, and a
    `code_verifier` that is not blank unless `pkce: false`. The refresh URL (the token URL unless the entry names one)
    answers a `refresh_token` grant of `kit-refresh`. Any other grant is 400 `{ "error": "invalid_grant" }`. The fake
    checks only that a `redirect_uri` and a `code_verifier` are there: it never sees the authorize request, so it cannot
    compare either with what that request sent.
  - Both answer `{ access_token: key, token_type: 'bearer', refresh_token: 'kit-refresh', expires_in: 3600 }`, with
    every `tokenAnswer.<path>` the entry reads, as a `token` entry's answer holds them, and, with `requireGranted`, the
    default scopes as `scope`.
  - The revoke URL answers 200 to a request naming a `token`, and 400 `{ "error": "invalid_request" }` to one naming
    none; on a revoke URL that is also the token or refresh URL, a request with a `grant_type` is that grant. A revoke
    the entry sends as a request (Slack's) carries the credential, as identify does, and is answered `{}`.
- Each operation the app answers is routed by its method and path (each `{name}` one segment, decoded into
  `call.path`), or for GraphQL by its query. When two paths match a request, the one whose first differing segment is
  literal answers: `/items/recent` before `/items/{id}`, and `/a/b/{y}` before `/a/{x}/c`. Of two operations on the
  same method and path (folk's `people.list` and `people.search`), the one whose required query and body parameters
  the request all carries answers, the most such first, the first declared on a tie; when none carries its own, the
  first declared answers. Its function gets `{ path, query, body }` and returns the JSON answered with 200,
  `undefined` for a 404, or a `Response` answered as it is. Paging is the function's: it answers each page as it likes.
  On a route two operations share, every request is routed afresh: a next page whose request drops the filter is
  answered by the other operation.
- The fake owns a GraphQL URL: a query it has no answer for throws
  `fakeProvider: no answer for this GraphQL query at POST <url>`. An app's own route for another query on that URL goes
  before the fake's routes, or into `operations`.
- `values` must be complete: the fake applies no `default`, as a client applies none. A key entry's fake missing a
  value its base or credential takes throws `template_missing` when it is made; a `token` entry's answers its token
  request with an error, so the sign-in fails as `unavailable`.
- `operations` is typed from the entry's own: an entry read as a wide `Entry` (from `catalogue.json`) takes none.
- A request no route matches is `fakeFetch`'s own "no route" error.

```ts
// An app's test, for an entry with no module:
const { fetch } = fakeFetch(fakeProvider(trello, { key: 'kit-token', values: { apiKey: 'kit-key' } }));
const { account } = await finishConnect(trello, { secret: { apiToken: 'kit-token' }, values: { apiKey: 'kit-key' }, fetch });
```

```ts
// An operation the app answers:
const { fetch } = fakeFetch(fakeProvider(notion, { key: 'kit-token', operations: {
  'pages.markdown': call => ({ markdown: `# Page ${call.path.pageId ?? ''}`, truncated: false }) } }));
const page = await client(notion, { token: 'kit-token', fetch }).pages.markdown({ pageId: 'p1' });
```

```ts
// A token entry: `key` is its secret field's value, and its calls carry `kit-token`.
const values = { accountId: 'kit-account', clientId: 'kit-client' };
const { fetch } = fakeFetch(fakeProvider(zoom, { key: 'kit-secret', values }));
const { account } = await finishConnect(zoom, { secret: { clientSecret: 'kit-secret' }, values, fetch });
```

```ts
// An OAuth 2 entry: the kit's client and code connect, and the grant holds `key` as its access token.
const redirectUri = 'https://app.example.test/callback';
const start = await startConnect(linear, { clientId: 'kit-client', redirectUri, state: 'kit-state' });
const { fetch } = fakeFetch(fakeProvider(linear, { key: 'kit-token' }));
const { account } = await finishConnect(linear, { client: { clientId: 'kit-client', clientSecret: 'kit-secret' },
  code: 'kit-code', redirectUri, codeVerifier: start.codeVerifier, fetch, onRevokeFailed: () => undefined });
```

Run `checkCredentialStore` against each real store adapter in the app's database test tier, using an
isolated existing connection fixture and a tenant with no key; it restores the connection's original sealed secret.

## The provider kit

The tests of a provider module with pages run `providerKit(scenario, { recording, fake })` (`src/kit.test-support.ts`):
sign in, a bad key, the first page, paging to the end, an incremental read and a 429, once on the provider's recording
and once on its fake, so the fake an app tests with answers as the provider does. A recording is the scenario's requests
and the provider's answers. One marked `synthetic` is built from the provider's documented samples; replace it from a
test account with `RECORD_PROVIDER=<recording>` and `RECORD_KEY` read at a prompt, as below, then read the file before
committing it: the recorder keeps every answer whole, so a live recording holds the test account's own mail. A
recording sits beside its entry as `src/catalogue/<id>.recording.json`, or `<id>.<part>.recording.json` for a provider
with more than one scenario, and `<recording>` is that name without `.recording.json` (the scenario's `provider`). A
scenario that names a `standIn` also needs a test account, given as `RECORD_ACCOUNT`: Microsoft's and Google's
(`microsoft.mail`, `microsoft.calendar`, `google.mail`, `google.calendar`) take a test mailbox's access token and its
address. The recording names the kit's stand-in in its place, so it replays without it. The scenarios read a whole
mailbox, or a primary calendar, two at a time: record from an account with a few of each. Microsoft's and Google's
synthetic recordings are played from the fakes until a test mailbox replaces them.

A lookup provider has no pages, so its tests run `lookupKit(scenario, { recording, fake })` instead: the key proof, a bad
key, a person found, one not found (null, with the credits the provider reports for it), a company and a 429. Its
recording stays synthetic: a real lookup spends a customer's credits, and the recorder refuses a provider with a module
but no list scenario of that name, so a sign-in alone never replaces a module's recording.

## Recording an entry with no module

An entry with no module, which sends a request when it signs in, becomes `recorded` from a test account with one
command. Read the key at a prompt (this works in bash and zsh), so it never lands in your shell's history:

```sh
printf 'Key: ' && read -rs RECORD_KEY && RECORD_KEY=$RECORD_KEY RECORD_PROVIDER=<id> RECORD_VALUES='{"<plain field>":"…"}' pnpm vitest run src/record.test.ts
```

- `RECORD_KEY` is the entry's secret field (a `token` entry's too). For an OAuth entry it is an access token: sign in
  to a test account with your app's own OAuth client (`startConnect` and `finishConnect`), and pass the grant's
  `accessToken`. An OAuth entry that reads its account only from the token answer, with no `identify.request`, sends
  nothing to record, and the recorder refuses it.
- `RECORD_VALUES` holds the test account's plain values, which are not secret. A field left out takes its kit value
  (its `default`, else its first choice, else `kit-<name>`). Each value given is written as its kit value, so a
  recording made on a sandbox or another region is written with the default host.
- A module's scenario of that name is recorded first. A provider with a module but no such scenario is refused before
  anything is sent. Otherwise the recorder signs in to the entry (a `token` entry's token request, then identify) with
  the key, then with a bad key, which must be refused as `rejected`. It writes `src/catalogue/<id>.recording.json`
  with `synthetic: false`, replacing any recording of that name, so the table test replays it with the kit's key and
  values and the entry's tier is `recorded`.

**What is written.** Each exchange is its method, its URL, its request body, its status, its `retry-after` header and
the wait headers the entry declares, each only when it holds the decimal number the engine reads (no other header), and
from the answer only the paths the entry reads:

- identify's `id` and `name` paths and every `save` path (a `tokenAnswer.` path is read in the token answer), a token
  answer's token and `expires_in`, and a body wait's path;
- the `path` of each condition in `identify.rejectWhen`, `errors.failed`, `errors.rules` and `http.rateLimit.when`, and
  the `errors.detail` paths. There a number or a boolean is kept, and a string only when it is a provider code as an
  error's detail takes one (letters, digits, `_`, `.` and `-`, up to 64): an error's message is never written.

In an answer the sign-in did not accept (the bad key's, or one the entry reads as an error), every kept string must be
such a code, whatever its path: there is no account to swap.

A path that reaches an object or a list keeps only its shell (`{}`, `[]`), which the paths read inside it fill. An
answer that is not JSON is written as `null`. Nothing else in an answer is written: no other token, name, address or
number.

**What is swapped.** The key becomes `kit-good-key`, each plain value given its kit value, and every token at the
entry's `token` path `kit-token`: inside the URL, the request body and the headers kept (as written, JSON-escaped,
percent- or form-encoded), and in the answers where they are a whole value. In the answers, the account's id and name
become `kit-account` and `kit-name` (read in identify's answer or the token answer), and each `save` value
`kit-<name>` (its key's name). A blank string at an identity or `save` path is written as the provider answered it:
there is nothing to swap. A number is replaced only when it is a whole value. Codes at the error and condition paths are
written as answered, apart from the values above, so the replay reads what the provider sent.

**When it refuses.** Before it writes, the recorder replays the file as the table test does. It writes nothing when:

- a sign-in request was answered with a redirect: point the entry at the final URL (a redirect's target can name the
  account, and the replay answers each request once);
- the file fails the table test's own replay check (`replayProblem`): the key signs in, to an account when the entry
  names an id, and the bad key is `rejected`, each sending no more requests than the file holds for it. The account is
  the engine's, from the file and the kit values: that the file holds nothing real is the swap's and the last check's
  work. Dropping or swapping changed what a rule reads (a `rejectWhen` on a header, which is not written; a message a
  rule compared; a swapped value a condition tests). The message says which sign-in changed;
- a value to swap is under 4 characters (an account id `7`, a region `eu`): it would match unrelated text, so record
  from an account whose values are longer;
- a real value is still in an exchange. Before the stand-ins are put in, each part is searched ignoring case,
  percent-decoded, and with every run of 6 or more base64 or base64url characters decoded from each of its first four
  characters (a Basic pair, a JWT's payload, a value after `state=`). The message names the stand-in, the exchange and
  the part (`url`, `headers`, `body`, `response`), never the value: for example an account named like a word of the
  API's host. Only what the recorder put in is exempt, so a real value that spells a stand-in inside it is still found;
- the sign-in with the key fails, or the bad key is not refused as `rejected`: the message gives the error's code and
  status, or the library's own error code, never the provider's text.

Of the environment, only `RECORD_PROVIDER` is printed (in the test's title and its messages).

**Before you commit it.** `src/fixtures-privacy.test.ts` runs on every recording, but it catches only email addresses
off the reserved domains and phone numbers written with a leading `+`. It misses names, street addresses, ids and
numbers in other formats, so read the file before committing it. Never copy a file from a `.record-test-*` folder
into `src/catalogue/`: those come from the recorder's own tests on a fake, and only a recording from a real account
makes an entry `recorded`.
