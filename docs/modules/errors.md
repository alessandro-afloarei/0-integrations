# `errors`

`errors` provides coded errors such as `ProviderHttpError` and `GrantRevoked`. Apps map their codes to their own
messages and reconnect behavior; library errors never include provider response bodies or secrets.
`ProviderHttpError.retryAfterMs` is the final response's diagnostic wait in milliseconds, or `null` when absent or
invalid. A valid `Retry-After` header (seconds or HTTP-date) wins over Breakcold's body delay or Fireflies' epoch-ms
timestamp; past dates yield zero and fractional body delays round up. The field does not change retry counts or
wait caps, and an app must still decide whether a call is safe to retry. HubSpot's admitted `MISSING_SCOPES` and
`VALIDATION_ERROR` categories appear in `detail`; other categories are omitted. Error codes and messages stay unchanged.
