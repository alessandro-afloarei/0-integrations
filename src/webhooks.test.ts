import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Webhook } from './catalogue.js';
import { breakcold } from './catalogue/breakcold.js';
import { fireflies } from './catalogue/fireflies.js';
import { intercom } from './catalogue/intercom.js';
import { stripe } from './catalogue/stripe.js';
import { deliveryId, readCappedBody, verifyWebhook, type WebhookRequest } from './webhooks.js';

const now = 1730000000;
const secret = 'webhook-secret';
const body = Buffer.from('{"event":"created"}');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now * 1000); });
afterEach(() => vi.useRealTimers());

function request(headers: Record<string, string>, rawBody: Uint8Array = body): WebhookRequest {
  return { method: 'POST', url: 'https://app.test/webhook', headers: new Headers(headers), rawBody };
}
function signed(timestamp: string, rawBody = body): WebhookRequest {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return request({ 'x-webhook-timestamp': timestamp, 'x-webhook-signature': `sha256=${digest}` }, rawBody);
}

test("verifies Breakcold's signature", () => {
  const req = signed(String(now));
  expect(verifyWebhook(breakcold.webhook, req, secret)).toBe(true);
  const changed = Buffer.from(body);
  changed[0] = 1;
  expect(verifyWebhook(breakcold.webhook, { ...req, rawBody: changed }, secret)).toBe(false);
  expect(verifyWebhook(breakcold.webhook, signed(String(now - 301)), secret)).toBe(false);
  expect(verifyWebhook(breakcold.webhook, signed(String(now - 300)), secret)).toBe(true);
});

test("verifies Fireflies' signature", () => {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  expect(verifyWebhook(fireflies.webhook, request({ 'x-hub-signature': `sha256=${digest}` }), secret)).toBe(true);
  expect(verifyWebhook(fireflies.webhook, request({}), secret)).toBe(false);
});

test('refuses a timestamp that is not plain seconds', () => {
  for (const timestamp of ['+1730000000', '1730000000.5', '1730000000000', '']) {
    expect(verifyWebhook(breakcold.webhook, signed(timestamp), secret)).toBe(false);
  }
});

test('a signature of another length is false, not a throw', () => {
  expect(verifyWebhook(fireflies.webhook, request({ 'x-hub-signature': 'sha256=ab' }), secret)).toBe(false);
});

test('signs the body bytes as sent', () => {
  const invalidUtf8 = Buffer.from([0xff, 0xfe]);
  const digest = createHmac('sha256', secret).update(invalidUtf8).digest('hex');
  expect(verifyWebhook(fireflies.webhook, request({ 'x-hub-signature': `sha256=${digest}` }, invalidUtf8), secret)).toBe(true);
});

test('readCappedBody keeps the cap', async () => {
  const make = (bytes: number) => new Request('https://app.test', { method: 'POST', body: new Uint8Array(bytes) });
  expect(await readCappedBody(make(1_048_577), 1_048_576)).toBeNull();
  expect((await readCappedBody(make(1_048_576), 1_048_576))?.length).toBe(1_048_576);
  expect((await readCappedBody(new Request('https://app.test'), 1_048_576))?.length).toBe(0);
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2)); }, cancel });
  const req = new Request('https://app.test', { method: 'POST', body: stream, duplex: 'half' });
  expect(await readCappedBody(req, 1)).toBeNull();
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('the signed template covers method, URL and base64', () => {
  const config: Webhook = { kind: 'hmac', header: 'signature', signed: '{method}{url}{body}', encoding: 'base64' };
  const digest = createHmac('sha256', secret).update('POSThttps://app.test/webhook').update(body).digest('base64');
  expect(verifyWebhook(config, request({ signature: digest }), secret)).toBe(true);
});

/** Stripe's header: `t=<timestamp>` and each `v1` signature of `<timestamp>.<body>`, with any other entries after. */
function stripeSigned(timestamp: string, extra = '', rawBody: Uint8Array = body): WebhookRequest {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return request({ 'stripe-signature': `t=${timestamp},v1=${digest}${extra}` }, rawBody);
}
const t = String(now);
const stripeDigest = (timestamp: string) => createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');

test("verifies Stripe's `t=…,v1=…` header", () => {
  expect(verifyWebhook(stripe.webhook, stripeSigned(t), secret)).toBe(true);
  // While a secret rolls, one signature per secret: any `v1` may match.
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${t},v1=${'0'.repeat(64)},v1=${stripeDigest(t)}` }), secret)).toBe(true);
  // Unknown entries (debug metadata) are ignored, whatever their order.
  expect(verifyWebhook(stripe.webhook, stripeSigned(t, ',secret=whsec_x,payload=ab'), secret)).toBe(true);
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `v0=x,t=${t},destination=we_1,v1=${stripeDigest(t)}` }), secret)).toBe(true);
});

test("refuses a Stripe header that is not a fresh `v1` signature of this body", () => {
  // Only `v1` is a signature: a `v0` is a downgrade.
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${t},v0=${stripeDigest(t)}` }), secret)).toBe(false);
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `v1=${stripeDigest(t)}` }), secret)).toBe(false);
  expect(verifyWebhook(stripe.webhook, stripeSigned(String(now - 301)), secret)).toBe(false);
  expect(verifyWebhook(stripe.webhook, stripeSigned(String(now - 300)), secret)).toBe(true);
  const changed = Buffer.from(body);
  changed[0] = 1;
  expect(verifyWebhook(stripe.webhook, { ...stripeSigned(t), rawBody: changed }, secret)).toBe(false);
  // A piece with no `=` names nothing: `v1<digest>` is not `v1=<digest>`.
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${t},v1${stripeDigest(t)}` }), secret)).toBe(false);
  // The signed timestamp is the one checked: a fresh `t` beside a signature of an old one fails.
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${t},v1=${stripeDigest(String(now - 3600))}` }), secret)).toBe(false);
});

test('a signature header over 8 KiB is false before it is parsed', () => {
  // The unknown entry is ignored, so only the cap refuses it; one just under passes.
  expect(verifyWebhook(stripe.webhook, stripeSigned(t, `,payload=${'a'.repeat(9 * 1024)}`), secret)).toBe(false);
  const under = 8 * 1024 - `t=${t},v1=${stripeDigest(t)},payload=`.length;
  expect(verifyWebhook(stripe.webhook, stripeSigned(t, `,payload=${'a'.repeat(under)}`), secret)).toBe(true);
});

test("verifies Intercom's SHA-1 signature", () => {
  const sha1 = createHmac('sha1', secret).update(body).digest('hex');
  const sha256 = createHmac('sha256', secret).update(body).digest('hex');
  expect(verifyWebhook(intercom.webhook, request({ 'x-hub-signature': `sha1=${sha1}` }), secret)).toBe(true);
  expect(verifyWebhook(intercom.webhook, request({ 'x-hub-signature': `sha1=${sha256}` }), secret)).toBe(false);
  expect(verifyWebhook(intercom.webhook, request({ 'x-hub-signature': sha1 }), secret)).toBe(false);
});

test('with `part`, the comparison ignores `prefix`', () => {
  const config: Webhook = { kind: 'hmac', header: 'signature', part: 'v1', prefix: 'sha256=' };
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  expect(verifyWebhook(config, request({ signature: `v1=${digest}` }), secret)).toBe(true);
  expect(verifyWebhook(config, request({ signature: `v1=sha256=${digest}` }), secret)).toBe(false);
});

test('deliveryId reads the declared header or the body paths', () => {
  expect(deliveryId(stripe.webhook, request({}, Buffer.from('{"id":"evt_1","type":"balance.available"}')))).toBe('evt_1');
  expect(deliveryId(breakcold.webhook, request({ 'x-webhook-delivery-id': 'd1' }))).toBe('d1');
  expect(deliveryId(breakcold.webhook, request({}))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"meeting.transcribed","meeting_id":"m1"}')))).toBe('meeting.transcribed:m1');
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"x"}')))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"","meeting_id":"m"}')))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('not json')))).toBeNull();
});
