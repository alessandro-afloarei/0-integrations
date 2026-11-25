# `webhooks`

`webhooks` verifies HMAC signatures with `verifyWebhook(provider.webhook, request, secret)` over the exact raw body
bytes. Use `readCappedBody(request, maxBytes)` before verification. Routing, replay protection, dedupe and the inbox
remain in the app.

After verifying the raw request with `verifyWebhook`, Fireflies' `parseWebhook(body)` reads the V2 event,
`meeting_id` and timestamp (number, or legacy string). Unknown fields are omitted; malformed events return null.
Breakcold's `parseWebhook(headers)` reads `x-webhook-delivery-id`. Apps own deduplication and retain original bytes.
