import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { Webhook } from './catalogue.js';
import { holds, parseJson, readPath } from './rules.js';

export type WebhookRequest = { method: string; url: string; headers: Headers; rawBody: Uint8Array };

/** A signature header longer than this is refused before it is parsed. */
const MAX_HEADER_BYTES = 8 * 1024;

const sha256 = (value: string) => createHash('sha256').update(value).digest();
/** Standard Webhooks read as the HMAC it is: `<set>-signature` lists `v1,<base64>` pieces with spaces between, over
 * `<set>-id.<set>-timestamp.<body>`, keyed with the secret's base64. */
const STANDARD = (set: string): Extract<Webhook, { kind: 'hmac' }> => ({ kind: 'hmac', header: `${set}-signature`,
  signed: '{timestamp}.{body}', encoding: 'base64', secret: 'base64', part: 'v1', timestamp: { header: `${set}-timestamp` } });

export function verifyWebhook(webhook: Webhook, request: WebhookRequest, secret: string): boolean {
  const standard = webhook.kind === 'standard';
  // Svix, the reference implementation, names them `svix-*`: the `webhook-*` set is read when it signs, else Svix's. An
  // entry that dedupes on a header reads only that header's set, so the id it dedupes on is the one signed.
  const set = request.headers.has('webhook-signature') ? 'webhook' : 'svix';
  const dedupe = webhook.deliveryId;
  if (standard && dedupe && 'header' in dedupe && dedupe.header !== `${set}-id`) return false;
  const scheme = standard ? STANDARD(set) : webhook;
  const received = request.headers.get(scheme.kind === 'basic' ? 'authorization' : scheme.header);
  if (!received || received.length > MAX_HEADER_BYTES) return false;
  // Compared as digests of equal length, so the token's length leaks nothing.
  if (scheme.kind === 'token') return timingSafeEqual(sha256(received), sha256(secret));
  // RFC 7617: `Basic`, one space, the base64 of `user:password`; a secret with no password keys nothing.
  if (scheme.kind === 'basic') return /^[^:]*:./su.test(secret) && /^basic /iu.test(received)
    && timingSafeEqual(sha256(received.slice(6)), sha256(Buffer.from(secret).toString('base64')));
  // With `part`, the header is `name=value` pieces split on `,` (Standard Webhooks: `name,value` on spaces). A name holds
  // neither separator (the table's rule), so a piece is that name's exactly when it starts with the name and `assign`.
  const [between, assign] = standard ? [' ', ','] : [',', '='];
  const named = (name: string) => received.split(between).filter(piece => piece.startsWith(name + assign)).map(piece => piece.slice(name.length + 1));
  const stamp = scheme.timestamp;
  const timestamp = stamp === undefined ? '' : 'part' in stamp ? named(stamp.part)[0] ?? '' : request.headers.get(stamp.header) ?? '';
  // Plain seconds within the tolerance of now. The header's text is what is signed, so a long one loses nothing.
  if (stamp && !(/^\d+$/.test(timestamp) && Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) <= (stamp.toleranceSeconds ?? 300))) return false;
  // A declaration that does not sign the body, or the timestamp it checks, can verify nothing safely.
  const signed = scheme.signed ?? '{body}';
  if (!signed.includes('{body}') || (stamp !== undefined && !signed.includes('{timestamp}'))) return false;
  const id = standard ? request.headers.get(`${set}-id`) || null : '';
  // The specification bars a `.` from the id: `a.<t>` and a body starting `<digits>.` would sign the same bytes.
  if (id === null || id.includes('.')) return false;
  // A Map: a name that is no placeholder (`constructor`) is signed as written, never read from a prototype.
  const substitutions = new Map<string, string | Uint8Array>([
    ['{body}', request.rawBody], ['{timestamp}', timestamp], ['{method}', request.method], ['{url}', request.url]]);
  const content = Buffer.concat([Buffer.from(standard ? `${id}.` : ''), ...signed
    .split(/(\{body\}|\{timestamp\}|\{method\}|\{url\})/).map(piece => Buffer.from(substitutions.get(piece) ?? piece))]);
  if (scheme.kind === 'ed25519') {
    // The public key is 32 bytes and the signature 64, both hex; anything else, or a key that is no point, is false.
    if (!/^[0-9a-f]{128}$/iu.test(received) || !/^[0-9a-f]{64}$/iu.test(secret)) return false;
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(secret, 'hex').toString('base64url') }, format: 'jwk' });
      return verify(null, content, key, Buffer.from(received, 'hex'));
    } catch {
      return false;
    }
  }
  // The key is the secret's bytes, or its decoding, which must encode back to it exactly (hex in either case, base64's
  // `=` padding optional); a key that decodes loosely, or holds only zero bytes (HMAC pads a key with zeros, so that is
  // the empty key anyone can sign with), accepts nothing.
  const text = standard ? secret.replace(/^whsec_/u, '') : secret;
  const key = Buffer.from(text, scheme.secret ?? 'utf8');
  const exact = scheme.secret === undefined
    || key.toString(scheme.secret).replace(/=+$/u, '') === (scheme.secret === 'hex' ? text.toLowerCase() : text.replace(/=+$/u, ''));
  if (!exact || key.every(byte => byte === 0)) return false;
  const hmac = createHmac(scheme.hash ?? 'sha256', key).update(content);
  const expected = Buffer.from((scheme.prefix ?? '') + hmac.digest(scheme.encoding ?? 'hex'));
  return (scheme.part === undefined ? [received] : named(scheme.part)).some(candidate => {
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

/** What an app dedupes a delivery on: the declared header, or the body's paths joined with `:`; null when one is missing.
 * Read it only after `verifyWebhook` accepted the request. */
export function deliveryId(webhook: Webhook, request: WebhookRequest): string | null {
  const source = webhook.deliveryId;
  if (source === undefined) return null;
  if ('header' in source) return request.headers.get(source.header) || null;
  const body = parseJson(Buffer.from(request.rawBody).toString('utf8'));
  const parts = source.body.map(path => readPath(body, path));
  return parts.every((part): part is string | number => (typeof part === 'string' && part !== '') || typeof part === 'number')
    ? parts.join(':') : null;
}

/** The answer to a handshake the entry declares, or null. The request is verified first unless the challenge is
 * `unsigned`, so call it before `verifyWebhook`, and verify every request it does not answer. The value is answered
 * only as 1 to 512 printable ASCII characters with no space, `<` or `>` (or, as JSON, a finite number): it comes from
 * whoever sent the request, so it can be no markup and no header. */
export function challengeAnswer(webhook: Webhook, request: WebhookRequest, secret: string): Response | null {
  const challenge = webhook.challenge;
  if (challenge === undefined) return null;
  const { when, echo, text } = challenge;
  const body = parseJson(Buffer.from(request.rawBody).toString('utf8'));
  const name = typeof echo === 'string' ? echo : 'header' in echo ? echo.header : echo.query;
  const value = typeof echo === 'string' ? readPath(body, echo) : 'header' in echo ? request.headers.get(name)
    : new URLSearchParams(/^[^#?]*\?([^#]*)/u.exec(request.url)?.[1]).get(name);
  // A body path answers only where `when` holds; a header or a query parameter, wherever it is present.
  const asked = when === undefined ? typeof echo !== 'string' : holds(when, { status: 200, headers: request.headers, body });
  const safe = typeof value === 'string' ? /^[!-;=?-~]{1,512}$/u.test(value) : !text && typeof value === 'number' && Number.isFinite(value);
  // Verified last, so a delivery that is no handshake is verified once, by the app's own `verifyWebhook`.
  if (!asked || !safe || !(challenge.unsigned ?? verifyWebhook(webhook, request, secret))) return null;
  // ASCII, so its length is its byte count: stated, an adapter that streams the answer sends no chunks (Nylas refuses them).
  return text ? new Response(String(value), { headers: { 'content-type': 'text/plain; charset=utf-8',
    'content-length': String(String(value).length), 'x-content-type-options': 'nosniff' } }) : Response.json({ [name]: value });
}

export async function readCappedBody(request: Request, maxBytes: number): Promise<Buffer | null> {
  const reader = request.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, bytes);
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
}
