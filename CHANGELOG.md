# Changelog

## Unreleased

- A `/` in a provider's error code becomes `.` in `detail` for every provider (Unipile's `errors/…` codes are now
  carried), OAuth refusals carry codes the HTTP errors already carried (`.` and `-` allowed), and a fractional or
  HTTP-date `Retry-After` is honoured by the retry wait.

## 0.12.0

- The package is now `0-integrations`, on npm and at github.com/alessandro-afloarei/0-integrations.
  `@alessandro-afloarei/integrations` stops receiving releases; 0.11.1 is its last.
  - It stays ESM only, Node 22 or later, with the same subpaths, so an app moving from the old name changes only its
    import specifier (`@alessandro-afloarei/integrations/hubspot` becomes `0-integrations/hubspot`), or keeps it
    through a package-manager alias: `"@alessandro-afloarei/integrations": "npm:0-integrations@0.12.0"`.
- The library is licensed under Apache 2.0 (`LICENSE`, and `NOTICE` in the package).
- A test checks every recorded fixture holds only synthetic emails and phone numbers (reserved domains, the fictional
  555-01xx numbers), after decoding JSON and URL escapes; the fixtures that held real ones are rewritten.
- The docs are split: a shorter README, a page per module under `docs/modules/`, and `ROADMAP.md`, `CONTRIBUTING.md`,
  `SECURITY.md` with issue and pull request templates.
- CI runs on GitHub-hosted runners only, since a public repository must not run forked code on self-hosted ones;
  releases are staged on npm with provenance.
- GitHub calls send `User-Agent: 0-integrations`.
- No API changes.

## 0.11.1

- unipile: a next page sends its cursor alone, with the page size. Unipile V2's `next_cursor` holds the first page's
  filters and refuses any sent beside it with a 400 (`api/invalid_parameters`, live on 2026-11-24), so every events or
  mail listing longer than one page failed on its second page. The offset path keeps its filters.
  - `unipile/fake` refuses a cursor sent beside anything but `limit`, and its cursor resumes the first page's filters.

## 0.11.0

- unipile: the client speaks Unipile V2 only (`https://api.unipile.com/v2`, now the `unipile` provider's `baseUrl`), the workspace's V2 key in
  `X-API-KEY`. Breaking:
  - `unipileClient({ apiKey, fetch })`: no `dsn`; `unipileOrigin` is gone with it.
  - `HostedSignIn` is `{ state, redirectUri, expiresOn, scopes? }` with `providers` (lowercase: `linkedin`, `google`,
    `outlook`) for a new account or `accountId` to sign one in again. Unipile sends the browser back to `redirectUri` with
    `account_id`, `provider` and `state`; there is no notify, success or failure address any more. `scopes` is the whole
    list each OAuth provider is asked for.
  - `parseAccountNotification` and `AccountNotification` are gone: nothing is made from a notice.
  - `account()` answers `{ createdAt, provider, email, scopes }`: `provider` replaces `type`, `email` is the mailbox's
    primary sender (one more request, for a mailbox), `scopes` what the account granted.
  - `emails()` takes no `threadId` (Unipile V2 ignores it on the list) and a `limit` of 1 to 100; `thread(accountId,
    threadId)` reads a thread whole. A message's `role` is read from its folders' roles; `id` and `provider_id` are both
    Unipile V2's id (the provider's own); `in_reply_to` comes from the `In-Reply-To` header.
  - `events()` takes a `limit` of 1 to 100. A time without an offset is read in its zone rather than skipped.
  - A refusal's `detail` is Unipile's type with its thrower (`provider.insufficient_permissions`).
  - A list without a cursor stops at `total_count`, and ends where an offset is refused as a bad request: Outlook pages by
    cursor and gives none on its last page.
  - `unipile/fake` answers V2: `fakeUnipile` takes no `dsn`; `hostedConsent` is `{ consentUrl, redirectUris, accountId }`; an
    account names `provider`, `email` and `scopes`.
- The Unipile mail and calendar recordings are synthetic V2 answers, their key sets checked against live V2 on 2026-11-23.

- mailbox: `MailboxEmail`, `MailboxCalendar`, `MailboxEvent` and `MailboxReader`, one member's mailbox and calendar read
  the same way over every transport; the `Unipile*` mail types are now aliases of them, and `unipileMailbox` reads a
  workspace account as a reader.
- microsoft: `graphMailbox` reads Outlook mail and calendar through Microsoft Graph on a member's delegated grant, and
  `microsoftConnect` signs a member in (PKCE; `MICROSOFT_SCOPES`). `microsoft/fake`: `fakeMicrosoft`, the sign-in and Graph
  on synthetic mailboxes.
- google: `googleMailbox` reads Gmail and Google Calendar on a member's grant, and `googleConnect` signs a member in and
  revokes (PKCE; `GOOGLE_SCOPES`). `google/fake`: `fakeGoogle`. `providers` gains `microsoft`, `google` and
  `GOOGLE_CALENDAR_BASE`; Google's 403 quota refusals read as `rate_limited`.
- The provider kit runs `graph-mail`, `graph-calendar`, `google-mail` and `google-calendar` on synthetic recordings and the
  fakes; `record.test.ts` records them from a test mailbox's access token.
- mailbox: `MailboxEvent.visibility`, `public` or `private`, on every transport, so an app can leave out what a member marked
  private. Unipile answers it as it is (as in 0.10.1); Google's `private` and `confidential` are private; Outlook's every
  sensitivity label but `normal` is, `personal` included. An event from Unipile or Graph that does not say is skipped. The
  fakes answer it as each provider does.

## 0.10.1

- unipile: an event carries Unipile's `visibility`, `public` or `private`, so an app can leave out what a member marked
  private. An event that does not say is skipped. Compatibility: `UnipileEvent` gains the required field, so an app that
  builds events (a fixture for `unipile/fake`) must add it.

## 0.10.0

- unipile: `emails`, `calendars`, `events` and `deleteAccount` read a member's Gmail, Google Calendar, Outlook mail and
  Outlook Calendar, signed in through the hosted link, which now takes `providers` (`GOOGLE`, `OUTLOOK`; `LINKEDIN` when
  omitted, so its wire is unchanged). Mail keeps the five headers an app filters on and drops the rest; `metaOnly` lists the
  metadata alone; `list-unsubscribe` is kept with its value blanked. Dates must be ISO times with an offset, and an event
  whose time comes without one is skipped rather than read in the host's time zone. Events and
  calendars page by Unipile's cursor or offset behind one cursor, each instance of a series on its own; by offset a list
  ends on an empty page or a repeated page. A Unipile refusal's `detail` is its error type (`disconnected_account`).
  `account` also answers the account's `type` and mailbox `email`, and they are `unipileConnect`'s details. unipile/fake:
  `apiKey`, an account's `type` and `email`, `mailboxes`, account deletion, and a `hostedConsent.accountId` given
  `{ state, providers }`, which may be async. Compatibility: `UnipileClient` gains the four methods, so a structural
  implementation must add them; an account answer must carry Unipile's `type`; the legacy `authLink` callback also
  receives `providers`.

## 0.9.0

- fathom: `fathomClient` lists a member's meetings (ten a page, filtered by creation time and recorder) and reads a
  recording's transcript; `fathom/fake` serves both. The provider paces calls a second apart and waits out one 429.
- attio: `attioClient` names a token's workspace (an unknown token is `rejected`), pages an object's records oldest first
  (or those created after a time; the record id breaks ties), and lists notes and workspace members; `attio/fake` serves them.
- aircall: `aircallClient` names the key's company, pages calls oldest first with their contact (past the 10,000 calls one
  listing serves, from a second before the last call read), and reads a call's transcript (null while it has none; a
  company without AI Assist is `request_failed` 403 `ai_assist_required`); `aircall/fake` serves them.
- notion: `notionClient` names a connection's bot and workspace, pages the pages shared with it, most recently edited
  first (an incremental read ends where older ones begin, to the minute Notion rounds edit times to), and reads a page as
  Markdown with a `cut` flag; `notion/fake` serves them. The provider paces calls 350 ms apart and waits out one 429.
- github: `githubClient` names a token's person, pages the repositories it reads and a repository's issues and pull
  requests in creation order, updated since a time, by GitHub's `Link` header; `github/fake` serves them. GitHub's 403
  rate limit is `rate_limited` with the wait GitHub asks for, never `rejected`, and neither a rate limit nor a 401 is retried.
- providers: a definition's `rateLimit(status, headers, body)` names a rate limit its status may not (GitHub's 403), and the
  wait it asks for when no `Retry-After` does (GitHub's `x-ratelimit-reset`, or a minute for a secondary limit).
- `parseEntries` reports a skipped entry's numeric id as a string, and takes the id's reader where a provider does not call it
  `id` (Fathom's `recording_id`).
- A provider kit for every new provider's tests: sign in, a bad key, the first page, paging to the end, an incremental
  read and a 429, on a recording (synthetic until recorded from a test account) and on the fake.
- apollo: `apolloClient` proves a key at no credit (`profile`), enriches a person without personal emails, phones or the
  waterfall (at most one credit; the person's details travel in the body, never the URL) and an organization by domain (one
  credit); no match is null, and a refusal's detail is Apollo's `error_details.code`. `apollo/fake` serves them.
- lusha: `lushaClient` on v3 reads the key's credits (`usage`), a person by email, LinkedIn URL or name and company domain
  (contact search: no emails or phones) and a company by domain (no premium reveals), each as `{ match, creditsCharged }`
  with null for no match. An account without v3 access is `request_failed` 403 `v3_not_enabled`. `lusha/fake` serves them.
- A lookup kit for providers without pages: the key proof, a bad key, a person found and one not, a company and a 429.

## 0.8.1

- hubspot: `dealCompanies` picks the primary company, else the lowest id; was the first association in HubSpot's
  answer, which HubSpot does not order. Primary is HubSpot's own deal-to-company association type
  (category `HUBSPOT_DEFINED`, typeId `5`, per the [associations v4 guide](https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide)).
  Ids compare as numbers; two primaries (malformed) resolve to the lowest of them; an answer without
  `associationTypes` falls back to the lowest id. The return type is unchanged. `dealContacts` is unchanged.
- hubspot/fake: `dealCompanies` (and the cohort's) also accept a deal's companies as `{ id, primary? }[]`, served
  with association types. The existing one-company string form answers byte for byte as before.

## 0.8.0

- hubspot: `dealStageHistory(ids)` reads retained dealstage revisions in batches of 50, returning a map of
  deal IDs to `{ value, timestamp, sourceType? }` revisions ordered oldest first. Provider timestamps are preserved;
  no history is synthesized. HubSpot documents up to 20 retained revisions per deal property, not lifetime history.
- hubspot/fake: accept a data callback so one fake can serve changing portal data without resetting OAuth state.
  Optional `dealStageHistory` and sync `dealContacts` maps support history and associations for sync deals as well
  as the existing cohort. Existing static fake data and ordinary record responses are unchanged.
- Compatibility: `HubSpotClient` gains the required `dealStageHistory` method. Structural implementations and
  typed wrappers must add it when upgrading.
- History batches use the 50-input limit observed in [Pipedream's HubSpot error report](https://github.com/PipedreamHQ/pipedream/pull/8462),
  consistent with the [Deals OpenAPI warning](https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json)
  that requesting history lowers the request maximum. The fake refuses history requests above 50 inputs with 400;
  plain reads retain their 100-input batch size.

## 0.7.0

- breakcold/fake: optional readable-only notes and meetings support direct reads without changing ingestion lists;
  normal listed records win duplicate ids and missing items remain 404.
- unipile: add `unipileConnect` for the shared hosted start/finish contract; account ids remain app-owned secrets.
- unipile/fake: optionally bind hosted consent to registered destinations, expiring single-use tickets and the
  app-supplied notification callback; reject parameter overrides and never follow notification redirects.
- errors: optional `ProviderHttpError.retryAfterMs` preserves the final response's valid retry hint, including
  Fireflies GraphQL and Slack HTTP-200 refusals. Missing/invalid hints are null; existing retry policy is unchanged.
- hubspot: retain admitted `MISSING_SCOPES` and `VALIDATION_ERROR` categories in error detail without changing
  rejection classification or exposing messages, context, credentials or unknown categories.

## 0.6.0

- hubspot: a typed client for object searches, batch reads, associations, portal identity, stages and owners. `changedRecords` resumes an id-paged scan and
  `hubspotConnect` composes with the shared OAuth start/finish flow, identifies the portal with its existing `Portal <id>` label,
  and preserves potentially shared refresh grants after identity failures (`reusesGrant: true`). Portal IDs reject zero and leading zeros in token extras and account-info.
- hubspot/fake: requires a registered OAuth client and HTTP(S) redirect URI, serves the real authorize URL, and binds one-use codes to
  the client and callback. Token and revoke requests require matching client credentials; authorization requires the read scopes. Token requests validate their grant type; revocation accepts only issued refresh tokens,
  is idempotent, and prevents further refreshes. Fixture callers must authorize before exchanging a code.
- hubspot: export `HUBSPOT_SCOPES`; shared OAuth completion supports additive `reusesGrant?: true` to skip unsafe cleanup.
- hubspot/fake: reuse one refresh token per client/portal across consents, issuing a new one after revoke. Allowlist
  portal fixture refresh shapes plus the legacy seed; isolate codes per instance. Document per-process revocation.

## 0.5.0

- Connect: one start/finish contract for OAuth, API-key forms and hosted flows, with Slack OAuth as its first consumer.

- Slack provider module: typed posting, bounded channel listing with skipped ids, cursor checks and `channelsCut`, idempotent revocation and identity, with a fake that binds authorization codes to the registered callback and client.
- OAuth completion revokes unowned grants after identity failures and reports failed cleanup through required `onRevokeFailed`; shared OAuth functions refuse blank state and missing PKCE verifiers. `GrantRevoked.detail` preserves the provider token-gone code on both OAuth and Web API paths.

## 0.4.0

- fireflies: search requests all declared list fields; resumable cursors are bound to their query and caller
  inputs are validated before requests. Codeless GraphQL errors are failures, and the fake refuses unknown users.

- fireflies, breakcold: parse verified webhook payloads / delivery headers without taking ownership of signature
  verification, routing, deduplication or the original stored bytes.

- fireflies: typed GraphQL client, identity lookup, offset sync at 50 records per page, and the provider fake.
  GraphQL failure codes take precedence over HTTP status. Transcript normalization preserves sentence attribution
  and decimal start times; apps keep their stored-payload validation and page budgets.

## 0.3.0

- granola, breakcold: provider modules for the two API-key sources. Each client returns typed values under the
  provider's own field names, since an app stores them; the schemas drop every key they do not name, so Granola's
  summary and an owner's private notes never leave the client. A list answers one `Page` at a time with the ids of the
  entries the client could not read, so the app decides what an unreadable entry means. Granola reads a transcript too
  large to inline page by page, up to 50 pages, and says when that cap cut it (`transcriptCut`); Breakcold refuses a
  page that claims more with no cursor (`cursor_missing`).
  `granola/fake` and `breakcold/fake` answer the calls their clients make.
- paginate: `paginate(load)` yields every page until the last and refuses a cursor it has seen (`cursor_repeated`);
  the caller stops whenever its own budget says so. Broken paging carries no status, so an app tells the library's
  `cursor_*` tokens from a provider's own code.
- http: `createClient` takes `beforeRequest(url)`, run once per call before anything is sent (an app's metering);
  what it throws reaches the caller unchanged. `ProviderHttpError.detail` carries the provider's own code for a refusal
  where the catalogue reads one: Breakcold's `usage_limit` and `organization_moved`.

## 0.2.0

- exa, firecrawl, unipile: the first provider modules. Each holds the provider's typed client and answer parsing, so
  an app no longer builds the provider's requests or reads its answers. Firecrawl sends no browser actions to a
  document and reads a page once more as it loads when its render fails. Unipile parses the hosted sign-in's account
  notification; `unipileOrigin`, in `providers` so a boot check loads no client, reads the workspace's address as its
  dashboard shows it, https only.
- testing: `respondFrom` answers a request from routes, or null, so a provider's fake serves an app's fixture mode as
  well as `fakeFetch`. `exa/fake`, `firecrawl/fake` and `unipile/fake` export `fakeExa`, `fakeFirecrawl` and
  `fakeUnipile`, which answer the calls their clients make; each client's own tests pin its exact requests.
- zod 4 validates provider answers inside the library. It is a dependency, never part of the public types: an answer
  in the wrong shape is a `ProviderHttpError` with code `invalid_response`.

## 0.1.1

- http: follow a redirect that stays on the same origin and keeps the request (307/308, or 301–303 for a GET), at
  most five hops; a redirect to another host is still never followed. Breakcold's universal endpoint redirects a
  signed-in request to its region, which 0.1.0 refused.

## 0.1.0

- errors: shared, coded failures without secret-bearing causes.
- providers: eight provider definitions with existing timing and retry values.
- vault: AES-256-GCM envelope encryption, legacy reads, AAD, key cache and KEK rewrapping.
- oauth: authorization URLs, PKCE, exchange, refresh and revocation through oauth4webapi.
- credentials: locked refresh, version-fenced saves and a 5-second window for a concurrent winner.
- http: ky client with token reuse, timeouts, pacing and capped 429 retries.
- webhooks: data-driven HMAC verification and bounded raw-body reads.
- testing: fetch scripts, memory stores and locks, and a real-store contract check.
