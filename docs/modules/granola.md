# Granola

`granola` and `breakcold` are the API-key sources' modules. Their clients return the provider's own field names, since
an app stores what they read, and answer a list one `Page` at a time: `{ items, skipped, cursor }`, where `skipped`
holds the ids of entries the client could not read and `cursor` is null on the last page. Walk the pages with
[`paginate`](paginate.md).

`granola/fake` exports `fakeGranola`, which returns routes that answer the calls `granolaClient` makes, from data the
app passes. `fakeGranola` inlines every transcript, so it never answers 413.
