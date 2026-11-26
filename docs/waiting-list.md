# Waiting list

What providers need that the engine cannot say yet. A provider is never forced into a shape that does not fit it: until
the engine can say what it needs, the provider is either not in the catalogue, or declared in part, with what the
engine can say and the rest left out. Each row names a need the provider's own documentation shows.

A mechanism is built once three providers wait for it, with one of them as its first entry. The
[providers page](providers.md) lists every entry the catalogue holds.

## Mechanisms

| Mechanism | Providers waiting |
|---|---|
| A GraphQL cursor sent in the query's variables | Linear, Monday |
| `offset` paging | Outline, PagerDuty |
| A next cursor that is a number | Vercel |
| A next cursor read from the last record of a page | Render |
| `Link` paging that ends on `results="false"` | Sentry |
| `Link` paging under another `rel` (`next-page`) | Guru |
| A continuation token in an answer's header | Azure DevOps |
| A form-encoded body on a declared operation | Chatwork, Twilio |
| An operation parameter sent as a header | PagerDuty |
| Regional hosts on more than one domain | Smartsheet |
| The credential in the URL path | Telegram |
| A placeholder in identify's request path | Twilio |
| A `User-Agent` the app names, sent when it signs in | Basecamp |
| A webhook signed as a JWT | Monday, Netlify |
| A webhook handshake answered in a header (`X-Hook-Secret`) | Asana |
| A webhook secret decoded from base64 before it signs | Airtable |

## Declared in part

None yet. An entry declared in part is listed here with what it leaves out and the mechanism that part waits for.

## Skipped

None yet. A provider whose documentation cannot be read without signing in, or does not load, is listed here with the
page tried.
