# `credentials`

`credentials` supplies `readSecret` for API keys and `accessToken` for OAuth grants. Pass the stores, vault, lock and
a refresh function, and the provider's catalogue entry. Refreshes use a 15-minute margin, a 30-second lock on
`<entry id>:refresh:<connectionId>`, and compare-and-swap saves. A refused refresh allows a concurrent writer 5 seconds to save, with reads every 500 ms.
A busy lock can serve a still-valid token; `RefreshBusy` asks the app to retry later.
