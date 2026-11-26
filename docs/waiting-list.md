# Waiting list

What providers need that the engine cannot say yet. A provider is never forced into a shape that does not fit it: until
the engine can say what it needs, the provider is either not in the catalogue, or declared in part, with what the
engine can say and the rest left out. Each row names a need the provider's own documentation shows.

A mechanism is built once three providers wait for it, with one of them as its first entry. The
[providers page](providers.md) lists every entry the catalogue holds.

## Mechanisms

| Mechanism | Providers waiting |
|---|---|
| A GraphQL cursor sent in the query's variables (Linear's lists are declared one page each, `first` and `after` ordinary variables) | Linear, Monday |
| `offset` paging | Outline, PagerDuty |
| A next cursor that is a number | Vercel |
| A next cursor read from the last record of a page | Render |
| `Link` paging that ends on `results="false"` | Sentry |
| `Link` paging under another `rel` (`next-page`) | Guru |
| A continuation token in an answer's header | Azure DevOps |
| OAuth 2 (3LO) on `api.atlassian.com/ex/confluence/{cloudId}` with next links relative to the site (`/wiki/api/v2/…`); a key sign-in breaks Atlassian's rules for apps, which must not collect API tokens ([Basic auth for REST APIs](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/)) | Confluence |
| A 429's wait in a header of seconds left (`RateLimit-User-Reset`, `RateLimit-Reset`) | Buildkite |
| A form-encoded body on a declared operation | Chatwork, Twilio |
| An operation parameter sent as a header | PagerDuty |
| Regional hosts on more than one domain | Smartsheet |
| The credential in the URL path | Telegram |
| A placeholder in identify's request path | Twilio |
| A `User-Agent` the app names, sent when it signs in | Basecamp |
| A webhook signed as a JWT | Monday, Netlify |
| Error codes read per sign-in (codes meaning a revoked OAuth grant, beside a key whose bad value must read as refused) | ClickUp |
| A webhook timestamp in milliseconds (the signed body's `webhookTimestamp`; the `Linear-Timestamp` header is not signed) | Linear |
| A plain value for an OAuth 2 sign-in (a subdomain or region chosen before the redirect) | — |
| An OAuth 2 token answer whose `scope` is a list of strings, which the engine's OAuth library refuses (Linear's apps created before 1 December 2023, [OAuth 2.0 authentication](https://linear.app/developers/oauth-2-0-authentication)) | Linear |
| A webhook handshake answered in a header (`X-Hook-Secret`) | Asana |
| A webhook secret decoded from base64 before it signs | Airtable |

## Declared in part

An entry declared in part is listed here with what it leaves out and the mechanism that part waits for.

| Provider | Left out | Waits for |
|---|---|---|
| Linear | Paging: each list answers one page, `first` and `after` ordinary variables, `pageInfo` in the result | A GraphQL cursor sent in the query's variables |
| Linear | OAuth 2 for an app created before 1 December 2023: its token answer's `scope` is an array, so it cannot sign in | An OAuth 2 token answer whose `scope` is a list of strings |
| Linear | The webhook timestamp check: the app refuses a delivery over a minute old itself | A webhook timestamp in milliseconds |
| Buildkite | A 429's wait: it is in `RateLimit-User-Reset`, which the retry does not read | A 429's wait in a header of seconds left |
| ClickUp | The codes that mean a revoked authorization (`OAUTH_019`, `OAUTH_021`, `OAUTH_025`, `OAUTH_077`): `errors` is shared by both sign-ins, and a personal token would read them as a revoked grant | Errors per sign-in |

## Skipped

None yet. A provider whose documentation cannot be read without signing in, or does not load, is listed here with the
page tried.
