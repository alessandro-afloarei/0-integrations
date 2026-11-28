# 0-integrations

0-integrations connects a Node app to other services: sign-in, credentials and token refresh, authenticated calls,
paging and incoming webhooks. It is a library that runs inside your own app. There is no hosted service and no account
to create.

## Install

```sh
pnpm add 0-integrations
```

It needs Node 22 or later and is ESM only. Import the module you need through its subpath; there is no root barrel.
The TypeScript declarations are the API reference.

## How it works

Each provider is an entry: one file of plain data that says how to sign in, how to learn the account, how the
credential travels, how errors read and which calls the provider offers. One engine runs any entry. A provider that
needs real code, such as answers with meaning, incremental reads or parsed webhooks, also has a module built on its
entry, with a fake for tests.

An entry signs in one of three ways: a `key` the person enters, an `oauth2` grant from the provider's consent screen,
or a `token` request that turns what the person entered into a short-lived token (client credentials, or a session
sign-in). What an app keeps for each account is a connection: a secret to seal (an API key or a token entry's secret,
or an OAuth grant) and plain values to store. Sign-in is `startConnect` and `finishConnect`, and calls go through
`client`.

## Connect a key provider

```ts
import { signInWith } from '0-integrations/catalogue';
import { attio } from '0-integrations/catalogue/attio';
import { finishConnect, startConnect } from '0-integrations/connect';

const key = signInWith(attio, 'key'); // Attio lists OAuth 2 first; this is its API key
const { fields } = await startConnect(key); // the form to draw: one secret field, "API key"
const { secret, account } = await finishConnect(key, { secret: { apiKey }, fetch });
// secret: { apiKey }, to seal; account: { id, name } of the workspace. A bad key throws ProviderHttpError `rejected`.
```

## Connect an OAuth provider

```ts
import { google } from '0-integrations/catalogue/google';
import { finishConnect, startConnect } from '0-integrations/connect';

// Send the browser to `start.url`; keep `state`, `start.codeVerifier`, and `start.values` when the entry has plain
// fields, on the server.
const start = await startConnect(google, { clientId: oauthClient.clientId, redirectUri, state });

// In the callback, once the state matches, with the verifier kept at the start:
const { secret, account } = await finishConnect(google, {
  client: oauthClient, code, redirectUri, codeVerifier, fetch, onRevokeFailed: error => { report(error); },
});
// secret: the grant, to seal; account: { id, name }, the member's address.
```

The [HubSpot page](docs/modules/hubspot.md) runs a whole OAuth connect against the HubSpot fake, with no account or
network.

## Call a provider

```ts
import { notion } from '0-integrations/catalogue/notion';
import { client } from '0-integrations/client';

const api = client(notion, { token: apiKey });
const page = await api.pages.markdown({ pageId }); // typed: { markdown: string; truncated: boolean }
const me = await api.json('/users/me'); // raw: authenticated, classified errors
```

Any entry gives the raw calls `json`, `request` and `paginate`; an entry that declares operations adds them, typed. For
an OAuth connection, `token` is a function that renews the token: [client](docs/modules/client.md) shows one. For a
`token` entry (Zoom, PayPal, Metabase) it is `tokenSource(entry, { secret, values })` from `0-integrations/oauth`.

## Providers

Every provider's entry is a file in [`src/catalogue/`](src/catalogue), published at `0-integrations/catalogue/<id>`.
[`docs/providers.md`](docs/providers.md) lists them all, with their categories, sign-ins, operations, webhooks and
tiers; it is generated from the entries, so an entry needs no line here. The build writes them too, each with its tier,
to `0-integrations/catalogue.json`, the list for code to read. What providers need that the engine cannot say yet is on
the [waiting list](docs/waiting-list.md). The providers below also have a module and a fake at `<id>/fake`.

| Module | Auth | Reads | Writes | Webhooks |
|---|---|---|---|---|
| [Aircall](docs/modules/aircall.md) | Key | calls, transcripts | — | — |
| [Apollo](docs/modules/apollo.md) | Key | people and company enrichment | — | — |
| [Attio](docs/modules/attio.md) | Key | records, notes, members | — | — |
| [Breakcold](docs/modules/breakcold.md) | Key | workspaces, records, notes, meetings | — | signature, delivery id |
| [Exa](docs/modules/exa.md) | Key | web search | — | — |
| [Fathom](docs/modules/fathom.md) | Key | meetings, transcripts | — | — |
| [Firecrawl](docs/modules/firecrawl.md) | Key | site maps, page scrapes | — | — |
| [Fireflies](docs/modules/fireflies.md) | Key | transcripts, search | — | signature, event |
| [GitHub](docs/modules/github.md) | Key | repositories, issues, pull requests | — | — |
| [Google](docs/modules/google.md) | OAuth | Gmail, Google Calendar | — | Calendar push channel token |
| [Granola](docs/modules/granola.md) | Key | notes, transcripts | — | — |
| [HubSpot](docs/modules/hubspot.md) | OAuth | CRM objects, associations, stages, owners, stage history | — | — |
| [Lusha](docs/modules/lusha.md) | Key | person and company lookups, credits | — | — |
| [Microsoft](docs/modules/microsoft.md) | OAuth | Outlook mail and calendar | — | — |
| [Notion](docs/modules/notion.md) | Key | shared pages, page text | — | — |
| [Slack](docs/modules/slack.md) | OAuth | channels | post a message | signature, challenge |
| [Unipile](docs/modules/unipile.md) | Key, plus hosted sign-in | accounts, mail, calendars | delete an account | — |

## Core

| Module | What it does |
|---|---|
| [`catalogue`](docs/modules/catalogue.md) | `defineProvider` and the entry types; `catalogue/<id>` is one entry, `catalogue.json` all of them |
| [`connect`](docs/modules/connect.md) | `startConnect` and `finishConnect`: one flow for OAuth and key forms, run from an entry |
| [`client`](docs/modules/client.md) | `client(entry, { token })`: the entry's operations, and `json`, `request` and `paginate` |
| [`oauth`](docs/modules/oauth.md) | Consent URLs, code exchange, refresh and revoke, with PKCE |
| [`credentials`](docs/modules/credentials.md) | Reads API keys and refreshes OAuth tokens under a lock |
| [`vault`](docs/modules/vault.md) | Seals JSON secrets under per-tenant data keys |
| [`webhooks`](docs/modules/webhooks.md) | HMAC (SHA-256 or SHA-1, Stripe-style `t=…,v1=…` headers), Ed25519, shared-token, HTTP Basic and Standard Webhooks checks over the raw body bytes, delivery ids, and challenge answers (Slack, Discord, Nylas) |
| [`paginate`](docs/modules/paginate.md) | Walks a module's pages and refuses a repeated cursor |
| [`errors`](docs/modules/errors.md) | Coded errors such as `ProviderHttpError` and `GrantRevoked`, never carrying provider bodies or secrets |
| [`testing`](docs/modules/testing.md) | Scripted fetch, in-memory stores and locks, and a check for your own credential store |
| [`mailbox`](docs/modules/mailbox.md) | One shape for a member's mail and calendar, whatever the transport |

To store credentials (`vault` and `credentials`), an app implements four seams; the library contains no database or
Redis client. `testing` has in-memory versions of the stores and the lock for tests:

```text
SecretStore: read a connection secret and replace it only at the expected version.
TenantKeyStore: read, insert the winning tenant key, and replace at the expected version.
KeySource: expose current KEK version, write format, and get(version).
WithLock: run work under a named lock, or return "busy".
```

## Roadmap and contributing

- [ROADMAP.md](ROADMAP.md): where the library is going.
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, the one check command, and how to add a provider in five steps, the
  first `pnpm new <id>`.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- [CHANGELOG.md](CHANGELOG.md): every release, with the migration for each breaking change.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
