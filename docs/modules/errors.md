# `errors`

`errors` provides coded errors such as `ProviderHttpError` and `GrantRevoked`. Apps map their codes to their own
messages and reconnect behavior; library errors never include provider response bodies or secrets.
`ProviderHttpError.retryAfterMs` is the final response's diagnostic wait in milliseconds, or `null` when absent or
invalid: the wait the retry read. A positive `Retry-After` header (seconds or HTTP-date) wins over the wait an entry
declares: a header (Buildkite's and PagerDuty's reset headers) only on a 429 or an answer a `rateLimit` rule marks, a
body field (Breakcold's delay, Fireflies' epoch-ms timestamp, Todoist's `retry_after`) on any error; a rate-limit rule's
own wait (GitHub's reset) raises it when that is later, and with nothing stated it is the rule's own wait, else
`rateLimit.defaultWaitMs`. A
`Retry-After` of 0, or a past date, yields zero when nothing else is stated; a declared wait already past, or 0, gives
none; fractional waits round up. The field does not change retry counts or
wait caps, and an app must still decide whether a call is safe to retry. HubSpot's admitted `MISSING_SCOPES` and
`VALIDATION_ERROR` categories appear in `detail`; other categories are omitted. Error codes and messages stay unchanged.
