# `webhooks`

`webhooks` verifies HMAC and Ed25519 signatures, shared tokens, HTTP Basic credentials and Standard Webhooks with
`verifyWebhook(entry.webhook, request, secret)` over the exact raw body bytes, and answers URL challenges with
`challengeAnswer` ([below](#receiving-a-delivery)). Use `readCappedBody(request, maxBytes)` before verification.
`deliveryId(entry.webhook, request)` reads what the entry declares an app dedupes on: a header, or body paths joined
with `:`, null when one is missing. Read it only after `verifyWebhook` accepted the request: an id such as Fireflies'
`event:meeting_id` can be guessed, so deduplicating before verifying lets a forged post suppress the real delivery.
Routing, replay protection, dedupe and the inbox remain in the app.

An entry's `webhook` declares the scheme: the header, what is signed, SHA-256 or SHA-1 (`hash: 'sha1'`, Intercom), and
for a header of `name=value` pieces such as Stripe's `t=…,v1=…` the piece that holds a signature (`part`) and the one
that holds the timestamp (`timestamp: { part }`). Any `v1` may match, so Stripe's rolling secrets pass, and other pieces
are ignored. A timestamp outside its tolerance (five minutes by default) and a signature header over 8 KiB are
`false`. `{timestamp}` is signed exactly when a timestamp is declared, and `{body}` is always signed: the catalogue's
table test refuses an entry that breaks either, and `verifyWebhook` is `false` for an app's own declaration whose
`signed` lacks `{body}`, or lacks `{timestamp}` beside a declared timestamp.

`secret: 'base64'` or `'hex'` keys the HMAC with the secret's decoding instead of its text: pass the secret as the
provider gives it, never decoded. The decoding is strict: base64 must encode back to exactly the secret (the `+` and `/`
alphabet, no whitespace; its `=` padding may be left out), and hex must be pairs of hex digits, in either case. A
secret that does not decode exactly, or whose key is only zero bytes (HMAC pads a key with zeros, so that key is the
empty one anyone can sign with), is `false`, never read another way. Airtable passes the webhook's `macSecretBase64`
(base64), Chatwork the webhook's token (base64), Close the subscription's `signature_key` (hex).

Close signs `close-sig-timestamp` and the body. It states no tolerance, so the five minutes apply. Close retries a
failed delivery for up to 72 hours, and its page does not say whether a retry is signed again: if a retry keeps its
first timestamp, it is `false` after five minutes. So answer the first delivery, and read anything you missed from
Close's event log, which keeps events for 30 days.

`kind: 'ed25519'` (Discord) checks a hex Ed25519 signature of the filled `signed` (`'{timestamp}{body}'`) against the
provider's public key, passed as `secret` in 64 hex characters, as the provider's dashboard shows it. A signature that is
not 128 hex characters, a key that is not 64, a key that is no Ed25519 point and a wrong signature are all `false`; the
timestamp rule is the same as `hmac`'s. Discord asks for a `401` when the check fails.

Slack's entry signs `v0:{timestamp}:{body}` with the app's signing secret: `X-Slack-Signature: v0=<hex>` and an
`X-Slack-Request-Timestamp` within five minutes.

`kind: 'token'` (Google Calendar push) signs nothing: the header (`x-goog-channel-token`) must equal the secret, the
channel `token` the app set when it opened the channel. The two are compared as SHA-256 digests, so their lengths leak
nothing; a missing header is `false`.

`kind: 'standard'` follows [Standard Webhooks](https://www.standardwebhooks.com/) (GitLab's signing token). It reads
`webhook-id`, `webhook-timestamp` (seconds, five minutes of tolerance) and `webhook-signature`, a space-separated list of
`v1,<base64>` of which any may match (other versions are ignored), over `<webhook-id>.<webhook-timestamp>.<raw body>`.
The secret is the base64 key, with or without its `whsec_` prefix, decoded as strictly as `secret: 'base64'` (padding
optional); one that decodes loosely, or whose key is only zero bytes, is `false`, as is an empty secret of any HMAC
scheme. GitLab's entry declares `webhook-id`, the same across retries, as its delivery id. A GitLab hook set up with
only the older secret token (`X-Gitlab-Token`) sends no signature, and this entry refuses it. An id
holding a `.` is `false`: the specification says the message id must "not be allowed to include any `.`", since the
signed content joins id, timestamp and body with dots (GitLab's ids are UUIDs).

`kind: 'basic'` (Mailjet) signs nothing either: the provider calls the URL the app registered with a user and password
in it (`https://user:password@…`) and sends them as HTTP Basic. Pass `user:password` as the secret. The request passes
when `authorization` is `Basic` (in any case), one space and exactly the base64 of the secret's UTF-8 bytes, compared as
SHA-256 digests as `token` is; the password runs from the first `:`. A secret with no `:` or an empty password, a
missing header, two spaces, base64 without its `=` padding and the credentials in clear are all `false`.

[Fireflies](fireflies.md) and [Breakcold](breakcold.md) declare a delivery id; Fireflies' module also parses the event.
Stripe's entry declares the event's `id` as its delivery id.

## Declaring a webhook

One declaration per kind, as the library's entries write them:

```ts
import type { Webhook } from '0-integrations/catalogue';

// `hmac` with a timestamp header (Breakcold)
const timestamped: Webhook = { kind: 'hmac', header: 'x-webhook-signature', signed: '{timestamp}.{body}', prefix: 'sha256=',
  timestamp: { header: 'x-webhook-timestamp' }, deliveryId: { header: 'x-webhook-delivery-id' } };
// `hmac` with `part`: `t=…,v1=…` pieces in one header (Stripe)
const pieces: Webhook = { kind: 'hmac', header: 'stripe-signature', signed: '{timestamp}.{body}', part: 'v1',
  timestamp: { part: 't' }, deliveryId: { body: ['id'] } };
// `ed25519`: the secret is the provider's public key (Discord)
const signedWithKey: Webhook = { kind: 'ed25519', header: 'x-signature-ed25519', signed: '{timestamp}{body}',
  timestamp: { header: 'x-signature-timestamp' } };
// `token`: the header is the secret itself (Google Calendar push)
const sharedToken: Webhook = { kind: 'token', header: 'x-goog-channel-token' };
// `hmac` keyed with the secret's hex decoding, over the timestamp header's text and the body (Close)
const decoded: Webhook = { kind: 'hmac', header: 'close-sig-hash', signed: '{timestamp}{body}', secret: 'hex',
  timestamp: { header: 'close-sig-timestamp' } };
// `basic`: `authorization` holds HTTP Basic of the secret, `user:password` (Mailjet)
const credentials: Webhook = { kind: 'basic' };
// `standard`: Standard Webhooks fixes the headers and what is signed (GitLab)
const standard: Webhook = { kind: 'standard', deliveryId: { header: 'webhook-id' } };
// A `challenge` beside any kind: echo the body's `challenge` when its `type` is `url_verification` (Slack)
const challenged: Webhook = { kind: 'hmac', header: 'x-slack-signature', signed: 'v0:{timestamp}:{body}', prefix: 'v0=',
  timestamp: { header: 'x-slack-request-timestamp' },
  challenge: { when: { path: 'type', equals: 'url_verification' }, echo: 'challenge' } };
```

## Receiving a delivery

Verify first, then answer a challenge, then dedupe and handle. `challengeAnswer(entry.webhook, request)` answers a URL
handshake the entry declares (`challenge`): Slack's `url_verification` with `{ "challenge": … }`, Discord's PING with
`{ "type": 1 }`, each a JSON `200`. It is null for any other body, a body that is not JSON, a value that is not a string
or a number, and an entry with no `challenge`; it copies nothing else of the body. Answer a challenge only after
`verifyWebhook` accepted the request: an unsigned one would let anyone register your URL elsewhere.

```ts
import type { Webhook } from '0-integrations/catalogue';
import { challengeAnswer, deliveryId, readCappedBody, verifyWebhook } from '0-integrations/webhooks';

async function receive(webhook: Webhook, request: Request, secret: string,
  handle: (id: string | null, rawBody: Buffer) => Promise<Response>): Promise<Response> {
  const rawBody = await readCappedBody(request, 1024 * 1024);
  if (rawBody === null) return new Response(null, { status: 413 });
  const delivery = { method: request.method, url: request.url, headers: request.headers, rawBody };
  if (!verifyWebhook(webhook, delivery, secret)) return new Response(null, { status: 401 }); // Discord requires a 401
  const answer = challengeAnswer(webhook, delivery);
  if (answer !== null) return answer;
  return handle(deliveryId(webhook, delivery), rawBody); // the app dedupes on the id, when the entry declares one
}
// receive(slack.webhook, request, signingSecret, …), or receive(discord.webhook, request, publicKey, …)
```
