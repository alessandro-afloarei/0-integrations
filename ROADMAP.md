# Roadmap

0-integrations aims to be the most comprehensive integrations library there is: open source, running inside the
developer's own app, with no hosted service and no account to create. Connecting a product or service should take an
afternoon, not a week. For each service it covers, the library provides:

- sign-in (OAuth and every other scheme the provider uses);
- token storage and refresh;
- authenticated reads and writes;
- incoming webhooks.

**Today** the library is the core (`vault`, `credentials`, `oauth`, `connect`, `http`, `webhooks`, `paginate`,
`testing`) plus 17 provider modules, each with a fake. The declared catalogue, the adapters and the connect screen are
planned; the rest of this page describes where it is going.

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
core                           connect · oauth · credentials · vault · http · paginate · webhooks · sync · errors · testing
```

Each layer will use only the ones below it, and each piece will be usable alone: the vault without the catalogue, the
catalogue without the adapters.

- **Core.** Will run any entry: connect, OAuth, credentials, the vault, HTTP with retries, paging, webhook schemes, a
  sync helper the app runs in its own job runner, and an SSRF guard for templated URLs. Today there is no SSRF guard:
  the app passes its own guarded `fetch`.
- **Declared catalogue.** Will hold one typed entry per provider, written from the provider's own docs and checked at
  build time. An entry will be pure data: auth alternatives, form fields, identity, revoke, verify, HTTP and retry
  rules, paging, webhook scheme, scopes and named operations, from which a typed client will be generated.
- **Deep modules.** Will be hand-written clients for the providers that earn them: typed reads and writes, zod-checked
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
| 1 | Entry format and generic engine | The entry format, its lints, `catalogue.json`, tiers and declared operations with an inferred typed client; today's providers moved onto entries; new auth modes, templated URLs, generic identify, revoke and verify, 5xx retry and more webhook schemes |
| 2 | Breadth | 300 or more entries, added in category batches with their main operations, 100 or more at `recorded` or above |
| 3 | Adapters | The Postgres, Redis and route-handler packages |
| 4 | Connect screen | The React connect screen, drawn from `catalogue.json` |
| 5 | Sync helper and deep modules | The `sync` helper, and deep modules up to 20 to 30 |
| 6 | First public release | A docs site generated from the entries, a comparison page, the npm release and the announcement |

After the first release, the catalogue keeps growing toward 1,000 entries or more, deep modules are added where users
ask for them, and the nightly verified tier widens.
