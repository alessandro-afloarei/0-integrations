# `oauth`

`oauth` builds consent URLs with `authorizeUrl` and handles `exchangeCode`, `refreshGrant` and `revokeGrant` on
`oauth4webapi`. `pkcePair` supplies PKCE where supported. Inject fetch on each network call; the app owns the state
nonce. `exchangeCode` returns only the token-answer fields the provider's `extras` names, never the rest.
