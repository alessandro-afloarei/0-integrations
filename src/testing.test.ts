import { describe, expect, test } from 'vitest';
import { defineProvider, signInWith } from './catalogue.js';
import { aircall } from './catalogue/aircall.js';
import { discord } from './catalogue/discord.js';
import { fireflies } from './catalogue/fireflies.js';
import { folk } from './catalogue/folk.js';
import { gitlab as gitlabEntry } from './catalogue/gitlab.js';
import { lemlist } from './catalogue/lemlist.js';
import { metabase } from './catalogue/metabase.js';
import { missive } from './catalogue/missive.js';
import { notion } from './catalogue/notion.js';
import { serpapi } from './catalogue/serpapi.js';
import { slack } from './catalogue/slack.js';
import { trello as trelloEntry } from './catalogue/trello.js';
import { zoom } from './catalogue/zoom.js';
import { client } from './client.js';
import { finishConnect, startConnect } from './connect.js';
import { GrantRevoked } from './errors.js';
import { kitValues } from './kit.test-support.js';
import { exchangeCode, refreshGrant, requestToken, revokeGrant, tokenSource } from './oauth.js';
import { checkCredentialStore, fakeFetch, fakeProvider, memoryStores, respondFrom, sequence, type FakeCall } from './testing.js';
import type { Sealed } from './vault.js';

/** GitLab's personal access token sign-in: these tests send `private-token`. */
const gitlab = signInWith(gitlabEntry, 'key');
const trello = signInWith(trelloEntry, 'key');

describe('fakeProvider', () => {
  const unauthorized = { status: 401, body: { error: 'unauthorized' } };
  const answer = async (response: Response) => ({ status: response.status, body: await response.json() });

  test("SerpApi's fake answers its account to the key in the query, and 401 to another", async () => {
    const { fetch } = fakeFetch(fakeProvider(serpapi, { key: 'k' }));
    expect(await answer(await fetch('https://serpapi.com/account?api_key=k')))
      .toEqual({ status: 200, body: { account_id: 'kit-account', account_email: 'kit-name' } });
    expect(await answer(await fetch('https://serpapi.com/account?api_key=x'))).toEqual(unauthorized);
  });

  test("Trello's fake checks its `OAuth …` header, the app's key and the person's token", async () => {
    const { fetch } = fakeFetch(fakeProvider(trello, { key: 'k', values: { apiKey: 'a' } }));
    const sent = (apiKey: string, token: string) => fetch('https://api.trello.com/1/members/me',
      { headers: { authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"` } });
    expect((await sent('a', 'k')).status).toBe(200);
    expect(await answer(await sent('b', 'k'))).toEqual(unauthorized);
    await expect(finishConnect(trello, { secret: { apiToken: 'k' }, values: { apiKey: 'a' }, fetch }))
      .resolves.toMatchObject({ account: { id: 'kit-account', name: 'kit-name' } });
    await expect(finishConnect(trello, { secret: { apiToken: 'x' }, values: { apiKey: 'a' }, fetch })).rejects.toMatchObject({ code: 'rejected' });
  });

  test("Aircall's fake checks Basic from the API ID and the token", async () => {
    const { fetch } = fakeFetch(fakeProvider(aircall, { key: 'k', values: { apiId: 'a' } }));
    const sent = (pair: string) => fetch('https://api.aircall.io/v1/company',
      { headers: { authorization: `Basic ${Buffer.from(pair).toString('base64')}` } });
    expect(await answer(await sent('a:k'))).toEqual({ status: 200, body: { company: { name: 'kit-name' } } });
    expect(await answer(await sent('a:x'))).toEqual(unauthorized);
    await expect(finishConnect(aircall, { secret: { apiToken: 'k' }, values: { apiId: 'a' }, fetch }))
      .resolves.toMatchObject({ account: { id: 'a', name: 'kit-name' } });
  });

  test("Discord's fake checks `Bot <token>`", async () => {
    const { fetch } = fakeFetch(fakeProvider(discord, { key: 'k' }));
    const sent = (value: string) => fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: value } });
    expect((await sent('Bot k')).status).toBe(200);
    expect(await answer(await sent('Bearer k'))).toEqual(unauthorized);
  });

  test("GitLab's fake checks `private-token` under the base filled from its values", async () => {
    expect(kitValues(gitlab)).toEqual({ host: 'gitlab.com' });
    const { fetch } = fakeFetch(fakeProvider(gitlab, { key: 'k', values: kitValues(gitlab) }));
    expect(await answer(await fetch('https://gitlab.com/api/v4/user', { headers: { 'private-token': 'k' } })))
      .toEqual({ status: 200, body: { id: 'kit-account', username: 'kit-name' } });
    expect(await answer(await fetch('https://gitlab.com/api/v4/user', { headers: { 'private-token': 'x' } }))).toEqual(unauthorized);
    await expect(client(gitlab, { token: 'k', values: { host: 'gitlab.com' }, fetch }).json('/user')).resolves.toMatchObject({ id: 'kit-account' });
  });

  test('a bad value fails in the fake as it fails in the engine', () => {
    expect(() => fakeProvider(gitlab, { key: 'k', values: { host: '127.0.0.1' } }))
      .toThrow(expect.objectContaining({ code: 'request_failed', detail: 'address_blocked' }));
    expect(() => fakeProvider(gitlab, { key: 'k', values: { host: 'a/b' } })).toThrow('base_value_invalid: gitlab {host}');
    expect(() => fakeProvider(gitlab, { key: 'k' })).toThrow('template_missing: gitlab {host}');
  });

  test("a fake's token answer names the host its values give, where identify, the calls and the refresh then go", async () => {
    const named = defineProvider({ id: 'named', name: 'Named', scopes: { default: [] }, save: { host: 'tokenAnswer.host' },
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.named.test/authorize', tokenUrl: 'https://login.named.test/token',
        refreshUrl: 'https://{host}/token' }], http: { baseUrl: 'https://{host}/api', host: '*.named.test' }, identify: { request: { path: '/me' }, id: 'id' } });
    expect(kitValues(named)).toEqual({ host: 'kit.named.test' });
    const http = fakeFetch(fakeProvider(named, { key: 'k', values: { host: 'eu.named.test' } }));
    const oauthClient = { clientId: 'kit-client', clientSecret: 'kit-secret' };
    const { values } = await finishConnect(named, { client: oauthClient, code: 'kit-code', redirectUri: 'https://app.test/cb', codeVerifier: 'v'.repeat(43),
      fetch: http.fetch, onRevokeFailed: () => undefined });
    expect(values).toEqual({ host: 'eu.named.test' });
    await refreshGrant(named, oauthClient, 'kit-refresh', { values, fetch: http.fetch });
    await client(named, { token: 'k', values, fetch: http.fetch }).json('/me');
    expect(http.calls.map(call => call.url)).toEqual(['https://login.named.test/token', 'https://eu.named.test/api/me', 'https://eu.named.test/token',
      'https://eu.named.test/api/me']);
    expect(() => fakeProvider(named, { key: 'k' })).toThrow('template_missing: named {host}');
  });

  test('`account` replaces the default answer of identify', async () => {
    const { fetch } = fakeFetch(fakeProvider(serpapi, { key: 'k', account: { account_id: 'acct_1', account_email: 'a@example.test' } }));
    await expect(finishConnect(serpapi, { secret: { apiKey: 'k' }, fetch }))
      .resolves.toMatchObject({ account: { id: 'acct_1', name: 'a@example.test' } });
  });

  test("an operation's function receives its decoded path parameters, query and body", async () => {
    const calls: FakeCall[] = [];
    const fake = fakeFetch(fakeProvider(notion, { key: 'k', operations: { 'pages.markdown': call => {
      calls.push(call);
      return { markdown: '# Plan', truncated: false };
    } } }));
    const api = client(notion, { token: 'k', fetch: fake.fetch });
    await expect(api.pages.markdown({ pageId: 'p 1' })).resolves.toEqual({ markdown: '# Plan', truncated: false });
    expect(fake.calls[0]?.url).toBe('https://api.notion.com/v1/pages/p%201/markdown?markdown_version=v2');
    expect(calls).toEqual([{ path: { pageId: 'p 1' }, query: { markdown_version: 'v2' }, body: undefined,
      headers: { authorization: 'Bearer k', 'content-type': 'application/json', 'notion-version': '2026-03-11' } }]);
    await expect(client(notion, { token: 'x', fetch: fake.fetch }).pages.markdown({ pageId: 'p' })).rejects.toMatchObject({ code: 'rejected' });
  });

  test('an operation that returns undefined is a 404: `notFound: null` answers null', async () => {
    const { fetch } = fakeFetch(fakeProvider(aircall, { key: 'k', values: { apiId: 'a' }, operations: { 'calls.transcript': () => undefined } }));
    await expect(client(aircall, { token: 'k', values: { apiId: 'a' }, fetch }).calls.transcript({ callId: 7 })).resolves.toBeNull();
    const notion404 = fakeFetch(fakeProvider(notion, { key: 'k', operations: { 'pages.markdown': () => undefined } }));
    await expect(client(notion, { token: 'k', fetch: notion404.fetch }).pages.markdown({ pageId: 'p' })).rejects.toMatchObject({ code: 'not_found' });
  });

  test('a returned Response is answered as it is', async () => {
    const { fetch } = fakeFetch(fakeProvider(notion, { key: 'k', operations: {
      'pages.markdown': () => Response.json({ object: 'error', code: 'validation_error' }, { status: 400 }) } }));
    await expect(client(notion, { token: 'k', fetch }).pages.markdown({ pageId: 'p' }))
      .rejects.toMatchObject({ code: 'request_failed', status: 400 });
  });

  test("a GraphQL operation routes by its query, and its function sees the posted body", async () => {
    const calls: FakeCall[] = [];
    const user = { user_id: 'u1', email: 'kit@example.test', name: 'Kit' };
    const { fetch } = fakeFetch(fakeProvider(fireflies, { key: 'k', operations: { user: call => { calls.push(call); return { data: { user } }; } } }));
    await expect(client(fireflies, { token: 'k', fetch }).user()).resolves.toEqual({ data: { user } });
    expect(calls).toEqual([{ path: {}, query: {}, body: { query: fireflies.operations.user.graphql, variables: {} },
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' } }]);
    await expect(fetch('https://api.fireflies.ai/graphql', { method: 'POST', headers: { authorization: 'Bearer k' },
      body: JSON.stringify({ query: 'query Other { other }' }) }))
      .rejects.toThrow('fakeProvider: no answer for this GraphQL query at POST https://api.fireflies.ai/graphql');
  });

  test('a request no route matches is fakeFetch\'s own "no route" error', async () => {
    const { fetch } = fakeFetch(fakeProvider(notion, { key: 'k' }));
    await expect(client(notion, { token: 'k', fetch }).pages.markdown({ pageId: 'p' }))
      .rejects.toThrow('fakeFetch: no route for GET https://api.notion.com/v1/pages/p/markdown?markdown_version=v2');
  });

  test("Zoom's fake answers the token request to the right Basic, and invalid_client to another", async () => {
    const values = { accountId: 'acc', clientId: 'c' };
    const { fetch } = fakeFetch(fakeProvider(zoom, { key: 'k', values }));
    const sent = (secret: string) => fetch('https://zoom.us/oauth/token', { method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`c:${secret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'account_credentials', account_id: 'acc' }) });
    expect(await answer(await sent('k'))).toEqual({ status: 200, body: { access_token: 'kit-token', expires_in: 3600 } });
    expect(await answer(await sent('x'))).toEqual({ status: 400, body: { error: 'invalid_client' } });
    const before = Date.now();
    const { token, expiresAt } = await requestToken(zoom, { secret: { clientSecret: 'k' }, values, fetch });
    expect(token).toBe('kit-token');
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    await expect(requestToken(zoom, { secret: { clientSecret: 'x' }, values, fetch })).rejects.toMatchObject({ code: 'rejected', detail: 'invalid_client' });
  });

  test("Metabase's fake answers a session to the right JSON body, and its calls require that session", async () => {
    expect(kitValues(metabase)).toEqual({ host: 'kit-host', username: 'kit-username' });
    const values = { host: 'kit-host', username: 'u' };
    const withCalls = defineProvider({ ...metabase, operations: { 'user.current': { path: '/user/current' } } });
    const { fetch } = fakeFetch(fakeProvider(withCalls, { key: 'pw', values, operations: { 'user.current': () => ({ email: 'u' }) } }));
    const session = (password: string) => fetch('https://kit-host/api/session', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'u', password }) });
    expect(await answer(await session('pw'))).toEqual({ status: 200, body: { id: 'kit-token', expires_in: 3600 } });
    expect(await answer(await session('nope'))).toEqual({ status: 400, body: { error: 'invalid_client' } });
    const current = (value: string) => fetch('https://kit-host/api/user/current', { headers: { 'x-metabase-session': value } });
    expect((await current('kit-token')).status).toBe(200);
    expect(await answer(await current('pw'))).toEqual(unauthorized);
    const api = client(withCalls, { token: tokenSource(withCalls, { secret: { password: 'pw' }, values, fetch }), values, fetch });
    await expect(api.user.current()).resolves.toEqual({ email: 'u' });
    await expect(finishConnect(metabase, { secret: { password: 'nope' }, values, fetch })).rejects.toMatchObject({ code: 'rejected' });
  });

  test('operations are keyed by the entry\'s own operation ids', () => {
    // @ts-expect-error: Notion declares no `nope`.
    expect(fakeProvider(notion, { key: 'k', operations: { nope: () => null } })).toBeInstanceOf(Array);
    // @ts-expect-error: Metabase declares no operations at all.
    expect(fakeProvider(metabase, { key: 'k', values: kitValues(metabase), operations: { nope: () => null } })).toBeInstanceOf(Array);
  });

  const items = defineProvider({ id: 'items', name: 'Items', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.items.test' },
    identify: { request: { path: '/users/me' }, id: 'id' },
    operations: {
      'items.get': { path: '/items/{id}', params: { id: { in: 'path', type: 'string', required: true } } },
      'items.recent': { path: '/items/recent' },
      'users.get': { path: '/users/{userId}', params: { userId: { in: 'path', type: 'string', required: true } } },
      'menu.get': { path: '/café/{id}', params: { id: { in: 'path', type: 'string', required: true } } },
    } });

  test('a literal last segment beats a placeholder, whatever the order declared', async () => {
    const { fetch } = fakeFetch(fakeProvider(items, { key: 'k', operations: {
      'items.get': call => ({ got: call.path }), 'items.recent': () => ({ recent: true }), 'users.get': call => ({ user: call.path }) } }));
    const api = client(items, { token: 'k', fetch });
    await expect(api.items.recent()).resolves.toEqual({ recent: true });
    await expect(api.items.get({ id: '7' })).resolves.toEqual({ got: { id: '7' } });
    await expect(finishConnect(items, { secret: { apiKey: 'k' }, fetch })).resolves.toMatchObject({ account: { id: 'kit-account' } });
    await expect(api.users.get({ userId: 'u1' })).resolves.toEqual({ user: { userId: 'u1' } });
  });

  const nested = defineProvider({ id: 'nested', name: 'Nested', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.nested.test' },
    operations: {
      'byX.get': { path: '/a/{x}/c', params: { x: { in: 'path', type: 'string', required: true } } },
      'byY.get': { path: '/a/b/{y}', params: { y: { in: 'path', type: 'string', required: true } } },
      'files.get': { path: '/files/{name}.{ext}', params: { name: { in: 'path', type: 'string', required: true },
        ext: { in: 'path', type: 'string', required: true } } },
    } });

  test('the route whose first differing segment is literal wins, whatever the order declared', async () => {
    const { fetch } = fakeFetch(fakeProvider(nested, { key: 'k', operations: { 'byX.get': call => ({ x: call.path }), 'byY.get': call => ({ y: call.path }) } }));
    const api = client(nested, { token: 'k', fetch });
    await expect(api.byY.get({ y: 'c' })).resolves.toEqual({ y: { y: 'c' } });
    await expect(api.byX.get({ x: 'z' })).resolves.toEqual({ x: { x: 'z' } });
  });

  test.each(['https://api.root.test', 'https://api.root.test/v1'])('an identify path of exactly `/` matches on the base %s', async baseUrl => {
    const root = defineProvider({ id: 'root', name: 'Root', fields: [{ name: 'apiKey', title: 'API key', secret: true }], auth: [{ kind: 'key' }],
      http: { baseUrl }, identify: { request: { path: '/' }, id: 'id' } });
    const { fetch } = fakeFetch(fakeProvider(root, { key: 'k' }));
    await expect(finishConnect(root, { secret: { apiKey: 'k' }, fetch })).resolves.toMatchObject({ account: { id: 'kit-account' } });
  });

  test('`/items` and `/items/` are two paths, as the engine sends them', async () => {
    const slashed = defineProvider({ id: 'slashed', name: 'Slashed', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.slashed.test' },
      operations: { 'items.bare': { path: '/items' }, 'items.slashed': { path: '/items/' } } });
    const { fetch } = fakeFetch(fakeProvider(slashed, { key: 'k', operations: { 'items.bare': () => ({ bare: true }) } }));
    const api = client(slashed, { token: 'k', fetch });
    await expect(api.items.bare()).resolves.toEqual({ bare: true });
    await expect(api.items.slashed()).rejects.toThrow('fakeFetch: no route for GET https://api.slashed.test/items/');
  });

  test('a token URL that ends in `/` is answered as the engine sends it', async () => {
    const slashed = defineProvider({ id: 'slashed', name: 'Slashed', docs: 'https://slashed.test/docs',
      fields: [{ name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Client secret', secret: true }],
      auth: [{ kind: 'token', request: { url: 'https://api.slashed.test/oauth/token/', body: { grant_type: 'client_credentials' },
        basic: ['{clientId}', '{clientSecret}'] } }], http: { baseUrl: 'https://api.slashed.test' } });
    const { fetch } = fakeFetch(fakeProvider(slashed, { key: 'k', values: { clientId: 'c' } }));
    await expect(requestToken(slashed, { secret: { clientSecret: 'k' }, values: { clientId: 'c' }, fetch })).resolves.toMatchObject({ token: 'kit-token' });
  });

  test('an identify path that ends in `/` matches the request the engine sends for it, and only that', async () => {
    const slashed = defineProvider({ id: 'slashed', name: 'Slashed', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.slashed.test' }, identify: { request: { path: '/me/' }, id: 'id' } });
    const { fetch } = fakeFetch(fakeProvider(slashed, { key: 'k' }));
    await expect(finishConnect(slashed, { secret: { apiKey: 'k' }, fetch })).resolves.toMatchObject({ account: { id: 'kit-account' } });
    await expect(fetch('https://api.slashed.test/me', { headers: { authorization: 'Bearer k' } })).rejects.toThrow('no route for GET');
  });

  test('an id template that reads several answer paths is filled at each of them; a list of paths at its first', async () => {
    const templated = defineProvider({ id: 'templated', name: 'Templated', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.templated.test' },
      identify: { request: { path: '/me' }, id: '{org.id}/{user.id}', name: ['user.display', 'user.login'] } });
    const { fetch } = fakeFetch(fakeProvider(templated, { key: 'k' }));
    await expect(finishConnect(templated, { secret: { apiKey: 'k' }, fetch }))
      .resolves.toMatchObject({ account: { id: 'kit-account/kit-account', name: 'kit-name' } });
  });

  test('a literal `.` between placeholders is kept', async () => {
    const { fetch } = fakeFetch(fakeProvider(nested, { key: 'k', operations: { 'files.get': call => call.path } }));
    await expect(client(nested, { token: 'k', fetch }).files.get({ name: 'report', ext: 'pdf' })).resolves.toEqual({ name: 'report', ext: 'pdf' });
  });

  test('a literal path segment that is not ASCII matches its percent-encoded request', async () => {
    const { fetch } = fakeFetch(fakeProvider(items, { key: 'k', operations: { 'menu.get': call => call.path } }));
    await expect(client(items, { token: 'k', fetch }).menu.get({ id: 'crème' })).resolves.toEqual({ id: 'crème' });
  });

  test("folk's list and search share a route: the search answers a call carrying its required filter", async () => {
    const person = (id: string) => ({ id, fullName: 'A', firstName: 'A', lastName: 'B', emails: [], companies: [] });
    const { fetch } = fakeFetch(fakeProvider(folk, { key: 'k', operations: {
      'people.list': () => ({ data: { items: [person('listed')] } }), 'people.search': () => ({ data: { items: [person('found')] } }) } }));
    const api = client(folk, { token: 'k', fetch });
    const ids = async (people: AsyncIterable<{ id: string }>) => { const seen = []; for await (const { id } of people) seen.push(id); return seen; };
    expect(await ids(api.people.list())).toEqual(['listed']);
    expect(await ids(api.people.search({ 'filter[emails][eq]': 'a@example.test' }))).toEqual(['found']);
  });

  test("a form operation's function receives its form body, and two on one route choose by a required form parameter", async () => {
    const formed = defineProvider({ id: 'formed', name: 'Formed', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.formed.test' },
      operations: { 'notes.create': { method: 'POST', path: '/notes', params: { text: { in: 'form', type: 'string', required: true },
        pinned: { in: 'form', type: 'boolean' } } },
      'notes.update': { method: 'POST', path: '/notes', params: { id: { in: 'form', type: 'integer', required: true } } } } });
    const calls: FakeCall[] = [];
    const { fetch } = fakeFetch(fakeProvider(formed, { key: 'k', operations: {
      'notes.create': call => { calls.push(call); return { by: 'create' }; }, 'notes.update': () => ({ by: 'update' }) } }));
    const api = client(formed, { token: 'k', fetch });
    await expect(api.notes.create({ text: 'a & b', pinned: true })).resolves.toEqual({ by: 'create' });
    await expect(api.notes.update({ id: 7 })).resolves.toEqual({ by: 'update' });
    expect(calls).toEqual([{ path: {}, query: {}, body: { text: 'a & b', pinned: 'true' },
      headers: { authorization: 'Bearer k', 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } }]);
  });

  test("lemlist's create and update share a route: the update answers a body carrying its required contactId", async () => {
    const { fetch } = fakeFetch(fakeProvider(lemlist, { key: 'k', operations: {
      'contacts.create': () => ({ data: { _id: 'created' } }), 'contacts.update': () => ({ data: { _id: 'updated' } }) } }));
    const api = client(lemlist, { token: 'k', fetch });
    await expect(api.contacts.create({ email: 'a@example.test' })).resolves.toEqual({ data: { _id: 'created' } });
    await expect(api.contacts.update({ contactId: 'c1' })).resolves.toEqual({ data: { _id: 'updated' } });
  });

  test("Missive's draft and send share a route: a call whose `drafts.send` is `true` is the send, any other the draft", async () => {
    const { fetch } = fakeFetch(fakeProvider(missive, { key: 'k', operations: {
      'drafts.create': () => ({ by: 'draft' }), 'messages.create': () => ({ by: 'send' }) } }));
    const api = client(missive, { token: 'k', fetch });
    await expect(api.drafts.create({ drafts: { subject: 'Hi' } })).resolves.toEqual({ by: 'draft' });
    await expect(api.messages.create({ drafts: { send: true, subject: 'Hi' } })).resolves.toEqual({ by: 'send' });
    const sent = (drafts: unknown) => fetch('https://public.missiveapp.com/v1/drafts', { method: 'POST', headers: { authorization: 'Bearer k' },
      body: JSON.stringify({ drafts }) }).then(answer);
    for (const drafts of [{ send: false }, { send: 'true' }, {}]) await expect(sent(drafts)).resolves.toEqual({ status: 200, body: { by: 'draft' } });
  });

  test('of two operations on one route, the one whose literals all hold answers, in every list element, the most literals first', async () => {
    const authored = defineProvider({ id: 'authored', name: 'Authored', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.authored.test' },
      operations: { 'threads.create': { method: 'POST', path: '/threads', params: { messages: { in: 'body', type: ['unknown'], required: true } } },
        'replies.create': { method: 'POST', path: '/threads', params: { messages: { in: 'body', required: true, type: [{ actor: 'agent', 'draft?': true }] } } } } });
    const { fetch } = fakeFetch(fakeProvider(authored, { key: 'k', operations: {
      'threads.create': () => ({ by: 'thread' }), 'replies.create': () => ({ by: 'reply' }) } }));
    const sent = (messages: unknown) => fetch('https://api.authored.test/threads', { method: 'POST', headers: { authorization: 'Bearer k' },
      body: JSON.stringify({ messages }) }).then(answer).then(({ body }) => (body as { by: string }).by);
    expect(await Promise.all([[{ actor: 'agent' }, { actor: 'agent', draft: true }], [{ actor: 'agent' }, { actor: 'user' }],
      [{ actor: 'agent', draft: false }], [{ actor: 'agent ' }], ['agent']].map(sent))).toEqual(['reply', 'thread', 'thread', 'thread', 'thread']);
  });

  test('a literal that arrives as text holds as its text: a boolean in a query, a header or a form, and a string in a query', async () => {
    const shared = defineProvider({ id: 'shared', name: 'Shared', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.shared.test' }, operations: {
      'items.list': { path: '/items' }, 'items.inbox': { path: '/items', params: { inbox: { in: 'query', type: true, required: true } } },
      'items.mine': { path: '/items', params: { 'x-mine': { in: 'header', type: true, required: true } } },
      'items.old': { path: '/items', params: { version: { in: 'query', type: 'v2', required: true } } },
      'notes.create': { method: 'POST', path: '/notes', params: { text: { in: 'form', type: 'string', required: true } } },
      'notes.pin': { method: 'POST', path: '/notes', params: { text: { in: 'form', type: 'string', required: true }, pinned: { in: 'form', type: true, required: true } } } } });
    const by = (name: string) => () => ({ by: name });
    const { fetch } = fakeFetch(fakeProvider(shared, { key: 'k', operations: { 'items.list': by('list'), 'items.inbox': by('inbox'),
      'items.mine': by('mine'), 'items.old': by('old'), 'notes.create': by('create'), 'notes.pin': by('pin') } }));
    const api = client(shared, { token: 'k', fetch });
    await expect(api.items.inbox({ inbox: true })).resolves.toEqual({ by: 'inbox' });
    await expect(api.items.mine({ 'x-mine': true })).resolves.toEqual({ by: 'mine' });
    await expect(api.items.old({ version: 'v2' })).resolves.toEqual({ by: 'old' });
    await expect(api.notes.pin({ text: 'a', pinned: true })).resolves.toEqual({ by: 'pin' });
    await expect(api.notes.create({ text: 'a' })).resolves.toEqual({ by: 'create' });
    const sent = (query: string) => fetch(`https://api.shared.test/items${query}`, { headers: { authorization: 'Bearer k' } }).then(answer);
    for (const query of ['?inbox=false', '?inbox=1', '?version=v1']) await expect(sent(query)).resolves.toEqual({ status: 200, body: { by: 'list' } });
  });

  test('a function receives the headers; of two operations on one route, the one whose required header the call carries answers', async () => {
    const versioned = defineProvider({ id: 'versioned', name: 'Versioned', auth: [{ kind: 'key' }],
      http: { baseUrl: 'https://api.versioned.test', headers: { 'x-version': '1' } }, operations: {
        'items.list': { path: '/items', params: { 'x-version': { in: 'header', type: 'string' } } },
        'items.mine': { path: '/items', params: { from: { in: 'header', type: 'string', required: true } } } } });
    const calls: FakeCall[] = [];
    const by = (name: string) => (call: FakeCall) => { calls.push(call); return { by: name }; };
    const { fetch } = fakeFetch(fakeProvider(versioned, { key: 'k', operations: { 'items.list': by('list'), 'items.mine': by('mine') } }));
    const api = client(versioned, { token: 'k', fetch });
    await expect(api.items.list({ 'x-version': '2' })).resolves.toEqual({ by: 'list' });
    await expect(api.items.mine({ from: 'ana@versioned.test' })).resolves.toEqual({ by: 'mine' });
    expect(calls.map(call => [call.headers['x-version'], call.headers.from, call.headers.authorization])).toEqual([
      ['2', undefined, 'Bearer k'], ['1', 'ana@versioned.test', 'Bearer k']]);
  });

  /** Basic client authentication, a JSON token body and no PKCE: the three shapes that differ from the defaults. */
  const basicJson = defineProvider({ id: 'basicjson', name: 'Basic JSON', http: { baseUrl: 'https://api.basicjson.test' },
    auth: [{ kind: 'oauth2', authorizeUrl: 'https://basicjson.test/authorize', tokenUrl: 'https://basicjson.test/token',
      refreshUrl: 'https://basicjson.test/refresh', clientAuth: 'basic', json: true, pkce: false, scopeSeparator: ',' }],
    scopes: { default: ['read', 'write'], requireGranted: true }, revoke: { url: 'https://basicjson.test/revoke', token: ['refresh'] },
    identify: { request: { path: '/me' }, id: 'id', name: 'tokenAnswer.workspace.name' } });
  const kitClient = { clientId: 'kit-client', clientSecret: 'kit-secret' };
  const redirectUri = 'https://app.test/callback';

  test('an OAuth 2 entry with Basic client authentication, a JSON body and no PKCE connects on its fake', async () => {
    const { fetch, calls } = fakeFetch(fakeProvider(basicJson, { key: 'k' }));
    const start = await startConnect(basicJson, { clientId: 'kit-client', redirectUri, state: 's' });
    await expect(finishConnect(basicJson, { client: kitClient, code: 'kit-code', redirectUri, fetch, onRevokeFailed: () => undefined }))
      .resolves.toMatchObject({ secret: { accessToken: 'k', refreshToken: 'kit-refresh' }, account: { id: 'kit-account', name: 'kit-workspace.name' } });
    expect(start.codeVerifier).toBeUndefined();
    expect(calls[0]).toMatchObject({ url: 'https://basicjson.test/token', body: JSON.stringify({ code: 'kit-code', redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    await expect(exchangeCode(basicJson, kitClient, { code: 'kit-code', redirectUri, fetch })).resolves.toMatchObject({ extras: { scope: 'read,write' } });
    await expect(exchangeCode(basicJson, kitClient, { code: 'other', redirectUri, fetch })).rejects.toBeInstanceOf(GrantRevoked);
    await expect(refreshGrant(basicJson, kitClient, 'kit-refresh', { fetch })).resolves.toMatchObject({ accessToken: 'k' });
    await expect(refreshGrant(basicJson, kitClient, 'old', { fetch })).rejects.toBeInstanceOf(GrantRevoked);
    await expect(revokeGrant(basicJson, { refreshToken: 'kit-refresh', client: kitClient, fetch })).resolves.toBeUndefined();
  });

  test('a wrong client is refused 401 invalid_client, at the token, refresh and revoke URLs alike', async () => {
    const { fetch } = fakeFetch(fakeProvider(basicJson, { key: 'k' }));
    const wrong = { clientId: 'kit-client', clientSecret: 'other' };
    const refused = { code: 'request_failed', status: 401, detail: 'invalid_client' };
    await expect(exchangeCode(basicJson, wrong, { code: 'kit-code', redirectUri, fetch })).rejects.toMatchObject(refused);
    await expect(refreshGrant(basicJson, wrong, 'kit-refresh', { fetch })).rejects.toMatchObject(refused);
    await expect(revokeGrant(basicJson, { refreshToken: 'kit-refresh', client: wrong, fetch })).rejects.toMatchObject(refused);
    // The client in the body, where the entry declares Basic, is no client either.
    const body = JSON.stringify({ grant_type: 'authorization_code', code: 'kit-code', redirect_uri: redirectUri, client_id: 'kit-client', client_secret: 'kit-secret' });
    expect((await fetch('https://basicjson.test/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401);
  });

  test.each([['basic', 'https://basicjson.test/revoke'], [undefined, 'https://basicjson.test/revoke'], ['basic', 'https://basicjson.test/token'],
    [undefined, 'https://basicjson.test/token']] as const)(
    'clientAuth %j, a revoke at %s: each request is answered only with the client authentication declared', async (clientAuth, revokeUrl) => {
    const split = defineProvider({ ...basicJson, auth: [{ kind: 'oauth2', authorizeUrl: 'https://basicjson.test/authorize',
      tokenUrl: 'https://basicjson.test/token', ...clientAuth && { clientAuth }, pkce: false }], revoke: { url: revokeUrl, token: ['refresh'] } });
    const { fetch } = fakeFetch(fakeProvider(split, { key: 'k' }));
    const basic = `Basic ${btoa('kit%2Dclient:kit%2Dsecret')}`;
    const pair = { client_id: 'kit-client', client_secret: 'kit-secret' };
    const requests = { exchange: [{ grant_type: 'authorization_code', code: 'kit-code', redirect_uri: redirectUri }, 'https://basicjson.test/token'],
      refresh: [{ grant_type: 'refresh_token', refresh_token: 'kit-refresh' }, 'https://basicjson.test/token'], revoke: [{ token: 'kit-refresh' }, revokeUrl] } as const;
    for (const [params, url] of Object.values(requests)) {
      const sent = (byBasic: boolean, inBody: boolean) => fetch(url, { method: 'POST', ...byBasic && { headers: { authorization: basic } },
        body: new URLSearchParams({ ...params, ...inBody ? pair : { client_id: 'kit-client' } }) });
      const declared = clientAuth === 'basic';
      expect((await sent(declared, !declared)).status).toBe(200);
      // The other method, and both together, are no client.
      for (const [byBasic, inBody] of [[!declared, declared], [true, true]] as const) {
        expect(await answer(await sent(byBasic, inBody))).toEqual({ status: 401, body: { error: 'invalid_client' } });
      }
    }
    await expect(exchangeCode(split, kitClient, { code: 'kit-code', redirectUri, fetch })).resolves.toMatchObject({ grant: { accessToken: 'k' } });
    await expect(refreshGrant(split, kitClient, 'kit-refresh', { fetch })).resolves.toMatchObject({ accessToken: 'k' });
    await expect(revokeGrant(split, { refreshToken: 'kit-refresh', client: kitClient, fetch })).resolves.toBeUndefined();
  });

  test("clientAuth 'none': each request is answered with the client's id alone, and refused with a secret or Basic", async () => {
    const open = defineProvider({ ...basicJson, auth: [{ kind: 'oauth2', authorizeUrl: 'https://basicjson.test/authorize',
      tokenUrl: 'https://basicjson.test/token', clientAuth: 'none' }], revoke: { url: 'https://basicjson.test/revoke', token: ['refresh'] } });
    const { fetch } = fakeFetch(fakeProvider(open, { key: 'k', client: { clientId: 'app' } }));
    const requests = { exchange: [{ grant_type: 'authorization_code', code: 'kit-code', redirect_uri: redirectUri, code_verifier: 'v' }, 'https://basicjson.test/token'],
      refresh: [{ grant_type: 'refresh_token', refresh_token: 'kit-refresh' }, 'https://basicjson.test/token'],
      revoke: [{ token: 'kit-refresh' }, 'https://basicjson.test/revoke'] } as const;
    for (const [params, url] of Object.values(requests)) {
      const sent = (extra: Record<string, string>, headers: Record<string, string> = {}) =>
        fetch(url, { method: 'POST', headers, body: new URLSearchParams({ ...params, client_id: 'app', ...extra }) });
      expect((await sent({})).status).toBe(200);
      for (const refused of [await sent({ client_secret: 'secret' }), await sent({}, { authorization: `Basic ${btoa('app:secret')}` })]) {
        expect(await answer(refused)).toEqual({ status: 401, body: { error: 'invalid_client' } });
      }
    }
    await expect(exchangeCode(open, { clientId: 'app' }, { code: 'kit-code', redirectUri, codeVerifier: 'v', fetch })).resolves.toMatchObject({ grant: { accessToken: 'k' } });
    await expect(refreshGrant(open, { clientId: 'app' }, 'kit-refresh', { fetch })).resolves.toMatchObject({ accessToken: 'k' });
    await expect(revokeGrant(open, { refreshToken: 'kit-refresh', client: { clientId: 'app' }, fetch })).resolves.toBeUndefined();
    await expect(exchangeCode(open, { clientId: 'other' }, { code: 'kit-code', redirectUri, codeVerifier: 'v', fetch })).rejects.toMatchObject({ status: 401 });
  });

  test('a PKCE entry is answered only with a code verifier, its client in the form body, and a given code and client', async () => {
    const pkce = defineProvider({ ...basicJson, auth: [{ kind: 'oauth2', authorizeUrl: 'https://basicjson.test/authorize', tokenUrl: 'https://basicjson.test/token' }] });
    const client = { clientId: 'app', clientSecret: 'secret' };
    const { fetch } = fakeFetch(fakeProvider(pkce, { key: 'k', client, code: 'c1' }));
    const form = (parts: Record<string, string>) => fetch('https://basicjson.test/token', { method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'c1', redirect_uri: redirectUri, client_id: 'app', client_secret: 'secret', ...parts }) });
    expect(await answer(await form({}))).toEqual({ status: 400, body: { error: 'invalid_grant' } });
    for (const blank of ['', '  ']) expect(await answer(await form({ code_verifier: blank }))).toEqual({ status: 400, body: { error: 'invalid_grant' } });
    expect((await form({ code_verifier: 'v' })).status).toBe(200);
    await expect(exchangeCode(pkce, client, { code: 'c1', redirectUri, codeVerifier: 'v', fetch })).resolves.toMatchObject({ grant: { accessToken: 'k' } });
    await expect(exchangeCode(pkce, kitClient, { code: 'c1', redirectUri, codeVerifier: 'v', fetch })).rejects.toMatchObject({ status: 401 });
  });

  test("a token or refresh request in another encoding than the entry's is 400 invalid_request", async () => {
    const basic = `Basic ${btoa('kit%2Dclient:kit%2Dsecret')}`;
    const code = { grant_type: 'authorization_code', code: 'kit-code', redirect_uri: redirectUri };
    const refresh = { grant_type: 'refresh_token', refresh_token: 'kit-refresh' };
    const form = defineProvider({ ...basicJson, auth: [{ kind: 'oauth2', authorizeUrl: 'https://basicjson.test/authorize',
      tokenUrl: 'https://basicjson.test/token', refreshUrl: 'https://basicjson.test/refresh', clientAuth: 'basic', pkce: false }] });
    for (const [entry, right, wrong] of [[basicJson, 'application/json', 'application/x-www-form-urlencoded'],
      [form, 'application/x-www-form-urlencoded;charset=UTF-8', 'application/json']] as const) {
      const { fetch } = fakeFetch(fakeProvider(entry, { key: 'k' }));
      for (const [url, grant] of [['https://basicjson.test/token', code], ['https://basicjson.test/refresh', refresh]] as const) {
        const body = entry === basicJson ? JSON.stringify(grant) : new URLSearchParams(grant).toString();
        const sent = (type?: string) => fetch(url, { method: 'POST', headers: { authorization: basic, ...type ? { 'content-type': type } : {} }, body });
        expect((await sent(right)).status).toBe(200);
        for (const type of [wrong, 'text/plain', undefined]) expect(await answer(await sent(type))).toEqual({ status: 400, body: { error: 'invalid_request' } });
      }
    }
    // Checked before the body is read: a JSON grant to a form entry that authenticates in the body finds no client there.
    const post = defineProvider({ ...basicJson, auth: [{ kind: 'oauth2', authorizeUrl: 'https://basicjson.test/authorize', tokenUrl: 'https://basicjson.test/token', pkce: false }] });
    const { fetch } = fakeFetch(fakeProvider(post, { key: 'k' }));
    const json = JSON.stringify({ ...code, client_id: 'kit-client', client_secret: 'kit-secret' });
    expect(await answer(await fetch('https://basicjson.test/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json })))
      .toEqual({ status: 400, body: { error: 'invalid_request' } });
  });

  test('a revoke with no token is 400 invalid_request', async () => {
    const { fetch } = fakeFetch(fakeProvider(basicJson, { key: 'k' }));
    const revoke = (body: Record<string, string>) => fetch('https://basicjson.test/revoke', { method: 'POST',
      headers: { authorization: `Basic ${btoa('kit%2Dclient:kit%2Dsecret')}` }, body: JSON.stringify(body) });
    expect(await answer(await revoke({ token_type_hint: 'refresh_token' }))).toEqual({ status: 400, body: { error: 'invalid_request' } });
    expect((await revoke({ token: 'kit-refresh' })).status).toBe(200);
  });

  test('an entry whose revoke URL is its token URL still connects, refreshes and revokes there', async () => {
    const shared = defineProvider({ ...basicJson, revoke: { url: 'https://basicjson.test/token', token: ['refresh'] } });
    const { fetch } = fakeFetch(fakeProvider(shared, { key: 'k' }));
    await expect(finishConnect(shared, { client: kitClient, code: 'kit-code', redirectUri, fetch, onRevokeFailed: () => undefined }))
      .resolves.toMatchObject({ secret: { accessToken: 'k' } });
    await expect(refreshGrant(shared, kitClient, 'kit-refresh', { fetch })).resolves.toMatchObject({ accessToken: 'k' });
    await expect(revokeGrant(shared, { refreshToken: 'kit-refresh', client: kitClient, fetch })).resolves.toBeUndefined();
  });

  test('with Basic client authentication, a client secret in the body as well is refused', async () => {
    const { fetch } = fakeFetch(fakeProvider(basicJson, { key: 'k' }));
    const sent = (body: Record<string, string>) => fetch('https://basicjson.test/token', { method: 'POST',
      headers: { authorization: `Basic ${btoa('kit%2Dclient:kit%2Dsecret')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'kit-code', redirect_uri: redirectUri, ...body }) });
    expect((await sent({})).status).toBe(200);
    expect(await answer(await sent({ client_id: 'kit-client', client_secret: 'kit-secret' }))).toEqual({ status: 401, body: { error: 'invalid_client' } });
  });

  const twoOnOne = defineProvider({ id: 'twoonone', name: 'Two on one', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
    auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.twoonone.test' },
    operations: { 'items.byA': { path: '/items', params: { a: { in: 'query', type: 'string', required: true } } },
      'items.byB': { path: '/items', params: { b: { in: 'query', type: 'string', required: true } } } } });
  test.each([['both carried, one parameter each: a tie', '?a=1&b=2'], ['none carried', '?c=3']])(
    'of two operations on one route with %s, the first declared answers', async (_, query) => {
      const { fetch } = fakeFetch(fakeProvider(twoOnOne, { key: 'k', operations: { 'items.byA': () => ({ by: 'a' }), 'items.byB': () => ({ by: 'b' }) } }));
      expect(await answer(await fetch(`https://api.twoonone.test/items${query}`, { headers: { authorization: 'Bearer k' } })))
        .toEqual({ status: 200, body: { by: 'a' } });
      expect(await answer(await fetch('https://api.twoonone.test/items?b=2', { headers: { authorization: 'Bearer k' } })))
        .toEqual({ status: 200, body: { by: 'b' } });
    });

  test("Slack's token answer holds the value given for the `save` key that reads it, and its kit values elsewhere", async () => {
    const { fetch } = fakeFetch(fakeProvider(slack, { key: 'k', values: { domain: 'slack.com', botUserId: 'U1' } }));
    await expect(finishConnect(slack, { client: kitClient, code: 'kit-code', redirectUri, fetch, onRevokeFailed: () => undefined }))
      .resolves.toMatchObject({ values: { botUserId: 'U1' }, account: { id: 'kit-team.id', name: 'kit-team.name' } });
  });

  test("Slack's revoke, a request, is answered to the connection's token and refused to another", async () => {
    const { fetch } = fakeFetch(fakeProvider(slack, { key: 'k', values: { domain: 'slack.com' } }));
    await expect(revokeGrant(slack, { accessToken: 'k', fetch, values: { domain: 'slack.com' } })).resolves.toBeUndefined();
    await expect(revokeGrant(slack, { accessToken: 'x', fetch, values: { domain: 'slack.com' } })).rejects.toMatchObject({ code: 'rejected' });
  });

  test("a `tokenAnswer.*` kit value never replaces the token or `expires_in`", async () => {
    const reads = defineProvider({ ...zoom, identify: { id: 'tokenAnswer.expires_in' } });
    const values = { accountId: 'acc', clientId: 'c' };
    const { fetch } = fakeFetch(fakeProvider(reads, { key: 'k', values }));
    await expect(requestToken(reads, { secret: { clientSecret: 'k' }, values, fetch }))
      .resolves.toMatchObject({ token: 'kit-token', extras: { expires_in: 3600 } });
  });
});

test('respondFrom matches a route whose url is a predicate', async () => {
  const respond = respondFrom([{ method: 'GET', url: url => url.host === 'a.test' && url.pathname.startsWith('/items/'),
    respond: () => new Response('item') }]);
  expect(await (await respond(new Request('https://a.test/items/7?full=1')))?.text()).toBe('item');
  expect(await respond(new Request('https://a.test/other'))).toBeNull();
});

test('respondFrom is null for a request no route matches', async () => {
  const respond = respondFrom([{ url: 'https://a.test/x', respond: () => new Response('a') }]);
  expect(await respond(new Request('https://b.test/x'))).toBeNull();
});

test('answers the first matching route and records the call', async () => {
  const fake = fakeFetch([
    { method: 'POST', url: 'https://api.test/items', respond: () => new Response('first') },
    { url: /api\.test/, respond: () => new Response('second') },
  ]);
  const response = await fake.fetch('https://api.test/items?q=one', {
    method: 'POST', headers: { 'X-Api-Key': 'k' }, body: 'body',
  });
  expect(await response.text()).toBe('first');
  expect(fake.calls).toEqual([{
    method: 'POST', url: 'https://api.test/items?q=one',
    headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-api-key': 'k' }, body: 'body',
  }]);
  expect(await (await fake.fetch(new Request('https://api.test/other?q=two'))).text()).toBe('second');
});

test('an unknown route throws and names it', async () => {
  await expect(fakeFetch([]).fetch('https://api.test/missing'))
    .rejects.toThrow('fakeFetch: no route for GET https://api.test/missing');
});

test('sequence repeats its last response', async () => {
  const next = sequence(() => new Response('a'), () => new Response('b'));
  expect(await next().text()).toBe('a');
  expect(await next().text()).toBe('b');
  expect(await next().text()).toBe('b');
});

const original: Sealed = { ciphertext: 'b3JpZ2luYWw=', iv: 'AAAAAAAAAAAAAAAA', authTag: 'AAAAAAAAAAAAAAAAAAAAAA==', kekVersion: 1, dekVersion: 1, format: 1 };
function storeFixture() {
  const stores = memoryStores();
  stores.secrets.put('connection', 'tenant', original);
  return { ...stores, connectionId: 'connection', freshTenantId: 'fresh-tenant' };
}

test('passes on the memory stores', async () => {
  const input = storeFixture();
  await expect(checkCredentialStore(input)).resolves.toBeUndefined();
  expect((await input.secrets.read('connection'))?.sealed).toEqual(original);
});

test('catches a store that ignores the expected version', async () => {
  const input = storeFixture();
  const secrets = { ...input.secrets, replace(id: string, sealed: Sealed) {
    input.secrets.put(id, 'tenant', sealed);
    return Promise.resolve(true);
  } };
  await expect(checkCredentialStore({ ...input, secrets }))
    .rejects.toThrow('checkCredentialStore: a replace at an old version was accepted');
  expect((await input.secrets.read('connection'))?.sealed).toEqual(original);
});

test('catches a store that drops the format', async () => {
  const input = storeFixture();
  const secrets = { ...input.secrets, async read(id: string) {
    const row = await input.secrets.read(id);
    return row ? { ...row, sealed: { ...row.sealed, format: 1 as const } } : null;
  } };
  await expect(checkCredentialStore({ ...input, secrets })).rejects.toThrow(/checkCredentialStore: .*round trip/);
});

test('catches two inserts that both win', async () => {
  const input = storeFixture();
  const tenantKeys = { ...input.tenantKeys, insert(_id: string, wrapped: Sealed) {
    return Promise.resolve({ wrapped, version: 1 });
  } };
  await expect(checkCredentialStore({ ...input, tenantKeys })).rejects.toThrow('checkCredentialStore: two inserts returned different keys');
});

test('catches tenant keys that ignore the expected version', async () => {
  const input = storeFixture();
  const tenantKeys = { ...input.tenantKeys, async replace(id: string, wrapped: Sealed) {
    const current = await input.tenantKeys.read(id);
    return current ? input.tenantKeys.replace(id, wrapped, current.version) : false;
  } };
  await expect(checkCredentialStore({ ...input, tenantKeys }))
    .rejects.toThrow('checkCredentialStore: a tenant-key replace at an old version was accepted');
});

test('regular expression routes match repeated requests with stateful flags', async () => {
  const route = /https:/g;
  const fake = fakeFetch([{ url: route, respond: () => new Response('ok') }]);
  expect(await (await fake.fetch('https://api.test/items')).text()).toBe('ok');
  expect(await (await fake.fetch('https://api.test/items')).text()).toBe('ok');
  expect(route.lastIndex).toBe(0);
});

test('passes on stores that normalize base64 through bytes', async () => {
  const input = storeFixture();
  function normalized(sealed: Sealed): Sealed {
    const iv = Buffer.from(sealed.iv, 'base64');
    const tag = Buffer.from(sealed.authTag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('invalid_test_envelope');
    return { ...sealed, ciphertext: Buffer.from(sealed.ciphertext, 'base64').toString('base64'),
      iv: iv.toString('base64'), authTag: tag.toString('base64') };
  }
  const secrets = { ...input.secrets, replace(id: string, sealed: Sealed, expected: number) {
    return input.secrets.replace(id, normalized(sealed), expected);
  } };
  const tenantKeys = { ...input.tenantKeys,
    insert(id: string, wrapped: Sealed) { return input.tenantKeys.insert(id, normalized(wrapped)); },
    replace(id: string, wrapped: Sealed, expected: number) { return input.tenantKeys.replace(id, normalized(wrapped), expected); },
  };
  await expect(checkCredentialStore({ ...input, secrets, tenantKeys })).resolves.toBeUndefined();
});

test('catches tenant-key inserts that corrupt the winning candidate', async () => {
  const input = storeFixture();
  const tenantKeys = { ...input.tenantKeys, insert(id: string, wrapped: Sealed) {
    return input.tenantKeys.insert(id, { ...wrapped, format: 1 });
  } };
  await expect(checkCredentialStore({ ...input, tenantKeys }))
    .rejects.toThrow('checkCredentialStore: the winning tenant key did not match an inserted candidate');
});

test('names the scenario that failed, not the restore that followed', async () => {
  const input = storeFixture();
  const secrets = { ...input.secrets, replace: () => Promise.resolve(false) };
  await expect(checkCredentialStore({ ...input, secrets }))
    .rejects.toThrow('checkCredentialStore: a replace at the current version was refused');
});
