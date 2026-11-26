# Roadmap

0-integrations aims to be the most comprehensive integrations library there is: open source, running inside the
developer's own app, with no hosted service and no account to create. Connecting a product or service should take an
afternoon, not a week. For each service it covers, the library provides:

- sign-in (OAuth and every other scheme the provider uses);
- token storage and refresh;
- authenticated reads and writes;
- incoming webhooks.

**Today** (0.13.0, with Stage B not yet released) the library is the core (`catalogue`, `connect`, `client`, `oauth`,
`credentials`, `vault`, `webhooks`, `paginate`, `testing`), the entries listed in [`docs/providers.md`](docs/providers.md),
which one engine runs, and a module with a fake for 17 of those providers. Any entry gets a fake derived from it,
`pnpm new <id>` writes a new entry's skeleton, and the recorder records an entry from a test account. What providers
need that the engine cannot say yet is on the [waiting list](docs/waiting-list.md). The adapters and the connect screen
are planned; the rest of this page describes where it is going.

## Goals

1. **Breadth.** At least 300 declared catalogue entries at the first public release, and 1,000 or more later, covering
   every widely used auth mode: API key (header or query), bearer, basic, OAuth 2 authorization code with PKCE, OAuth 2
   client credentials, OAuth 1, JWT and service accounts, and two-step or session-token logins.
2. **Honest quality.** Every entry carries a tier, and the docs show it. Nothing claims more than it has proven.
3. **Depth where it pays.** 20 to 30 deep modules at the first public release, in CRM, tasks and projects, mail and
   calendar, meeting recorders and chat.
4. **Batteries included.** From zero to a working connection without writing storage, locks, OAuth routes or a connect
   screen. The ready-made pieces are optional, and the four seams stay for anyone who brings their own.
5. **One place per provider.** Sign-in, quirks, identity, revoke, paging, rate limits, webhook signing, scopes and docs
   all live in the provider's entry or beside it, never in a central `switch`.

## Not planned

- A hosted service, a dashboard, a managed scheduler or a records store.
- Running user-written integration scripts.
- Unified APIs that force every CRM into one model. Deep modules return each provider's own field names.
- MCP servers or agent tool hosting. An app can build those on the library.
- Other languages. TypeScript on Node 22 or later only; the catalogue will also export as JSON for others to read.

## Layers

```text
adapters (separate packages)   postgres · redis · next (route handlers) · react (connect screen)
deep modules                   <provider>  typed reads/writes, parsed webhooks, fake, recordings
catalogue                      catalogue/<provider>  one declared entry each, tiered
core                           connect · client · oauth · credentials · vault · paginate · webhooks · sync · errors · testing
```

Each layer will use only the ones below it, and each piece will be usable alone: the vault without the catalogue, the
catalogue without the adapters.

- **Core.** Runs any entry: connect, OAuth, credentials, the vault, HTTP with retries, paging, webhook checks and
  declared operations. `guardedFetch` refuses private addresses, and is the default for a host the person types. A
  sync helper the app runs in its own job runner is planned.
- **Declared catalogue.** Holds one typed entry per provider, written from the provider's own docs and checked by one
  table test. An entry is pure data: sign-in, form fields, identity (which also checks the credential), revoke, HTTP,
  retry and error rules, paging shapes, webhook scheme, scopes and named operations, with a client whose types are
  inferred from the entry.
- **Deep modules.** Hand-written clients for the providers that earn them: typed reads and writes, zod-checked
  answers, parsed webhooks, a fake and recordings.
- **Adapters.** Will be separate packages: a Postgres store, a Redis lock and nonce store, route handlers for OAuth and
  webhooks, and an unstyled React connect screen drawn from the catalogue.

## Tiers

| Tier | What it proves |
|---|---|
| declared | The entry passes the schema and the lints |
| recorded | A real sign-in and first call, captured from a real account, replay in CI |
| verified | A live check passes in the nightly run |

A recording made up from docs tests the code but leaves the entry `declared`. A `verified` entry that fails two nights
in a row moves down a tier.

## Licensing

The library is licensed under the Apache License 2.0. Code is copied only from Apache 2.0 or MIT sources, and each
copied file or block is credited in `NOTICE` and in a header comment naming its source and license. Other projects
inspire the design, but their code is not copied. Provider facts (URLs, scopes, header names, signature schemes) come
from each provider's own documentation.

## Phases

Each phase ends with a release. Breaking changes are listed in the changelog with their migration.

| # | Phase | Done when |
|---|---|---|
| 0 | Open-source readiness | Apache 2.0 license, contributor docs, security policy and issue templates; the repository public |
| 1 | Entry format and generic engine | Stage A, done in 0.13.0: the entry format, its table test, `catalogue.json`, tiers, generic identify and revoke, the paging walker, declared operations with an inferred typed client, and the 17 providers moved onto entries. Stage B, done: keys in the query string, field choices, templated base URLs and a guarded `fetch`; JSON token bodies, a second base, a separate refresh URL; client-credentials and session logins; more webhook schemes and challenge handshakes; 5xx and network retries on reads; a fake derived from an entry, the recorder for an entry with no module, and a scaffolder; 28 entries. Next: the release of Stage B |
| 2 | Breadth | 300 or more entries, added in category batches with their main operations, 100 or more at `recorded` or above |
| 3 | Adapters | The Postgres, Redis and route-handler packages |
| 4 | Connect screen | The React connect screen, drawn from `catalogue.json` |
| 5 | Sync helper and deep modules | The `sync` helper, and deep modules up to 20 to 30 |
| 6 | First public release | A docs site generated from the entries, a comparison page, the npm release and the announcement |

After the first release, the catalogue keeps growing toward 1,000 entries or more, deep modules are added where users
ask for them, and the nightly verified tier widens.
