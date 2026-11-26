# Fireflies

`firefliesClient({ apiKey, fetch, signal? })` reads the key owner (`user`), a transcript (`transcript`),
keyword matches (`search`), or one 50-record offset page (`transcripts`); `user()` is the API-key proof.
`changedTranscripts(client, { userId, fromDate, toDate, cursor? })` yields pages through `paginate`. The window
filters on transcript creation date, not modification date: edits are not re-yielded once creation falls outside
the window. Windows must overlap (for example three days). Fireflies gives no order guarantee; apps own deduplication
and page budgets. Break the iteration to enforce your own run budget.

The cursor is a JSON string binding the offset to the user, date window and fixed 50-record page size, with `null`
at the end. Resume only with the same query; a fresh window starts without a cursor. Malformed or mismatched cursors
throw `TypeError('cursor_invalid')`. Invalid dates and search limits throw `TypeError('date_invalid')` and
`TypeError('limit_invalid')`; search accepts integer limits from 1 through 50. `skipped` reports unreadable list
entries, counted toward the offset. Apps validate records against their own stored contract. An unnormalizable
detail record throws `FirefliesTranscriptError` from `fireflies/errors`, a `ProviderHttpError` with code
`invalid_response`, `detail: 'transcript_invalid'` and a sanitized `path` containing only field names and indices.
It is distinct from a missing record, which returns `null`.

`fireflies/fake` exports `fakeFireflies({ account: apiKey => ({ user, transcripts }) })`; return `null` to reject a
key. Pass its routes to `fakeFetch` or `respondFrom` from `testing`. It covers identity, paging, transcript reads
and keyword search against caller-owned fixture data.

After verifying the raw request with `verifyWebhook`, Fireflies' `parseWebhook(body)` reads the V2 event,
`meeting_id` and timestamp (number, or legacy string). Unknown fields are omitted; malformed events return null.
Apps own deduplication and retain original bytes.
