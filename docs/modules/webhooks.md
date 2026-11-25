# `webhooks`

`webhooks` verifies HMAC signatures with `verifyWebhook(entry.webhook, request, secret)` over the exact raw body
bytes. Use `readCappedBody(request, maxBytes)` before verification. `deliveryId(entry.webhook, request)` reads what the
entry declares an app dedupes on: a header, or body paths joined with `:`, null when one is missing. Routing, replay
protection, dedupe and the inbox remain in the app.

After verifying the raw request with `verifyWebhook`, Fireflies' `parseWebhook(body)` reads the V2 event,
`meeting_id` and timestamp (number, or legacy string). Unknown fields are omitted; malformed events return null.
`deliveryId(breakcold.webhook, request)` reads Breakcold's `x-webhook-delivery-id`. Apps own deduplication and retain
original bytes.
