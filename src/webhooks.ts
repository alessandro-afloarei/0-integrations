import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { Webhook } from './catalogue.js';
import { parseJson, readPath } from './rules.js';

export type WebhookRequest = { method: string; url: string; headers: Headers; rawBody: Uint8Array };

export function verifyWebhook(webhook: Webhook, request: WebhookRequest, secret: string): boolean {
  const timestamp = webhook.timestamp ? request.headers.get(webhook.timestamp.header) ?? '' : '';
  if (webhook.timestamp) {
    if (!/^\d+$/.test(timestamp)) return false;
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > (webhook.timestamp.toleranceSeconds ?? 300)) return false;
  }
  const received = request.headers.get(webhook.header);
  if (!received) return false;
  const hmac = createHmac('sha256', secret);
  const substitutions: Record<string, string | Uint8Array> = {
    '{body}': request.rawBody, '{timestamp}': timestamp, '{method}': request.method, '{url}': request.url,
  };
  for (const part of (webhook.signed ?? '{body}').split(/(\{body\}|\{timestamp\}|\{method\}|\{url\})/)) hmac.update(substitutions[part] ?? part);
  const expected = Buffer.from((webhook.prefix ?? '') + hmac.digest(webhook.encoding ?? 'hex'));
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
