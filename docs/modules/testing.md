# `testing`

`testing` provides scripted `fakeFetch` routes, repeating `sequence` responses, `memoryStores`, `memoryLock` and
`openLock`. Each provider module has a fake beside it (`aircall/fake`, `apollo/fake`, `attio/fake`, `breakcold/fake`,
`exa/fake`, `fathom/fake`, `firecrawl/fake`, `fireflies/fake`, `github/fake`, `google/fake`, `granola/fake`,
`hubspot/fake`, `lusha/fake`, `microsoft/fake`, `notion/fake`, `slack/fake`, `unipile/fake`): `fakeAircall`,
`fakeApollo`, `fakeAttio`, `fakeBreakcold`, `fakeExa`, `fakeFathom`, `fakeFirecrawl`, `fakeFireflies`, `fakeGitHub`,
`fakeGoogle`, `fakeGranola`, `fakeHubSpot`, `fakeLusha`, `fakeMicrosoft`, `fakeNotion`, `fakeSlack` and
`fakeUnipile` return routes that answer the calls their clients make, from data the app passes
(each client's own tests pin its exact requests; `fakeGranola` inlines every transcript, so it never answers 413). `respondFrom(routes)` answers a request from routes or returns null,
for an app's fixture mode.

Run `checkCredentialStore` against each real store adapter in the app's database test tier, using an
isolated existing connection fixture and a tenant with no key; it restores the connection's original sealed secret.

## The provider kit

Every new provider's tests run `providerKit(scenario, { recording, fake })` (`src/kit.test-support.ts`): sign in, a bad
key, the first page, paging to the end, an incremental read and a 429, once on the provider's recording and once on its
fake, so the fake an app tests with answers as the provider does. A recording is the scenario's requests and the
provider's answers. One marked `synthetic` is built from the provider's documented samples; replace it from a test account
with `RECORD_PROVIDER=<recording> RECORD_KEY=<key> pnpm vitest run src/record.test.ts`, then read the file before
committing it: the recorder keeps every answer whole, so a live recording holds the test account's own mail. A recording
sits beside its entry as `src/catalogue/<id>.recording.json`, or `<id>.<part>.recording.json` for a provider with more
than one scenario, and `<recording>` is that name without `.recording.json` (the scenario's `provider`). A scenario that
names a `standIn` also needs a test account, given as `RECORD_ACCOUNT`: Unipile's (`unipile.mail`, `unipile.calendar`)
take an API key and an account id, Microsoft's and Google's (`microsoft.mail`, `microsoft.calendar`, `google.mail`,
`google.calendar`) a test mailbox's access token and its address. The recording names the kit's stand-in in its place, so
it replays without it. The scenarios read a whole mailbox, or a primary calendar, two at a time: record from an account
with a few of each. Microsoft's and Google's synthetic recordings are played from the fakes until a test mailbox replaces
them.

A lookup provider has no pages, so its tests run `lookupKit(scenario, { recording, fake })` instead: the key proof, a bad
key, a person found, one not found (null, with the credits the provider reports for it), a company and a 429. Its
recording stays synthetic: `record.test.ts` plays list scenarios only, and a real lookup spends a customer's credits.
