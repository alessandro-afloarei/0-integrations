# Waiting list

What providers need that the engine cannot say yet. A provider is never forced into a shape that does not fit it: until
the engine can say what it needs, the provider is either not in the catalogue, or declared in part, with what the
engine can say and the rest left out. Each row names a need the provider's own documentation shows.

A mechanism is built once three providers wait for it, with one of them as its first entry. The
[providers page](providers.md) lists every entry the catalogue holds.

## Mechanisms

| Mechanism | Providers waiting |
|---|---|
| An OAuth 2 sign-in that reads a value the person types before the redirect (a host, a subdomain, an organization), with authorize and token URLs built from it when it is a host. **Next to be built.** | Mattermost, Outline, Azure DevOps; Sentry also needs a documented client registration |
| A GraphQL cursor sent in the query's variables (Linear's lists are declared one page each, `first` and `after` ordinary variables) | Linear, monday.com |
| `offset` paging | Outline, PagerDuty |
| A 429's wait in a header of seconds left (`RateLimit-User-Reset`, `RateLimit-Reset`) | Buildkite, PagerDuty |
| A form-encoded body on a declared operation | Chatwork, Zulip |
| An error code that is a number (`errorCode`, `error.code`), which `errors.detail` cannot read | PagerDuty, Smartsheet |
| A webhook secret decoded from base64 before it signs | Airtable, Chatwork |
| A next cursor that is a number | Vercel |
| A next cursor read from the last record of a page (Render's `cursor`, Zulip's `anchor`: the last message's id) | Render, Zulip |
| `Link` paging that ends on `results="false"` | Sentry |
| `Link` paging under another `rel` (`next-page`) | Guru |
| Page numbers where a page past the last answers the last page again, so the walk stops at the answer's page count | Smartsheet |
| A list that answers 204 with no body when it is empty | Chatwork |
| A list whose records are a map keyed by id, beside an `order` list of the ids | Mattermost |
| A 429's wait in the error body, in seconds, possibly fractional | Zulip |
| An operation parameter sent as a header | PagerDuty |
| Regional hosts on more than one domain | Smartsheet |
| OAuth 2 (3LO) on `api.atlassian.com/ex/confluence/{cloudId}` with next links relative to the site (`/wiki/api/v2/…`); a key sign-in breaks Atlassian's rules for apps, which must not collect API tokens ([Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/)) | Confluence |
| OAuth 2 whose base, and refresh, is the host the token answer names (`host`) | Wrike |
| An OAuth 2 token URL built from a value the redirect returns (`/sentry-app-installations/{installationId}/authorizations/`), with a JSON body and the token at `token` | Sentry |
| OAuth 2 for a public client from Dynamic Client Registration (no client secret, a loopback redirect only, no refresh token) | CircleCI |
| An RFC 7009 revoke that authenticates the client by Basic, beside a token request that posts the secret in the body | Todoist |
| Error codes read per sign-in (codes meaning a revoked OAuth grant, beside a key whose bad value must read as refused) | ClickUp |
| An OAuth 2 token answer whose `scope` is a list of strings, which the engine's OAuth library refuses (Linear's apps created before 1 December 2023, [OAuth 2.0 authentication](https://linear.app/developers/oauth-2-0-authentication)) | Linear |
| A webhook signed as a JWT | monday.com |
| A webhook handshake answered in a header (`X-Hook-Secret`) | Asana |
| A `token` webhook whose header carries a prefix (`Authorization: Bearer <token>`, a token the person chooses, [Webhook](https://docs.honeybadger.io/guides/integrations/webhook/)) | Honeybadger |
| A webhook timestamp in milliseconds (the signed body's `webhookTimestamp`; the `Linear-Timestamp` header is not signed) | Linear |

## Declared in part

An entry declared in part is listed here with what it leaves out and the mechanism that part waits for. "—" means the
part waits for the provider, not for the engine. A template operation the provider does not offer is named in the
entry's comment, not here.

| Provider | Left out | Waits for |
|---|---|---|
| Linear | Paging: each list answers one page, `first` and `after` ordinary variables, `pageInfo` in the result | A GraphQL cursor sent in the query's variables |
| Linear | OAuth 2 for an app created before 1 December 2023: its token answer's `scope` is an array, so it cannot sign in | An OAuth 2 token answer whose `scope` is a list of strings |
| Linear | The webhook timestamp check: the app refuses a delivery over a minute old itself | A webhook timestamp in milliseconds |
| Buildkite | A 429's wait: it is in `RateLimit-User-Reset`, which the retry does not read | A 429's wait in a header of seconds left |
| ClickUp | The codes that mean a revoked authorization (`OAUTH_019`, `OAUTH_021`, `OAUTH_025`, `OAUTH_077`): `errors` is shared by both sign-ins, and a personal token would read them as a revoked grant | Error codes read per sign-in |
| Airtable | The webhook | A webhook secret decoded from base64 |
| Asana | The webhook | A webhook handshake answered in a header |
| Todoist | `revoke` | An RFC 7009 revoke that authenticates the client by Basic |
| Smartsheet | Gov, Europe and Australia: other domains, with their own tokens | Regional hosts on more than one domain |
| Smartsheet | Paging: `sheets.list` and `rows.list` answer one page each, `page` and `pageSize` ordinary parameters, `totalPages` and `totalRowCount` in their results | Page numbers where a page past the last answers the last page again |
| Smartsheet | `errors.detail`: the code, `errorCode`, is a number | An error code that is a number |
| Smartsheet | OAuth 2: Smartsheet approves or denies each request to register an app, and the authorize request documents no `redirect_uri` or PKCE | — |
| monday.com | Paging: each list answers one page, `cursor`, `page` and `limit` ordinary variables, `items_page.cursor` in the result | A GraphQL cursor sent in the query's variables |
| monday.com | The webhook | A webhook signed as a JWT |
| Guru | Paging: each list answers its first page; the next link is in a header | `Link` paging under another `rel` |
| Guru | OAuth 2: a client is enabled by Guru's support and belongs to one workspace | — |
| GitBook | OAuth 2: no page says how a developer registers a client | — |
| Honeybadger | OAuth 2: no page says how an app registers a client | — |
| incident.io | The webhook: its page leaves the hash and the secret's form to Svix | — |
| Outline | Paging: each list answers one page, `offset` and `limit` body parameters, `pagination` in the result | `offset` paging |
| Outline | OAuth 2: each server has its own OAuth URLs | An OAuth 2 sign-in that reads a value the person types before the redirect |
| Mattermost | OAuth 2: each server is its own OAuth 2 provider | An OAuth 2 sign-in that reads a value the person types before the redirect |
| Mattermost | Paging and records of `posts.list`: one page, its posts a map keyed by id (`'unknown'`) beside `order`, `page` and `per_page` ordinary parameters, `has_next` in the result | A list whose records are a map keyed by id |
| Zulip | `messages.create` | A form-encoded body |
| Zulip | Paging: `messages.list` reads around an `anchor`, which an app moves to the last message's id, `num_before` and `num_after` ordinary parameters, `found_newest` and `found_oldest` in the result | A next cursor read from the last record of a page |
| Zulip | `retry`: the wait is in the error body, in seconds | A 429's wait in the error body |
| Chatwork | `messages.create` | A form-encoded body |
| Chatwork | `result` on `messages.list` and `contacts.list` | A list that answers 204 when it is empty |
| Chatwork | The webhook | A webhook secret decoded from base64 |
| CircleCI | OAuth 2: a public client from Dynamic Client Registration | OAuth 2 for a public client |
| Vercel | Paging: each list answers one page, `limit`, `until` and `pagination` declared | A next cursor that is a number |
| Vercel | OAuth 2 (Sign in with Vercel): its REST API permissions are in private beta | — |
| Render | Paging: each list answers one page, `cursor` and `limit` declared, each element keeps its `cursor` | A next cursor read from the last record of a page |
| Sentry | Paging: each list answers one page, `cursor` an ordinary query parameter (the next cursor is in the `Link` header only) | `Link` paging that ends on `results="false"` |
| Sentry | OAuth 2 on sentry.io and self-hosted servers (no page says how a client for `/oauth/` is registered) | An OAuth 2 sign-in that reads a value the person types before the redirect, and a documented client registration |
| Sentry | OAuth 2 for a public integration (Sentry's integration platform) | An OAuth 2 token URL built from a value the redirect returns |
| PagerDuty | Paging: each list answers one page, `limit` and `offset` declared, `more` in the result | `offset` paging |
| PagerDuty | `incidents.create` and `incidents.update`: both need the `From` header | An operation parameter sent as a header |
| PagerDuty | `errors.detail`: the code, `error.code`, is a number | An error code that is a number |
| PagerDuty | A 429's wait: it is in `ratelimit-reset`, which the retry does not read | A 429's wait in a header of seconds left |

## Not declared

A provider with no entry, with the reason and the provider's own page that shows it. A provider whose documentation
cannot be read without signing in, or does not load, is listed here too, with the page tried.

| Provider | Why | Page |
|---|---|---|
| Confluence | Atlassian's rules forbid apps that collect API tokens, so a key alone would steer an app wrong, and its OAuth 2 (3LO) uses another base | [Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/) |
| Wrike | Its OAuth 2 base is the host the token answer names, and its permanent token is not meant for multi-user applications | [OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization/), [FAQ](https://developers.wrike.com/docs/faq/) |
| Netlify | Integrations other people use must use OAuth 2, and the documentation gives only the implicit grant, with no token URL for the code flow | [Get started with the API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/) |
| Azure DevOps | A personal access token is not for production applications, and its Microsoft Entra OAuth 2 needs the organization in the base before the redirect | [Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops) |
