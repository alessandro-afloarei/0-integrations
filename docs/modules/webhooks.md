# `webhooks`

`webhooks` verifies HMAC and Ed25519 signatures, shared tokens and Standard Webhooks with `verifyWebhook(entry.webhook, request, secret)` over the exact raw body
bytes. Use `readCappedBody(request, maxBytes)` before verification. `deliveryId(entry.webhook, request)` reads what the
entry declares an app dedupes on: a header, or body paths joined with `:`, null when one is missing. Read it only after
`verifyWebhook` accepted the request: an id such as Fireflies' `event:meeting_id` can be guessed, so deduplicating before
verifying lets a forged post suppress the real delivery. Routing, replay protection, dedupe and the inbox remain in the
app.

An entry's `webhook` declares the scheme: the header, what is signed, SHA-256 or SHA-1 (`hash: 'sha1'`, Intercom), and
for a header of `name=value` pieces such as Stripe's `t=…,v1=…` the piece that holds a signature (`part`) and the one
that holds the timestamp (`timestamp: { part }`). Any `v1` may match, so Stripe's rolling secrets pass, and other pieces
are ignored. A timestamp outside its tolerance (five minutes by default) and a signature header over 8 KiB are `false`.

`kind: 'ed25519'` (Discord) checks a hex Ed25519 signature of the filled `signed` (`'{timestamp}{body}'`) against the
provider's public key, passed as `secret` in 64 hex characters, as the provider's dashboard shows it. A signature that is
not 128 hex characters, a key that is not 64, a key that is no Ed25519 point and a wrong signature are all `false`; the
timestamp rule is the same as `hmac`'s. Discord asks for a `401` when the check fails.

`kind: 'token'` (Google Calendar push) signs nothing: the header (`x-goog-channel-token`) must equal the secret, the
channel `token` the app set when it opened the channel. The two are compared as SHA-256 digests, so their lengths leak
nothing; a missing header is `false`.

`kind: 'standard'` follows [Standard Webhooks](https://www.standardwebhooks.com/) (GitLab's signing token). It reads
`webhook-id`, `webhook-timestamp` (seconds, five minutes of tolerance) and `webhook-signature`, a space-separated list of
`v1,<base64>` of which any may match (other versions are ignored), over `<webhook-id>.<webhook-timestamp>.<raw body>`.
The secret is the base64 key, with or without its `whsec_` prefix; one that decodes to nothing is `false`, as is an empty
secret of any HMAC scheme. GitLab's entry declares `webhook-id`, the same across retries, as its delivery id.

[Fireflies](fireflies.md) and [Breakcold](breakcold.md) declare a delivery id; Fireflies' module also parses the event.
Stripe's entry declares the event's `id` as its delivery id.
