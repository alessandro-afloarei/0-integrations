import { createHmac, generateKeyPairSync, sign, timingSafeEqual, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Webhook } from './catalogue.js';
import { agentmail } from './catalogue/agentmail.js';
import { airtable } from './catalogue/airtable.js';
import { breakcold } from './catalogue/breakcold.js';
import { chatwork } from './catalogue/chatwork.js';
import { close } from './catalogue/close.js';
import { discord } from './catalogue/discord.js';
import { fellow } from './catalogue/fellow.js';
import { fireflies } from './catalogue/fireflies.js';
import { front } from './catalogue/front.js';
import { gitlab } from './catalogue/gitlab.js';
import { google } from './catalogue/google.js';
import { intercom } from './catalogue/intercom.js';
import { mailjet } from './catalogue/mailjet.js';
import { recallai } from './catalogue/recallai.js';
import { nylas } from './catalogue/nylas.js';
import { pipedrive } from './catalogue/pipedrive.js';
import { slack } from './catalogue/slack.js';
import { stripe } from './catalogue/stripe.js';
import { zendesk } from './catalogue/zendesk.js';
import { challengeAnswer, deliveryId, readCappedBody, verifyWebhook, type WebhookRequest } from './webhooks.js';

// The real comparison, watched: the Basic test reads what reached it.
vi.mock('node:crypto', async original => {
  const crypto = await original<typeof import('node:crypto')>();
  return { ...crypto, timingSafeEqual: vi.fn(crypto.timingSafeEqual) };
});

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
  // An empty secret is a key anyone can sign with.
  const unkeyed = createHmac('sha256', '').update(body).digest('hex');
  expect(verifyWebhook(fireflies.webhook, request({ 'x-hub-signature': `sha256=${unkeyed}` }), '')).toBe(false);
});

test('refuses a timestamp that is not plain seconds', () => {
  for (const timestamp of ['+1730000000', '1730000000.5', '1730000000000', '']) {
    expect(verifyWebhook(breakcold.webhook, signed(timestamp), secret)).toBe(false);
  }
});

test('a timestamp in plain seconds keeps its edges on both sides of now', () => {
  for (const [at, verdict] of [[now - 300, true], [now + 300, true], [now - 301, false], [now + 301, false]] as const) {
    expect(verifyWebhook(breakcold.webhook, signed(String(at)), secret)).toBe(verdict);
  }
  // An instant in another unit is no number of seconds near now.
  for (const timestamp of [String(now * 1000), new Date(now * 1000).toISOString()]) {
    expect(verifyWebhook(breakcold.webhook, signed(timestamp), secret)).toBe(false);
  }
});

/** The secret of Zendesk's own verification sample, used as its text, as the sample's `createHmac` takes it. */
const zendeskSecret = 'dGhpc19zZWNyZXRfaXNfZm9yX3Rlc3Rpbmdfb25seQ==';
/** An instant written as Zendesk's header writes one: `2021-03-25T05:09:27Z`. */
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
/** Zendesk's recipe, `base64(HMACSHA256(TIMESTAMP + BODY))`, the timestamp header's text as sent. */
const zendeskSigned = (timestamp: string, rawBody: Uint8Array = body, key = zendeskSecret) => request({
  'x-zendesk-webhook-signature': createHmac('sha256', key).update(timestamp).update(rawBody).digest('base64'),
  'x-zendesk-webhook-signature-timestamp': timestamp }, rawBody);

test("verifies Zendesk's base64 signature of its ISO 8601 timestamp and the body, within five minutes", () => {
  expect(verifyWebhook(zendesk.webhook, zendeskSigned(iso(now * 1000)), zendeskSecret)).toBe(true);
  for (const [offset, verdict] of [[-300_000, true], [300_000, true], [-301_000, false], [301_000, false]] as const) {
    expect(verifyWebhook(zendesk.webhook, zendeskSigned(iso(now * 1000 + offset)), zendeskSecret)).toBe(verdict);
  }
  // A request with no body (a trigger's GET or DELETE) signs the timestamp alone.
  expect(verifyWebhook(zendesk.webhook, zendeskSigned(iso(now * 1000), new Uint8Array()), zendeskSecret)).toBe(true);
  // The same instant with a fraction or an offset, signed as written.
  for (const timestamp of ['2024-10-27T03:33:20.250Z', '2024-10-27T04:33:20+01:00', '2024-10-27T03:33:20+0000']) {
    expect(verifyWebhook(zendesk.webhook, zendeskSigned(timestamp), zendeskSecret)).toBe(true);
  }
  const good = zendeskSigned(iso(now * 1000));
  const changed = Buffer.from(body);
  changed[0] = 1;
  expect(verifyWebhook(zendesk.webhook, { ...good, rawBody: changed }, zendeskSecret)).toBe(false);
  expect(verifyWebhook(zendesk.webhook, good, 'another-secret')).toBe(false);
  expect(verifyWebhook(zendesk.webhook, zendeskSigned(iso(now * 1000), body, 'another-secret'), zendeskSecret)).toBe(false);
  // The timestamp is signed: a fresh one beside the signature of an old one fails.
  const old = zendeskSigned(iso((now - 3600) * 1000));
  old.headers.set('x-zendesk-webhook-signature-timestamp', iso(now * 1000));
  expect(verifyWebhook(zendesk.webhook, old, zendeskSecret)).toBe(false);
});

test.each([
  '2024-10-27', '2024-10-27T03:33:20', '2024-10-27t03:33:20Z', '2024-10-27T03:33:20z', '2024-10-27 03:33:20Z',
  '2021-02-30T00:00:00Z', '2024-10-27T24:00:00Z', '2024-10-27T03:33:60Z', 'Sun, 27 Oct 2024 03:33:20 GMT',
  '1730000000', '1730000000000', '+002024-10-27T03:33:20Z', '02024-10-27T03:33:20Z', '-002024-10-27T03:33:20Z', '',
])('an ISO 8601 timestamp header %j that is no instant with its zone is false, though signed and read loosely as now', timestamp => {
  // Now is where a looser reader (`Date.parse`) puts it, so only the strict reading refuses it.
  const loose = Date.parse(timestamp);
  vi.setSystemTime(Number.isNaN(loose) ? now * 1000 : loose);
  expect(verifyWebhook(zendesk.webhook, zendeskSigned(timestamp), zendeskSecret)).toBe(false);
});

/** An app's own declaration of a timestamp in epoch milliseconds, signed before the body with a `.`. */
const millis: Webhook = { kind: 'hmac', header: 'x-signature', signed: '{timestamp}.{body}', timestamp: { header: 'x-t', unit: 'epochMs' } };
const millisSigned = (timestamp: string, rawBody: Uint8Array = body) =>
  request({ 'x-signature': createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'), 'x-t': timestamp }, rawBody);

test('an `epochMs` timestamp is whole milliseconds within the tolerance of now, to the millisecond', () => {
  expect(verifyWebhook(millis, millisSigned(String(now * 1000)), secret)).toBe(true);
  for (const [offset, verdict] of [[-300_000, true], [300_000, true], [-300_001, false], [300_001, false]] as const) {
    expect(verifyWebhook(millis, millisSigned(String(now * 1000 + offset)), secret)).toBe(verdict);
  }
  expect(verifyWebhook({ ...millis, timestamp: { header: 'x-t', unit: 'epochMs', toleranceSeconds: 60 } }, millisSigned(String(now * 1000 - 60_001)), secret)).toBe(false);
});

test.each(['+1730000000000', '-1730000000000', '1730000000000.0', '1730000000 000', '1730000000\t000', '1.73e12', '0x192c6e0d800', '',
  String(now), String(now * 1_000_000), '9'.repeat(400), iso(now * 1000)])('an `epochMs` timestamp %j is false, though signed', timestamp => {
  expect(verifyWebhook(millis, millisSigned(timestamp), secret)).toBe(false);
});

test('a timestamp and body that sign the same bytes with the boundary moved by one byte are false', () => {
  // Zendesk signs `{timestamp}{body}` with nothing between: the body's first byte joins the timestamp, or the
  // timestamp's last byte the body.
  const stamp = iso(now * 1000);
  const moved = (timestamp: string, rawBody: Buffer) => ({ ...zendeskSigned(stamp), rawBody,
    headers: new Headers({ 'x-zendesk-webhook-signature': zendeskSigned(stamp).headers.get('x-zendesk-webhook-signature') ?? '',
      'x-zendesk-webhook-signature-timestamp': timestamp }) });
  expect(verifyWebhook(zendesk.webhook, moved(stamp, body), zendeskSecret)).toBe(true);
  expect(verifyWebhook(zendesk.webhook, moved(stamp + body.toString().slice(0, 1), body.subarray(1)), zendeskSecret)).toBe(false);
  expect(verifyWebhook(zendesk.webhook, moved(stamp.slice(0, -1), Buffer.concat([Buffer.from('Z'), body])), zendeskSecret)).toBe(false);
  // The same with milliseconds and a body that starts with a digit.
  const joined: Webhook = { ...millis, signed: '{timestamp}{body}' };
  const digits = Buffer.from('1{"event":"created"}');
  const signature = createHmac('sha256', secret).update(String(now * 1000)).update(digits).digest('hex');
  const sent = (timestamp: string, rawBody: Buffer) => request({ 'x-signature': signature, 'x-t': timestamp }, rawBody);
  expect(verifyWebhook(joined, sent(String(now * 1000), digits), secret)).toBe(true);
  expect(verifyWebhook(joined, sent(String(now * 1000) + '1', digits.subarray(1)), secret)).toBe(false);
  expect(verifyWebhook(joined, sent(String(now * 100), Buffer.concat([Buffer.from('0'), digits])), secret)).toBe(false);
});

test('a valid delivery replayed past its tolerance is false, in every unit', () => {
  const deliveries = [[breakcold.webhook, signed(t), secret], [millis, millisSigned(String(now * 1000)), secret],
    [zendesk.webhook, zendeskSigned(iso(now * 1000)), zendeskSecret]] as const;
  for (const [webhook, delivery, key] of deliveries) expect(verifyWebhook(webhook, delivery, key)).toBe(true);
  vi.setSystemTime(now * 1000 + 301_000);
  for (const [webhook, delivery, key] of deliveries) expect(verifyWebhook(webhook, delivery, key)).toBe(false);
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

test("an app's own declaration that does not sign the body, or the timestamp it checks, verifies nothing", () => {
  const hmacOf = (content: string) => createHmac('sha256', secret).update(content).digest('hex');
  const noBody: Webhook = { kind: 'hmac', header: 'signature', signed: '{timestamp}', timestamp: { header: 'x-t' } };
  expect(verifyWebhook(noBody, request({ signature: hmacOf(t), 'x-t': t }), secret)).toBe(false);
  const unsignedTime: Webhook = { kind: 'hmac', header: 'signature', timestamp: { header: 'x-t' } };
  expect(verifyWebhook(unsignedTime, request({ signature: createHmac('sha256', secret).update(body).digest('hex'), 'x-t': t }), secret)).toBe(false);
  const edSigned = (content: Buffer) => sign(null, content, pair.privateKey).toString('hex');
  const edNoBody: Webhook = { kind: 'ed25519', header: 'x-signature-ed25519', signed: '{timestamp}', timestamp: { header: 'x-signature-timestamp' } };
  expect(verifyWebhook(edNoBody, discordSigned(t, edSigned(Buffer.from(t))), publicKey)).toBe(false);
  const edUnsignedTime: Webhook = { kind: 'ed25519', header: 'x-signature-ed25519', timestamp: { header: 'x-signature-timestamp' } };
  expect(verifyWebhook(edUnsignedTime, discordSigned(t, edSigned(body)), publicKey)).toBe(false);
});

test('a name in `signed` that is no placeholder is signed as written, an inherited one (`constructor`) included', () => {
  for (const signed of ['constructor{body}', '{constructor}{body}', 'toString:{body}', '{nope}{body}']) {
    const digest = createHmac('sha256', secret).update(signed.replace('{body}', '')).update(body).digest('hex');
    expect(verifyWebhook({ kind: 'hmac', header: 'signature', signed }, request({ signature: digest }), secret)).toBe(true);
  }
});

test('the signed template covers method, URL and base64', () => {
  const config: Webhook = { kind: 'hmac', header: 'signature', signed: '{method}{url}{body}', encoding: 'base64' };
  const digest = createHmac('sha256', secret).update('POSThttps://app.test/webhook').update(body).digest('base64');
  expect(verifyWebhook(config, request({ signature: digest }), secret)).toBe(true);
});

const t = String(now);
const stripeDigest = (timestamp: string) => createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
/** Stripe's header: `t=<timestamp>` and the `v1` signature of `<timestamp>.<body>`, with any other entries after. */
const stripeSigned = (timestamp: string, extra = '') => request({ 'stripe-signature': `t=${timestamp},v1=${stripeDigest(timestamp)}${extra}` });

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
  // The first `t` is the timestamp: a second one can neither refresh an old one nor sign in its place.
  const old = String(now - 3600);
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${old},t=${t},v1=${stripeDigest(t)}` }), secret)).toBe(false);
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${t},t=${old},v1=${stripeDigest(old)}` }), secret)).toBe(false);
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

test("an app's own entry with `prefix` beside `part` (the table refuses it) compares the prefix inside the piece", () => {
  const config: Webhook = { kind: 'hmac', header: 'signature', part: 'v1', prefix: 'sha256=' };
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  expect(verifyWebhook(config, request({ signature: `v1=sha256=${digest}` }), secret)).toBe(true);
  expect(verifyWebhook(config, request({ signature: `v1=${digest}` }), secret)).toBe(false);
});

/** Discord's key pair: the public key as 64 hex characters, as the Developer Portal shows it. */
const hexKey = (key: KeyObject) => Buffer.from(key.export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex');
const pair = generateKeyPairSync('ed25519');
const publicKey = hexKey(pair.publicKey);
/** Discord's headers: the hex Ed25519 signature of `<timestamp><body>`, and the timestamp. */
function discordSigned(timestamp: string, signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), pair.privateKey).toString('hex')) {
  return request({ 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp });
}

test("verifies Discord's Ed25519 signature over the timestamp and the raw body", () => {
  expect(publicKey).toMatch(/^[0-9a-f]{64}$/u);
  expect(verifyWebhook(discord.webhook, discordSigned(t), publicKey)).toBe(true);
  expect(verifyWebhook(discord.webhook, discordSigned(t), publicKey.toUpperCase())).toBe(true);
  const changed = Buffer.from(body);
  changed[0] = 1;
  expect(verifyWebhook(discord.webhook, { ...discordSigned(t), rawBody: changed }, publicKey)).toBe(false);
  // The timestamp is signed: another one beside the same signature fails.
  const fresh = discordSigned(t).headers.get('x-signature-ed25519') ?? '';
  expect(verifyWebhook(discord.webhook, discordSigned(String(now - 1), fresh), publicKey)).toBe(false);
});

test('an Ed25519 signature covers the body bytes as sent, not valid UTF-8 included', () => {
  const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x80]);
  const signature = sign(null, Buffer.concat([Buffer.from(t), invalidUtf8]), pair.privateKey).toString('hex');
  const req = { ...discordSigned(t, signature), rawBody: invalidUtf8 };
  expect(verifyWebhook(discord.webhook, req, publicKey)).toBe(true);
  // Read as UTF-8 and back, the bytes would change, and so would the signed content.
  expect(verifyWebhook(discord.webhook, { ...req, rawBody: Buffer.from(invalidUtf8.toString('utf8')) }, publicKey)).toBe(false);
});

test('refuses an Ed25519 signature that is altered, short, not hex, or under another key, never throwing', () => {
  const good = discordSigned(t).headers.get('x-signature-ed25519') ?? '';
  const flipped = (parseInt(good.slice(0, 1), 16) ^ 1).toString(16) + good.slice(1);
  const other = hexKey(generateKeyPairSync('ed25519').publicKey);
  // A flipped bit, 127 and 130 characters, a non-hex character; another key, a non-hex key, a short one, none, no point.
  for (const [signature, key] of <[string, string][]>[[flipped, publicKey], [good.slice(1), publicKey], [`${good}00`, publicKey], [`${good.slice(2)}zz`, publicKey],
    [good, other], [good, `${publicKey.slice(2)}zz`], [good, publicKey.slice(2)], [good, ''], [good, '0'.repeat(64)]]) {
    expect(verifyWebhook(discord.webhook, discordSigned(t, signature), key)).toBe(false);
  }
});

test('an Ed25519 webhook keeps the timestamp rule: plain seconds, inside the tolerance, present', () => {
  expect(verifyWebhook(discord.webhook, discordSigned(String(now - 300)), publicKey)).toBe(true);
  expect(verifyWebhook(discord.webhook, discordSigned(String(now - 301)), publicKey)).toBe(false);
  expect(verifyWebhook(discord.webhook, discordSigned(`${t}.0`), publicKey)).toBe(false);
  const signature = discordSigned(t).headers.get('x-signature-ed25519') ?? '';
  expect(verifyWebhook(discord.webhook, request({ 'x-signature-ed25519': signature }), publicKey)).toBe(false);
  expect(verifyWebhook(discord.webhook, request({ 'x-signature-timestamp': t }), publicKey)).toBe(false);
});

test("verifies Google Calendar push's channel token: the exact token, nothing longer, shorter or different", () => {
  const token = 'channel-token-1';
  const push = (value?: string) => request(value === undefined ? {} : { 'x-goog-channel-token': value }, new Uint8Array());
  expect(verifyWebhook(google.webhook, push(token), token)).toBe(true);
  for (const value of [`${token}1`, token.slice(0, -1), `${token.slice(0, -1)}2`, undefined]) {
    expect(verifyWebhook(google.webhook, push(value), token)).toBe(false);
  }
});

/** A Standard Webhooks secret: 24 random-looking bytes, base64 after `whsec_`. */
const standardKey = Buffer.from('standard-webhooks-key-24');
const standardSecret = `whsec_${standardKey.toString('base64')}`;
/** The spec's construction: `v1,` and the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>`. */
const standardSignature = (id: string, timestamp: string, key = standardKey) =>
  `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64')}`;
function standardSigned(signature: string, timestamp = t, id = 'msg_1'): WebhookRequest {
  return request({ 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature });
}

test("verifies a Standard Webhooks signature (GitLab's signing token): any `v1` may match", () => {
  const good = standardSignature('msg_1', t);
  expect(verifyWebhook(gitlab.webhook, standardSigned(good), standardSecret)).toBe(true);
  expect(verifyWebhook(gitlab.webhook, standardSigned(`v1,${Buffer.alloc(32).toString('base64')} ${good}`), standardSecret)).toBe(true);
  // The `whsec_` prefix is optional; the key is its base64 either way.
  expect(verifyWebhook(gitlab.webhook, standardSigned(good), standardKey.toString('base64'))).toBe(true);
});

test('refuses a Standard Webhooks request that is not a fresh `v1` signature of this id, timestamp and body', () => {
  const good = standardSignature('msg_1', t);
  // Another version is ignored, so a `v1a` alone signs nothing.
  expect(verifyWebhook(gitlab.webhook, standardSigned(good.replace('v1,', 'v1a,')), standardSecret)).toBe(false);
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', String(now - 301)), String(now - 301)), standardSecret)).toBe(false);
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', String(now - 300)), String(now - 300)), standardSecret)).toBe(true);
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', `${t}.0`), `${t}.0`), standardSecret)).toBe(false);
  // The id is signed: the same signature under another id fails, and so does a request with none.
  expect(verifyWebhook(gitlab.webhook, standardSigned(good, t, 'msg_2'), standardSecret)).toBe(false);
  expect(verifyWebhook(gitlab.webhook, request({ 'webhook-timestamp': t, 'webhook-signature': good }), standardSecret)).toBe(false);
  const changed = Buffer.from(body);
  changed[0] = 1;
  expect(verifyWebhook(gitlab.webhook, { ...standardSigned(good), rawBody: changed }, standardSecret)).toBe(false);
  // A secret whose base64 decodes to nothing keys nothing, even beside a signature made with an empty key.
  for (const empty of ['whsec_', '', '!!!']) {
    expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', t, Buffer.alloc(0))), empty)).toBe(false);
  }
  // The 8 KiB cap: a list over it is false before it is parsed, though its last signature is good.
  expect(verifyWebhook(gitlab.webhook, standardSigned(`${'v1a,x '.repeat(1400)}${good}`), standardSecret)).toBe(false);
});

/** An `hmac` webhook keyed with the secret's decoding: the hex digest of the body, and the same with base64. */
const decodedHex: Webhook = { kind: 'hmac', header: 'x-signature', secret: 'hex' };
const decodedBase64: Webhook = { kind: 'hmac', header: 'x-signature', secret: 'base64' };
const keyBytes = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const hmacHex = (key: Buffer | string, content: Buffer | string = body) => createHmac('sha256', key).update(content).digest('hex');

test('`secret` keys the HMAC with the hex or base64 decoding of the secret, never its text', () => {
  const hexSecret = keyBytes.toString('hex');
  const base64Secret = keyBytes.toString('base64');
  expect(verifyWebhook(decodedHex, request({ 'x-signature': hmacHex(keyBytes) }), hexSecret)).toBe(true);
  expect(verifyWebhook(decodedHex, request({ 'x-signature': hmacHex(keyBytes) }), hexSecret.toUpperCase())).toBe(true);
  expect(verifyWebhook(decodedBase64, request({ 'x-signature': hmacHex(keyBytes) }), base64Secret)).toBe(true);
  // Signed with the secret's text where the entry decodes it, or with the decoding where it does not: false.
  expect(verifyWebhook(decodedHex, request({ 'x-signature': hmacHex(hexSecret) }), hexSecret)).toBe(false);
  expect(verifyWebhook(decodedBase64, request({ 'x-signature': hmacHex(base64Secret) }), base64Secret)).toBe(false);
  const plain: Webhook = { kind: 'hmac', header: 'x-signature' };
  expect(verifyWebhook(plain, request({ 'x-signature': hmacHex(keyBytes) }), hexSecret)).toBe(false);
  expect(verifyWebhook(plain, request({ 'x-signature': hmacHex(hexSecret) }), hexSecret)).toBe(true);
});

test.each<[string, 'base64' | 'hex']>([
  ['ab$c', 'base64'], ['YWJj ZGVm', 'base64'], [' YWJjZGVm', 'base64'], ['YWJjZGVm\n', 'base64'], ['YR==', 'base64'], ['YR', 'base64'],
  ['-_8-', 'base64'], ['', 'base64'], ['====', 'base64'],
  ['abc', 'hex'], ['0g', 'hex'], ['zz', 'hex'], ['ab cd', 'hex'], ['0x00ff', 'hex'], ['', 'hex'],
])('a %j secret that is no exact %s keys nothing: false, never its loose decoding or its text', (bad, encoding) => {
  const webhook = encoding === 'hex' ? decodedHex : decodedBase64;
  for (const key of [Buffer.from(bad, encoding), Buffer.from(bad)]) {
    expect(verifyWebhook(webhook, request({ 'x-signature': hmacHex(key) }), bad)).toBe(false);
  }
});

test.each(['YQ', 'YQ=', 'YQ==', 'YWI', 'YWI='])('a base64 secret %j with its padding left out or in is its bytes', padded => {
  const key = Buffer.from(padded, 'base64');
  expect(verifyWebhook(decodedBase64, request({ 'x-signature': hmacHex(key) }), padded)).toBe(true);
  expect(verifyWebhook(decodedBase64, request({ 'x-signature': hmacHex(padded) }), padded)).toBe(false);
});

test('a key of only zero bytes is the empty key HMAC pads it to: a delivery signed with the empty key is false', () => {
  const plain: Webhook = { kind: 'hmac', header: 'x-signature' };
  for (const [webhook, zero] of <[Webhook, string][]>[[decodedHex, '00'], [decodedHex, '0'.repeat(64)], [decodedBase64, 'AAAA'], [plain, '\u0000'], [plain, '\u0000'.repeat(32)]]) {
    expect(verifyWebhook(webhook, request({ 'x-signature': hmacHex('') }), zero)).toBe(false);
  }
  const zeroStandard = `whsec_${Buffer.alloc(32).toString('base64')}`;
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', t, Buffer.alloc(0))), zeroStandard)).toBe(false);
});

test('a decoded secret keeps the signature rules: one header, the whole digest, these bytes', () => {
  const hexSecret = keyBytes.toString('hex');
  const good = hmacHex(keyBytes);
  const flipped = (parseInt(good.slice(0, 1), 16) ^ 1).toString(16) + good.slice(1);
  expect(verifyWebhook(decodedHex, request({ 'x-signature': flipped }), hexSecret)).toBe(false);
  expect(verifyWebhook(decodedHex, request({}), hexSecret)).toBe(false);
  // Two signature headers arrive joined (`a, b`): neither alone is the header.
  expect(verifyWebhook(decodedHex, { ...request({}), headers: new Headers([['x-signature', good], ['x-signature', good]]) }, hexSecret)).toBe(false);
  expect(verifyWebhook(decodedHex, request({ 'x-signature': good }, Buffer.from('{"event":"deleted"}')), hexSecret)).toBe(false);
});

test('a Standard Webhooks secret is decoded as strictly, padding optional: loose base64 after `whsec_` is false', () => {
  const loose = [`whsec_${standardKey.toString('base64')} `, `whsec_${standardKey.toString('base64')}\n`, `whsec_${standardKey.toString('base64url')}-`, 'whsec_YR=='];
  for (const secret of loose) {
    for (const key of [Buffer.from(secret.slice(6), 'base64'), Buffer.from(secret.slice(6))]) {
      expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', t, key)), secret)).toBe(false);
    }
  }
  // The specification asks for base64 alone; its reference libraries read an unpadded secret, and so does this one.
  const padded = Buffer.alloc(32, 7);
  expect(padded.toString('base64')).toMatch(/=$/u);
  const unpadded = `whsec_${padded.toString('base64').replace(/=+$/u, '')}`;
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', t, padded)), unpadded)).toBe(true);
});

// The three pages give no secret, body and signature together, so each vector is computed from the page's recipe.
test("verifies Airtable's `X-Airtable-Content-MAC`: `hmac-sha256=` and the hex HMAC of the body, keyed with `macSecretBase64` decoded", () => {
  const macSecretBase64 = keyBytes.toString('base64');
  expect(verifyWebhook(airtable.webhook, request({ 'x-airtable-content-mac': `hmac-sha256=${hmacHex(keyBytes)}` }), macSecretBase64)).toBe(true);
  expect(verifyWebhook(airtable.webhook, request({ 'x-airtable-content-mac': `hmac-sha256=${hmacHex(macSecretBase64)}` }), macSecretBase64)).toBe(false);
  expect(verifyWebhook(airtable.webhook, request({ 'x-airtable-content-mac': hmacHex(keyBytes) }), macSecretBase64)).toBe(false);
});

test("verifies Chatwork's `x-chatworkwebhooksignature`: the base64 HMAC of the body, keyed with the token decoded from base64", () => {
  const token = keyBytes.toString('base64');
  const base64Of = (key: Buffer | string) => createHmac('sha256', key).update(body).digest('base64');
  expect(verifyWebhook(chatwork.webhook, request({ 'x-chatworkwebhooksignature': base64Of(keyBytes) }), token)).toBe(true);
  expect(verifyWebhook(chatwork.webhook, request({ 'x-chatworkwebhooksignature': base64Of(token) }), token)).toBe(false);
  expect(verifyWebhook(chatwork.webhook, request({ 'x-chatworkwebhooksignature': hmacHex(keyBytes) }), token)).toBe(false);
});

/** Close's example `signature_key` (its Webhooks page); the hash is the hex HMAC of `close-sig-timestamp` and the body. */
const closeKey = '058bfb6a3d8cfdc4da7c3be5901b16ae11da982b46a25fb2cd7016e97a140a1c';
const closeSigned = (timestamp: string, signedAt = timestamp, key: Buffer | string = Buffer.from(closeKey, 'hex')) =>
  request({ 'close-sig-hash': hmacHex(key, Buffer.concat([Buffer.from(signedAt), body])), 'close-sig-timestamp': timestamp });

test("verifies Close's `close-sig-hash` over `close-sig-timestamp` and the body, keyed with the hex `signature_key` decoded", () => {
  expect(verifyWebhook(close.webhook, closeSigned(t), closeKey)).toBe(true);
  expect(verifyWebhook(close.webhook, closeSigned(t, t, closeKey), closeKey)).toBe(false);
  expect(verifyWebhook(close.webhook, closeSigned(String(now - 300)), closeKey)).toBe(true);
  expect(verifyWebhook(close.webhook, closeSigned(String(now - 301)), closeKey)).toBe(false);
  expect(verifyWebhook(close.webhook, closeSigned(t, String(now - 3600)), closeKey)).toBe(false);
  expect(verifyWebhook(close.webhook, { ...closeSigned(t), headers: new Headers({ 'close-sig-hash': hmacHex(Buffer.from(closeKey, 'hex')) }) }, closeKey)).toBe(false);
  expect(verifyWebhook(close.webhook, closeSigned(t), closeKey.slice(1))).toBe(false);
});

test('an empty secret accepts nothing, whatever the kind', () => {
  const unkeyed = createHmac('sha256', '').update(`${t}.`).update(body).digest('hex');
  expect(verifyWebhook(stripe.webhook, request({ 'stripe-signature': `t=${t},v1=${unkeyed}` }), '')).toBe(false);
  expect(verifyWebhook(slack.webhook, request({ 'x-slack-signature': `v0=${createHmac('sha256', '').update(`v0:${t}:`).update(body).digest('hex')}`,
    'x-slack-request-timestamp': t }), '')).toBe(false);
  expect(verifyWebhook(discord.webhook, discordSigned(t), '')).toBe(false);
  // A token header is never empty, so an empty channel token matches no request.
  for (const header of ['', ' ', 'x']) expect(verifyWebhook(google.webhook, request({ 'x-goog-channel-token': header }), '')).toBe(false);
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', t, Buffer.alloc(0))), '')).toBe(false);
});

/** A request with this body and no signature. */
const posted = (json: string) => request({}, Buffer.from(json));
/** Slack's `url_verification`, or any body, signed as Slack signs it (with `key`, at `at`). */
const slackSigned = (json: string, key = secret, at = t) => request({ 'x-slack-request-timestamp': at,
  'x-slack-signature': `v0=${createHmac('sha256', key).update(`v0:${at}:${json}`).digest('hex')}` }, Buffer.from(json));
/** Discord's interaction, signed as Discord signs it. */
const discordPing = (json: string) => request({ 'x-signature-timestamp': t,
  'x-signature-ed25519': sign(null, Buffer.from(t + json), pair.privateKey).toString('hex') }, Buffer.from(json));
/** Nylas' verification: a GET to the registered URL with `query`, and no body. */
const nylasGet = (query: string) => ({ method: 'GET', url: `https://app.test/webhook${query}`, headers: new Headers(), rawBody: Buffer.alloc(0) });
const answered = async (answer: Response | null) => (answer === null ? null : { status: answer.status,
  type: answer.headers.get('content-type'), nosniff: answer.headers.get('x-content-type-options'),
  length: answer.headers.get('content-length'), body: await answer.text() });
const asJson = (body: unknown) => ({ status: 200, type: 'application/json', nosniff: null, length: null, body: JSON.stringify(body) });
/** Nylas refuses a chunked answer: a text answer states its length, so an adapter that streams it sends no chunks. */
const asText = (body: string) => ({ status: 200, type: 'text/plain; charset=utf-8', nosniff: 'nosniff', length: String(body.length), body });

test("answers Slack's `url_verification` with its challenge only when it is signed with the app's secret", async () => {
  const challenge = '3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P';
  const json = JSON.stringify({ token: 'Jhj5dZrVaK7ZwHHjRyZWjbDl', challenge, type: 'url_verification' });
  expect(await answered(challengeAnswer(slack.webhook, slackSigned(json), secret))).toEqual(asJson({ challenge }));
  expect(challengeAnswer(slack.webhook, slackSigned(json), 'another-secret')).toBeNull();
  // Verified as every delivery is: a stale timestamp, or the signature of another body replayed, answers nothing.
  expect(challengeAnswer(slack.webhook, slackSigned(json, secret, String(now - 301)), secret)).toBeNull();
  const replayed = slackSigned(JSON.stringify({ type: 'url_verification', challenge: 'other' }));
  expect(challengeAnswer(slack.webhook, { ...replayed, rawBody: Buffer.from(json) }, secret)).toBeNull();
  expect(challengeAnswer(slack.webhook, slackSigned(json, 'another-secret'), secret)).toBeNull();
  expect(challengeAnswer(slack.webhook, posted(json), secret)).toBeNull();
  expect(challengeAnswer(slack.webhook, slackSigned(JSON.stringify({ type: 'event_callback', challenge, event: {} })), secret)).toBeNull();
  expect(challengeAnswer(slack.webhook, slackSigned(JSON.stringify({ type: 'url_verification', challenge: { value: challenge } })), secret)).toBeNull();
});

test("answers Discord's PING with `{ type: 1 }` only under its signature, and no other interaction", async () => {
  expect(await answered(challengeAnswer(discord.webhook, discordPing('{"type":1}'), publicKey))).toEqual(asJson({ type: 1 }));
  // Discord checks the endpoint with invalid signatures: a PING it did not sign is no handshake.
  const forged = discordPing('{"type":1}');
  const good = forged.headers.get('x-signature-ed25519') ?? '';
  forged.headers.set('x-signature-ed25519', (parseInt(good.slice(0, 1), 16) ^ 1).toString(16) + good.slice(1));
  expect(challengeAnswer(discord.webhook, forged, publicKey)).toBeNull();
  expect(challengeAnswer(discord.webhook, posted('{"type":1}'), publicKey)).toBeNull();
  expect(challengeAnswer(discord.webhook, discordPing('{"type":2}'), publicKey)).toBeNull();
});

test("answers Nylas' GET `?challenge=` with the value alone, as text, unsigned", async () => {
  const value = 'bc609b38-c81f-47fb-a275-1d9bd61a968b';
  for (const key of ['', 'any-secret']) expect(await answered(challengeAnswer(nylas.webhook, nylasGet(`?challenge=${value}`), key))).toEqual(asText(value));
  expect(await answered(challengeAnswer(nylas.webhook, nylasGet('?a=1&challenge=abc'), ''))).toEqual(asText('abc'));
  expect(await answered(challengeAnswer(nylas.webhook, { ...nylasGet('?challenge=abc'), url: '/webhook?challenge=abc' }, ''))).toEqual(asText('abc'));
  for (const query of ['', '?', '?challenge=', '?challenge', '?Challenge=abc', '?other=abc', '#challenge=abc', '#x?challenge=abc']) {
    expect(challengeAnswer(nylas.webhook, nylasGet(query), '')).toBeNull();
  }
  // A notification is no handshake: its body is never read for a value.
  expect(challengeAnswer(nylas.webhook, posted('{"challenge":"abc"}'), '')).toBeNull();
  // A query challenge comes with no body: a delivery to a URL carrying `?challenge=` is an event, verified as one.
  const relayed = { ...posted('{"trigger":"message.created"}'), url: 'https://app.test/webhook?challenge=abc' };
  expect(challengeAnswer(nylas.webhook, relayed, '')).toBeNull();
  expect(await answered(challengeAnswer(nylas.webhook, { ...relayed, rawBody: Buffer.alloc(0) }, ''))).toEqual(asText('abc'));
  expect(challengeAnswer(nylas.webhook, { ...nylasGet('?challenge=abc'), rawBody: Buffer.from(' ') }, '')).toBeNull();
});

test('a challenge value is 1 to 512 printable ASCII characters with no space, `<` or `>`, or it is not answered', async () => {
  const slackChallenge = (value: unknown) => slackSigned(JSON.stringify({ type: 'url_verification', challenge: value }));
  for (const value of ['<script>alert(1)</script>', 'a<b', 'a>b', 'a b', 'a\nb', 'a\r\nx-evil: 1', 'a\tb', 'é', 'a\u0000', '', 'x'.repeat(513)]) {
    expect(challengeAnswer(nylas.webhook, nylasGet(`?challenge=${encodeURIComponent(value)}`), '')).toBeNull();
    expect(challengeAnswer(slack.webhook, slackChallenge(value), secret)).toBeNull();
  }
  expect(challengeAnswer(nylas.webhook, nylasGet('?challenge=a+b'), '')).toBeNull();
  const longest = 'x'.repeat(512);
  expect(await answered(challengeAnswer(nylas.webhook, nylasGet(`?challenge=${longest}`), ''))).toEqual(asText(longest));
  const printable = '!"#$%&\'()*+,-./09:;=?@AZ[\\]^_`az{|}~';
  expect(await answered(challengeAnswer(nylas.webhook, nylasGet(`?challenge=${encodeURIComponent(printable)}`), ''))).toEqual(asText(printable));
  expect(await answered(challengeAnswer(slack.webhook, slackChallenge(printable), secret))).toEqual(asJson({ challenge: printable }));
  for (const value of [null, true, {}, [], 1e400]) expect(challengeAnswer(slack.webhook, slackChallenge(value), secret)).toBeNull();
});

test("answers Fellow's `url_verification` on its page's body with the challenge alone, as text, unsigned", async () => {
  const json = '{\n  "type": "url_verification",\n  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P"\n}';
  expect(await answered(challengeAnswer(fellow.webhook, posted(json), ''))).toEqual(asText('3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P'));
  expect(challengeAnswer(fellow.webhook, posted('{"type":"meeting.ended","challenge":"abc"}'), '')).toBeNull();
});

test('a query challenge echoes the query alone, after the request is verified unless it is unsigned', async () => {
  const signed: Webhook = { kind: 'token', header: 'x-token', challenge: { echo: { query: 'challenge' }, text: true } };
  const sent = (headers: Record<string, string>) => ({ ...request(headers, Buffer.alloc(0)), url: 'https://app.test/webhook?challenge=abc' });
  expect(await answered(challengeAnswer(signed, sent({ 'x-token': secret }), secret))).toEqual(asText('abc'));
  expect(challengeAnswer(signed, sent({ 'x-token': 'wrong' }), secret)).toBeNull();
  expect(challengeAnswer(signed, sent({}), secret)).toBeNull();
  const unsigned: Webhook = { ...signed, challenge: { echo: { query: 'challenge' }, text: true, unsigned: true } };
  expect(await answered(challengeAnswer(unsigned, sent({}), ''))).toEqual(asText('abc'));
});

/** Front's validation request: its page's body, `x-front-challenge`, and the base64 HMAC of `<timestamp>:<body>`
 * keyed with the token's text, the timestamp in milliseconds. */
const frontSync = '{"type":"sync","authorization":{"id":"cmp_abc"}}';
function frontSigned(json: string, headers: Record<string, string> = {}, at = String(now * 1000), key = secret): WebhookRequest {
  const signature = createHmac('sha256', key).update(`${at}:`).update(json).digest('base64');
  return request({ 'x-front-signature': signature, 'x-front-request-timestamp': at, ...headers }, Buffer.from(json));
}

test("verifies Front's base64 signature of its millisecond timestamp, a `:` and the body", () => {
  expect(verifyWebhook(front.webhook, frontSigned(body.toString()), secret)).toBe(true);
  expect(verifyWebhook(front.webhook, frontSigned(body.toString(), {}, String(now * 1000 - 300_001)), secret)).toBe(false);
  expect(verifyWebhook(front.webhook, frontSigned(body.toString(), {}, String(now * 1000 + 300_001)), secret)).toBe(false);
  // Seconds where Front writes milliseconds: January 1970, not now.
  expect(verifyWebhook(front.webhook, frontSigned(body.toString(), {}, String(now)), secret)).toBe(false);
  expect(verifyWebhook(front.webhook, frontSigned(body.toString(), {}, 'x', 'another-secret'), secret)).toBe(false);
  expect(verifyWebhook(front.webhook, frontSigned(body.toString()), 'another-secret')).toBe(false);
  const changed = frontSigned(body.toString());
  expect(verifyWebhook(front.webhook, { ...changed, rawBody: Buffer.from('{"event":"createe"}') }, secret)).toBe(false);
});

test("answers Front's validation request with `x-front-challenge` alone, as text, only under its signature", async () => {
  const value = 'b9f4c2a1-random-string';
  expect(await answered(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': value }), secret))).toEqual(asText(value));
  expect(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': value }), 'another-secret')).toBeNull();
  expect(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': value }, String(now * 1000), 'another-secret'), secret)).toBeNull();
  expect(challengeAnswer(front.webhook, frontSigned(frontSync), secret)).toBeNull();
  // An event is no handshake, though it carries the header.
  expect(challengeAnswer(front.webhook, frontSigned('{"type":"inbound_received","authorization":{"id":"cmp_abc"}}', { 'x-front-challenge': value }), secret)).toBeNull();
  expect(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': value }, String(now * 1000 - 301_000)), secret)).toBeNull();
  expect(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': value }, String(now)), secret)).toBeNull();
  for (const hostile of ['a b', 'a<b', 'a>b', 'é', 'x'.repeat(513)]) {
    expect(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': hostile }), secret)).toBeNull();
  }
  // What `Headers` would refuse to hold, read through one that does not.
  const through = (held: string) => {
    const sent = frontSigned(frontSync);
    const headers = { get: (name: string) => (name === 'x-front-challenge' ? held : sent.headers.get(name)),
      has: (name: string) => sent.headers.has(name) } as unknown as Headers;
    return challengeAnswer(front.webhook, { ...sent, headers }, secret);
  };
  expect(await answered(through(value))).toEqual(asText(value));
  for (const hostile of ['a\nb', 'a\r\nx-evil: 1', 'a\u0000', '€']) expect(through(hostile)).toBeNull();
});

test('a value read from a header or a query is never answered as JSON, even by a declaration that leaves out `text`', async () => {
  const value = 'b9f4c2a1';
  const json = { ...front.webhook, challenge: { ...front.webhook.challenge, text: undefined } } as unknown as Webhook;
  expect(challengeAnswer(json, frontSigned(frontSync, { 'x-front-challenge': value }), secret)).toBeNull();
  const query = { kind: 'token', header: 'x-token', challenge: { echo: { query: 'challenge' }, unsigned: true } } as unknown as Webhook;
  expect(challengeAnswer(query, { ...request({}, Buffer.alloc(0)), url: 'https://app.test/webhook?challenge=abc' }, '')).toBeNull();
  expect(await answered(challengeAnswer(front.webhook, frontSigned(frontSync, { 'x-front-challenge': value }), secret))).toEqual(asText(value));
});

test('a text answer is a string: a number at a body path is not answered as text', async () => {
  const text: Webhook = { kind: 'token', header: 'x-token', challenge: { when: { path: 'type', equals: 1 }, echo: 'value', text: true, unsigned: true } };
  expect(challengeAnswer(text, posted('{"type":1,"value":42}'), '')).toBeNull();
  expect(await answered(challengeAnswer(text, posted('{"type":1,"value":"42"}'), ''))).toEqual(asText('42'));
});

test("a body path is answered only when `when` holds: an app's own declaration without one answers nothing", () => {
  // @ts-expect-error A body path needs `when`.
  const loose: Webhook = { kind: 'token', header: 'x-token', challenge: { echo: 'challenge', unsigned: true } };
  expect(challengeAnswer(loose, posted('{"challenge":"abc"}'), '')).toBeNull();
});

test('a challenge answer echoes the one declared value and nothing else of the body', async () => {
  expect(challengeAnswer(slack.webhook, slackSigned('type=url_verification&challenge=x'), secret)).toBeNull();
  expect(challengeAnswer(slack.webhook, slackSigned('\u00ff'), secret)).toBeNull();
  expect(challengeAnswer(fireflies.webhook, posted('{"type":"url_verification","challenge":"x"}'), secret)).toBeNull();
  expect(challengeAnswer(slack.webhook, slackSigned('[{"type":"url_verification","challenge":"x"}]'), secret)).toBeNull();
  expect(await answered(challengeAnswer(slack.webhook, slackSigned('{"type":"url_verification","challenge":"x","token":"secret","extra":{"a":1}}'), secret)))
    .toEqual(asJson({ challenge: 'x' }));
});

test('a Standard Webhooks id holding a `.` is false: the signed content cannot be split again', () => {
  // Signed for id `a`, an old timestamp and the body `<now>.x`; replayed now as id `a.<old>`, timestamp `<now>`, body `x`.
  const old = String(now - 3600);
  const signature = `v1,${createHmac('sha256', standardKey).update(`a.${old}.${t}.x`).digest('base64')}`;
  const replayed = request({ 'webhook-id': `a.${old}`, 'webhook-timestamp': t, 'webhook-signature': signature }, Buffer.from('x'));
  expect(verifyWebhook(gitlab.webhook, replayed, standardSecret)).toBe(false);
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg.1', t), t, 'msg.1'), standardSecret)).toBe(false);
});

/** The same scheme under Svix's names (AgentMail): `svix-id`, `svix-timestamp`, `svix-signature`. */
function svixSigned(signature: string, timestamp = t, id = 'msg_1'): WebhookRequest {
  return request({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature });
}

test("verifies AgentMail's webhook under Svix's header names, and the same request under `webhook-*` names", () => {
  const good = standardSignature('msg_1', t);
  expect(verifyWebhook(agentmail.webhook, svixSigned(good), standardSecret)).toBe(true);
  expect(verifyWebhook(agentmail.webhook, svixSigned(`v1,${Buffer.alloc(32).toString('base64')} ${good}`), standardSecret)).toBe(true);
  expect(verifyWebhook(agentmail.webhook, standardSigned(good), standardSecret)).toBe(true);
  // Svix's published example, signed at its own timestamp.
  vi.setSystemTime(1731705121 * 1000);
  const example = request({ 'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121',
    'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' }, Buffer.from('{"event_type":"ping","data":{"success":true}}'));
  expect(verifyWebhook(agentmail.webhook, example, 'whsec_plJ3nmyCDGBKInavdOK15jsl')).toBe(true);
  expect(verifyWebhook(agentmail.webhook, example, 'whsec_plJ3nmyCDGBKInavdOK15jsm')).toBe(false);
});

test('a request is checked with one set of Standard Webhooks headers whole, never an id or timestamp of the other', () => {
  const good = standardSignature('msg_1', t);
  // No `webhook-signature`: the `svix-*` set is read, and its id or timestamp is missing; `webhook-*` ones do not stand in.
  expect(verifyWebhook(agentmail.webhook, request({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'svix-signature': good }), standardSecret)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, request({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'svix-timestamp': t, 'svix-signature': good }), standardSecret)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, request({ 'svix-id': 'msg_1', 'webhook-timestamp': t, 'svix-signature': good }), standardSecret)).toBe(false);
  // A `webhook-signature` chooses the `webhook-*` set, whatever `svix-*` headers stand beside it.
  expect(verifyWebhook(agentmail.webhook, request({ 'svix-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': good }), standardSecret)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, { ...svixSigned(good), headers: new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': t,
    'svix-signature': good, 'webhook-signature': 'v1,x' }) }, standardSecret)).toBe(false);
});

/** An app's own entry that dedupes on Svix's id header. */
const svixDeduped: Webhook = { kind: 'standard', deliveryId: { header: 'svix-id' } };

test("an entry that dedupes on a header reads only that header's set: a renamed replay is false", () => {
  const good = standardSignature('msg_1', t);
  // A GitLab delivery renamed to Svix's names would verify with no `webhook-id` to dedupe on.
  expect(verifyWebhook(gitlab.webhook, svixSigned(good), standardSecret)).toBe(false);
  expect(verifyWebhook(gitlab.webhook, request({ 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': good, 'webhook-id': 'msg_2' }), standardSecret)).toBe(false);
  expect(verifyWebhook(svixDeduped, standardSigned(good), standardSecret)).toBe(false);
  expect(verifyWebhook(svixDeduped, request({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': good, 'svix-id': 'msg_2' }), standardSecret)).toBe(false);
  // A header in neither set verifies nothing.
  const elsewhere: Webhook = { kind: 'standard', deliveryId: { header: 'x-delivery-id' } };
  expect(verifyWebhook(elsewhere, standardSigned(good), standardSecret)).toBe(false);
  expect(verifyWebhook(elsewhere, svixSigned(good), standardSecret)).toBe(false);
  // Each reads its own set, the other set's headers beside it or not, and dedupes on the id that was signed.
  const both = request({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': good, 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': good });
  expect(verifyWebhook(gitlab.webhook, standardSigned(good), standardSecret)).toBe(true);
  expect(verifyWebhook(gitlab.webhook, both, standardSecret)).toBe(true);
  expect(deliveryId(gitlab.webhook, both)).toBe('msg_1');
  expect(verifyWebhook(svixDeduped, svixSigned(good), standardSecret)).toBe(true);
  expect(deliveryId(svixDeduped, svixSigned(good))).toBe('msg_1');
});

test('an entry with a body id or none accepts either clean set, and both sets signed alike', () => {
  const good = standardSignature('msg_1', t);
  const both = request({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': good, 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': good });
  for (const webhook of [agentmail.webhook, recallai.webhook]) {
    for (const delivery of [standardSigned(good), svixSigned(good), both]) expect(verifyWebhook(webhook, delivery, standardSecret)).toBe(true);
  }
});

test('refuses a Svix-named request that is stale, altered or signed for another id', () => {
  expect(verifyWebhook(agentmail.webhook, svixSigned(standardSignature('msg_1', String(now - 301)), String(now - 301)), standardSecret)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, svixSigned(standardSignature('msg_1', String(now - 300)), String(now - 300)), standardSecret)).toBe(true);
  expect(verifyWebhook(agentmail.webhook, svixSigned(standardSignature('msg_1', t), t, 'msg_2'), standardSecret)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, svixSigned(standardSignature('msg.1', t), t, 'msg.1'), standardSecret)).toBe(false);
  const changed = Buffer.from(body);
  changed[0] = 1;
  expect(verifyWebhook(agentmail.webhook, { ...svixSigned(standardSignature('msg_1', t)), rawBody: changed }, standardSecret)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, svixSigned(standardSignature('msg_1', t)), `whsec_${Buffer.from('another-key').toString('base64')}`)).toBe(false);
  expect(verifyWebhook(agentmail.webhook, svixSigned(`${'v1a,x '.repeat(1400)}${standardSignature('msg_1', t)}`), standardSecret)).toBe(false);
});

test('deliveryId reads the declared header or the body paths', () => {
  expect(deliveryId(agentmail.webhook, request({ 'svix-id': 'msg_1' }, Buffer.from('{"event_type":"message.received","event_id":"e1"}')))).toBe('e1');
  expect(deliveryId(gitlab.webhook, standardSigned(standardSignature('msg_1', t)))).toBe('msg_1');
  expect(deliveryId(stripe.webhook, request({}, Buffer.from('{"id":"evt_1","type":"balance.available"}')))).toBe('evt_1');
  expect(deliveryId(breakcold.webhook, request({ 'x-webhook-delivery-id': 'd1' }))).toBe('d1');
  expect(deliveryId(breakcold.webhook, request({}))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"meeting.transcribed","meeting_id":"m1"}')))).toBe('meeting.transcribed:m1');
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"x"}')))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"","meeting_id":"m"}')))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('not json')))).toBeNull();
});

test("Pipedrive dedupes a webhooks v2 delivery on its event's id, and gives a v1 delivery, whose `meta.id` is the object's, none", () => {
  // The guides' examples: v2's `meta` names its `version` and the event's `id`; v1's `meta.id` is the deal's.
  const v2 = (id: string) => request({}, Buffer.from(JSON.stringify({ meta: { action: 'change', entity: 'deal', entity_id: '42', id,
    version: '2.0', attempt: 1 }, data: { id: 42 } })));
  const v1 = (title: string) => request({}, Buffer.from(JSON.stringify({ v: 1, meta: { v: 1, action: 'updated', object: 'deal', id: 42,
    webhook_id: 7 }, current: { id: 42, title }, event: 'updated.deal' })));
  expect([deliveryId(pipedrive.webhook, v1('first')), deliveryId(pipedrive.webhook, v1('second'))]).toEqual([null, null]);
  const [one, two] = [deliveryId(pipedrive.webhook, v2('a3f1c2d4-0000-4000-8000-000000000001')),
    deliveryId(pipedrive.webhook, v2('a3f1c2d4-0000-4000-8000-000000000002'))];
  expect(one).not.toBeNull();
  expect(two).not.toBeNull();
  expect(one).not.toBe(two);
  expect(deliveryId(pipedrive.webhook, v2('a3f1c2d4-0000-4000-8000-000000000001'))).toBe(one);
});

/** A delivery carrying this `authorization` header, as Mailjet sends the user and password of the URL it calls. */
const basic = (authorization?: string) => request(authorization === undefined ? {} : { authorization });

test("verifies Mailjet's Basic credentials: the scheme in any case, one space, the exact base64 of `user:password`", () => {
  expect(verifyWebhook(mailjet.webhook, basic('Basic dXNlcjpwYXNz'), 'user:pass')).toBe(true);
  expect(verifyWebhook(mailjet.webhook, basic('basic dXNlcjpwYXNz'), 'user:pass')).toBe(true);
  expect(verifyWebhook(mailjet.webhook, basic('BASIC dXNlcjpwYXNz'), 'user:pass')).toBe(true);
  // `user:pas` encodes with one `=`, which the header must keep.
  expect(verifyWebhook(mailjet.webhook, basic('Basic dXNlcjpwYXM='), 'user:pas')).toBe(true);
  expect(verifyWebhook(mailjet.webhook, basic('Basic dXNlcjpwYXM'), 'user:pas')).toBe(false);
  // The password runs from the first `:`, so it may hold one; the secret's UTF-8 bytes are encoded.
  expect(verifyWebhook(mailjet.webhook, basic(`Basic ${Buffer.from('user:pa:ss').toString('base64')}`), 'user:pa:ss')).toBe(true);
  expect(verifyWebhook(mailjet.webhook, basic(`Basic ${Buffer.from('usér:pâss').toString('base64')}`), 'usér:pâss')).toBe(true);
  expect(verifyWebhook(mailjet.webhook, basic(`Basic ${Buffer.from('usér:pâss', 'latin1').toString('base64')}`), 'usér:pâss')).toBe(false);
  for (const header of ['Basic  dXNlcjpwYXNz', 'BasicdXNlcjpwYXNz', 'Bearer dXNlcjpwYXNz', 'dXNlcjpwYXNz', 'Basic dXNlcjpwYXNz,',
    `Basic ${Buffer.from('user:wrong').toString('base64')}`, `Basic ${Buffer.from('other:pass').toString('base64')}`, undefined]) {
    expect(verifyWebhook(mailjet.webhook, basic(header), 'user:pass')).toBe(false);
  }
});

test('a Basic secret with no `:`, or an empty password, keys nothing', () => {
  for (const key of ['user', 'user:', '', ':']) {
    expect(verifyWebhook(mailjet.webhook, basic(`Basic ${Buffer.from(key).toString('base64')}`), key)).toBe(false);
  }
  // An empty user is the provider's to refuse: the password alone still keys the check.
  expect(verifyWebhook(mailjet.webhook, basic(`Basic ${Buffer.from(':pass').toString('base64')}`), ':pass')).toBe(true);
});

test('a Basic header over 8 KiB is false before it is read, and the secret in clear is no credential', () => {
  const long = `user:${'p'.repeat(7 * 1024)}`;
  expect(verifyWebhook(mailjet.webhook, basic(`Basic ${Buffer.from(long).toString('base64')}`), long)).toBe(false);
  expect(verifyWebhook(mailjet.webhook, basic('Basic user:pass'), 'user:pass')).toBe(false);
  expect(verifyWebhook(mailjet.webhook, basic('user:pass'), 'user:pass')).toBe(false);
});

test('a Basic header is compared as a digest: every length reaches the comparison as 32 bytes', () => {
  const compared = vi.mocked(timingSafeEqual);
  for (const header of ['Basic d', 'Basic dXNlcjpwYXNz', `Basic ${'A'.repeat(4096)}`]) {
    compared.mockClear();
    verifyWebhook(mailjet.webhook, basic(header), 'user:pass');
    expect(compared.mock.calls.map(([a, b]) => [a.byteLength, b.byteLength])).toEqual([[32, 32]]);
  }
});
