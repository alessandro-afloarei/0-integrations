import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { Webhook } from './catalogue.js';
import { parseJson, readPath } from './rules.js';

export type WebhookRequest = { method: string; url: string; headers: Headers; rawBody: Uint8Array };

/** A signature header longer than this is refused before it is parsed. */
const MAX_HEADER_BYTES = 8 * 1024;

export function verifyWebhook(webhook: Webhook, request: WebhookRequest, secret: string): boolean {
  const received = request.headers.get(webhook.header);
  if (!received || received.length > MAX_HEADER_BYTES) return false;
  const part = webhook.kind === 'hmac' ? webhook.part : undefined;
  // With `part`, the header is `name=value` pieces split on `,`, each on its first `=`; a piece with no `=` names nothing.
  const pieces = part === undefined ? [] : received.split(',').flatMap(piece => {
    const at = piece.indexOf('=');
    return at < 0 ? [] : [{ name: piece.slice(0, at), value: piece.slice(at + 1) }];
  });
  const named = (name: string) => pieces.filter(piece => piece.name === name).map(piece => piece.value);
  const stamp = webhook.timestamp;
  const timestamp = stamp === undefined ? '' : 'part' in stamp ? named(stamp.part)[0] ?? '' : request.headers.get(stamp.header) ?? '';
  if (stamp) {
    if (!/^\d+$/.test(timestamp)) return false;
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > (stamp.toleranceSeconds ?? 300)) return false;
  }
  const substitutions: Record<string, string | Uint8Array> = {
    '{body}': request.rawBody, '{timestamp}': timestamp, '{method}': request.method, '{url}': request.url,
  };
  const content = Buffer.concat((webhook.signed ?? '{body}').split(/(\{body\}|\{timestamp\}|\{method\}|\{url\})/)
    .map(piece => Buffer.from(substitutions[piece] ?? piece)));
  if (webhook.kind === 'ed25519') {
    // The public key is 32 bytes and the signature 64, both hex; anything else, or a key that is no point, is false.
    if (!/^[0-9a-f]{128}$/iu.test(received) || !/^[0-9a-f]{64}$/iu.test(secret)) return false;
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(secret, 'hex').toString('base64url') }, format: 'jwk' });
      return verify(null, content, key, Buffer.from(received, 'hex'));
    } catch {
      return false;
    }
  }
  const hmac = createHmac(webhook.hash ?? 'sha256', secret).update(content);
  // A part's value is the signature alone: `prefix` is not compared there.
  const expected = Buffer.from((part === undefined ? webhook.prefix ?? '' : '') + hmac.digest(webhook.encoding ?? 'hex'));
  return (part === undefined ? [received] : named(part)).some(candidate => {
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
