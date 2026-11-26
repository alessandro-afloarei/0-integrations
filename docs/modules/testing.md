# `testing`

`testing` provides scripted `fakeFetch` routes, repeating `sequence` responses, `memoryStores`, `memoryLock` and
`openLock`. Each provider module has a fake beside it at `<id>/fake` (`fakeHubSpot` from `hubspot/fake`, `fakeNotion`
from `notion/fake`), whose routes answer the calls its client makes, from data the app passes. Each client's own tests
pin its exact requests. `respondFrom(routes)` answers a request from routes or returns null, for an app's fixture mode.

## A fake derived from an entry

Any entry, with no module, gives an app a fake: `fakeProvider(entry, { key, values?, account?, operations? })` returns
routes for `fakeFetch`. They answer for one credential, `key`, sent as the entry sends it (a header, Basic or the query,
the base filled from `values` with the engine's own rules): a request without it is 401 `{ "error": "unauthorized" }`.

- Identify's request answers `account`, or by default `kit-account` at the first answer path of `identify.id` and
  `kit-name` at the first of `name`.
- A `token` entry's token request answers `kit-token` (at its `token` path), `expires_in: 3600` and a kit value at every
  `tokenAnswer.*` path the entry reads (never over the token or `expires_in`). One whose Basic or body differs from the
  request the engine sends for `key` is 400 `{ "error": "invalid_client" }`. Its calls then carry `kit-token`.
- Each operation the app answers is routed by its method and path (each `{name}` one segment, decoded into
  `call.path`; a literal segment beats a placeholder, so `/items/recent` is never answered by `/items/{id}`), or for
  GraphQL by its query. Its function gets `{ path, query, body }` and returns the JSON answered with
  200, `undefined` for a 404, or a `Response` answered as it is. Paging is the function's: it answers each page as it
  likes.
- The fake owns a GraphQL URL: a query it has no answer for throws
  `fakeProvider: no answer for this GraphQL query at POST <url>`. An app's own route for another query on that URL goes
  before the fake's routes, or into `operations`.
- `values` must be complete (the fake applies no `default`, as a client applies none), and a request no route matches is
  `fakeFetch`'s own "no route" error.

```ts
// An app's test, for an entry with no module:
const { fetch } = fakeFetch(fakeProvider(trello, { key: 'kit-token', values: { apiKey: 'kit-key' } }));
const { account } = await finishConnect(trello, { secret: { apiToken: 'kit-token' }, values: { apiKey: 'kit-key' }, fetch });
```

Run `checkCredentialStore` against each real store adapter in the app's database test tier, using an
isolated existing connection fixture and a tenant with no key; it restores the connection's original sealed secret.

## The provider kit

The tests of a provider module with pages run `providerKit(scenario, { recording, fake })` (`src/kit.test-support.ts`):
sign in, a bad key, the first page, paging to the end, an incremental read and a 429, once on the provider's recording
and once on its fake, so the fake an app tests with answers as the provider does. A recording is the scenario's requests
and the provider's answers. One marked `synthetic` is built from the provider's documented samples; replace it from a
test account with `RECORD_PROVIDER=<recording> RECORD_KEY=<key> pnpm vitest run src/record.test.ts`, then read the file
before committing it: the recorder keeps every answer whole, so a live recording holds the test account's own mail. A
recording sits beside its entry as `src/catalogue/<id>.recording.json`, or `<id>.<part>.recording.json` for a provider
with more than one scenario, and `<recording>` is that name without `.recording.json` (the scenario's `provider`). A
scenario that names a `standIn` also needs a test account, given as `RECORD_ACCOUNT`: Microsoft's and Google's
(`microsoft.mail`, `microsoft.calendar`, `google.mail`, `google.calendar`) take a test mailbox's access token and its
address. The recording names the kit's stand-in in its place, so it replays without it. The scenarios read a whole
mailbox, or a primary calendar, two at a time: record from an account with a few of each. Microsoft's and Google's
synthetic recordings are played from the fakes until a test mailbox replaces them.

A lookup provider has no pages, so its tests run `lookupKit(scenario, { recording, fake })` instead: the key proof, a bad
key, a person found, one not found (null, with the credits the provider reports for it), a company and a 429. Its
recording stays synthetic: `record.test.ts` plays list scenarios only, and a real lookup spends a customer's credits.

## Recording an entry with no module

An entry with no module becomes `recorded` from a test account with one command. Read the key at a prompt, so it never
lands in your shell's history:

```sh
read -rsp 'Key: ' RECORD_KEY && RECORD_KEY=$RECORD_KEY RECORD_PROVIDER=<id> RECORD_VALUES='{"<plain field>":"…"}' pnpm vitest run src/record.test.ts
```

- `RECORD_KEY` is the entry's secret field (a `token` entry's too). For an OAuth entry it is an access token: sign in
  to a test account with your app's own OAuth client (`startConnect` and `finishConnect`), and pass the grant's
  `accessToken`.
- `RECORD_VALUES` holds the test account's plain values, which are not secret. A field left out takes its kit value
  (its `default`, else its first choice, else `kit-<name>`).
- A module's scenario of that name is still recorded first. With none, the recorder signs in to the entry (a `token`
  entry's token request, then identify) with the key, then with a bad key, which must be refused as `rejected`. It
  writes `src/catalogue/<id>.recording.json` with `synthetic: false`, replacing any recording of that name, so the
  table test replays it with the kit's key and values and the entry's tier is `recorded`.

**What is written.** From each answer the recorder keeps only the paths the entry reads, and drops everything else
before anything is swapped: identify's `id` and `name` paths and every `save` path (a `tokenAnswer.` path is kept in
the token answer), a token answer's token and `expires_in`, the `path` of each condition in `identify.rejectWhen`,
`errors.failed`, `errors.rules` and `http.rateLimit.when`, the `errors.detail` paths and a body wait's path. An answer
that is not JSON is written as `null`: only its status is kept. Each exchange also keeps its method, URL, request body,
status and its `content-type`, `link`, `location` and `retry-after` headers. A refresh token, an ID token, another
person's name or a phone number in an answer is never written unless the entry reads it.

**What is swapped.** The key becomes `kit-good-key`, each plain value given its kit value, and every token at the
entry's `token` path `kit-token`: inside the URL, the request body and the headers kept (as written, JSON-escaped,
percent- or form-encoded), and in the answers where they are a whole value. The account's id and name, at identify's
paths, become `kit-account` and `kit-name` in the answers. A value read at another path (a `save` value, an error code)
is kept as the provider answered it.

**When it refuses.** The recorder writes nothing, and says which stand-in's value is at fault without quoting it,
when:

- a value to swap is under 4 characters (an account id `7`, a region `eu`): it would match unrelated text, so record
  from an account whose values are longer;
- a real value is still in the file once the stand-ins are taken out, searched ignoring case, percent-decoded and with
  every base64-like run decoded (a Basic pair, a JWT's payload), for example a key echoed inside an error message or a
  number holding the account id;
- the sign-in with the key fails, or the bad key is not refused as `rejected`: its message gives the error's code and
  status only, never the provider's text.

Nothing read from the environment is printed.

**Before you commit it.** `src/fixtures-privacy.test.ts` runs on every recording, but it catches only email addresses
off the reserved domains and phone numbers written with a leading `+`. It misses names, street addresses, ids and
numbers in other formats, so read the file before committing it. Never copy a file from a `.record-test-*` folder
into `src/catalogue/`: those come from the recorder's own tests on a fake, and only a recording from a real account
makes an entry `recorded`.
