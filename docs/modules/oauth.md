# `oauth`

`oauth` builds consent URLs with `authorizeUrl(entry, …)` and handles `exchangeCode`, `refreshGrant` and `revokeGrant`
on `oauth4webapi`, each driven by a catalogue entry whose sign-in is OAuth 2. `pkcePair` supplies PKCE where the entry
uses it. Inject fetch on each network call; the app owns the state nonce. `exchangeCode` returns only the token-answer
fields the entry reads (`identify`, `save`, and `scope` when every scope must be granted), never the rest; a token
answer the entry's `failed` condition marks is refused with the entry's own code.

`refreshGrant` posts to the entry's `refreshUrl` when it names one (Figma), else to `tokenUrl`; a refresh answer
without a `refresh_token` keeps the one sent. With `json: true` (Atlassian) the exchange, the refresh and an RFC 7009
revoke send their parameters as one JSON object (`content-type: application/json`); Basic client authentication stays a
header.

`revokeGrant(entry, { accessToken?, refreshToken?, client?, fetch })` is the one revoke: an RFC 7009 revoke of the
first token the entry's `revoke.token` names (it needs `client`, else `oauth_client_required`), or the entry's
`revoke.request` sent with the access token, to the `http.bases` entry its `base` names, if any. A 2xx,
`invalid_grant`, a revoked code and the entry's `goneErrors` are done, and so is an RFC 7009 revoke's 404, an entry
with no `revoke` or a grant without the token it names. A request revoke's answer is read as any JSON call's: its 404
is `not_found` (a missing route, not a gone token), and a 2xx without JSON is `invalid_response`.

## A `token` entry: `tokenSource`

A `token` entry (Zoom's Server-to-Server OAuth) turns what the person entered into a short-lived token with one declared
request. `tokenSource(entry, { secret, values?, fetch? })` is the token function `client()` takes for it:

```ts
import { zoom } from '0-integrations/catalogue/zoom';
import { client } from '0-integrations/client';
import { tokenSource } from '0-integrations/oauth';

// One source per connection, built outside any request handler and kept for the process's life.
const api = client(zoom, { token: tokenSource(zoom, { secret, values }), values });

export async function handler() {
  return api.json('/users/me'); // every request reuses the kept token
}
```

Build one source per connection and keep it for the process's life: a new source requests a new token (for Metabase,
a new session; each process signs in its own).

`secret` is the entry's secret field by name (`{ clientSecret }`), `values` the plain ones (`{ accountId, clientId }`):
pass the connection's, as `finishConnect` returned them, since neither `tokenSource` nor `client` applies a field's
`default` (PayPal's `apiHost`).
The source requests a token on its first call and keeps it until 60 seconds before the answer's `expires_in` runs out
(an answer with no positive `expires_in` keeps it until it is refused; a caller that requested a token, or joined that
request, gets it however short its life). Concurrent calls share one request; a failed
request is not kept, so the next call tries again. When the API refuses the token with a 401, the client passes it back
and the source requests a new one. A client asks its source when it first needs a token and again only after a refused
call, so a client kept for hours renews on the first 401 (the call is sent once more), and a client built per job gets
a token the source already renewed 60 seconds early.

The request posts the entry's body as a form (or as one JSON object with `json: true`), with Basic client
authentication when the entry says `basic`, and the entry's `http.headers`. Its URL is filled by the base's rule: a host
from a field (PayPal's `'https://{apiHost}/v1/oauth2/token'`) must match `http.host`, and a typed host (Metabase's,
`http.host: '*'`) is sent through `guardedFetch` unless the app passes its own `fetch`, which still never reaches an
address literal the guard blocks. It is sent once: never retried, since it is
no read of the provider's API, and never redirected (a 3xx is `request_failed`). A 400, 401 or 403 is `rejected`, with
the RFC 6749 `error` as its detail; a 2xx without a non-empty token is `invalid_response` (`missing_fields`); any other
answer is classified as usual. No detail holds a secret field, a body value filled from one, or the Basic value sent.
A template naming a value that is missing or blank is `TypeError('template_missing: <entry id> {<name>}')` before
anything is sent. The token lives in the process; the vault keeps only the long-lived secret fields.
