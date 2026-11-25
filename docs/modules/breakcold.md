# Breakcold

`granola` and `breakcold` are the API-key sources' modules. Their clients return the provider's own field names, since
an app stores what they read, and answer a list one `Page` at a time: `{ items, skipped, cursor }`, where `skipped`
holds the ids of entries the client could not read and `cursor` is null on the last page. `paginate(load)` walks the
pages and refuses a repeated cursor; the app stops when its own budget says so. Broken paging is `invalid_response` with
no status and the library's own `detail` (`cursor_repeated`, `cursor_missing`), so it never reads as a provider's code. `createClient`'s `beforeRequest(url)`
runs once per call before anything is sent, for an app's metering, and a refusal's `ProviderHttpError.detail` carries
the provider's own code where the catalogue reads one (Breakcold's `usage_limit`).

`deliveryId(breakcold.webhook, request)` from `0-integrations/webhooks` reads Breakcold's `x-webhook-delivery-id`. Apps
own deduplication and retain original bytes.

`breakcold/fake` exports `fakeBreakcold`, which returns routes that answer the calls `breakcoldClient` makes, from data the
app passes. `fakeBreakcold` accepts optional `readable: {notes?, meetings?}` collections for fixtures that must be available by id
without entering ingestion lists. Normal `notes` and `meetings` still supply those lists and take precedence on a
duplicate id. Missing ids remain 404; direct-only meetings use the existing `segments` collection for transcripts.
