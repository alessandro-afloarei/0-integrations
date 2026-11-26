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

An entry with no module becomes `recorded` from a test account with one command:

```sh
RECORD_PROVIDER=<id> RECORD_KEY=<secret> RECORD_VALUES='{"<plain field>":"…"}' pnpm vitest run src/record.test.ts
```

`RECORD_KEY` is the entry's secret field (a `token` entry's too), or an OAuth access token for an OAuth entry.
`RECORD_VALUES` holds the test account's plain values; a field left out takes its kit value (its `default`, else its
first choice, else `kit-<name>`). A module's scenario of that name is still recorded first. With none, the recorder signs
in to the entry (a `token` entry's token request, then identify) once with the key and once with a bad one, and writes
`src/catalogue/<id>.recording.json` with `synthetic: false`, so the table test replays it with the kit's key and values
and the entry's tier is `recorded`.

Before it writes, the recorder swaps each real value for the kit's stand-in wherever the provider put it (the URL, the
request body, the `link`, `content-type` and `retry-after` headers, the answer at any depth, keys included, as written,
JSON-escaped or percent-encoded): the key for `kit-good-key`, each plain value for its kit value, every token at the
entry's `token` path for `kit-token`, and the account's id and name, read at identify's paths, for `kit-account` and
`kit-name`. It writes nothing when a value is under 4 characters (it would match unrelated text: record from an account
whose values are longer), or when a value is still found once the text is decoded (an encoding it does not know). Its
messages never quote a value, and nothing read from the environment is printed. The privacy check
(`src/fixtures-privacy.test.ts`) still runs on the file: anything else of the account's in an answer (another address, a
person's name) must be replaced by hand with a synthetic one, so read the file before committing it.
