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
`signed` lacks `{body}`, or lacks `{timestamp}` beside a declared timestamp. A timestamp is epoch seconds unless its
`unit` says `epochMs` (whole milliseconds) or `iso8601` (an instant with its zone, as Zendesk's
`2021-03-25T05:09:27Z`, read as a `Wait` reads one); a value in another unit, a date alone or an instant with no zone
is `false`, and the header's text as sent is what is signed. Zendesk states no window, so the five minutes apply.

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

A request with no `webhook-signature` is read under Svix's names instead, `svix-id`, `svix-timestamp` and
`svix-signature`: Svix, the reference implementation, sends these, as AgentMail's, Resend's and Fellow's webhooks do.
One set is read whole. A `standard` entry that dedupes on a header reads only that header's set and is `false` for the
other (a header that is neither `webhook-id` nor `svix-id` accepts nothing), so on every request it accepts the id
header it dedupes on is the one the signature covers: a delivery renamed to the other set's names cannot replay without
its id, or with a fresh one. An entry that dedupes on the body, or on nothing, reads either set. AgentMail's entry
declares the body's `event_id` as its delivery id: its `svix-id` differs between webhooks registered for the
organization, a pod and an inbox, and `event_id` does not.

`kind: 'basic'` (Mailjet, Pipedrive, Postmark) signs nothing: the app gives the provider a user and password, in the URL
it registers (`https://user:password@…`) or in fields of their own (Pipedrive's `http_auth_user` and
`http_auth_password`), and the provider sends them as HTTP Basic. Pass `user:password` as the secret. Where they sit in
a URL, use a user and password of letters, digits, `-` and `_`: no page says how a reserved character there is escaped.
The request passes when `authorization` is `Basic` (in any case), one space and exactly the base64 of the secret's UTF-8
bytes, compared as SHA-256 digests as `token` is; the password runs from the first `:`. A secret with no `:` or an
empty password, a missing header, two spaces, base64 without its `=` padding and the credentials in clear are all
`false`.

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
// `hmac` over an ISO 8601 timestamp header and the body, base64 (Zendesk)
const instant: Webhook = { kind: 'hmac', header: 'x-zendesk-webhook-signature', signed: '{timestamp}{body}', encoding: 'base64',
  timestamp: { header: 'x-zendesk-webhook-signature-timestamp', unit: 'iso8601' } };
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
// A `challenge` read from a GET's query and answered as text, unsigned: the secret comes after it (Nylas)
const queried: Webhook = { kind: 'hmac', header: 'x-nylas-signature',
  challenge: { echo: { query: 'challenge' }, text: true, unsigned: true } };
```

## Receiving a delivery

Answer a challenge first, then verify, then dedupe and handle. `challengeAnswer(entry.webhook, request, secret)`
answers a URL handshake the entry declares (`challenge`) and is null for every other request. It verifies the request
with `verifyWebhook` first, unless the entry marks the challenge `unsigned`: Slack's `url_verification` is answered
`{ "challenge": … }` and Discord's PING `{ "type": 1 }`, each a JSON `200`, only under a valid signature (Discord also
sends PINGs with invalid signatures, and expects the `401`). Nylas' check is a `GET` with `?challenge=…`, sent before
Nylas makes the webhook's secret, so it is unsigned; it is answered with the value alone, as
`text/plain; charset=utf-8` with `x-content-type-options: nosniff` and its `content-length`: Nylas refuses an answer
sent with chunked encoding, so keep that header when your server sends the `Response`.

A challenge read from the body is answered only where its `when` holds; one read from a query parameter only on a
request with an empty body (a delivery to a URL holding the parameter is an event, verified as one), where its `when`
holds or, with none, wherever the value is present, and only as text (`text: true`). The value comes from
whoever sent the request, so it is answered only when it is 1 to 512 printable ASCII characters with no space, `<` or
`>` (in a JSON answer, a finite number too): never markup, never a header. The answer copies nothing else of the
request, changes nothing and holds nothing secret; anyone may receive one for an unsigned challenge. Verify every
request it does not answer.

```ts
import type { Webhook } from '0-integrations/catalogue';
import { challengeAnswer, deliveryId, readCappedBody, verifyWebhook } from '0-integrations/webhooks';

async function receive(webhook: Webhook, request: Request, secret: string,
  handle: (id: string | null, rawBody: Buffer) => Promise<Response>): Promise<Response> {
  const rawBody = await readCappedBody(request, 1024 * 1024);
  if (rawBody === null) return new Response(null, { status: 413 });
  const delivery = { method: request.method, url: request.url, headers: request.headers, rawBody };
  const answer = challengeAnswer(webhook, delivery, secret); // a handshake, verified unless the entry marks it unsigned
  if (answer !== null) return answer;
  if (!verifyWebhook(webhook, delivery, secret)) return new Response(null, { status: 401 }); // Discord requires a 401
  return handle(deliveryId(webhook, delivery), rawBody); // the app dedupes on the id, when the entry declares one
}
// receive(slack.webhook, request, signingSecret, …), receive(discord.webhook, request, publicKey, …),
// or receive(nylas.webhook, request, webhookSecret, …)
```
