# `webhooks`

`webhooks` verifies HMAC signatures with `verifyWebhook(entry.webhook, request, secret)` over the exact raw body
bytes. Use `readCappedBody(request, maxBytes)` before verification. `deliveryId(entry.webhook, request)` reads what the
entry declares an app dedupes on: a header, or body paths joined with `:`, null when one is missing. Read it only after
`verifyWebhook` accepted the request: an id such as Fireflies' `event:meeting_id` can be guessed, so deduplicating before
verifying lets a forged post suppress the real delivery. Routing, replay protection, dedupe and the inbox remain in the
app.

[Fireflies](fireflies.md) and [Breakcold](breakcold.md) declare a delivery id; Fireflies' module also parses the event.
