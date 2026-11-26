import { expect, expectTypeOf, test } from 'vitest';
import { defineProvider } from './catalogue.js';
import { attio } from './catalogue/attio.js';
import { google } from './catalogue/google.js';
import { hubspot } from './catalogue/hubspot.js';
import { notion } from './catalogue/notion.js';
import { aircall } from './catalogue/aircall.js';
import { client } from './client.js';
import { finishConnect, startConnect } from './connect.js';
import { accessToken, type WithLock } from './credentials.js';
import { fakeHubSpot, type HubSpotFakeData } from './hubspot/fake.js';
import { refreshGrant, type OAuthClient } from './oauth.js';
import { fakeFetch } from './testing.js';
import type { SecretStore, Vault } from './vault.js';

// Every code example of README.md and docs/, as written, each in its own function. An import of
// `0-integrations/<subpath>` is the source file that subpath publishes (src/exports.test.ts holds the map). The
// parameters are what an example leaves to the app; a `return` keeps what it only shows. Never called: the types are the test.

async function readmeConnectKey(apiKey: string) {
  const { fields } = await startConnect(attio); // the form to draw: one secret field, "API key"
  const { secret, account } = await finishConnect(attio, { secret: { apiKey }, fetch });
  expectTypeOf(account).toEqualTypeOf<{ id: string; name: string }>();
  return [fields, secret];
}

async function readmeConnectOAuth(oauthClient: OAuthClient, redirectUri: string, state: string, code: string,
  report: (error: unknown) => void) {
  // Send the browser to `start.url`; keep `state` and `start.codeVerifier` on the server.
  const start = await startConnect(google, { clientId: oauthClient.clientId, redirectUri, state });

  // In the callback, once the state matches, with the verifier kept at the start:
  const { secret, account } = await finishConnect(google, {
    client: oauthClient, code, redirectUri, codeVerifier: start.codeVerifier, fetch, onRevokeFailed: error => { report(error); },
  });
  expectTypeOf(account).toEqualTypeOf<{ id: string; name: string }>();
  return [start, secret];
}

// README.md › Call a provider, and the first example of docs/modules/client.md.
async function readmeCall(apiKey: string, pageId: string) {
  const api = client(notion, { token: apiKey });
  const page = await api.pages.markdown({ pageId }); // typed: { markdown: string; truncated: boolean }
  const me = await api.json('/users/me'); // raw: authenticated, paced, classified errors
  expectTypeOf(page).branded.toEqualTypeOf<{ markdown: string; truncated: boolean }>();
  return me;
}

// docs/modules/catalogue.md, and the design's entry (`export` dropped: this is a function body).
function catalogueEntry() {
  const attio = defineProvider({
    id: 'attio', name: 'Attio', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }],
    http: { baseUrl: 'https://api.attio.com/v2', minIntervalMs: 100, retry: { maxWaitMs: 10_000 } },
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

// docs/modules/connect.md: "To ask for other scopes, derive an entry".
function connectOtherScopes() {
  return defineProvider({ ...google, scopes: { default: ['https://www.googleapis.com/auth/gmail.readonly'] } });
}

async function hubspotFakeConnect(portalData: Omit<HubSpotFakeData, 'client' | 'redirectUri'>, client: OAuthClient,
  state: string, onRevokeFailed: (error: unknown) => void) {
  const redirectUri = 'https://app.test/api/integrations/hubspot/callback';
  const http = fakeFetch(fakeHubSpot({ ...portalData, client, redirectUri }));
  const { url } = await startConnect(hubspot, { clientId: client.clientId, redirectUri, state });
  const consent = await http.fetch(url, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location') ?? '');
  if (back.searchParams.get('state') !== state) throw new Error('state_mismatch');
  const code = back.searchParams.get('code');
  if (!code) throw new Error('missing_code');
  const connected = await finishConnect(hubspot, {
    client, code, redirectUri, fetch: http.fetch, onRevokeFailed,
  });
  return connected;
}

// docs/design/entries-and-engine.md › The engine (its operation line is a comment there).
async function designClient() {
  const api = client(attio, { token: process.env.ATTIO_KEY });
  const self = await api.json('/self');                          // raw, authenticated, retried
  return self;
}

test('every docs example compiles', () => {
  expect([readmeConnectKey, readmeConnectOAuth, readmeCall, catalogueEntry, clientOAuthToken, clientOwnEntry, connectKey,
    connectOtherScopes, hubspotFakeConnect, designClient].every(example => typeof example === 'function')).toBe(true);
});
