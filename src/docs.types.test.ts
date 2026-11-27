import { expect, expectTypeOf, test } from 'vitest';
import { defineProvider, signInWith, type Entry, type Values, type Webhook } from './catalogue.js';
import { attio } from './catalogue/attio.js';
import { breakcold } from './catalogue/breakcold.js';
import { close } from './catalogue/close.js';
import { stripe } from './catalogue/stripe.js';
import { discord } from './catalogue/discord.js';
import { slack } from './catalogue/slack.js';
import { google } from './catalogue/google.js';
import { hubspot } from './catalogue/hubspot.js';
import { linear } from './catalogue/linear.js';
import { mailjet } from './catalogue/mailjet.js';
import { mattermost } from './catalogue/mattermost.js';
import { notion } from './catalogue/notion.js';
import { nylas } from './catalogue/nylas.js';
import { aircall } from './catalogue/aircall.js';
import { front } from './catalogue/front.js';
import { gitlab } from './catalogue/gitlab.js';
import { metabase } from './catalogue/metabase.js';
import { trello } from './catalogue/trello.js';
import { zendesk } from './catalogue/zendesk.js';
import { zoom } from './catalogue/zoom.js';
import { client } from './client.js';
import { finishConnect, startConnect } from './connect.js';
import { accessToken, type WithLock } from './credentials.js';
import { fakeHubSpot, type HubSpotFakeData } from './hubspot/fake.js';
import { refreshGrant, revokeGrant, tokenSource, type OAuthClient } from './oauth.js';
import { fakeFetch, fakeProvider } from './testing.js';
import type { SecretStore, Vault } from './vault.js';
import { challengeAnswer, deliveryId, readCappedBody, verifyWebhook } from './webhooks.js';

// Every code example of README.md and docs/, as written, each in its own function. An import of
// `0-integrations/<subpath>` is the source file that subpath publishes (src/exports.test.ts holds the map). The
// parameters are what an example leaves to the app; a `return` keeps what it only shows. Never called: the types are the test.

async function readmeConnectKey(apiKey: string) {
  const key = signInWith(attio, 'key'); // Attio lists OAuth 2 first; this is its API key
  const { fields } = await startConnect(key); // the form to draw: one secret field, "API key"
  const { secret, account } = await finishConnect(key, { secret: { apiKey }, fetch });
  expectTypeOf(account).toEqualTypeOf<{ id: string; name: string }>();
  return [fields, secret];
}

async function readmeConnectOAuth(oauthClient: OAuthClient, redirectUri: string, state: string, code: string,
  codeVerifier: string | undefined, report: (error: unknown) => void) {
  // Send the browser to `start.url`; keep `state`, `start.codeVerifier`, and `start.values` when the entry has plain
  // fields, on the server.
  const start = await startConnect(google, { clientId: oauthClient.clientId, redirectUri, state });

  // In the callback, once the state matches, with the verifier kept at the start:
  const { secret, account } = await finishConnect(google, {
    client: oauthClient, code, redirectUri, codeVerifier, fetch, onRevokeFailed: error => { report(error); },
  });
  expectTypeOf(account).toEqualTypeOf<{ id: string; name: string }>();
  return [start, secret];
}

// README.md › Call a provider, and the first example of docs/modules/client.md.
async function readmeCall(apiKey: string, pageId: string) {
  const api = client(notion, { token: apiKey });
  const page = await api.pages.markdown({ pageId }); // typed: { markdown: string; truncated: boolean }
  const me = await api.json('/users/me'); // raw: authenticated, classified errors
  expectTypeOf(page).branded.toEqualTypeOf<{ markdown: string; truncated: boolean }>();
  return me;
}

// docs/modules/catalogue.md, and the design's entry (`export` dropped: this is a function body).
function catalogueEntry() {
  const attio = defineProvider({
    id: 'attio', name: 'Attio', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
    auth: [
      { kind: 'oauth2', authorizeUrl: 'https://app.attio.com/authorize', tokenUrl: 'https://app.attio.com/oauth/token',
        authorizeParams: { response_type: 'code' } },
      { kind: 'key' },
    ],
    scopes: { default: [] },
    revoke: { url: 'https://app.attio.com/oauth/revoke', token: ['access'] },
    http: { baseUrl: 'https://api.attio.com/v2', retry: {} },
    identify: { request: { path: '/self' }, id: 'workspace_id', name: 'workspace_name',
      rejectWhen: [{ path: 'active', equals: false, detail: 'token_inactive' }, { status: 400 }] },
  });
  return attio;
}

function clientOAuthToken(oauthClient: OAuthClient, connectionId: string, secrets: SecretStore, vault: Vault, withLock: WithLock) {
  const refresh = (refreshToken: string) => refreshGrant(google, oauthClient, refreshToken, { fetch });
  const gmail = client(google, {
    token: rejected => accessToken({ connectionId, secrets, vault, withLock, provider: google, refresh, rejected }),
  });
  return gmail;
}

async function clientOwnEntry(token: string, teamId: string, skipped: (string | null)[], titles: string[]) {
  const tasks = defineProvider({
    id: 'tasks', name: 'Tasks', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.tasks.example/v1' },
    paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'cursor' } } },
    operations: {
      'issues.list': { path: '/teams/{teamId}/issues', paging: 'cursor', records: 'items',
        params: { teamId: { in: 'path', type: 'string', required: true } },
        result: { items: [{ id: 'string', title: 'string' }], 'next?': 'string' } },
    },
  });

  for await (const issue of client(tasks, { token }).issues.list({ teamId }, { onSkipped: ids => { skipped.push(...ids); } })) {
    titles.push(issue.title);
  }
}

async function connectKey(apiToken: string, apiId: string) {
  const { fields } = await startConnect(aircall); // API ID, and API token (secret)
  const { secret, values, account } = await finishConnect(aircall, { secret: { apiToken }, values: { apiId }, fetch });
  // secret: { apiToken } to seal; values: { apiId } to keep; account: { id: apiId, name: the company's name }
  return [fields, secret, values, account];
}

// docs/modules/connect.md › An entry with two sign-ins.
async function connectTwoSignIns(oauthClient: OAuthClient, redirectUri: string, state: string, code: string,
  report: (error: unknown) => void, teamId: string, apiKey: string, kept: { kind: 'oauth2' | 'key'; token: string }) {
  // Send the browser to `url`; keep `state` and `codeVerifier` on the server.
  const { url, codeVerifier } = await startConnect(linear, { clientId: oauthClient.clientId, redirectUri, state });

  // In the callback, once the state matches:
  const { secret, account } = await finishConnect(linear, { client: oauthClient, code, redirectUri, codeVerifier,
    onRevokeFailed: report });
  // secret: the grant to seal, with `kind: 'oauth2'` kept beside it; account: the Linear user

  const api = client(linear, { token: secret.accessToken });
  const issues = await api.issues.list({ teamId, first: 50 }); // one page: nodes and pageInfo

  // A person's own key instead: a form, then one call.
  const key = signInWith(linear, 'key');
  const own = await finishConnect(key, { secret: { apiKey } }); // own.secret: { apiKey }, with `kind: 'key'` kept beside it

  // Every later call narrows again with the kind kept (`'oauth2' | 'key'`): a union of the two narrowings.
  const later = client(signInWith(linear, kept.kind), { token: kept.token });
  expectTypeOf(later.issues.get).toBeFunction();
  expectTypeOf(issues.data.issues.pageInfo.hasNextPage).toEqualTypeOf<boolean>();
  expectTypeOf(own.secret).toEqualTypeOf<Readonly<Record<'apiKey', string>>>();
  return [url, account, issues, later];
}

// docs/modules/connect.md › OAuth 2 on the person's own server.
async function connectOwnServer(clients: Map<string, OAuthClient>, pending: Map<string, { codeVerifier: string | undefined; values: { host: string } }>,
  host: string, redirectUri: string, state: string, code: string, refreshToken: string, report: (error: unknown) => void) {
  // The app's client for the server the person typed: one per server, never another's.
  const registered = clients.get(host);
  if (registered === undefined) throw new Error('not_registered_on_this_server');
  const start = await startConnect(mattermost, { clientId: registered.clientId, redirectUri, state, values: { host } });
  pending.set(state, { codeVerifier: start.codeVerifier, values: start.values }); // on the server; send the browser to `start.url`

  // In the callback: what was kept, found by `state`, and that server's client.
  const kept = pending.get(state);
  const own = kept && clients.get(kept.values.host);
  if (kept === undefined || own === undefined) throw new Error('unknown_state');
  const { secret, values } = await finishConnect(mattermost, { client: own, code, redirectUri, codeVerifier: kept.codeVerifier,
    values: kept.values, onRevokeFailed: report });
  // secret: the grant to seal; values: { host } to keep with it

  const api = client(mattermost, { token: secret.accessToken, values });
  const renewed = await refreshGrant(mattermost, own, refreshToken, { values }); // through the address guard

  // When the person disconnects, with the same values:
  await revokeGrant(mattermost, { ...secret, client: own, values });
  expectTypeOf(values.host).toEqualTypeOf<string>();
  return [api, renewed];
}

// docs/modules/connect.md: "To ask for other scopes, derive an entry".
function connectOtherScopes() {
  return defineProvider({ ...google, scopes: { default: ['https://www.googleapis.com/auth/gmail.readonly'] } });
}

async function hubspotFakeConnect(portalData: Omit<HubSpotFakeData, 'client' | 'redirectUri'>, client: OAuthClient,
  state: string, onRevokeFailed: (error: unknown) => void) {
  const redirectUri = 'https://app.test/api/integrations/hubspot/callback';
  const http = fakeFetch(fakeHubSpot({ ...portalData, client, redirectUri }));
  const { url, codeVerifier } = await startConnect(hubspot, { clientId: client.clientId, redirectUri, state });
  const consent = await http.fetch(url, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location') ?? '');
  if (back.searchParams.get('state') !== state) throw new Error('state_mismatch');
  const code = back.searchParams.get('code');
  if (!code) throw new Error('missing_code');
  const connected = await finishConnect(hubspot, {
    client, code, redirectUri, codeVerifier, fetch: http.fetch, onRevokeFailed,
  });
  return connected;
}

// docs/modules/client.md › The address guard.
async function clientGuarded(accessToken: string, host: string) {
  const api = client(gitlab, { token: accessToken, values: { host } }); // `host` as the person typed it
  const user = await api.json('/user');
  return user;
}

// docs/modules/connect.md › A token provider's connect.
async function connectToken(password: string, host: string, username: string) {
  // Once, at sign-in:
  const { secret, values, account } = await finishConnect(metabase, { secret: { password }, values: { host, username } });
  // secret: { password } to seal; values: { host, username } to keep; account: { id: username, name: username }

  // Outside any request handler, once per connection:
  const api = client(metabase, { token: tokenSource(metabase, { secret, values }), values });

  async function handler() {
    return api.json('/user/current');
  }
  return [handler, account];
}

// docs/modules/oauth.md: a wrapper generic over the entry, as one over `startConnect`.
function oauthWrapper(client: OAuthClient, refreshToken: string, clientId: string, state: string) {
  const renew = (entry: Entry, values: Values) => refreshGrant(entry, client, refreshToken, { values });
  const start = (entry: Entry, values: Values) => startConnect(entry, { clientId, redirectUri: 'https://app.test/cb', state, values });
  return [renew, start];
}

// docs/modules/oauth.md › A `token` entry.
function oauthTokenSource(secret: { clientSecret: string }, values: { accountId: string; clientId: string }) {
  // One source per connection, built outside any request handler and kept for the process's life.
  const api = client(zoom, { token: tokenSource(zoom, { secret, values }), values });

  async function handler() {
    return api.json('/users/me'); // every request reuses the kept token
  }
  return handler;
}

// docs/design/entries-and-engine.md › The engine (its operation line is a comment there).
async function designClient() {
  const api = client(signInWith(attio, 'key'), { token: process.env.ATTIO_KEY });
  const self = await api.json('/self');                          // raw, authenticated, retried
  return self;
}

// docs/modules/webhooks.md › Declaring a webhook.
function webhooksDeclared() {
  // `hmac` with a timestamp header (Breakcold)
  const timestamped: Webhook = { kind: 'hmac', header: 'x-webhook-signature', signed: '{timestamp}.{body}', prefix: 'sha256=',
    timestamp: { header: 'x-webhook-timestamp' }, deliveryId: { body: ['eventId'] } };
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
  // A `challenge` read from a request header and answered as text, after the request verifies (Front)
  const headed: Webhook = { kind: 'hmac', header: 'x-front-signature', signed: '{timestamp}:{body}', encoding: 'base64',
    timestamp: { header: 'x-front-request-timestamp', unit: 'epochMs' },
    challenge: { when: { path: 'type', equals: 'sync' }, echo: { header: 'x-front-challenge' }, text: true } };
  return [timestamped, pieces, signedWithKey, sharedToken, instant, decoded, credentials, standard, challenged, queried, headed];
}

// docs/modules/webhooks.md › Receiving a delivery (its last line, a comment there, is the three calls below).
async function webhooksReceive(webhook: Webhook, request: Request, secret: string,
  handle: (id: string | null, rawBody: Buffer) => Promise<Response>): Promise<Response> {
  const rawBody = await readCappedBody(request, 1024 * 1024);
  if (rawBody === null) return new Response(null, { status: 413 });
  const delivery = { method: request.method, url: request.url, headers: request.headers, rawBody };
  const answer = challengeAnswer(webhook, delivery, secret); // a handshake, verified unless the entry marks it unsigned
  if (answer !== null) return answer;
  if (!verifyWebhook(webhook, delivery, secret)) return new Response(null, { status: 401 }); // Discord requires a 401
  return handle(deliveryId(webhook, delivery), rawBody); // the app dedupes on the id, when the entry declares one
}
function webhooksReceiveCalls(request: Request, signingSecret: string, publicKey: string, webhookSecret: string,
  handle: (id: string | null, rawBody: Buffer) => Promise<Response>) {
  return [webhooksReceive(slack.webhook, request, signingSecret, handle), webhooksReceive(discord.webhook, request, publicKey, handle),
    webhooksReceive(nylas.webhook, request, webhookSecret, handle)];
}

// docs/modules/testing.md › A fake derived from an entry (its four examples).
async function testingDerivedFake() {
  // An app's test, for an entry with no module:
  const key = signInWith(trello, 'key'); // Trello lists OAuth 2 first; this is its API key and token
  const { fetch } = fakeFetch(fakeProvider(key, { key: 'kit-token', values: { apiKey: 'kit-key' } }));
  const { account } = await finishConnect(key, { secret: { apiToken: 'kit-token' }, values: { apiKey: 'kit-key' }, fetch });
  return account;
}
async function testingDerivedOperation() {
  // An operation the app answers:
  const { fetch } = fakeFetch(fakeProvider(notion, { key: 'kit-token', operations: {
    'pages.markdown': call => ({ markdown: `# Page ${call.path.pageId ?? ''}`, truncated: false }) } }));
  const page = await client(notion, { token: 'kit-token', fetch }).pages.markdown({ pageId: 'p1' });
  return page;
}
async function testingDerivedToken() {
  // A token entry: `key` is its secret field's value, and its calls carry `kit-token`.
  const values = { accountId: 'kit-account', clientId: 'kit-client' };
  const { fetch } = fakeFetch(fakeProvider(zoom, { key: 'kit-secret', values }));
  const { account } = await finishConnect(zoom, { secret: { clientSecret: 'kit-secret' }, values, fetch });
  return account;
}
async function testingDerivedOAuth() {
  // An OAuth 2 entry: the kit's client and code connect, and the grant holds `key` as its access token.
  const redirectUri = 'https://app.example.test/callback';
  const start = await startConnect(linear, { clientId: 'kit-client', redirectUri, state: 'kit-state' });
  const { fetch } = fakeFetch(fakeProvider(linear, { key: 'kit-token' }));
  const { account } = await finishConnect(linear, { client: { clientId: 'kit-client', clientSecret: 'kit-secret' },
    code: 'kit-code', redirectUri, codeVerifier: start.codeVerifier, fetch, onRevokeFailed: () => undefined });
  return account;
}

test('every docs example compiles', () => {
  expect([readmeConnectKey, readmeConnectOAuth, readmeCall, catalogueEntry, clientOAuthToken, clientOwnEntry, connectKey,
    connectTwoSignIns, connectOwnServer, connectOtherScopes, hubspotFakeConnect, designClient, clientGuarded, oauthTokenSource, oauthWrapper, connectToken, webhooksReceive,
    webhooksReceiveCalls, webhooksDeclared, testingDerivedFake, testingDerivedOperation,
    testingDerivedToken, testingDerivedOAuth].every(example => typeof example === 'function')).toBe(true);
});

test("webhooks.md's declarations are the entries' own (Discord's without its challenge)", () => {
  // `toEqual` reads a property set to undefined as missing.
  expect(webhooksDeclared()).toEqual([breakcold.webhook, stripe.webhook, { ...discord.webhook, challenge: undefined }, google.webhook,
    zendesk.webhook, close.webhook, mailjet.webhook, gitlab.webhook, slack.webhook, nylas.webhook, front.webhook]);
});

test("testing.md's derived-fake examples run", async () => {
  await expect(testingDerivedFake()).resolves.toEqual({ id: 'kit-account', name: 'kit-name' });
  await expect(testingDerivedOperation()).resolves.toEqual({ markdown: '# Page p1', truncated: false });
  await expect(testingDerivedToken()).resolves.toEqual({ id: 'kit-account', name: 'kit-account' });
  await expect(testingDerivedOAuth()).resolves.toEqual({ id: 'kit-account', name: 'kit-name' });
});
