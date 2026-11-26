# Waiting list

What providers need that the engine cannot say yet. A provider is never forced into a shape that does not fit it: until
the engine can say what it needs, the provider is either not in the catalogue, or declared in part, with what the
engine can say and the rest left out. Each row names a need the provider's own documentation shows.

A mechanism is built once three providers wait for it, with one of them as its first entry. The
[providers page](providers.md) lists every entry the catalogue holds.

## Mechanisms

| Mechanism | Providers waiting |
|---|---|
| A group of parameters of which at least one is required: a lookup that finds one record by any of several equal inputs (an email, a LinkedIn URL, a domain), or a create that needs one of them. No input can be `required`, so a call with none is sent and refused by the provider. **Next to be built.** | Cognism ([Cognism API](https://developers.cognism.com/)), People Data Labs ([Person Enrichment](https://docs.peopledatalabs.com/docs/input-parameters-person-enrichment-api), [Company Enrichment](https://docs.peopledatalabs.com/docs/input-parameters-company-enrichment-api)), Freshsales ([Create a contact](https://developers.freshworks.com/crm/api/#create_contact)), LeadIQ ([searchPeople](https://developer.leadiq.com/#query-searchPeople)), Hunter ([Email Enrichment](https://hunter.io/api-documentation/v2#email-enrichment)), RocketReach ([Company Lookup](https://docs.rocketreach.co/reference/company-lookup-api)), Reply.io ([Create a contact](https://docs.reply.io/api-reference/contacts/create-a-contact)), lemlist ([Upsert contact](https://developer.lemlist.com/api-reference/endpoints/contacts/upsert-contact)), Salesloft ([Create a person](https://developers.salesloft.com/docs/api/people-create/)) |
| An OAuth 2 sign-in on the cloud host alone, beside a key on a typed host: the provider writes its OAuth 2 URLs on its cloud host only, while its API is also served on a host the person types, so the OAuth 2 sign-in needs a base of its own (the cloud's) | Outline (OAuth 2 on `app.getoutline.com`, its API also `https://{domain}/api`, [openapi.json](https://www.getoutline.com/openapi.json)), Sentry (OAuth 2 on `sentry.io`, self-hosting named for internal-integration tokens only, [Authentication](https://docs.sentry.io/api/auth/)) |
| An identify per sign-in: two sign-ins share `identify`, and the endpoint the OAuth 2 sign-in identifies with refuses the other credential | Azure DevOps (the Profiles API requires Microsoft Entra tokens, [Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)) |
| A plain field only one sign-in reads: the OAuth 2 sign-in would never read a plain field the other sign-in's token request reads | ZoomInfo (`clientId`, [Authorization Code Flow with PKCE](https://docs.gtm.ai/docs/authorization-code-flow-pkce)) |
| A GraphQL cursor sent in the query's variables (Linear's lists are declared one page each, `first` and `after` ordinary variables) | Linear, monday.com, LeadIQ (its cursor is `input.after`, a list of key and value pairs inside the `input` variable, so it needs a cursor path inside a variable and a cursor that is JSON, [Paginating advanced search](https://developer.leadiq.com/#paginating-advanced-search)) |
| A 429's wait in a header of seconds left or of an epoch time (`RateLimit-User-Reset`, `RateLimit-Reset`; `X-RateLimit-Reset`) | Buildkite, PagerDuty, Capsule (`X-RateLimit-Reset`, [Handling API responses](https://developer.capsulecrm.com/v2/overview/handling-api-responses)) |
| A form-encoded body on a declared operation | Chatwork, Zulip, Agile CRM (`companies.list`, [Get list of companies](https://github.com/agilecrm/rest-api#23-get-list-of-companies)) |
| An error code that is a number (`errorCode`, `error.code`, `errors[].code`), which `errors.detail` cannot read | PagerDuty, Smartsheet, Cognism ([Cognism API](https://developers.cognism.com/)) |
| A webhook secret decoded before it signs (base64, hex) | Airtable (base64), Chatwork (base64), Close (hex, [Webhooks](https://developer.close.com/api/resources/webhooks)) |
| A next cursor that is a number | Vercel |
| A next cursor read from the last record of a page (Render's `cursor`, Zulip's `anchor`: the last message's id; Agile CRM's `cursor` in the last contact or deal) | Render, Zulip, Agile CRM ([Listing contacts](https://github.com/agilecrm/rest-api#11-listing-contacts-)) |
| `Link` paging that ends on `results="false"` | Sentry |
| `Link` paging under another `rel` (`next-page`) | Guru |
| Page numbers that stop at the answer's page count (Smartsheet answers the last page again past the last; ZoomInfo's pages state no end but `meta.page.total`) | Smartsheet, ZoomInfo ([Pagination](https://docs.gtm.ai/docs/pagination-batching-and-bulk)) |
| A page number inside a nested JSON body object (`page.number`, beside `page.size`) | Teamleader Focus ([General principles](https://developer.focus.teamleader.eu/docs/general-principles)) |
| An index that counts from 1 (`start`, "Start index of the request results (counting from 1)"), which `offset` paging, counting from 0, cannot send | RocketReach ([People Search](https://docs.rocketreach.co/reference/people-search-api)) |
| A cursor list whose page past the last answers 404 (`scroll_token`: the last batch's token is null, or the next request answers 404 because paging is complete), which a walk reads as an error | People Data Labs ([Person Search](https://docs.peopledatalabs.com/docs/input-parameters-person-search-api)) |
| A search created by one request and read by another (`POST /search/query-mode` answers a `search_id`; the run reads it) | Clay ([Searches](https://developers.clay.com/searches/advanced)) |
| A stateful iterator: the same request repeated while `has_more` is true | Clay ([Pagination](https://developers.clay.com/public-api/pagination)) |
| An asynchronous run polled until done (a routine's results answer 202 until they are ready) | Clay ([Routines](https://developers.clay.com/routines/api)) |
| A list that answers 204 with no body when it is empty | Chatwork, Agile CRM ([Listing contacts](https://github.com/agilecrm/rest-api#11-listing-contacts-)) |
| A list whose records are a map keyed by id, beside an `order` list of the ids | Mattermost |
| A 429's wait in the error body, in seconds (Zulip's `retry-after`, possibly fractional; Todoist's `error_extra.retry_after`) | Zulip, Todoist |
| An operation parameter sent as a header | PagerDuty |
| A JSON Patch request body (`application/json-patch+json`, an array of operations) | Nutshell ([Update a contact](https://developers.nutshell.com/reference/cb995ae09d7e0e99e91b122bcc9358ed)) |
| A request body that is not JSON (multipart): a `multipart/form-data` body the page marks required | Salesloft ([Create a cadence membership](https://developers.salesloft.com/docs/api/cadence-memberships-create/)) |
| A parameter required when another has a given value (a party's `name` when its `type` is `organisation`) | Capsule ([Handling API responses](https://developer.capsulecrm.com/v2/overview/handling-api-responses)) |
| A host on one of several fixed domains | Smartsheet, Freshsales (`myfreshworks.com`, or `freshworks.com` for an account migrated from Freshsales Classic, [Installation parameters](https://developers.freshworks.com/docs/app-sdk/v2.3/freshsales-suite/app-settings/installation-parameters/)) |
| A key that sends a plain field in a second header (the acting user in `X-USER-ID`, or `X-User-Email` with `X-TEAM-ID`, else `403 USER_REQUIRED`) | Reply.io's Organization API keys ([Authentication](https://docs.reply.io/api-reference/authentication)) |
| OAuth 2 (3LO) on `api.atlassian.com/ex/confluence/{cloudId}` with next links relative to the site (`/wiki/api/v2/…`); a key sign-in breaks Atlassian's rules for apps, which must not collect API tokens ([Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/)) | Confluence |
| OAuth 2 whose base is the host the token answer names | Wrike (its `host`; the refresh goes to that host too), Pipedrive (its `api_domain`, "The base URL path, including the `company_domain`, where the requests can be sent to"; the exchange and the refresh stay on `https://oauth.pipedrive.com/oauth/token`, [OAuth authorization](https://pipedrive.readme.io/docs/marketplace-oauth-authorization)) |
| An OAuth 2 token URL built from a value the redirect returns (`/sentry-app-installations/{installationId}/authorizations/`), with a JSON body and the token at `token` | Sentry |
| OAuth 2 for a public client from Dynamic Client Registration (no client secret, a loopback redirect only, no refresh token) | CircleCI |
| OAuth 2 client authentication that differs between its requests (Basic on one, the body on another) | Todoist (Basic on its RFC 7009 revoke, the secret in the body of its token request), Keap (the secret in the body of its code exchange, Basic on its refresh, [Getting Started with OAuth](https://developer.keap.com/docs/resources/getting-started-oauth)) |
| Error codes read per sign-in (codes meaning a revoked OAuth grant, beside a key whose bad value must read as refused) | ClickUp |
| An OAuth 2 token answer whose `scope` is a list of strings, which the engine's OAuth library refuses (Linear's apps created before 1 December 2023, [OAuth 2.0 authentication](https://linear.app/developers/oauth-2-0-authentication)) | Linear |
| A webhook signed as a JWT | monday.com |
| A webhook handshake answered in a header (`X-Hook-Secret`) | Asana |
| A `token` webhook whose header carries a prefix (`Authorization: Bearer <token>`, a token the person chooses, [Webhook](https://docs.honeybadger.io/guides/integrations/webhook/)) | Honeybadger |
| A webhook secret sent in the JSON body (no signature: the optional `secret` comes back as a field of each delivery) | lemlist ([Add webhook](https://developer.lemlist.com/api-reference/endpoints/webhooks/add-webhook)) |
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
| Airtable | The webhook | A webhook secret decoded before it signs |
| Asana | The webhook | A webhook handshake answered in a header |
| Todoist | `revoke` | OAuth 2 client authentication that differs between its requests |
| Todoist | A 429's wait: it is in `error_extra.retry_after`, in seconds, which the retry does not read | A 429's wait in the error body |
| Smartsheet | Gov, Europe and Australia: other domains, with their own tokens | A host on one of several fixed domains |
| Smartsheet | Paging: `sheets.list` and `rows.list` answer one page each, `page` and `pageSize` ordinary parameters, `totalPages` and `totalRowCount` in their results | Page numbers that stop at the answer's page count |
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
| Chatwork | `result` on `messages.list` and `contacts.list` | A list that answers 204 with no body when it is empty |
| Chatwork | The webhook | A webhook secret decoded before it signs |
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
| Capsule | A 429's wait: Capsule asks the app to wait until the epoch time in `X-RateLimit-Reset`, which a retry does not read, and may block an app that keeps calling, so the entry declares no retry | A 429's wait in a header of seconds left or of an epoch time |
| Capsule | `parties.create`: an organisation needs `name` ("trying to create an organisation without a name" answers 422), which the body's shape cannot require for one `type` alone; the `party` description says it | A parameter required when another has a given value |
| Close | The webhook: its `signature_key` is decoded from hex before it signs | A webhook secret decoded before it signs |
| Close | Leads and opportunities past the maximum `_skip` of `leads.list` and `opportunities.list` ("The maximum is 35,000 for some organizations", [List Leads](https://developer.close.com/api/resources/leads/list), [List Opportunities](https://developer.close.com/api/resources/opportunities/list)); no page says what answers past it | — |
| Close | Search results past 10,000: "Pagination stops after 10,000 results", the last page answering a `null` cursor, which the walk reads as the end ([Search](https://developer.close.com/api/resources/advanced-filtering/search)) | — |
| Teamleader Focus | Paging: each list answers one page, `page` (`size`, `number`) an ordinary body parameter | A page number inside a nested JSON body object |
| Freshsales | The host: checked against no domain pattern (`http.host: '*'`), because the docs fix two domains, `myfreshworks.com` and `freshworks.com` (accounts migrated from Freshsales Classic) | A host on one of several fixed domains |
| Freshsales | `contacts.create`'s group ("Either Email/Mobile/Twitter ID is required to create a contact"; the table also marks `external_id`): none is required, the group is named in the body's description | A group of parameters of which at least one is required |
| Freshsales | OAuth 2: documented only for apps on Freshworks' own platform, the redirect fixed to its callback and "the marketplace constructs the access-token request" ([OAuth](https://developers.freshworks.com/docs/app-sdk/v3.0/sales_account/advanced-interfaces/request-method/oauth-access-freshworks-resources/)) | — |
| Nutshell | `contacts.update`: a JSON Patch body | A JSON Patch request body |
| Nutshell | OAuth 2: some reference pages name OAuth access tokens and a read scope, but no page gives a flow, its URLs or how a client is registered ([llms.txt](https://developers.nutshell.com/llms.txt)) | — |
| Salesflare | Results and paging: the response schemas of the three lists, of `contacts.get` and of `contacts.update` are placeholders (`"type": "string"`), so no list or end can be cited; each list answers one page, `limit` and `offset` ordinary parameters. `contacts.create` documents a list of objects with a numeric `id`, but its description says one contact sent answers one object, so it declares no `result` either ([openapi.json](https://api.salesflare.com/openapi.json)) | — |
| Agile CRM | `companies.list`: its page, sort and cursor are form parameters | A form-encoded body on a declared operation |
| Agile CRM | Paging: `contacts.list` and `deals.list` answer one page each, `page_size` and `cursor` ordinary parameters, each deal keeping its `cursor` | A next cursor read from the last record of a page |
| Agile CRM | `result` on `contacts.list` and `contacts.get`: each answers 204 with no body when there is none | A list that answers 204 with no body when it is empty |
| Affinity | OAuth 2: an OAuth app is created in, and can be authorized only by, its own organization ("only your users can authorize it"; Scale, Advanced or Enterprise); a client that publishes a metadata URL (CIMD) is added by each organization's admin, so no client a developer registers once serves every organization ([OAuth Apps](https://developer.affinity.co/pages/external-api-v2/oauth-apps)) | — |
| Leadfeeder | OAuth 2: documented (authorization code with PKCE), but an application can be registered only as "Internal"; "Public", for third-party developers, "is coming soon" ([How to create and manage an OAuth application](https://help.leadfeeder.com/en/articles/16547323-how-to-create-and-manage-an-oauth-application)) | — |
| Cognism | Paging of `contacts.search` and `accounts.search`: one page each, `indexSize` and `lastReturnedKey` ordinary parameters, `lastReturnedKey` in the result; no page says how the last page ends ([Cognism API](https://developers.cognism.com/)) | — |
| Cognism | `errors.detail`: the code, `errors[].code`, is a number | An error code that is a number |
| Cognism | The "at least one of" rule on `contacts.get` and `accounts.get`: no input is required, so a call with too little input is sent and answers "Not enough input parameters to enrich" | A group of parameters of which at least one is required |
| People Data Labs | Paging of `people.search` and `companies.search`: one page each, `size` and `scroll_token` ordinary parameters, `scroll_token` and `total` in the result | A cursor list whose page past the last answers 404 |
| People Data Labs | The "at least one of" rule on `people.get` and `companies.get`: no input is required, so a call with none is sent and refused | A group of parameters of which at least one is required |
| lemlist | `contacts.create`: one of `email`, `linkedinUrl` or `linkedinUrlSalesNav` is needed; none is required | A group of parameters of which at least one is required |
| lemlist | The webhook: no signature; the optional `secret` comes back as a field of the JSON body | A webhook secret sent in the JSON body |
| lemlist | Contacts past the 10,000th: "`limit + offset` must not exceed **10 000** — past that the request answers `400 PAGE_WINDOW_TOO_LARGE`", so a longer walk of `contacts.list` ends on that 400 ([Search Contacts](https://developer.lemlist.com/api-reference/endpoints/contacts/get-many-contacts-v2)) | — |
| lemlist | `campaigns.list` past its first page: one page each call, `limit` and `offset` ordinary parameters; the page says only "Offset from the start. For pagination." and also lists `page`, so where the offset starts is not stated ([Get Many Campaigns](https://developer.lemlist.com/api-reference/endpoints/campaigns/get-many-campaigns)) | — |
| Reply.io | `contacts.create`: an email or a LinkedIn URL is needed; neither is required | A group of parameters of which at least one is required |
| Reply.io | Organization API keys: every request names the acting user in a header (`X-USER-ID`, or `X-User-Email` together with `X-TEAM-ID`), else `403 USER_REQUIRED`. A Team key needs none and acts as the workspace owner; the key field recommends a user key, which acts as the person connecting | A key that sends a plain field in a second header |
| Salesloft | `people.create`: `email_address`, or `phone` with `last_name`, is needed; none is required | A group of parameters of which at least one is required |
| Salesloft | `cadenceMemberships.create` (adding a person to a cadence): its definition marks a `multipart/form-data` body required | A request body that is not JSON (multipart) |
| ZoomInfo | OAuth 2 (Authorization Code with PKCE): a Standard App "will be created immediately" and serves its own organization; use by other organizations needs the Partner Program ("You must be an approved member of the ZoomInfo Partner Program"). Beside the `token` sign-in it would leave `clientId` unread ([Partner App](https://docs.gtm.ai/docs/partner-app), [Standard App](https://docs.gtm.ai/docs/standard-app)) | A plain field only one sign-in reads |
| ZoomInfo | Paging of `contacts.search` and `companies.search`: one page each, `page[number]` and `page[size]` ordinary query parameters, `meta.page` in the result | Page numbers that stop at the answer's page count |
| ZoomInfo | Records past the 100th page of a search: "Page number cannot be greater than max value 100" ([Status Codes and Errors](https://docs.gtm.ai/docs/status-codes-and-errors)) | — |
| Clay | `people.search` and `companies.search`: a search is created by one request and read by another, page by page while `has_more` | A search created by one request and read by another; a stateful iterator |
| Clay | `people.get` and `companies.get`: an enrichment is a routine run, polled until done | An asynchronous run polled until done |
| LeadIQ | `people.get` and `companies.get`: no identifier is required, so a lookup with none is sent and refused by LeadIQ | A group of parameters of which at least one is required |
| LeadIQ | Paging of `people.search` and `companies.search`: one page each, `skip`, `limit` and `after` ordinary fields of `input`, `after` in the result | A GraphQL cursor sent in the query's variables |
| Hunter | `people.get`: neither `email` nor `linkedin_handle` is required | A group of parameters of which at least one is required |
| Hunter | Paging on a Free plan: Domain Search answers 400 `pagination_error` when `limit` plus `offset` passes 10 (with a smaller `limit` a walk can end inside that window), and Discover when a plan without paging sends an offset above 0 ([API reference](https://hunter.io/api-documentation/v2#domain-search), [Discover](https://hunter.io/api-documentation/v2#discover)) | — |
| Hunter | Discover's records past offset 10,000: "up to a maximum offset of 10,000" ([Discover](https://hunter.io/api-documentation/v2#discover)) | — |
| RocketReach | `people.get` and `companies.get`: no identifier is required | A group of parameters of which at least one is required |
| RocketReach | Paging of `people.search` and `companies.search`: one page each, `start` and `page_size` ordinary body parameters | An index that counts from 1 |

## Not declared

A provider with no entry, with the reason and the provider's own page that shows it. A provider whose documentation
cannot be read without signing in, or does not load, is listed here too, with the page tried.

| Provider | Why | Page |
|---|---|---|
| Confluence | Atlassian's rules forbid apps that collect API tokens, so a key alone would steer an app wrong, and its OAuth 2 (3LO) uses another base | [Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/) |
| Wrike | Its OAuth 2 base is the host the token answer names, and its permanent token is not meant for multi-user applications | [OAuth 2.0 authorization](https://developers.wrike.com/docs/oauth-20-authorization/), [FAQ](https://developers.wrike.com/docs/faq/) |
| Netlify | Integrations other people use must use OAuth 2, and the documentation gives only the implicit grant, with no token URL for the code flow | [Get started with the API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/) |
| Pipedrive | OAuth 2.0 is mandatory for apps and API tokens are for private apps only, so a key alone would steer an app wrong; its OAuth 2 calls go to the `api_domain` the token answer names; and its base is given two ways (the company domain on the Requests page, `api.pipedrive.com` in the OpenAPI files) | [About the Marketplace](https://pipedrive.readme.io/docs/about-the-marketplace), [OAuth authorization](https://pipedrive.readme.io/docs/marketplace-oauth-authorization), [Requests](https://pipedrive.readme.io/docs/core-api-concepts-requests), [OpenAPI file](https://developers.pipedrive.com/docs/api/v1/openapi.yaml) |
| Keap | Its OAuth 2 code exchange sends the client secret in the body while its refresh requires HTTP Basic, which one sign-in cannot say; and its personal access tokens and service account keys "authenticate as you", OAuth being the way to act for other Keap users, so a key alone would steer an app wrong | [Getting Started with OAuth](https://developer.keap.com/docs/resources/getting-started-oauth), [PATs and SAKs](https://developer.keap.com/docs/resources/personal-access-tokens) |
| SugarCRM | Its only sign-in is a password grant that reads the person's username and password, while its guide says "Store just the refresh_token in long-term storage – not the username and password": a `token` sign-in keeps the password to sign in again | [REST API](https://support.sugarcrm.com/documentation/sugar_developer/sugar_developer_guide_26.1/integration/web_services/rest_api/) |
