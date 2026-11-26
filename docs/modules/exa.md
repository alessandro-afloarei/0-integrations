# Exa

`exaClient({ apiKey, fetch })` takes the key and the app's fetch and returns typed calls, so the app never builds a
request or reads an answer. The library checks every answer with zod, which no public type names, so an app's own zod
version never meets it; an answer in the wrong shape is a `ProviderHttpError` with code `invalid_response`.

`exa/fake` exports `fakeExa`, which returns routes that answer the calls `exaClient` makes, from data the app passes.
