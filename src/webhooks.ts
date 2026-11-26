import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { Webhook } from './catalogue.js';
import { holds, parseJson, readPath } from './rules.js';

export type WebhookRequest = { method: string; url: string; headers: Headers; rawBody: Uint8Array };

/** A signature header longer than this is refused before it is parsed. */
const MAX_HEADER_BYTES = 8 * 1024;

const sha256 = (value: string) => createHash('sha256').update(value).digest();
/** Standard Webhooks read as the HMAC it is: `webhook-signature` lists `v1,<base64>` pieces with spaces between, over
 * `<webhook-id>.<webhook-timestamp>.<body>`, keyed with the secret's base64. */
const STANDARD: Extract<Webhook, { kind: 'hmac' }> = { kind: 'hmac', header: 'webhook-signature', signed: '{timestamp}.{body}',
  encoding: 'base64', part: 'v1', timestamp: { header: 'webhook-timestamp' } };

export function verifyWebhook(webhook: Webhook, request: WebhookRequest, secret: string): boolean {
  const standard = webhook.kind === 'standard';
  const scheme = standard ? STANDARD : webhook;
  const received = request.headers.get(scheme.header);
  if (!received || received.length > MAX_HEADER_BYTES) return false;
  // Compared as digests of equal length, so the token's length leaks nothing.
  if (scheme.kind === 'token') return timingSafeEqual(sha256(received), sha256(secret));
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
  const id = standard ? request.headers.get('webhook-id') || null : '';
  if (id === null) return false;
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
  // An empty key, which anyone can sign with, accepts nothing.
  const key = standard ? Buffer.from(secret.replace(/^whsec_/u, ''), 'base64') : secret;
  if (key.length === 0) return false;
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

/** The answer to a challenge the entry declares (`{ [echo]: <the body's value> }` as JSON), or null. Call it only after
 * `verifyWebhook` accepted the request. */
export function challengeAnswer(webhook: Webhook, request: WebhookRequest): Response | null {
  const challenge = webhook.challenge;
  if (challenge === undefined) return null;
  const body = parseJson(Buffer.from(request.rawBody).toString('utf8'));
  const value = readPath(body, challenge.echo);
  return holds(challenge.when, { status: 200, headers: request.headers, body })
    && (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
    ? Response.json({ [challenge.echo]: value }) : null;
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
