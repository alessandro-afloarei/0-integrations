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
  - `auth.send`: every plain field of the entry by its name, and `{token}`: the access token, or the key. Only a key
    entry's secret field is its credential, so only a key entry's `send` may also name it. An entry has at most one
    secret field, and a key or token entry exactly one. A plain value that is blank fills no template: it is missing,
    and nothing is sent.
  - `http.baseUrl`: every plain field and every `save` key by its name. See "A base filled from a value" below.
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
| `id`, `name`, `categories` | Identity and metadata. | — |
| `docs` | The provider's own page that states what the entry declares, https. Every library entry has one. | — |
| `fields` | What the user enters to connect: `{ name, title, secret?, default?, help?, choices? }`. A connect screen is drawn from these. A plain field left out or blank takes its `default` in `finishConnect`, the one place a default is applied; `choices` lists every value it accepts, the `default` among them. A secret field has neither. | none |
| `auth` | A list of sign-in alternatives (below). | — |
| `scopes` | `{ default, requireGranted? }`. `requireGranted` refuses a grant that lacks a requested scope. | none |
| `identify` | How to learn the account, and so also the credential check (below). | no check |
| `save` | Values kept on the connection after sign-in: `{ hubId: 'tokenAnswer.hub_id' }`. | none |
| `revoke` | `{ url, token: ['refresh', 'access'] }` (RFC 7009) or `{ request }`, each with `goneErrors?`. | none |
| `http` | `baseUrl`, `host?` (the host a base filled from a value must have; `*`: any, address-guarded), `bases?` (named extra base URLs), `headers?`, `timeoutMs?`, `minIntervalMs?`, `retry?`, `rateLimit?`. | 30 s, no pacing |
| `errors` | Where the provider's error code is, and how answers map to error codes (below). | status only |
| `paging` | Named paging shapes (below). | none |
| `webhook` | The signature scheme (below). | none |
| `operations` | Named reads and writes (below). | none |

#### A base filled from a value

A placeholder in `http.baseUrl` names a plain field or a `save` key. In the host (between `https://` and the next `/`)
it is a host part, and the base needs `http.host`, the host the filled base must have: a name (`api.example.com`), `*.`
and a domain (any name ending in `.example.com`, never `example.com` itself), or `*` (any). Intercom's region is the
first: `baseUrl: 'https://{apiHost}', host: '*.intercom.io'`, with `apiHost` a field whose `choices` are its three
hosts. In the path it is one segment: `encodeURIComponent` of the value, so `a/b` is sent as `a%2Fb`; a value that is
`.` or `..` is `TypeError('base_value_invalid: <entry id> {<name>}')`, and a base with no placeholder in its host needs
no `http.host`. Jira's is the first: `baseUrl: 'https://api.atlassian.com/ex/jira/{cloudId}'`, with `cloudId` a value
its `save` keeps.

- The base is filled once per client, on its first request or the first read of its `baseUrl`, never when the client
  is built, and always before the token is read and before `beforeRequest`. An app's own `baseUrl` is used as given,
  after the one check below that every URL the library sends to passes.
- The value is the connection's plain value or saved value, read from the `values` the app passes; none (or a blank
  one) is `template_missing`. Only `finishConnect` applies a field's `default` (and returns it in `values`): a client,
  and a revoke, never do, so they need the connection's `values`. A value in the host that is not a host part (ASCII
  letters, digits and `-` in dot-separated labels; no port, since `http.host` checks only the name) is
  `TypeError('base_value_invalid: <entry id> {<name>}')`.
- Every URL the library sends to (an entry's base, filled or fixed, an app's own, a token URL, an OAuth 2 token,
  refresh or revoke URL) must parse and be https with no user or password, and a templated host must match
  `http.host`, else `TypeError('base_host_refused: <entry id>')`, before a secret is read or sent. The credential then
  never leaves the filled base's origin.
- `host: '*'` is a host the person types (GitLab's own server). It is allowed only on a base whose whole host is one
  placeholder, and the entry is reached through the address guard below. A filled host that is a blocked address
  (`127.0.0.1`, `2130706433`) is refused before the token is read, whatever `fetch` the app passes.

#### The address guard

`guardedFetch` (published from `0-integrations/client`) is a `fetch` over `node:https` that refuses
`ProviderHttpError('request_failed', null, 'address_blocked')`, never retried, for a URL that is not https, a host that
is a blocked address, and a name whose lookup answers none or any blocked address. It is the default `fetch` of
`client()` and `finishConnect` for an entry with `http.host: '*'`; every other entry keeps the global one.

- The blocked ranges, in `node:net`'s `BlockList`. IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`,
  `169.254.0.0/16` (the cloud metadata address), `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`,
  `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/3`. IPv6: `::/96`,
  `64:ff9b::/96`, `64:ff9b:1::/48`, `100::/64`, `2001::/32`, `2001:db8::/32`, `2002::/16`, `fc00::/7` (holds
  `fd00:ec2::254`), `fe80::/10`, `fec0::/10`, `ff00::/8`. A string that is not an IP is blocked. `::ffff:0:0/96` is
  never listed: `BlockList` applies the IPv4 rules to IPv4-mapped addresses itself, and that rule would match every
  IPv4 address. The URL parser already reads `https://2130706433` and `https://0x7f.1` as `127.0.0.1`.
- DNS rebinding is closed: the guard dials with its own lookup, which resolves every address and refuses the whole
  answer if one is blocked, so the address dialled is one it checked. The socket's remote address is checked again
  as it connects, and on a reused socket, before TLS or the request writes a byte. A blocked literal and a blocked name
  never get a TCP connection.
- It is a minimal `fetch` for what the engine sends: a `Request` or a URL with init, a body read whole, the caller's
  `signal` and the timeout's abort, a redirect answered and never followed (as `redirect: 'manual'`), and the answer's
  body streamed; a body cut short fails as fetch's does, `TypeError('terminated')`. It asks for no compression and
  decodes none.
- It dials through its own agent, never Node's global one, which follows `HTTPS_PROXY` when `NODE_USE_ENV_PROXY=1` or
  `--use-env-proxy` is set (Node 22.21 and later) and would hand the name to the proxy unchecked. So the guard never
  sends through a proxy, whatever the environment says.
- Outside the guard: an app's own `fetch` (a test fake, a wrapper, a proxy). The engine cannot see what it resolves, so
  only a host that is an address literal is checked. A proxy that an app's own `fetch` sends through resolves and dials
  for it, unchecked. In production pass `guardedFetch`, or no `fetch`, for an entry whose host is typed.

#### Arriving later

Some pieces of this design are not in the code until a provider or a later step needs them: `categories`,
`oauth2.send`, `Operation.base`, placeholders in `identify`'s request path, the `s` and
`epochSeconds` body-wait units, the `epochMs` reset unit, the paging kinds `offset`, `page` and `linkHeader`, `Size`,
and `Where.variables`. `paging` and `operations` arrive with the walker and the client.

An entry's **tier** (`declared`, `recorded`) is not written in the entry. The build works it out: an entry with a real
recording beside it is `recorded`. `verified` arrives with the nightly live checks.

**A connection** is one account: a *secret* (the secret fields, or the OAuth grant) and plain *values*
(`Readonly<Record<string, unknown>>`, JSON only): the plain fields the user entered and what `save` kept. A template
accepts only a string or a number from them.

### `auth`

```ts
type Auth =
  | { kind: 'key'; send?: Send }
  | { kind: 'oauth2'; authorizeUrl: string; tokenUrl: string; refreshUrl?: string; json?: true; pkce?: false;
      clientAuth?: 'basic'; scopeSeparator?: ','; authorizeParams?: Record<string, string>;
      tokenTypes?: readonly string[]; failed?: When; reusesGrant?: true; send?: Send }
  | { kind: 'token'; request: TokenRequest; send?: Send };

type Send = { header: string; value?: Template } | { basic: readonly [Template, Template] }
  | { query: Record<string, Template> };
type TokenRequest = { url: Template; body: Record<string, Template>; json?: true;
  basic?: readonly [Template, Template]; token?: Path };
```

- `send` says how the credential travels. With no `send` it is `{ header: 'authorization', value: 'Bearer {token}' }`.
  A `send` with a header and no `value` sends the bare `{token}`, so the table refuses a `value` of exactly `'{token}'`.
- `key` covers API keys, bearer tokens and basic auth: `{ basic: ['{apiId}', '{apiToken}'] }`.
- `query` sets each parameter, filled, on the URL of every request and every redirect hop, after the caller's query, so
  it replaces a value of the same name. It adds no header, and `beforeRequest` sees the URL without it. A query send
  names at least one parameter.
- `oauth2` states only what differs: PKCE on, the client secret in the body, scopes joined by a space. `failed` marks
  a token answer that is an error inside a 200. `reusesGrant` means a failed identify must not revoke the grant. The
  authorize URL carries only what the entry and the call state; `authorizeParams` holds `response_type` where a
  provider is sent it today.
- `oauth2.refreshUrl` is where a refresh posts (Figma's `/v1/oauth/refresh`); the code exchange still posts to
  `tokenUrl`. A refresh answer without a `refresh_token` keeps the one sent.
- `oauth2.json`: the code exchange, the refresh and an RFC 7009 revoke send the same parameters as one JSON object
  (Atlassian) with `content-type: application/json`, the client id and secret in it unless `clientAuth: 'basic'`. The
  answer is read as a form-bodied one is.
- `token` turns what the person entered into a short-lived token with one request: client credentials (Zoom, PayPal) or
  a session sign-in (Metabase). It has no refresh: a new request is the refresh.
  - The request's URL is filled by the base rule from the plain values alone (a host placeholder's result must match
    `http.host`; a fixed URL is used as written, after the same check). Its body's templates and `basic` are filled
    from the plain values and the secret fields by name, and it is posted as a form, or as one JSON object with
    `json: true`, with the entry's `http.headers`, redirects not followed, through the entry's default `fetch`
    (`guardedFetch` for `http.host: '*'`) unless the app passes one.
  - Its answer: a 2xx whose `token` path (`access_token` by default) holds a non-empty string is the token, and a root
    `expires_in` that is a positive finite number of seconds is its life (none: kept until refused); the caller that
    requested a token gets it, however short its life. A 2xx without a token is `invalid_response` (`missing_fields`);
    400, 401 and 403 are `rejected` (RFC 6749 §5.2), their detail the answer's `error` when it is one of the RFC's
    codes (`invalid_client`, …), else none; any other answer is classified as usual. No detail holds a secret field, a
    body value filled from one, or the Basic value sent.
    The request is sent once, never retried: it is no read of the provider's API.
  - `tokenSource(entry, { secret, values?, fetch? })` (from `./oauth`) is the token function `client()` takes: it keeps
    the token until it is passed back as refused or a call comes within 60 seconds of its expiry, or after it (that
    call requests a new one; nothing renews by itself), concurrent calls share one
    request, and a failed request is not kept. It applies no field's `default`, so an app passes it, and `client`, the
    connection's `values` as `finishConnect` returned them.
  - `startConnect` returns the form. `finishConnect(entry, { secret, values?, fetch? })` reads the fields as a key
    entry does (defaults, choices), requests a token (the credential check), identifies with it, with the token
    answer's keys the entry names as `tokenAnswer.*`, and returns the secret fields as `secret`; the token is not
    returned.
  - Its `send` may name `{token}` (the token obtained) and plain fields, never a secret field: a call never sends one,
    whatever `values` holds.
- A sign-in the provider hosts on its own page is not a kind: the entry is a `key` entry for the app's own key, and the
  provider's module offers the hosted link and the account lookup as calls.

### `identify` and `save`

```ts
type Identify = { request?: Call; id?: Value; name?: Value; lowercase?: true;
  rejectWhen?: readonly (Omit<When, 'detail'> & { detail?: string })[] };
type Call = { method?: Method; path?: Template; query?: Record<string, string>; graphql?: string; base?: string };
type Value = Path | readonly Path[] | Template;
```

`id`, `name` and `save` read from one lookup: the answer's own keys at the root, `tokenAnswer.*` (the token answer,
seen only inside the engine, never the token's own key: `access_token` and `refresh_token`, or a `token` entry's
`token` path, read as missing) and `connection.*` (the plain values). `save` keeps only a string, a number or a
boolean: an object or a list, which may hold a second credential (`tokenAnswer.authed_user`), is not kept. An id must
be a string or a number and a name a string, so neither can carry one either. A string with braces is a template over
the same lookup, where `{id}` is the id already found: `'Portal {id}'`.

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
- A request's `base` names a key of `http.bases`: identify's request and a request revoke are sent to that base, and
  the credential stays on its origin. An unknown name is `TypeError('base_unknown: <name>')` before anything is sent.
  Jira's identify goes to `api.atlassian.com` while its own base still waits for the `cloudId` it saves: a call on a
  second base never fills the entry's own. A request revoke on a second base needs no `values`; one on a templated
  own base needs them, and `revokeGrant` takes none, so it fails closed (`template_missing`) with nothing sent.
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
- Only a call marked idempotent is retried: a GET unless the caller says `idempotent: false`, or any call the caller
  marks `idempotent: true` (an operation of `kind: 'read'`, an idempotent DELETE), never with a caller's `signal`. It is
  retried after a 429, a 408, 500, 502, 503 or 504, or a network failure (the connection could not be made, or was
  dropped before an answer), up to `retry.limit` retries of any of these together. The limit counts per request sent:
  a redirect hop and the resend after a 401 each get their own.
- A 429 waits `Retry-After`, else `waitFromBody`, else `retry.defaultWaitMs`, capped by `maxWaitMs`, with no jitter. The
  others wait a positive `Retry-After`, capped by `maxWaitMs`; without one, the n-th retry (n from 0) waits a
  full-jitter backoff: a random share of `min(maxWaitMs, 1000 × 2^n)` milliseconds, so at most 1, 2, 4 seconds and so
  on. The backoff never starts from `defaultWaitMs`, which entries set for a rate limit (30 seconds for Firecrawl).
- Never retried: a call not marked idempotent, a timeout (the caller has already waited the whole `timeoutMs`; a
  retry would only multiply it), a 501, any other 4xx, a 2xx that `errors.failed` marks, the guard's `address_blocked`,
  the OAuth token endpoint, a `token` entry's request and an RFC 7009 revoke. An answer that step 3 reclassifies is
  reported, not retried. The last answer is classified as any other; a timeout, and a network failure after the last
  retry, are `unavailable`.
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
type Timestamp = { header: string; toleranceSeconds?: number };
type Webhook = (
  | { kind: 'hmac'; header: string; signed?: Template; prefix?: string; encoding?: 'base64'; hash?: 'sha1';
      part?: string; timestamp?: Timestamp | { part: string; toleranceSeconds?: number } }
  | { kind: 'ed25519'; header: string; signed?: Template; timestamp?: Timestamp }
  | { kind: 'token'; header: string }
  | { kind: 'standard' }
) & { deliveryId?: { header: string } | { body: readonly Path[] }; challenge?: { when: When; echo: string } };
```

`verifyWebhook(entry.webhook, request, secret)` is a boolean over the raw body bytes: it never throws on a hostile
request. Every comparison is constant time over buffers of equal length, a timestamp is plain seconds inside its
tolerance (300 seconds by default), and a signature header longer than 8 KiB is `false` before it is parsed.
`deliveryId` is what an app dedupes on; several body paths are joined with `:`.

1. `hmac` signs the filled `signed` (the raw body by default) with HMAC-SHA256, or HMAC-SHA1 with `hash: 'sha1'`
   (Intercom), and compares `prefix` and the hex digest (base64 with `encoding`).
2. `hmac` with `part` (Stripe's `t=…,v1=…,v1=…`): the header is split on `,`, each piece on its first `=`. Every value
   whose name is `part` is a signature, the other pieces (another scheme, debug entries) are ignored, and the request
   passes when one of them equals the digest. A part's value is the signature alone, so the table refuses `prefix`
   beside it (an app's own entry with both compares `prefix` and the digest inside the piece) and a `part` name holding
   a `,`, `=` or whitespace.
3. `timestamp: { part }` reads the timestamp from the first piece of that name in the same header; `{timestamp}` in
   `signed` is that value. `timestamp.part` needs `part`, and `{timestamp}` is in `signed` exactly when there is a
   `timestamp`: a tolerance on a timestamp that is not signed would let a replay pass with a fresh one. `verifyWebhook`
   is `false` for an app's own declaration whose `signed` lacks `{body}`, or lacks `{timestamp}` beside a timestamp;
   any other name in `signed` is signed as written.
4. `ed25519` (Discord): the secret is the provider's public key as 64 hex characters; the header holds a
   128-hex-character signature over the filled `signed`. A bad key, a bad signature or a wrong length is `false`.
5. `token` (Google Calendar push): the header must equal the secret, compared over the SHA-256 digests of both, so its
   length leaks nothing.
6. `standard` (Standard Webhooks, GitLab): `webhook-id`, `webhook-timestamp`
   (seconds, 300 seconds of tolerance) and `webhook-signature` (space-separated `v1,<base64>`, other versions ignored)
   over `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 decoding of the secret after an optional
   `whsec_`. An id holding a `.` is `false`, as the specification bars it.
7. A header send's `value` (`Send.value`, Discord's `Bot {token}`, Trello's) is filled as every credential template is.
8. `challengeAnswer(webhook, request)`, called only after `verifyWebhook` accepted the request, answers a handshake: a
   JSON response `{ [echo]: value }` when the body is JSON, `challenge.when` holds for it and its top-level `echo` is a
   string or a finite number; otherwise null. Slack's `url_verification` and Discord's PING are its users.

In the code today: `hmac` (Breakcold, Fireflies, Slack), with `hash` (Intercom) and `part` (Stripe), `ed25519` and
`Send.value` (Discord, Trello), `token` (Google), `standard` (GitLab) and `challenge` (Slack, Discord). A secret that keys
nothing (empty, or a `standard` secret whose base64 decodes to nothing) is `false`. The table test also refuses a
`challenge.when` with a `status`, `header` or `detail` or without a `path`, and an `echo` holding a `.`.

Left as code in a module, not data: Twilio (sorted form parameters), HubSpot v3 (URI decoding), PayPal (a certificate
chain), SendGrid (ECDSA DER), Microsoft Graph rich notifications and Jira app tokens (JWT). Not declared until a
provider needs them: Paddle's `;` separator, second challenge shapes (Microsoft Graph's `validationToken`, Zoom's
`endpoint.url_validation`, Dropbox's GET, Asana's `X-Hook-Secret`) and a default `deliveryId` for `standard`.

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
  anything else a write. A GraphQL operation is a POST, so a write unless it says `kind: 'read'`. A search sent as POST
  says `kind: 'read'`: the engine retries only a call marked idempotent, a GET by default and an operation of
  `kind: 'read'`.
- A shape key ending in `?` may be missing or null, and is read as absent.
- `result` is checked by a small walker that drops undeclared keys. Without `result` the answer is `unknown`, and a 204
  (the usual answer to DELETE, PUT and PATCH) answers `null`, which `unknown` already covers. Any other answer without
  JSON, and a 204 to an operation with a `result`, is `invalid_response`.
- A path's `{name}` must be a declared `path` parameter; the compiler refuses the entry otherwise.
- An operation id's first dot-separated segment is never `json`, `request` or `paginate` (compared for equality, so
  `requests.list` is fine): those are the client's own calls. Nor is an id `then`, which would make the client a
  thenable. No id has an empty segment or is a dotted prefix of another (`pages` beside `pages.markdown`). The
  compiler refuses a reserved first segment and `then`; the table test and `client()` refuse every one of these, and
  `client()` refuses an app's own with `operation_clash: <id>`.
- At run time each argument is checked by its declared type (and `enum`) before anything is sent; one that does not fit
  is a `TypeError` naming it (`param_missing: <name>`, `param_invalid: <name>`). An argument that is not declared, or is
  `undefined`, is not sent; `null` is sent only for a `nullable` one (a JSON body or variable), else it counts as left
  out. A `path` value is one percent-encoded segment and cannot be empty, `.` or `..`; `path` and `query` values are
  strings, finite numbers or booleans, never `nullable`, and an `enum` is on a `string` parameter only. `body`
  parameters are sent as one JSON object, `variables` as GraphQL's variables (`{}` when none), posted with the query to
  the base.
- A paged operation yields the records at `records`, page by page, each checked against the element of `result` there;
  a record that does not fit is skipped, and the call's `onSkipped(ids)` option hears once from each page that skipped
  any, with their `id`s (or `null`). Without `records` it yields each page's whole answer.
- There are no sync concepts here: no parent and child streams, no incremental cursors, no transforms. An app calls an
  operation with the parent's id.

### What data cannot say

There are no hooks, and `defineProvider` takes one argument. What an entry cannot say is a call of the provider's
module: a hosted sign-in link and a two-request account lookup are calls of that provider's module.
A hook is added only when a provider's sign-in or identity can be neither data nor a module call.

## The engine

The core functions keep their names and take an entry. `ProviderDefinition`, `./providers`, `OAuthConnect`,
`DirectConnect` and the module connect objects are gone.

| Area | Change |
|---|---|
| `catalogue` (new) | `defineProvider`, the entry types, the template and path helpers. |
| `http` (internal) | `createClient(entry, options)` reads `auth.send`, `http`, `errors`, `rateLimit` from the entry, and `classify` interprets the declared rules. `./http` is no longer a subpath: `client` is the public client. |
| `connect` | `startConnect(entry, …)` and `finishConnect(entry, …)` run any entry: a form or OAuth 2. The scopes are the entry's; `requireGranted` compares the grant with them and refuses a short one as `rejected` (`scope_missing`). Identify is generic. A failed identify revokes the fresh grant unless `reusesGrant`. `finishConnect` returns `{ secret, values, account }`, typed from the entry. Its `fetch` is optional, defaulting as `client`'s. |
| `oauth`, `credentials` | Driven by the entry. `revokeGrant(entry, { accessToken?, refreshToken?, client?, fetch })` is the one revoke (`client` only for an RFC 7009 revoke): by RFC 7009 or by request, as the entry declares; a 2xx, `invalid_grant`, a revoked grant and the entry's `goneErrors` are done, and an RFC 7009 revoke's 404 (a request revoke's 404 is a missing route). |
| `paginate` | Unchanged. The walker for the declared shapes is built on it. |
| `webhooks` | `verifyWebhook(entry.webhook, request, secret)`, then `challengeAnswer(entry.webhook, request)` and `deliveryId(entry.webhook, request)`. |
| `client` (new) | `client(entry, options)` takes the HTTP client's options (`token`, `values?`, `baseUrl?`, `headers?`, `minIntervalMs?`, `beforeRequest?`, `fetch?`) and returns the typed operations, plus `json`, `request` and `paginate` for raw calls. `token` is a string or a function that renews it; a missing or blank one is refused when a request needs it (`token_missing`). `fetch` is the global one by default, or `guardedFetch` for an entry whose host is typed. |
| `vault` | Unchanged. A connection's plain values are the app's to keep. |

```ts
import { client } from '0-integrations/client';
import { attio } from '0-integrations/catalogue/attio';

const api = client(attio, { token: process.env.ATTIO_KEY });
const self = await api.json('/self');                          // raw, authenticated, retried
// An entry that declares operations adds them, typed:
// for await (const issue of api.issues.list({ teamId }, { onSkipped: ids => log(ids) })) { … }
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
keeps). Sign-in is `startConnect` and `finishConnect`; calls go through `client`. OAuth app credentials are arguments,
never a stored "integration" object.

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

**Stage B: expansion.** Four pull requests. Each item arrives with a first provider that needs it, an entry citing
its docs, and engine tests as proof:

1. **Where a call can go.** Keys in the query (SerpApi); field choices and defaults, and a base filled from a value with
   a host pattern (Intercom); a guarded `fetch` that refuses private addresses, for a host the person types (GitLab);
   retry of 5xx and network failures on reads, with jitter (Microsoft, Google).
2. **How a token is obtained.** JSON token bodies, a second base for identify, a path segment and a saved value in the
   base (Jira); a separate refresh URL (Figma); one declared token request for client credentials and session sign-ins
   (Zoom, Metabase); a templated token URL (PayPal, Metabase).
3. **More webhook schemes.** Timestamped `t=,v1=` headers (Stripe), SHA-1 (Intercom), Ed25519 and a header value
   template (Discord, Trello), shared tokens (Google), Standard Webhooks (GitLab), and a challenge handshake (Slack,
   Discord).
4. **The kit.** A fake derived from any entry, the recorder for an entry with no module, a scaffolder (`pnpm new <id>`)
   and a five-step guide to adding a provider.

Arriving later, each when a provider needs it: extra token parameters, token paths and a default expiry in the OAuth
code flow; a nested `token` request body and an `expiresIn` path; a revoke for the `token` kind; templated OAuth
authorize and token URLs (Shopify); placeholders in `bases`; retry of writes; second challenge shapes; webhook schemes
that are code (Twilio, HubSpot v3, PayPal, SendGrid).

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
