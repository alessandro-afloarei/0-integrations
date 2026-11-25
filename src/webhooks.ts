import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { HmacScheme } from './providers.js';

export type WebhookRequest = { method: string; url: string; headers: Headers; rawBody: Uint8Array };

export function verifyWebhook(scheme: HmacScheme, request: WebhookRequest, secret: string): boolean {
  const timestamp = scheme.timestamp ? request.headers.get(scheme.timestamp.header) ?? '' : '';
  if (scheme.timestamp) {
    if (!/^\d+$/.test(timestamp)) return false;
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > scheme.timestamp.toleranceSeconds) return false;
  }
  const received = request.headers.get(scheme.signatureHeader);
  if (!received) return false;
  const hmac = createHmac('sha256', secret);
  const substitutions: Record<string, string | Uint8Array> = {
    '{body}': request.rawBody, '{timestamp}': timestamp, '{method}': request.method, '{url}': request.url,
  };
  for (const part of scheme.signed.split(/(\{body\}|\{timestamp\}|\{method\}|\{url\})/)) hmac.update(substitutions[part] ?? part);
  const expected = Buffer.from(scheme.prefix + hmac.digest(scheme.encoding));
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
