# Entries and the engine: design

Status: accepted, 2026-11-25. This is phase 1 of the [roadmap](../../ROADMAP.md).

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
- The engine runs any entry. The 17 current providers move onto entries, and their module clients keep their calls.
- A typed client inferred from the entry, with no code generation.
- Every entry gets authenticated raw HTTP for free, so an entry with only `auth` and `http` is already useful.
- One table test runs over every entry. A new entry adds no test code.
- `catalogue.json` is built from the entries, for docs, other languages and a connect screen.

## Non-goals

- New providers. They come in the next phase, in batches.
- Storage adapters, route handlers and the connect screen (later phases).
- Unified data models, a scheduler, a sync engine.
- Describing every API feature as data. What data cannot say stays code, in a provider's module or its quirks file.

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
  - `auth.send`: every field of the entry by its name, secret or plain, plus `{token}`: the access token, or the
    entry's only secret field.
  - `identify` and `save`: the lookup described under `identify`.
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
`fields[].default` and `help`, `Send.value`, `oauth2.send`, `Request.base` and `Operation.base`, the `s` and
`epochSeconds` body-wait units, the `epochMs` reset unit, and `paging` and `operations`, which arrive with the walker
and the client.

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
      failed?: When; reusesGrant?: true; send?: Send }
  | { kind: 'hosted'; send?: Send };

type Send = { header: string; value?: Template } | { basic: readonly [Template, Template] };
```

- `send` says how the credential travels. With no `send` it is `{ header: 'authorization', value: 'Bearer {token}' }`.
  A `send` with a header and no `value` sends the bare `{token}`.
- `key` covers API keys, bearer tokens and basic auth: `{ basic: ['{apiId}', '{apiToken}'] }`.
- `oauth2` states only what differs: PKCE on, the client secret in the body, scopes joined by a space. `failed` marks
  a token answer that is an error inside a 200. `reusesGrant` means a failed identify must not revoke the grant. The
  authorize URL carries only what the entry and the call state; `authorizeParams` holds `response_type` where a
  provider is sent it today.
- `hosted` is a sign-in the provider hosts and data cannot describe. Its quirks file starts it. Its `{token}` is the
  app's own key for that provider, passed like OAuth client credentials, never a field.

### `identify` and `save`

```ts
type Identify = { request?: Request; id?: Value; name?: Value; lowercase?: true;
  rejectWhen?: readonly (Omit<When, 'detail'> & { detail?: string })[] };
type Request = { method?: Method; path?: Template; query?: Record<string, string>; graphql?: string; base?: string };
type Value = Path | readonly Path[] | Template;
```

`id`, `name` and `save` read from one lookup: the answer's own keys at the root, `tokenAnswer.*` (the token answer,
seen only inside the engine) and `connection.*` (the plain values). A string with braces is a template over the same
lookup, where `{id}` is the id already found: `'Portal {id}'`.

- The request is sent only when a value needs the answer. Slack's identity is all `tokenAnswer.*`, so it sends none.
  HubSpot's `id: ['tokenAnswer.hub_id', 'portalId']` sends one only when the token answer has no `hub_id`.
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
   `Retry-After`, else the matching rule's `resetAt`, else `rateLimit.defaultWaitMs`.
4. The status mapping of today. A failed 2xx is `request_failed`.

So a failed 2xx can be a revoked grant, match a rule or be a rate limit before it falls to `request_failed`.

- `errors.detail` is where the provider's own error code sits. A code counts only when it is a non-empty string: an
  empty one is skipped and the next path read. A `/` in it becomes `.`, and it must then pass the library's strict
  pattern, so no provider text or secret reaches an error. `allow` keeps only the listed codes. It checks the first
  code found, so a refused one hides a later path.
- Only a 429 is retried, as today, on reads, up to `retry.limit`. The wait is `Retry-After`, else `waitFromBody`, else
  `retry.defaultWaitMs`, capped by `maxWaitMs`. An answer that step 3 reclassifies is reported, not retried.
- With no `http.retry` there is no retry. `retry: {}` means one retry, waits capped at 60 seconds and a default wait of
  1 second. A `limit` of 0 means no retry and no waits.
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

A module's public cursor never changes in this phase. A module moves onto the walker only when its requests and its
cursors stay identical, which its tests and recording prove. Otherwise it keeps its own loop.

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

### Quirks

What data cannot say is a typed hook in a sibling file, passed as `defineProvider`'s second argument:

```ts
// src/catalogue/unipile.ts
export const unipile = defineProvider({ id: 'unipile', /* … */ auth: [{ kind: 'hosted', send: { header: 'x-api-key' } }] }, quirks);

type Quirks = {
  /** Start a sign-in the entry cannot describe. Returns the URL the browser goes to. */
  authorize?(input: { http: HttpClient; state: string; redirectUri: string; options: Values }): Promise<string>;
  /** Identity that takes more than one request, or a rule beyond paths. */
  identify?(input: { http: HttpClient; values: Values; tokenAnswer: Values }):
    Promise<{ account: { id: string; name: string }; values?: Values }>;
};
type Values = Readonly<Record<string, unknown>>;
```

Two hooks, because two of the 17 providers need code and they need these two: Unipile's hosted sign-in and its
two-request identity, and Microsoft's rule that a mailbox account must have an address. `options` is what the app
passed to `startConnect`; `values` holds what the sign-in returned (an account id) and the plain fields. A hook only
gets the entry's own HTTP client, so it can only call the provider. A third hook is added when a provider proves it
cannot be data. Functions are dropped when the catalogue prints to JSON, which records `quirks: true`.

## The engine

The existing core functions keep their names and take an entry where they took a provider definition.

| Area | Change |
|---|---|
| `catalogue` (new) | `defineProvider`, the entry types, the template and path helpers. |
| `http` | `createClient` reads `auth.send`, `http`, `errors`, `rateLimit` from the entry. The error and rate-limit functions of today become interpreters of the declared rules. |
| `connect` | `startConnect(entry, …)` and `finishConnect(entry, …)` run any entry: form, OAuth 2 or hosted. Both take `scopes`, which default to the entry's; `requireGranted` compares the grant with them and refuses a short one as `rejected` (`scope_missing`). Identify and revoke are generic. A failed identify still revokes the fresh grant unless `reusesGrant`. Revoke treats a 2xx, a 404, `invalid_grant`, a revoked grant and the entry's `goneErrors` as done. `finishConnect` returns `{ secret, values, account }`. |
| `oauth`, `credentials` | Same behaviour, driven by the entry. |
| `paginate` | A walker for the five declared shapes, beside today's `paginate`. The repeated-cursor guard stays. |
| `webhooks` | `verifyWebhook(entry.webhook, request, secret)`, plus `deliveryId`. |
| `client` (new) | `client(entry, { token, values?, headers?, fetch? })` returns the typed operations, plus `request` and `pages` for raw calls. `token` is a string or a function that renews it. |
| `vault` | `SecretStore` may also read and replace a connection's plain `values`. Optional in this phase, so existing stores keep working. |

```ts
import { client } from '0-integrations/client';
import { attio } from '0-integrations/catalogue/attio';

const api = client(attio, { token: process.env.ATTIO_KEY });
const self = await api.request('/self');                       // raw, authenticated, retried
for await (const record of api.records.list({ object: 'people' })) { /* typed */ }
```

**Types.** `defineProvider` takes a `const` type parameter, so the client's methods, arguments, results and paging are
inferred from the literal. The entry types are hand-written TypeScript. A zod schema of the same shape lives in the
tests only and checks every entry.

**Modules.** A provider's hand-written module (`0-integrations/hubspot`) stays where the provider needs real code:
answer shapes with meaning, incremental reads, webhook parsing. It is built on its entry and keeps its public calls.

**Packaging.** `"./catalogue/*"` is one wildcard export, so a new entry needs no `package.json` edit. A test compares
the rest of `exports` with the source tree. The build is `tsc`, then a short script that imports the compiled entries
and writes `dist/catalogue.json`.

## Testing

One table test, `src/catalogue/catalogue.test.ts`, runs over every entry in the folder:

1. **Shape.** The entry matches the schema. It holds no function. Every URL is https. Every placeholder names a
   declared field or saved value. Ids are unique and equal their file name. It survives a JSON round trip.
2. **Replay**, when a recording sits beside it (`<id>.recording.json`): identify with a good and a bad credential, the
   first page of each declared paging shape and a walk to the end, a 429, the OAuth exchange and revoke, and webhook
   samples, valid and tampered.
3. **Fake**, when the provider's module has one: the same cases against the fake, so the fake is held to the recording.

A recording is a real capture from a real account, cleaned by the privacy check. A made-up one tests the code but
leaves the entry `declared`. The module kits stay for what an entry cannot know, such as incremental reads.

`pnpm check` remains the one gate, with no network.

## What an app developer learns

Two concepts: an **entry** (a provider) and a **connection** (one account's secret and plain values). Sign-in is
`startConnect` and `finishConnect`; calls go through `client`. OAuth app credentials are arguments, never a stored
"integration" object.

## Order of work

Each step leaves `pnpm check` green and the package releasable.

**Stage A: the foundation.** Steps 1 to 9 change no public API.

1. Shared internals and safe cleanups: one detail sanitiser, one `Retry-After` reader (it accepts fractions of a
   second, as the tests send), shared answer helpers.
2. The entry types, `defineProvider`, and the three helpers: template, path and condition.
3. The 17 entries, and the interpreters of the declared error, rate-limit and body-wait rules. Today's `./providers`
   is derived from the entries, so its exported shapes and behaviour stay.
4. `catalogue.json`, the wildcard export and the exports test.
5. The core functions accept entries as well as today's definitions.
6. Generic identify and revoke. The quirks hooks.
7. The paging walker. A module moves onto it only where its requests and cursors stay identical.
8. The table test and the recording format's sign-in and webhook steps.
9. Plain connection `values` in `SecretStore`, optional.
10. Entry-driven connect. **Breaking**: `OAuthConnect`, `DirectConnect` and `./providers` give way.
11. Declared operations and the inferred client.
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

- The exact defaults of `retry`, chosen so the 17 providers behave exactly as today.
- Whether a module's simplest calls move onto declared operations in this phase or stay hand-written.
- The names of internal helpers.
