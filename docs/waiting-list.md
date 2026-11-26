# Waiting list

What providers need that the engine cannot say yet. A provider is never forced into a shape that does not fit it: until
the engine can say what it needs, the provider is either not in the catalogue, or declared in part, with what the
engine can say and the rest left out. Each row names a need the provider's own documentation shows.

A mechanism is built once three providers wait for it, with one of them as its first entry. The
[providers page](providers.md) lists every entry the catalogue holds.

## Mechanisms

| Mechanism | Providers waiting |
|---|---|
| An OAuth 2 sign-in on the cloud host alone, beside a key on a typed host: the provider writes its OAuth 2 URLs on its cloud host only, while its API is also served on a host the person types, so the OAuth 2 sign-in needs a base of its own (the cloud's) | Outline (OAuth 2 on `app.getoutline.com`, its API also `https://{domain}/api`, [openapi.json](https://www.getoutline.com/openapi.json)), Sentry (OAuth 2 on `sentry.io`, self-hosting named for internal-integration tokens only, [Authentication](https://docs.sentry.io/api/auth/)), Intercom (OAuth 2 calls go to `api.intercom.io`, which routes to the workspace's region, beside the key on `api.eu.intercom.io` or `api.au.intercom.io`; the region is known only after sign-in, from `/me`'s `app.region`; each region has its own authorize host, `app.intercom.com`, `app.eu.intercom.com` or `app.au.intercom.com`, which a Google sign-in requires; the token at `https://api.intercom.io/auth/eagle/token`, [Setting up OAuth](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth), [REST APIs](https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis)) |
| An identify per sign-in: two sign-ins share `identify`, and the endpoint the OAuth 2 sign-in identifies with refuses the other credential | Azure DevOps (the Profiles API requires Microsoft Entra tokens, [Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)), Metabase (the session sign-in identifies the email the person entered, while an API key belongs to a group, [Set up Metabase from code](https://www.metabase.com/articles/set-up-metabase-from-code-with-the-api)) |
| A GraphQL cursor sent in the query's variables (Linear's lists are declared one page each, `first` and `after` ordinary variables) | Linear, monday.com |
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
| A 429's wait in the error body, in seconds (Zulip's `retry-after`, possibly fractional; Todoist's `error_extra.retry_after`) | Zulip, Todoist |
| An operation parameter sent as a header | PagerDuty |
| Regional hosts on more than one domain. **Next to be built.** | Smartsheet, Figma (Figma for Government: the page gives only its token URL, `https://api.figma-gov.com/v1/oauth/token`, not its authorize URL or API base, [OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/)), Slack (GovSlack: `slack-gov.com` for the authorize URL and the API, [oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access)), Microsoft (Graph's national clouds: `graph.microsoft.us`, `dod-graph.microsoft.us`, `microsoftgraph.chinacloudapi.cn`, with their own sign-in hosts, [National cloud deployments](https://learn.microsoft.com/en-us/graph/deployments)) |
| OAuth 2 (3LO) on `api.atlassian.com/ex/confluence/{cloudId}` with next links relative to the site (`/wiki/api/v2/…`); a key sign-in breaks Atlassian's rules for apps, which must not collect API tokens ([Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/)) | Confluence |
| OAuth 2 whose base, and refresh, is the host the token answer names (`host`) | Wrike |
| An OAuth 2 token URL built from a value the redirect returns (`/sentry-app-installations/{installationId}/authorizations/`), with a JSON body and the token at `token` | Sentry |
| OAuth 2 for a public client (no client secret), where the engine always sends one | CircleCI (Dynamic Client Registration, a loopback redirect only, no refresh token), Firecrawl (Dynamic Client Registration or a client ID metadata document, "neither needs approval from Firecrawl", refresh tokens that rotate, [OAuth for apps](https://docs.firecrawl.dev/oauth)) |
| An RFC 7009 revoke that authenticates the client by Basic, beside a token request that posts the secret in the body | Todoist |
| A revoke request that authenticates the OAuth client by Basic and sends the token in its body | GitHub (`DELETE /applications/{client_id}/grant`, [REST API endpoints for OAuth authorizations](https://docs.github.com/en/rest/apps/oauth-applications)) |
| A plain field only one sign-in reads: the OAuth 2 sign-in reads every plain field (its connect asks for them), so a field only the other sign-in sends keeps OAuth 2 out | Trello (OAuth 2.0 (3LO) on `auth.atlassian.com`, its token as Bearer on `api.trello.com/1`, while the key sends the Trello app's API key, [OAuth 2.0 Confidential Client Usage](https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-confidential-client-usage/)), Zoom (the Server-to-Server `token` sign-in sends the account ID and the app's client ID the person types, which a user-level OAuth 2 sign-in, with the app's own client ID and no account ID, never reads, [Server-to-Server OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/), [OAuth 2.0](https://developers.zoom.us/docs/integrations/oauth/)) |
| OAuth 2 token, refresh and revoke requests that carry a header every request needs (the engine sends `http.headers` only on calls and a `token` sign-in's request) | Notion (`Notion-Version`, which the reference marks required on `/v1/oauth/token` and `/v1/oauth/revoke`, [Create a token](https://developers.notion.com/reference/create-a-token), [Refresh a token](https://developers.notion.com/reference/refresh-a-token), [Revoke a token](https://developers.notion.com/reference/revoke-token)) |
| An OAuth 2 token request authenticated by the developer's own API key as the Basic user, with no client id | Stripe (Stripe Apps: `curl -X POST https://api.stripe.com/v1/oauth/token -u sk_live_***: -d code=… -d grant_type=authorization_code`, [OAuth 2.0](https://docs.stripe.com/stripe-apps/api-authentication/oauth)) |
| A key sign-in beside a token sign-in, which an entry cannot hold | Metabase (API keys in `X-API-Key`, recommended for scripts, beside the session sign-in, [Set up Metabase from code](https://www.metabase.com/articles/set-up-metabase-from-code-with-the-api)) |
| A session sign-in that answers a second-factor challenge (a two-step login) | Metabase (`POST /api/session` answers a `challenge_token` for a person with two-factor authentication, [API reference](https://www.metabase.com/docs/latest/api)) |
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
| Todoist | A 429's wait: it is in `error_extra.retry_after`, in seconds, which the retry does not read | A 429's wait in the error body |
| Smartsheet | Gov, Europe and Australia: other domains, with their own tokens | Regional hosts on more than one domain |
| Smartsheet | Paging: `sheets.list` and `rows.list` answer one page each, `page` and `pageSize` ordinary parameters, `totalPages` and `totalRowCount` in their results | Page numbers where a page past the last answers the last page again |
| Smartsheet | `errors.detail`: the code, `errorCode`, is a number | An error code that is a number |
| Smartsheet | OAuth 2: Smartsheet first accepts or denies a request to open Developer Tools for the developer's account, where registering an app is then immediate; the authorize request lists no redirect parameter or PKCE ([OAuth](https://developers.smartsheet.com/api/smartsheet/guides/advanced-topics/oauth)) | — |
| monday.com | Paging: each list answers one page, `cursor`, `page` and `limit` ordinary variables, `items_page.cursor` in the result | A GraphQL cursor sent in the query's variables |
| monday.com | The webhook | A webhook signed as a JWT |
| Guru | Paging: each list answers its first page; the next link is in a header | `Link` paging under another `rel` |
| Guru | OAuth 2: a client is enabled by Guru's support and belongs to one workspace | — |
| GitBook | OAuth 2: no page says how a developer registers a client | — |
| Honeybadger | OAuth 2: no page says how an app registers a client | — |
| Honeybadger | The Bearer token a person may set on the Webhook integration: `webhook` checks `Honeybadger-Token` | A `token` webhook whose header carries a prefix |
| incident.io | The webhook: its page leaves the hash and the secret's form to Svix | — |
| Outline | OAuth 2: its documented authorize, token and refresh URLs are the cloud's (`app.getoutline.com`), while the entry's base is the host the person types | An OAuth 2 sign-in on the cloud host alone, beside a key on a typed host |
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
| Sentry | OAuth 2: its documented authorize and token URLs are sentry.io's ([Authentication](https://docs.sentry.io/api/auth/#oauth2)), and self-hosting is named only for internal-integration tokens, while the entry's base is the host the person types; a client is made under Developer Settings, then OAuth Applications ([Setting up Sentry OAuth application](https://github.com/getsentry/sentry-oauth-example#1-setting-up-sentry-oauth-application)) | An OAuth 2 sign-in on the cloud host alone, beside a key on a typed host |
| Sentry | OAuth 2 for a public integration (Sentry's integration platform) | An OAuth 2 token URL built from a value the redirect returns |
| PagerDuty | Records past the 10,000th: "the sum of the `offset` and `limit` parameters cannot exceed 10000, or the REST API will respond with status 400", so a longer walk ends on that 400 ([Pagination](https://docs.pagerduty.com/developer/pagination)) | — |
| PagerDuty | `incidents.create` and `incidents.update`: both need the `From` header | An operation parameter sent as a header |
| PagerDuty | `errors.detail`: the code, `error.code`, is a number | An error code that is a number |
| PagerDuty | A 429's wait: it is in `ratelimit-reset`, which the retry does not read | A 429's wait in a header of seconds left |
| Azure DevOps | The personal access token: it cannot call the Profiles API the OAuth 2 sign-in identifies with, and both sign-ins share `identify`; Microsoft also says not to use PATs as long-term credentials for production applications ([Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)) | An identify per sign-in |
| Azure DevOps | Microsoft account (MSA) users: Microsoft Entra apps don't natively support them for the Azure DevOps resource ([Entra OAuth apps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops)) | — |
| Azure DevOps | Paging of `projects.list`: one page, `$top` and `$skip` ordinary parameters; no page says what `$skip` counts or where the next `continuationToken` comes from ([Projects - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1)) | — |
| Apollo | OAuth 2: registration is for partners and Apollo approves it first ("Once registration is approved, you can use the Apollo playground to test the OAuth flow"), and its authorize URL is a fragment route (`https://app.apollo.io/#/oauth/authorize?…`) ([OAuth 2.0 (Partners)](https://docs.apollo.io/docs/use-oauth-20-authorization-flow-to-access-apollo-user-information-partners)) | — |
| Aircall | OAuth 2: OAuth credentials come only with the Technology Partner program ([OAuth implementation guide](https://developer.aircall.io/docs/oauth)) | — |
| Breakcold | OAuth 2: its API definition names a signed-in user's flow, but no page says how a developer registers a client, and REST integrations are told to use an API key; a signed-in user's token may also need the `X-Breakcold-Organization-Id` header ([List authorized workspaces](https://docs.breakcold.com/api-reference/workspaces/list-authorized-workspaces)) | — |
| Fathom | OAuth 2: a developer registers an app alone, the token URL and the `public_api` scope are stated, but no page gives the authorize URL ([Building with OAuth](https://developers.fathom.ai/oauth), [SDK OAuth](https://developers.fathom.ai/sdks/oauth)) | — |
| Notion | OAuth 2 (public integrations: `https://api.notion.com/v1/oauth/authorize` with `owner=user`, Basic client auth, a JSON body, refresh tokens, `/v1/oauth/revoke`) | OAuth 2 token, refresh and revoke requests that carry a header every request needs |
| Zoom | OAuth 2 for a user-level (General) app (`https://zoom.us/oauth/authorize`, `/oauth/token` with Basic, refresh tokens, `/oauth/revoke`) | A plain field only one sign-in reads |
| GitHub | `revoke`: the OAuth app's grant is deleted with the client's Basic pair and the token in the body | A revoke request that authenticates the OAuth client by Basic |
| Trello | OAuth 2.0 (3LO): the entry's key sends the Trello app's API key, a plain field the OAuth 2 sign-in never reads | A plain field only one sign-in reads |
| Figma | Figma for Government (only its token URL is documented, on `api.figma-gov.com`) | Regional hosts on more than one domain |
| Metabase | API keys (`X-API-Key`), which belong to a group, not a person | A key sign-in beside a token sign-in; An identify per sign-in |
| Metabase | People with two-factor authentication: the session request answers a challenge, not a session | A session sign-in that answers a second-factor challenge |
| Slack | GovSlack (`slack-gov.com`) | Regional hosts on more than one domain |
| Microsoft | Graph's national clouds (US Government, China) | Regional hosts on more than one domain |
| Intercom | OAuth 2, which Intercom requires for an app that reaches other people's workspaces ([Authentication](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication)): its calls go to `api.intercom.io`, which routes to the workspace's region, known only after sign-in (`/me` answers `app.region`), and each region has its own authorize host | An OAuth 2 sign-in on the cloud host alone, beside a key on a typed host |
| Discord | OAuth 2 ([OAuth2](https://docs.discord.com/developers/topics/oauth2)): it signs in a person (scope `identify`), a different account from the app's bot the entry connects ("bot users, which are a separate type of user dedicated to automation"), so it is not a second sign-in of this entry | — |
| Firecrawl | OAuth 2 ("OAuth for apps"): a public client, with no client secret | OAuth 2 for a public client |
| Stripe | OAuth 2 of a Stripe App (its public install links also need App Review): the token request signs with the app developer's own API key, no client id | An OAuth 2 token request authenticated by the developer's own API key |

## Not declared

A provider with no entry, with the reason and the provider's own page that shows it. A provider whose documentation
cannot be read without signing in, or does not load, is listed here too, with the page tried.

| Provider | Why | Page |
|---|---|---|
| Confluence | Atlassian's rules forbid apps that collect API tokens, so a key alone would steer an app wrong, and its OAuth 2 (3LO) uses another base | [Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/) |
| Wrike | Its OAuth 2 base is the host the token answer names, and its permanent token is not meant for multi-user applications | [OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization/), [FAQ](https://developers.wrike.com/docs/faq/) |
| Netlify | Integrations other people use must use OAuth 2, and the documentation gives only the implicit grant, with no token URL for the code flow | [Get started with the API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/) |
