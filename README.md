# 0-integrations

0-integrations handles sign-in, token storage and refresh, authenticated calls and incoming webhooks for many services.
It runs inside your own Node app, with no hosted service and no account to create.

## Install

```sh
pnpm add 0-integrations
```

It needs Node 22 or later and is ESM only. Import the module you need through its subpath; there is no root barrel.
The TypeScript declarations are the API reference.

## The four seams

To store credentials (`vault` and `credentials`), an app implements four seams; the library contains no database or
Redis client. `testing` has in-memory versions of the stores and the lock for tests:

```text
SecretStore: read a connection secret and replace it only at the expected version.
TenantKeyStore: read, insert the winning tenant key, and replace at the expected version.
KeySource: expose current KEK version, write format, and get(version).
WithLock: run work under a named lock, or return "busy".
```

## Example: connect HubSpot

This example runs against the HubSpot fake, so it needs no account or network.

```ts
import { hubspot } from '0-integrations/catalogue/hubspot';
import { startConnect, finishConnect } from '0-integrations/connect';
import { fakeHubSpot } from '0-integrations/hubspot/fake';
import { fakeFetch } from '0-integrations/testing';

const redirectUri = 'https://app.test/api/integrations/hubspot/callback';
const http = fakeFetch(fakeHubSpot({ ...portalData, client, redirectUri }));
const begun = await startConnect(hubspot, { clientId: client.clientId, redirectUri, state });
if (begun.kind !== 'redirect') throw new Error('expected_redirect');
const consent = await http.fetch(begun.url, { redirect: 'manual' });
const back = new URL(consent.headers.get('location') ?? '');
if (back.searchParams.get('state') !== state) throw new Error('state_mismatch');
const code = back.searchParams.get('code');
if (!code) throw new Error('missing_code');
const { secret, account } = await finishConnect(hubspot, {
  client, code, redirectUri, fetch: http.fetch, onRevokeFailed,
});
// secret: the OAuth grant to seal; account: { id: '42', name: 'Portal 42' }
```

The example uses app-owned `portalData`, OAuth `client`, a fresh stored `state`, and an `onRevokeFailed` observer.
In the app, consume and validate that state once; keep the returned secret on the server.
In an app you redirect the browser to `begun.url`, read `code` and `state` in your callback, check the state, and pass
your real (guarded) `fetch` to `finishConnect`.

## Modules

| Module | What it does |
|---|---|
| [`errors`](docs/modules/errors.md) | Coded errors such as `ProviderHttpError` and `GrantRevoked`, never carrying provider bodies or secrets |
| [`catalogue`](docs/design/entries-and-engine.md) | `defineProvider` and the entry types; `catalogue/<id>` is one provider's entry as plain data, `catalogue.json` all 17 as JSON |
| [`vault`](docs/modules/vault.md) | Seals JSON secrets under per-tenant data keys |
| [`oauth`](docs/modules/oauth.md) | Consent URLs, code exchange, refresh and revoke, with PKCE |
| [`connect`](docs/modules/connect.md) | `startConnect` and `finishConnect`: one flow for OAuth and key forms, run from a catalogue entry |
| [`credentials`](docs/modules/credentials.md) | Reads API keys and refreshes OAuth tokens under a lock |
| [`http`](docs/modules/http.md) | An authenticated client with timeouts, pacing and capped 429 waits |
| [`webhooks`](docs/modules/webhooks.md) | HMAC signature checks over the raw body bytes |
| [`paginate`](docs/modules/paginate.md) | Walks a client's pages and refuses a repeated cursor |
| [`testing`](docs/modules/testing.md) | Scripted fetch, in-memory stores and locks, and a check for your own credential store |
| [`mailbox`](docs/modules/mailbox.md) | One shape for a member's mail and calendar, whatever the transport |

## Providers

Each provider has its own subpath, and its fake sits beside it at `<provider>/fake`.

| Provider | Auth | Reads | Writes | Webhooks | Fake |
|---|---|---|---|---|---|
| [Aircall](docs/modules/aircall.md) | Key | calls, transcripts | — | — | `aircall/fake` |
| [Apollo](docs/modules/apollo.md) | Key | people and company enrichment | — | — | `apollo/fake` |
| [Attio](docs/modules/attio.md) | Key | records, notes, members | — | — | `attio/fake` |
| [Breakcold](docs/modules/breakcold.md) | Key | workspaces, records, notes, meetings | — | signature, delivery id | `breakcold/fake` |
| [Exa](docs/modules/exa.md) | Key | web search | — | — | `exa/fake` |
| [Fathom](docs/modules/fathom.md) | Key | meetings, transcripts | — | — | `fathom/fake` |
| [Firecrawl](docs/modules/firecrawl.md) | Key | site maps, page scrapes | — | — | `firecrawl/fake` |
| [Fireflies](docs/modules/fireflies.md) | Key | transcripts, search | — | signature, event | `fireflies/fake` |
| [GitHub](docs/modules/github.md) | Key | repositories, issues, pull requests | — | — | `github/fake` |
| [Google](docs/modules/google.md) | OAuth | Gmail, Google Calendar | — | — | `google/fake` |
| [Granola](docs/modules/granola.md) | Key | notes, transcripts | — | — | `granola/fake` |
| [HubSpot](docs/modules/hubspot.md) | OAuth | CRM objects, associations, stages, owners, stage history | — | — | `hubspot/fake` |
| [Lusha](docs/modules/lusha.md) | Key | person and company lookups, credits | — | — | `lusha/fake` |
| [Microsoft](docs/modules/microsoft.md) | OAuth | Outlook mail and calendar | — | — | `microsoft/fake` |
| [Notion](docs/modules/notion.md) | Key | shared pages, page text | — | — | `notion/fake` |
| [Slack](docs/modules/slack.md) | OAuth | channels | post a message | — | `slack/fake` |
| [Unipile](docs/modules/unipile.md) | Key, plus hosted sign-in | accounts, mail, calendars | delete an account | — | `unipile/fake` |

## Roadmap and contributing

- [ROADMAP.md](ROADMAP.md): where the library is going.
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, the one check command, and what a new provider module ships with.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- [CHANGELOG.md](CHANGELOG.md): every release, with the migration for each breaking change.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
