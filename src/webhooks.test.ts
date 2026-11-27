import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Webhook } from './catalogue.js';
import { airtable } from './catalogue/airtable.js';
import { breakcold } from './catalogue/breakcold.js';
import { chatwork } from './catalogue/chatwork.js';
import { close } from './catalogue/close.js';
import { discord } from './catalogue/discord.js';
import { fireflies } from './catalogue/fireflies.js';
import { gitlab } from './catalogue/gitlab.js';
import { google } from './catalogue/google.js';
import { intercom } from './catalogue/intercom.js';
import { slack } from './catalogue/slack.js';
import { stripe } from './catalogue/stripe.js';
import { challengeAnswer, deliveryId, readCappedBody, verifyWebhook, type WebhookRequest } from './webhooks.js';

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
  ['ab$c', 'base64'], ['YWJj ZGVm', 'base64'], [' YWJjZGVm', 'base64'], ['YWJjZGVm\n', 'base64'], ['YWI', 'base64'], ['YWI==', 'base64'],
  ['-_8-', 'base64'], ['YQ=', 'base64'], ['', 'base64'], ['====', 'base64'],
  ['abc', 'hex'], ['0g', 'hex'], ['zz', 'hex'], ['ab cd', 'hex'], ['0x00ff', 'hex'], ['', 'hex'],
])('a %j secret that is no exact %s keys nothing: false, never its loose decoding or its text', (bad, encoding) => {
  const webhook = encoding === 'hex' ? decodedHex : decodedBase64;
  for (const key of [Buffer.from(bad, encoding), Buffer.from(bad)]) {
    expect(verifyWebhook(webhook, request({ 'x-signature': hmacHex(key) }), bad)).toBe(false);
  }
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

test('a Standard Webhooks secret is decoded as strictly: loose base64 after `whsec_` is false', () => {
  for (const loose of [`whsec_${standardKey.toString('base64')} `, `whsec_${standardKey.toString('base64url')}-`, `whsec_${standardKey.toString('base64').slice(0, -1)}`]) {
    expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg_1', t, Buffer.from(loose.slice(6), 'base64'))), loose)).toBe(false);
  }
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

/** A request with this JSON body: `challengeAnswer` runs after `verifyWebhook`, so no signature is needed here. */
const posted = (json: string) => request({}, Buffer.from(json));
const answered = async (answer: Response | null) => (answer === null ? null
  : { status: answer.status, type: answer.headers.get('content-type'), body: await answer.json() });

test("answers Slack's `url_verification` with its challenge, and nothing else", async () => {
  const challenge = '3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P';
  // A signed `url_verification` passes `verifyWebhook` first, as an app calls them.
  const json = JSON.stringify({ token: 'Jhj5dZrVaK7ZwHHjRyZWjbDl', challenge, type: 'url_verification' });
  const digest = createHmac('sha256', secret).update(`v0:${t}:${json}`).digest('hex');
  const verification = request({ 'x-slack-signature': `v0=${digest}`, 'x-slack-request-timestamp': t }, Buffer.from(json));
  expect(verifyWebhook(slack.webhook, verification, secret)).toBe(true);
  expect(await answered(challengeAnswer(slack.webhook, verification)))
    .toEqual({ status: 200, type: 'application/json', body: { challenge } });
  expect(challengeAnswer(slack.webhook, posted(JSON.stringify({ type: 'event_callback', challenge, event: {} })))).toBeNull();
  expect(challengeAnswer(slack.webhook, posted(JSON.stringify({ type: 'url_verification', challenge: { value: challenge } })))).toBeNull();
});

test("answers Discord's PING with `{ type: 1 }`, and no other interaction", async () => {
  expect(await answered(challengeAnswer(discord.webhook, posted('{"type":1}')))).toEqual({ status: 200, type: 'application/json', body: { type: 1 } });
  expect(challengeAnswer(discord.webhook, posted('{"type":2}'))).toBeNull();
});

test('a challenge answer echoes the one declared value and nothing else of the body', async () => {
  expect(challengeAnswer(slack.webhook, posted('type=url_verification&challenge=x'))).toBeNull();
  expect(challengeAnswer(slack.webhook, request({}, Buffer.from([0xff, 0xfe])))).toBeNull();
  expect(challengeAnswer(fireflies.webhook, posted('{"type":"url_verification","challenge":"x"}'))).toBeNull();
  expect(challengeAnswer(slack.webhook, posted('[{"type":"url_verification","challenge":"x"}]'))).toBeNull();
  expect(challengeAnswer(slack.webhook, posted('{"type":"url_verification","challenge":null}'))).toBeNull();
  expect(await answered(challengeAnswer(slack.webhook, posted('{"type":"url_verification","challenge":"x","token":"secret","extra":{"a":1}}'))))
    .toEqual({ status: 200, type: 'application/json', body: { challenge: 'x' } });
});

test('a Standard Webhooks id holding a `.` is false: the signed content cannot be split again', () => {
  // Signed for id `a`, an old timestamp and the body `<now>.x`; replayed now as id `a.<old>`, timestamp `<now>`, body `x`.
  const old = String(now - 3600);
  const signature = `v1,${createHmac('sha256', standardKey).update(`a.${old}.${t}.x`).digest('base64')}`;
  const replayed = request({ 'webhook-id': `a.${old}`, 'webhook-timestamp': t, 'webhook-signature': signature }, Buffer.from('x'));
  expect(verifyWebhook(gitlab.webhook, replayed, standardSecret)).toBe(false);
  expect(verifyWebhook(gitlab.webhook, standardSigned(standardSignature('msg.1', t), t, 'msg.1'), standardSecret)).toBe(false);
});

test('deliveryId reads the declared header or the body paths', () => {
  expect(deliveryId(gitlab.webhook, standardSigned(standardSignature('msg_1', t)))).toBe('msg_1');
  expect(deliveryId(stripe.webhook, request({}, Buffer.from('{"id":"evt_1","type":"balance.available"}')))).toBe('evt_1');
  expect(deliveryId(breakcold.webhook, request({ 'x-webhook-delivery-id': 'd1' }))).toBe('d1');
  expect(deliveryId(breakcold.webhook, request({}))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"meeting.transcribed","meeting_id":"m1"}')))).toBe('meeting.transcribed:m1');
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"x"}')))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('{"event":"","meeting_id":"m"}')))).toBeNull();
  expect(deliveryId(fireflies.webhook, request({}, Buffer.from('not json')))).toBeNull();
});
