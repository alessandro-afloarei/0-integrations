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
`revoke.request` sent with the access token, to the `http.bases` entry its `base` names, if any. A 2xx, `invalid_grant`, a revoked code and the entry's `goneErrors` are
done, and so is an RFC 7009 revoke's 404, an entry with no `revoke` or a grant without the token it names. A request
revoke's answer is read as any JSON call's: its 404 is `not_found` (a missing route, not a gone token), and a 2xx
without JSON is `invalid_response`.
