# `http`

`http` creates an authenticated client with `createClient({ provider, token, fetch })`. Call `json` for classified
JSON responses or `request` for raw status, headers and parsed data. Tokens are reused until a 401 requests renewal.
The client applies timeouts, pacing and capped 429 waits; only GETs and explicitly idempotent calls retry, and a
caller's signal disables retry waits. A redirect is followed only on the same origin (307/308, or 301–303 for a
GET, at most five hops), so a credential never reaches another host. Pass the app's guarded fetch to preserve fixtures
and production checks.

`createClient`'s `beforeRequest(url)` runs once per call before anything is sent, for an app's metering, and a refusal's
`ProviderHttpError.detail` carries the provider's own code where the catalogue reads one (Breakcold's `usage_limit`).
