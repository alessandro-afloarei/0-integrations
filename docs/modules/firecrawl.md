# Firecrawl

`firecrawlClient({ apiKey, fetch })` takes the key and the app's fetch and returns typed calls, so the app never builds a
request or reads an answer. The library checks every answer with zod, which no public type names, so an app's own zod
version never meets it; an answer in the wrong shape is a `ProviderHttpError` with code `invalid_response`. Firecrawl
sends no browser actions to a document and reads a page as it loads when a render fails.

`firecrawl/fake` exports `fakeFirecrawl`, which returns routes that answer the calls `firecrawlClient` makes, from data the app passes.
