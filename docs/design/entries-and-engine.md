# Entries and the engine: design

Status: accepted, 2026-11-25; amended the same day to drop compatibility with 0.12. This is phase 1 of the
[roadmap](../../ROADMAP.md).

## Intent

Today each of the 17 providers is written by hand: a definition, a client, a fake, a recording, a kit test, two
`exports` lines and a docs page. Adding one takes about nine edits and 200 lines. The catalogue will hold hundreds, so
the cost of one more provider is the thing this design minimises.

After this phase a provider is **one small file of plain data**, an *entry*, and one generic *engine* runs any entry:
sign-in, token refresh, "who is this account", revoke, authenticated calls with retry, paging, webhook checks, and
declared reads and writes with full types.

Five rules decide every choice below:

1. The code stays extremely simple and as small as it can be.
2. An app integrates with a few lines.
3. What repeats is abstracted once, in the engine.
4. Adding a provider is easy: one file, no test code, no registry to edit.
5. It is easy to maintain and test: one check command, and every entry is exercised automatically.

## Goals

- `defineProvider({...})`: one typed, pure-data entry per provider in `src/catalogue/<id>.ts`.
- The engine runs any entry. The 17 current providers move onto entries. A module keeps only the calls that carry
  meaning; its sign-in, errors and paging are the engine's, read from its entry.
- A typed client inferred from the entry, with no code generation.
- Every entry gets authenticated raw HTTP for free, so an entry with only `auth` and `http` is already useful.
- One table test runs over every entry. A new entry adds no test code.
- `catalogue.json` is built from the entries, for docs, other languages and a connect screen.

## Non-goals

- New providers. They come in the next phase, in batches.
- Storage adapters, route handlers and the connect screen (later phases).
- Unified data models, a scheduler, a sync engine.
- Describing every API feature as data. What data cannot say stays code, in a provider's module.
- Compatibility with 0.12. An old call is removed in the step that replaces it; nothing is kept for old callers.

## Anti-goals

- A second schema beside the types. The TypeScript types are the only schema; a test checks entries against them.
- A template language. Placeholders and paths only: no conditions, no functions, no arithmetic.
- A central `switch` on provider ids, anywhere.
- Fields that no provider uses yet. Each field arrives with the first provider that needs it and a test that proves it.
- zod in any published `.d.ts`.
- A build step that generates source files.

## What the research found

Five studies fed this design: three declarative systems read in depth, a field survey of smaller libraries and
standards, and a line-by-line map of this library. The findings that shaped it:

- **Defaults carry most providers.** In one large catalogue about 900 lines restate standard OAuth values. In another,
  half of all read operations use the default error handling and a fifth of the written handlers only restate it. So an
  entry states only what differs from the standard.
- **Four sign-in modes cover 90% of providers:** API key, OAuth 2 authorization code, basic, and client credentials.
- **Five paging shapes cover 93%:** none, cursor, page number, offset, and a next link in a header.
- **A handful of signature schemes cover nearly all webhooks,** and they fit a small data union.
- **Most "custom code" is one request and two paths.** 30 of 36 post-connection scripts in one system only make a
  request and copy a field. Declared `identify` replaces them.
- **Types can be inferred.** A spike typed arguments, results and paging from a plain-data entry with 37 lines of types.
  With 300 entries the check took 1.15 s, against 3.9 s with zod schemas in the entries.
- **This library's own repetition:** the client setup line appears 9 times, cursor reading 7 times, "not found is null"
  6 times, the fakes' key check 13 times. The 17 providers use about 25 distinct declared fields.
- **Nobody tests their catalogue well.** The studied systems check the schema and little else. Recorded replays per
  entry, run on every pull request, are the gap this library fills.

## Approaches

- **A. Entries as plain data, types inferred, engine in the core (chosen).** One file per provider, nothing generated.
  The entry prints to JSON as it is. The cost: operation shapes use a tiny descriptor language instead of zod.
- **B. Entries hold zod schemas.** Familiar, but zod would reach the published types, the catalogue would not print to
  JSON, and type checks are three times slower at 300 entries.
- **C. Generate a typed client per entry at build time.** Works, but adds a build step and files that drift from their
  source. Inference gives the same types with neither.

## The entry

```ts
import { defineProvider } from '0-integrations/catalogue';

export const attio = defineProvider({
  id: 'attio',
  name: 'Attio',
  fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.attio.com/v2', minIntervalMs: 100, retry: { maxWaitMs: 10_000 } },
  identify: { request: { path: '/self' }, id: 'workspace_id', name: 'workspace_name',
    rejectWhen: [{ path: 'active', equals: false, detail: 'token_inactive' }, { status: 400 }] },
});
```

That is a whole provider: sign-in form, credential check, account identity, retry and raw calls.

### Two small languages

- **Template**: a string with `{name}` placeholders. A name that is missing is an error that names the entry and the
  key. There are no fallbacks, conditions or functions. Each place that takes a template states its names:
  - `auth.send`: every plain field of the entry by its name, the entry's only secret field by its name, and `{token}`:
    the access token, or that secret field. An entry has at most one secret field, and a key entry exactly one.
  - `identify` and `save` values: the lookup described under `identify`.
  - `webhook.signed`: `{body}`, `{timestamp}`, `{method}`, `{url}`.
  - an operation's `path`: its declared `path` parameters.
- **Path**: a dotted path into an answer (`data.user.id`, `errors.0.code`). At each level the whole remaining path is
  tried as one key first, so `@odata.nextLink` reads the key of that name. A list of paths means "the first one
  present". One helper reads them everywhere.

A **condition** (`When`) is shared by error rules, rate-limit rules and `rejectWhen`:

```ts
type When = { status?: number | 'error'; header?: string; path?: Path; detail?: string | true;
  equals?: string | number | boolean; in?: readonly string[]; startsWith?: string; contains?: string };
```

Every stated part must hold. `status: 'error'` is any answer outside 2xx. One of `header` or `path`, never both,
selects the value compared. A comparison (`equals`, `in`, `startsWith`, `contains`) needs one of them, and a header
compares only to a string. With no comparison the value only has to be present: here that means not `undefined`, so a
`null` counts. (In `identify`, present means neither `undefined` nor `null`.) `contains` ignores case. `detail` tests
the provider's own error code as `errors.detail` reads it: a string must equal it, `true` means there is one. There
are no regular expressions in entries.

### Fields of an entry

Only `id`, `name`, `auth` and `http.baseUrl` are required. Everything else has a default or is absent.

| Field | What it declares | Default |
|---|---|---|
| `id`, `name`, `docs`, `categories` | Identity and metadata. | — |
| `fields` | What the user enters to connect: `{ name, title, secret?, default?, help? }`. A connect screen is drawn from these. | none |
| `auth` | A list of sign-in alternatives (below). | — |
| `scopes` | `{ default, requireGranted? }`. `requireGranted` refuses a grant that lacks a requested scope. | none |
| `identify` | How to learn the account, and so also the credential check (below). | no check |
| `save` | Values kept on the connection after sign-in: `{ hubId: 'tokenAnswer.hub_id' }`. | none |
| `revoke` | `{ url, token: ['refresh', 'access'] }` (RFC 7009) or `{ request }`, each with `goneErrors?`. | none |
| `http` | `baseUrl`, `bases?` (named extra base URLs), `headers?`, `timeoutMs?`, `minIntervalMs?`, `retry?`, `rateLimit?`. | 30 s, no pacing |
| `errors` | Where the provider's error code is, and how answers map to error codes (below). | status only |
| `paging` | Named paging shapes (below). | none |
| `webhook` | The signature scheme (below). | none |
| `operations` | Named reads and writes (below). | none |

#### Arriving later

Some pieces of this design are not in the code until a provider or a later step needs them: `docs` and `categories`,
`fields[].default` and `help`, `Send.value`, `oauth2.send`, `Call.base` and `Operation.base`, placeholders in
`identify`'s request path, the `s` and `epochSeconds` body-wait units, the `epochMs` reset unit, the paging kinds
`offset`, `page` and `linkHeader`, `Size`, and `Where.variables`. `paging` and `operations` arrive with the walker and
the client.

An entry's **tier** (`declared`, `recorded`) is not written in the entry. The build works it out: an entry with a real
recording beside it is `recorded`. `verified` arrives with the nightly live checks.

**A connection** is one account: a *secret* (the secret fields, or the OAuth grant) and plain *values*
(`Readonly<Record<string, unknown>>`, JSON only): the plain fields the user entered and what `save` kept. A template
accepts only a string or a number from them.

### `auth`

```ts
type Auth =
  | { kind: 'key'; send?: Send }
  | { kind: 'oauth2'; authorizeUrl: string; tokenUrl: string; pkce?: false; clientAuth?: 'basic';
      scopeSeparator?: ','; authorizeParams?: Record<string, string>; tokenTypes?: readonly string[];
      failed?: When; reusesGrant?: true; send?: Send };

type Send = { header: string; value?: Template } | { basic: readonly [Template, Template] };
```

- `send` says how the credential travels. With no `send` it is `{ header: 'authorization', value: 'Bearer {token}' }`.
  A `send` with a header and no `value` sends the bare `{token}`.
- `key` covers API keys, bearer tokens and basic auth: `{ basic: ['{apiId}', '{apiToken}'] }`.
- `oauth2` states only what differs: PKCE on, the client secret in the body, scopes joined by a space. `failed` marks
  a token answer that is an error inside a 200. `reusesGrant` means a failed identify must not revoke the grant. The
  authorize URL carries only what the entry and the call state; `authorizeParams` holds `response_type` where a
  provider is sent it today.
- A sign-in the provider hosts on its own page (Unipile's) is not a kind: the entry is a `key` entry for the app's own
  key, and the provider's module offers the hosted link and the account lookup as calls.

### `identify` and `save`

```ts
type Identify = { request?: Call; id?: Value; name?: Value; lowercase?: true;
  rejectWhen?: readonly (Omit<When, 'detail'> & { detail?: string })[] };
type Call = { method?: Method; path?: Template; query?: Record<string, string>; graphql?: string; base?: string };
type Value = Path | readonly Path[] | Template;
```

`id`, `name` and `save` read from one lookup: the answer's own keys at the root, `tokenAnswer.*` (the token answer,
seen only inside the engine) and `connection.*` (the plain values). A string with braces is a template over the same
lookup, where `{id}` is the id already found: `'Portal {id}'`.

- The request is sent only when a value needs the answer, or at once when there is no `id` and no `name` (a
  credential check). Slack's identity is all `tokenAnswer.*`, so it sends none. HubSpot's
  `id: ['tokenAnswer.hub_id', 'portalId']` sends one only when the token answer has no `hub_id`.
- Microsoft's account is the immutable Graph id, named by its address: `id: 'id'`, `name: ['mail',
  'userPrincipalName']`, `lowercase: true`. The rule that a mailbox has an address belongs to the mailbox reader, which
  needs one.
- "Present" means not null or undefined. An id must then be a non-empty string or a positive integer, else the answer
  is `invalid_response` with detail `missing_fields`. A blank name falls back to the id.
- `lowercase` lowercases and trims the id and the name when they are strings.
- `rejectWhen` names answers that mean a bad credential despite their status. The error is `rejected`. A rule's
  `detail` is the detail reported, so a `rejectWhen` condition cannot test the provider's code.
- With no `id`, identify is only a credential check. There is no separate `verify`: none of the 17 providers needs
  the two apart.
- Only the paths an entry names leave the token answer. Nothing else of it is returned or stored.

### `http.retry`, `http.rateLimit` and `errors`

```ts
type Retry = { limit?: number; maxWaitMs?: number; defaultWaitMs?: number;
  waitFromBody?: { path: Path; unit: 'ms' | 's' | 'epochMs' | 'epochSeconds' } };
type RateLimit = { when: readonly (When & { resetAt?: { header: string; unit: 'epochSeconds' | 'epochMs' } })[];
  defaultWaitMs?: number };
type Errors = { detail?: Path | readonly Path[]; allow?: readonly string[]; failed?: When;
  revoked?: readonly string[];
  rules?: readonly { when: When; code: ProviderErrorCode; detail?: string }[] };
```

An error answer is one outside 2xx, or a 2xx that `errors.failed` marks (`{ ok: false }`, GraphQL `errors`). It is
classified in this order, and the first step that decides wins:

1. `errors.revoked`: the provider's code is on the list, so the grant is gone (`GrantRevoked`).
2. `errors.rules`, in the order written. A rule with no `detail` keeps the provider's code. The error carries only
   `Retry-After`, else the body's wait: never a rate limit's.
3. `http.rateLimit.when`: a rate limit without a 429 (a 403 with `x-ratelimit-remaining: 0`). The wait reported is
   `Retry-After`, else the matching rule's `resetAt`, else `rateLimit.defaultWaitMs`, else the body's wait.
4. The status mapping of today. A failed 2xx is `request_failed`.

So a failed 2xx can be a revoked grant, match a rule or be a rate limit before it falls to `request_failed`.

- `errors.detail` is where the provider's own error code sits. A code counts only when it is a non-empty string: an
  empty one is skipped and the next path read. A `/` in it becomes `.`, and it must then pass the library's strict
  pattern, so no provider text or secret reaches an error. `allow` keeps only the listed codes. It checks the first
  code found, so a refused one hides a later path.
- Only a 429 is retried, as today, on reads, up to `retry.limit`. The wait is `Retry-After`, else `waitFromBody`, else
  `retry.defaultWaitMs`, capped by `maxWaitMs`. An answer that step 3 reclassifies is reported, not retried.
- With no `http.retry` there is no retry. `retry: {}` means one retry, waits capped at 60 seconds and a default wait of
  1 second. A `limit` of 0 means no retry; an error still carries the wait the provider names.
- The error taxonomy does not change.

### `paging`

```ts
type Paging =
  | { kind: 'cursor'; next: Path; more?: Path; send: Where; size?: Size }
  | { kind: 'offset'; send: Where; size: Size }
  | { kind: 'page'; send: Where; size?: Size; more?: Path }
  | { kind: 'linkHeader'; size?: Size }
  | { kind: 'nextUrl'; next: Path; pathPrefix?: string };
type Where = { query: string } | { body: string } | { variables: string };
type Size = { send: Where; value?: number };
```

The engine owns the stop rules, and entries hold no stop expressions:

- `cursor`: with `more`, stop when it is falsy; a truthy `more` with a blank cursor is `invalid_response`
  (`cursor_missing`). Without `more`, a blank cursor stops. A repeated cursor is `invalid_response`.
- `offset`: sends 0 first and stops on a page shorter than the size.
- `page`: sends nothing on the first request, then 2, 3 and so on. It stops on a falsy `more`, or an empty page.
- `linkHeader` follows `rel="next"`. `nextUrl` follows a full URL in the body. Both stay on the provider's origin, and
  `nextUrl` under `pathPrefix`, counted from the base URL's path. A link that leaves is `invalid_response`.

A module keeps its own public cursor and builds its own requests, and reads its next cursor through its entry's shape,
so its stop rules are the engine's. A module whose cursor is not a provider's cursor (a page number, a restart point,
a query) keeps its own loop. The walker is built on `paginate`: the library has one paging loop and one
repeated-cursor guard.

### `webhook`

```ts
type Webhook = { kind: 'hmac'; header: string; signed?: Template; prefix?: string; encoding?: 'base64';
  timestamp?: { header: string; toleranceSeconds?: number };
  deliveryId?: { header: string } | { body: readonly Path[] } };
```

Defaults: SHA-256, hex, the raw body signed, a tolerance of 300 seconds. `deliveryId` is what an app dedupes on;
several body paths are joined with `:`.

### `operations`

```ts
type Operation = ({ method?: Method; path: Template } | { graphql: string }) & {
  kind?: 'read' | 'write' | 'delete'; params?: Record<string, Param>; result?: Shape; records?: Path;
  paging?: string; notFound?: 'null'; base?: string };
type Param = { in: 'path' | 'query' | 'body' | 'variables'; type: Shape; required?: true; nullable?: true;
  enum?: readonly string[]; description?: string };
type Shape = 'string' | 'integer' | 'number' | 'boolean' | 'unknown' | readonly [Shape] | { readonly [key: string]: Shape };
```

- An operation's key is its id (`'issues.create'`). `kind` defaults from the method: GET is a read, DELETE a delete,
  anything else a write. A search sent as POST says `kind: 'read'`, and reads are the calls the engine retries.
- A shape key ending in `?` may be missing or null, and is read as absent.
- `result` is checked by a small walker that drops undeclared keys. Without `result` the answer is `unknown`.
- A path's `{name}` must be a declared `path` parameter; the compiler refuses the entry otherwise.
- There are no sync concepts here: no parent and child streams, no incremental cursors, no transforms. An app calls an
  operation with the parent's id.

### What data cannot say

There are no hooks, and `defineProvider` takes one argument. What an entry cannot say is a call of the provider's
module: Unipile's hosted sign-in link and its two-request account lookup are its module's `authLink` and `account`.
A hook is added only when a provider's sign-in or identity can be neither data nor a module call.

## The engine

The core functions keep their names and take an entry. `ProviderDefinition`, `./providers`, `OAuthConnect`,
`DirectConnect` and the module connect objects are gone.

| Area | Change |
|---|---|
| `catalogue` (new) | `defineProvider`, the entry types, the template and path helpers. |
| `http` (internal) | `createClient(entry, options)` reads `auth.send`, `http`, `errors`, `rateLimit` from the entry, and `classify` interprets the declared rules. `./http` is no longer a subpath: `client` is the public client. |
| `connect` | `startConnect(entry, …)` and `finishConnect(entry, …)` run any entry: a form or OAuth 2. The scopes are the entry's; `requireGranted` compares the grant with them and refuses a short one as `rejected` (`scope_missing`). Identify is generic. A failed identify revokes the fresh grant unless `reusesGrant`. `finishConnect` returns `{ secret, values, account }`, typed from the entry. |
| `oauth`, `credentials` | Driven by the entry. `revokeGrant(entry, { accessToken?, refreshToken?, client?, fetch })` is the one revoke (`client` only for an RFC 7009 revoke): by RFC 7009 or by request, as the entry declares; a 2xx, `invalid_grant`, a revoked grant and the entry's `goneErrors` are done, and an RFC 7009 revoke's 404 (a request revoke's 404 is a missing route). |
| `paginate` | Unchanged. The walker for the declared shapes is built on it. |
| `webhooks` | `verifyWebhook(entry.webhook, request, secret)`, plus `deliveryId(entry.webhook, request)`. |
| `client` (new) | `client(entry, { token, values?, headers?, fetch? })` returns the typed operations, plus `json`, `request` and `pages` for raw calls. `token` is a string or a function that renews it. |
| `vault` | Unchanged. A connection's plain values are the app's to keep. |

```ts
import { client } from '0-integrations/client';
import { attio } from '0-integrations/catalogue/attio';

const api = client(attio, { token: process.env.ATTIO_KEY });
const self = await api.json('/self');                          // raw, authenticated, retried
for await (const record of api.records.list({ object: 'people' })) { /* typed */ }
```

**Types.** `defineProvider` takes a `const` type parameter, so the client's methods, arguments, results and paging are
inferred from the literal. The entry types are hand-written TypeScript. A zod schema of the same shape lives in the
tests only and checks every entry.

**Modules.** A provider's hand-written module (`0-integrations/hubspot`) stays where the provider needs real code:
answer shapes with meaning, incremental reads, webhook parsing, a sign-in the provider hosts. It is built on its entry:
its client, its errors and its next cursors are the engine's.

**Packaging.** `"./catalogue/*"` is one wildcard export, so a new entry needs no `package.json` edit. A test compares
the rest of `exports` with the source tree. The build is `tsc`, then a short script that imports the compiled entries
and writes `dist/catalogue.json`.

## Testing

One table test, `src/catalogue/catalogue.test.ts`, runs over every entry in the folder:

1. **Shape.** The entry matches the schema. It holds no function. Every URL is https. Every placeholder names a
   declared field or saved value. Ids are unique and equal their file name. It survives a JSON round trip.
2. **Replay**, when a recording sits beside it (`<id>.recording.json`, or `<id>.<part>.recording.json`): identify with
   a good and a bad credential. The module kits run the first page, a walk to the end and a 429 on the same
   recordings, through modules that run on the entry. Paging, a 429, the OAuth exchange and revoke, and webhook samples
   join the table's replay with the first entry that has them and no module.
3. **Fake**, when the provider's module has one: its kit runs the same cases against the fake, so the fake is held to
   the recording.

A recording is a real capture from a real account, cleaned by the privacy check. A made-up one tests the code but
leaves the entry `declared`. The module kits stay for what an entry cannot know, such as incremental reads.

`pnpm check` remains the one gate, with no network.

## What an app developer learns

Two concepts: an **entry** (a provider) and a **connection** (one account's secret and plain values, which the app
keeps). Sign-in is `startConnect` and `finishConnect`; calls go through `client`. OAuth app credentials are arguments, never a stored
"integration" object.

## Order of work

Each step leaves `pnpm check` green and the package releasable.

**Stage A: the foundation.** Steps 1 to 4 add the catalogue beside today's API. From step 5 on, each old call is
removed in the step that replaces it; nothing is kept for 0.12 callers.

1. Shared internals and safe cleanups: one detail sanitiser, one `Retry-After` reader (it accepts fractions of a
   second, as the tests send), shared answer helpers.
2. The entry types, `defineProvider`, and the three helpers: template, path and condition.
3. The 17 entries, and the interpreters of the declared error, rate-limit and body-wait rules. Today's `./providers`
   is derived from the entries for this step only.
4. `catalogue.json`, the wildcard export and the exports test.
5. HTTP calls run on entries; the modules' own error readers give way to the declared rules.
6. Generic identify. Microsoft's identity is data, so no hook is needed.
7. OAuth, credentials and webhooks read entries; one revoke; `deliveryId`.
8. Entry-driven connect. `OAuthConnect`, `DirectConnect`, the module connect objects, then `./providers` go.
9. The paging walker; modules read their next cursors through their entries.
10. Recordings beside their entries, and the table test's replay of identify.
11. Declared operations and the inferred client; `./http` becomes internal.
12. Release 0.13.0 with a migration list.

**Stage B: expansion.** Each item arrives with a first provider that needs it, an entry and a recording or a derived
fake as proof. Order follows how many providers need each:

1. Keys in the query string, field choices (region, sandbox), templated base URLs with a host pattern, and the guarded
   `fetch` that refuses private addresses.
2. The remaining OAuth 2 deviations as flags: JSON token bodies, a separate refresh URL, extra token parameters, token
   paths, a default expiry.
3. One declared token request for client credentials and session logins.
4. More webhook schemes (timestamped `t=,v1=` headers, SHA-1, Ed25519, shared tokens, Standard Webhooks) and challenge
   handshakes.
5. Retry of 5xx and network failures on reads, with jitter.
6. A fake derived from an entry, a scaffolder (`pnpm new <id>`), and a five-step guide to adding a provider.

OAuth 1, JWT and service-account sign-in, and multipart bodies wait for the first provider that needs them.

## Invariants this phase keeps

- No published `.d.ts` names zod.
- Errors carry no provider body and no secret. The six error codes and their status mapping stay.
- A credential never leaves its provider's origin: manual redirects, same origin, at most five hops.
- Retries only where safe: reads, never with a caller's `signal`, waits capped.
- Refresh under a lock, re-read inside it, saved by compare-and-swap; the old refresh token is kept when none returns.
- The vault's formats and its key handling.
- Answers are parsed and undeclared keys are dropped. One bad list entry is skipped and reported, never failing a page.
- Webhooks: raw bytes, constant-time compare, timestamp tolerance, a capped body.
- Every endpoint is https. Fixtures hold no real person's data.
- ESM only, Node 22 or later, three runtime dependencies pinned exactly.

## Left to the builder

- Whether a module's simplest calls move onto declared operations in this phase or stay hand-written.
- The names of internal helpers.
