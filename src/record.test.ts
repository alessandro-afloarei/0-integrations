import { existsSync, globSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { lookupNames } from './account.js';
import { defineProvider, type Entry, type Value } from './catalogue.js';
import { serpapi } from './catalogue/serpapi.js';
import { trello } from './catalogue/trello.js';
import { zoom } from './catalogue/zoom.js';
import { ProviderHttpError } from './errors.js';
import { defaultFetch } from './http.js';
import { answerReads, BAD_KEY, GOOD_KEY, kitValues, onlyRead, playScenario, recorder, replay, scrub, signIn, type Exchange,
  type KitScenario, type Recording, type Swap } from './kit.test-support.js';
import { parseJson, readPath } from './rules.js';
import { fakeFetch, fakeProvider } from './testing.js';
import { tierOf } from './tier.js';

/**
 * Records a provider from a test account, replacing its recording:
 * `RECORD_PROVIDER=<id> RECORD_KEY=… [RECORD_VALUES='{"<plain field>":"…"}'] pnpm vitest run src/record.test.ts`.
 * A module's kit scenario of that name is recorded first; else the entry `src/catalogue/<id>.ts` signs in, and only what
 * the entry reads from each answer is written. A scenario that names a stand-in also takes the test account's own as
 * `RECORD_ACCOUNT`. Read the file before committing it: a scenario's recording keeps each answer whole.
 */
const provider = process.env.RECORD_PROVIDER ?? '';
const key = process.env.RECORD_KEY ?? '';

/** The kit scenario named `name`, found among every `src/<id>/scenario.test-support.ts` export by its shape. */
async function findScenario(name: string): Promise<KitScenario<unknown, unknown> | undefined> {
  const modules = await Promise.all(globSync('src/*/scenario.test-support.ts')
    .map(file => import(pathToFileURL(file).href) as Promise<Record<string, unknown>>));
  return modules.flatMap(module => Object.values(module)).find((value): value is KitScenario<unknown, unknown> =>
    typeof value === 'object' && value !== null && 'provider' in value && value.provider === name
      && 'page' in value && typeof value.page === 'function');
}

/** The entry `src/catalogue/<id>.ts` exports under its id. */
async function findEntry(id: string): Promise<Entry | undefined> {
  const file = `src/catalogue/${id}.ts`;
  if (!/^[a-z][a-z0-9]*$/u.test(id) || !existsSync(file)) return undefined;
  return Object.values(await import(pathToFileURL(file).href) as Record<string, unknown>).find((value): value is Entry =>
    typeof value === 'object' && value !== null && 'id' in value && value.id === id);
}

/** Swaps what the scenario names by its stand-in for the test account's own on the wire, and back in the answers, so a
 * recording replays without them. */
function swapping(real: typeof fetch, standIns: readonly [kit: string, real: string][]): typeof fetch {
  const swap = (text: string, toReal: boolean) => standIns.reduce((out, [kit, actual]) =>
    (toReal ? out.replaceAll(kit, actual) : out.replaceAll(actual, kit)), text);
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await real(new Request(swap(request.url, true), request));
    return new Response(swap(await response.text(), false), { status: response.status, headers: response.headers });
  };
}

async function recordScenario(scenario: KitScenario<unknown, unknown>, secret: string): Promise<Exchange[]> {
  const standIns: [string, string][] = scenario.standIn === undefined ? [] : [[scenario.standIn, process.env.RECORD_ACCOUNT ?? '']];
  if (standIns.some(([, actual]) => actual === '')) throw new Error(`${scenario.provider} needs RECORD_ACCOUNT`);
  const real = standIns.length === 0 ? fetch : swapping(fetch, standIns);
  const good = recorder(real, 'good');
  const bad = recorder(real, 'bad');
  await playScenario(scenario, side => (side === 'good' ? good.fetch : bad.fetch), { good: secret, bad: BAD_KEY });
  return scrub([...good.exchanges, ...bad.exchanges], { sent: [[secret, GOOD_KEY], ...standIns.map(([kit, actual]): Swap => [actual, kit])] });
}

/** What failed, by its code and status alone: a provider's text never reaches the test's output. */
const failure = (what: string, error: unknown) => (error instanceof ProviderHttpError
  ? `${what} ${error.code}${error.status === null ? '' : ` (${String(error.status)})`}`
  : `${what} ${error instanceof TypeError ? error.message : error instanceof Error ? error.name : 'a non-error'}`);

/** The paths identify reads a value at, from its answer or from the token answer (`tokenAnswer.` stripped). */
const identityPaths = (value: Value | undefined) => (value === undefined ? [] : lookupNames({ identify: { id: value } })
  .filter(name => !name.startsWith('connection.')).map(name => name.replace(/^tokenAnswer\./u, '')));

/** Signs in to an entry with the test account's key and plain values (a token entry's token request, then identify),
 * then with a bad key, which must be refused as `rejected`. Each answer keeps only the paths the entry reads; the key,
 * each plain value given, every token issued and the account identify names are swapped for the kit's stand-ins, so the
 * recording replays with the kit's key and values. */
async function recordEntry(entry: Entry, secret: string, given: Readonly<Record<string, string>>, real: typeof fetch): Promise<Exchange[]> {
  const kit = kitValues(entry);
  const good = recorder(real, 'good');
  const bad = recorder(real, 'bad');
  await signIn(entry, secret, good.fetch, { ...kit, ...given }).catch((error: unknown) => {
    throw new Error(failure('recording stopped: the sign-in with the key failed with', error));
  });
  const refused = await signIn(entry, BAD_KEY, bad.fetch, { ...kit, ...given }).then(() => undefined, (error: unknown) => error);
  if (refused === undefined) throw new Error('recording stopped: the bad key signed in; it must be refused as rejected');
  if (!(refused instanceof ProviderHttpError && refused.code === 'rejected')) {
    throw new Error(failure('recording stopped: the bad key must be refused as rejected, not', refused));
  }
  const [auth] = entry.auth;
  /** Each string or number the good answers hold at one of `paths`, for the stand-in `kit`. */
  const found = (paths: readonly string[], stand: string) => good.exchanges.flatMap(({ response }) => paths.map(path => readPath(response, path)))
    .filter(value => typeof value === 'string' || typeof value === 'number').map((value): Swap => [String(value), stand]);
  const reads = answerReads(entry);
  return scrub([...good.exchanges, ...bad.exchanges].map(exchange => ({ ...exchange, response: onlyRead(exchange.response, reads) ?? null })), {
    sent: [[secret, GOOD_KEY],
      ...Object.entries(kit).flatMap(([name, stand]): Swap[] => (given[name] === undefined || given[name] === stand ? [] : [[given[name], stand]])),
      ...auth.kind === 'token' ? found([auth.request.token ?? 'access_token'], 'kit-token') : []],
    answered: [...found(identityPaths(entry.identify?.id), 'kit-account'), ...found(identityPaths(entry.identify?.name), 'kit-name')] });
}

/** A module's kit scenario of that name, else the entry, recorded from a test account. */
async function record(id: string, secret: string, given: Readonly<Record<string, string>>): Promise<Exchange[]> {
  const scenario = await findScenario(id);
  if (scenario) return recordScenario(scenario, secret);
  const entry = await findEntry(id);
  if (!entry) throw new Error(`no kit scenario or entry for ${id}`);
  return recordEntry(entry, secret, given, defaultFetch(entry));
}

/** `RECORD_VALUES`: a JSON object of strings. The message never quotes it: it may hold a real value. */
function recordValues(): Readonly<Record<string, string>> {
  const values = parseJson(process.env.RECORD_VALUES ?? '{}');
  if (typeof values !== 'object' || values === null || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) {
    throw new Error('RECORD_VALUES must be a JSON object of strings');
  }
  return values as Record<string, string>;
}

/** Writes `<folder>/<provider>.recording.json`, marked as recorded from a test account; an older one is replaced. */
function write(folder: string, name: string, exchanges: Exchange[]): string {
  const recording: Recording = { provider: name, synthetic: false, source: 'Recorded from a test account by src/record.test.ts.',
    recordedAt: new Date().toISOString().slice(0, 10), exchanges };
  const file = join(folder, `${name}.recording.json`);
  writeFileSync(file, `${JSON.stringify(recording, null, 1)}\n`);
  return file;
}

test.runIf(provider !== '' && key !== '')(`records ${provider} from a test account`, async () => {
  write(fileURLToPath(new URL('./catalogue/', import.meta.url)), provider, await record(provider, key, recordValues()));
}, 120_000);

describe('recording an entry with no module, on its derived fake standing in for the provider', () => {
  let parent = '';
  beforeAll(() => { parent = mkdtempSync(fileURLToPath(new URL('../.record-test-', import.meta.url))); });
  afterAll(() => { rmSync(parent, { recursive: true, force: true }); });
  type Wrap = (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;

  /** Records the entry with a test account's `key` and plain `values` (each beside the kit's), then reads the file back. */
  async function recordOnFake(entry: Entry, data: { key: string; values?: Record<string, string>; account?: unknown; wrap?: Wrap }) {
    const folder = mkdtempSync(join(parent, 'run-'));
    const { values = {}, wrap = (fetch: typeof globalThis.fetch) => fetch } = data;
    const { fetch } = fakeFetch(fakeProvider(entry, { key: data.key, values: { ...kitValues(entry), ...values }, account: data.account }));
    const written = await recordEntry(entry, data.key, values, wrap(fetch)).then(exchanges => write(folder, entry.id, exchanges), (error: unknown) => error);
    if (typeof written !== 'string') return { folder, refused: written instanceof Error ? written.message : 'not an Error', text: '', recording: undefined };
    const text = readFileSync(written, 'utf8');
    return { folder, file: written, refused: undefined, text, recording: JSON.parse(text) as Recording };
  }

  /** A provider whose good answers are changed by `edit` (the bad key's are kept, unless `bad`). */
  const answering = (edit: (body: unknown, request: Request) => unknown, bad = false): Wrap => fetch => async (input, init) => {
    const request = new Request(input, init);
    const response = await fetch(request.clone());
    if (response.status >= 400 && !bad) return response;
    return Response.json(edit(await response.json(), request), { status: response.status });
  };
  /** A provider whose answers carry `link` and `content-type` headers made from what was sent, written by `as`. */
  const echoing = (as: (sent: string) => string = sent => sent): Wrap => fetch => async (input, init) => {
    const request = new Request(input, init);
    const [url = '', body = '', authorization = ''] = [request.url, await request.clone().text(), request.headers.get('authorization') ?? ''].map(as);
    const response = await fetch(request);
    return new Response(response.body, { status: response.status,
      headers: { link: `<${url}>; rel="self"; auth="${encodeURIComponent(authorization)}"`, 'content-type': `application/json; echo=${encodeURIComponent(body)}` } });
  };

  /** Signs in on the recording with the kit's key and values, as the table test does. */
  const replayed = (entry: Entry, recording: Recording | undefined) => recording === undefined ? Promise.reject(new Error('nothing written'))
    : Promise.all([signIn(entry, GOOD_KEY, replay(recording, 'good')), signIn(entry, BAD_KEY, replay(recording, 'bad')).catch((error: unknown) => error)]);

  test('a key in the query: the URLs hold the kit key, the account is the kit account, and the file replays as recorded', async () => {
    const { file = '', text, recording } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: echoing(),
      account: { account_id: 'acct-7f3a90', account_email: 'ana.lopez@lumen.io' } });
    expect(recording?.exchanges.map(exchange => [exchange.url, exchange.response])).toEqual([
      [`https://serpapi.com/account?api_key=${GOOD_KEY}`, { account_id: 'kit-account', account_email: 'kit-name' }],
      [`https://serpapi.com/account?api_key=${BAD_KEY}`, {}]]);
    for (const real of ['real-key-1', 'acct-7f3a90', 'ana.lopez']) expect(text).not.toContain(real);
    expect(await replayed(serpapi, recording)).toMatchObject([{ account: { id: 'kit-account', name: 'kit-name' } }, { code: 'rejected' }]);
    expect(tierOf('serpapi', [{ file: basename(file), synthetic: recording?.synthetic ?? true }])).toBe('recorded');
    expect(recording).toMatchObject({ provider: 'serpapi', synthetic: false, source: 'Recorded from a test account by src/record.test.ts.' });
  });

  test('a plain value in a header: echoed as is and percent-encoded, it is written as its kit value', async () => {
    const { text, recording } = await recordOnFake(trello, { key: 'real-key-1', values: { apiKey: 'real a/1' }, wrap: echoing() });
    expect(recording?.exchanges[0]?.headers?.link).toContain(encodeURIComponent(`oauth_consumer_key="kit-apiKey", oauth_token="${GOOD_KEY}"`));
    for (const real of ['real a/1', encodeURIComponent('real a/1'), 'real-key-1']) expect(text).not.toContain(real);
    expect(await replayed(trello, recording)).toMatchObject([{ account: { id: 'kit-account', name: 'kit-name' } }, { code: 'rejected' }]);
  });

  test('a token entry: only the token and its life are kept, the token as kit-token, the body with the kit values; it replays', async () => {
    const { text, recording } = await recordOnFake(zoom, { key: 'real-key-1', values: { accountId: 'real-acct-1', clientId: 'real-cid-1' },
      wrap: answering(body => ({ ...body as object, access_token: 'zoom-issued-7Hk2', refresh_token: 'rt-real-99', scope: 'user:read' })) });
    expect(recording?.exchanges.map(({ key: side, body, status, response }) => [side, body, status, response])).toEqual([
      ['good', 'grant_type=account_credentials&account_id=kit-accountId', 200, { access_token: 'kit-token', expires_in: 3600 }],
      ['bad', 'grant_type=account_credentials&account_id=kit-accountId', 400, {}]]);
    for (const real of ['zoom-issued-7Hk2', 'rt-real-99', 'user:read', 'real-acct-1', 'real-cid-1', 'real-key-1']) expect(text).not.toContain(real);
    expect(await replayed(zoom, recording)).toMatchObject([{ account: { id: 'kit-accountId' } }, { code: 'rejected' }]);
  });

  /** An entry reading from its answers everything the engine can: identify, `save`, `rejectWhen`, the error's code, its
   * rules, a rate limit and a body wait. */
  const reading = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
    fields: [{ name: 'apiKey', title: 'API key', secret: true }], auth: [{ kind: 'key' }],
    http: { baseUrl: 'https://api.acme.test', rateLimit: { when: [{ path: 'limits.left', equals: 0 }] },
      retry: { waitFromBody: { path: 'wait_ms', unit: 'ms' } } },
    identify: { request: { path: '/me' }, id: 'user.id', name: ['user.display', 'user.login'], rejectWhen: [{ path: 'state', equals: 'disabled' }] },
    save: { plan: 'org.plan' }, errors: { detail: ['error.code'], rules: [{ when: { path: 'gone', equals: true }, code: 'not_found' }] } });

  test('hostile: only the paths the entry reads are written; tokens, names, a phone, an address and other people are dropped', async () => {
    const { text, recording } = await recordOnFake(reading, { key: 'real-key-1', account: {
      user: { id: 'u-real-881', display: 'Ana Lopez', login: 'alopez', full_name: 'Ana Maria Lopez', phone: '(415) 867-5309' },
      org: { plan: 'team', address: '1 Main St, Springfield', members: [{ name: 'Bob Stone' }] },
      refresh_token: 'rt-real-99', id_token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1LXJlYWwtODgxIn0.', state: 'active',
      limits: { left: 5, total: 100 }, wait_ms: 10, gone: false, error: { code: 'none', message: 'Jane Roe was here' } } });
    expect(recording?.exchanges[0]?.response).toEqual({ user: { id: 'kit-account', display: 'kit-name', login: 'kit-name' },
      org: { plan: 'team' }, state: 'active', limits: { left: 5 }, wait_ms: 10, gone: false, error: { code: 'none' } });
    for (const real of ['rt-real-99', 'eyJ', 'Ana', 'alopez', '867-5309', 'Main St', 'Bob Stone', 'Jane Roe', 'total', 'u-real-881']) {
      expect(text).not.toContain(real);
    }
    expect(answerReads(reading).sort()).toEqual(['error.code', 'gone', 'limits.left', 'org.plan', 'state', 'user.display', 'user.id',
      'user.login', 'wait_ms']);
  });

  test('a path read as one whole key, and an array, keep the answer\'s own shape', () => {
    expect(onlyRead({ '@odata.nextLink': 'n', '@odata': { nextLink: 'x' }, other: 1 }, ['@odata.nextLink'])).toEqual({ '@odata.nextLink': 'n' });
    expect(onlyRead([{ id: 'a', name: 'n', secret: 's' }, { id: 'b' }], ['0.id', '0.name'])).toEqual([{ id: 'a', name: 'n' }]);
    expect(onlyRead('text', ['id'])).toBeUndefined();
  });

  /** A token entry whose identify reads the token answer, PayPal's way. */
  const tokenRead = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
    fields: [{ name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Client secret', secret: true }],
    auth: [{ kind: 'token', request: { url: 'https://api.acme.test/oauth2/token', body: { grant_type: 'client_credentials' },
      basic: ['{clientId}', '{clientSecret}'] } }],
    http: { baseUrl: 'https://api.acme.test' }, identify: { id: 'tokenAnswer.app_id' } });

  test('an id read from the token answer is written as the kit account, and the token answer keeps nothing else', async () => {
    const { text, recording } = await recordOnFake(tokenRead, { key: 'real-key-1', values: { clientId: 'real-cid-1' },
      wrap: answering(body => ({ ...body as object, app_id: 'APP-real-77', refresh_token: 'rt-real-99', id_token: 'jwt-real-1' })) });
    expect(recording?.exchanges[0]?.response).toEqual({ access_token: 'kit-token', expires_in: 3600, app_id: 'kit-account' });
    for (const real of ['APP-real-77', 'rt-real-99', 'jwt-real-1']) expect(text).not.toContain(real);
    expect(await replayed(tokenRead, recording)).toMatchObject([{ account: { id: 'kit-account' } }, { code: 'rejected' }]);
  });

  test('a value read whole is swapped, and one holding a real value inside it refuses the recording', async () => {
    const plan = (value: string) => answering(body => ({ ...body as object, org: { plan: value } }));
    const swapped = await recordOnFake(reading, { key: 'real-key-1', wrap: plan('real-key-1') });
    expect(swapped.recording?.exchanges[0]?.response).toMatchObject({ org: { plan: GOOD_KEY } });
    const inside = await recordOnFake(reading, { key: 'real-key-1', wrap: plan('plan of real-key-1') });
    expect(inside.refused).toBe('recording refused: the value for kit-good-key is still in it after the swap, in a form the recorder does not know');
    expect(readdirSync(inside.folder)).toEqual([]);
  });

  test('a number is replaced only when it is the whole real value; one holding it by part is never rewritten, and refuses', async () => {
    const id = (left: number) => answering(body => ({ ...body as object, user: { id: 48213, display: 'Ana Lopez' }, limits: { left } }));
    expect((await recordOnFake(reading, { key: 'real-key-1', wrap: id(5) })).recording?.exchanges[0]?.response)
      .toMatchObject({ user: { id: 'kit-account', display: 'kit-name' }, limits: { left: 5 } });
    expect((await recordOnFake(reading, { key: 'real-key-1', wrap: id(482130) })).refused)
      .toBe('recording refused: the value for kit-account is still in it after the swap, in a form the recorder does not know');
    // In a request body too: a number is never rewritten into a string by part.
    const sent = (n: number): Exchange[] => [{ key: 'good', method: 'POST', url: 'https://api.acme.test/a', body: { n }, status: 200, response: null }];
    expect(scrub(sent(48213), { sent: [['48213', 'kit-account']] })[0]?.body).toEqual({ n: 'kit-account' });
    expect(() => scrub(sent(482130), { sent: [['48213', 'kit-account']] })).toThrow('the value for kit-account is still in it');
  });

  test.each<[string, (sent: string) => string]>([
    ['upper-cased', sent => sent.toUpperCase()],
    ['as base64', sent => Buffer.from(sent).toString('base64')],
    ['inside a JWT\'s payload', sent => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: sent })).toString('base64url')}.sig`],
  ])('hostile: the key echoed %s refuses the recording, and nothing is written', async (_, as) => {
    const { refused, folder } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: echoing(as) });
    expect(refused).toBe('recording refused: the value for kit-good-key is still in it after the swap, in a form the recorder does not know');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: an account id echoed lower-cased in a header refuses the recording', async () => {
    const lowered: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return new Response(response.body, { status: response.status, headers: { link: '</users/acct-7f3a90>; rel="me"' } });
    };
    const { refused } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: lowered, account: { account_id: 'ACCT-7F3A90', account_email: 'kit-name' } });
    expect(refused).toBe('recording refused: the value for kit-account is still in it after the swap, in a form the recorder does not know');
  });

  test('hostile: a value too short to swap safely refuses the recording, and nothing is written', async () => {
    const { refused, folder } = await recordOnFake(trello, { key: 'real-key-1', values: { apiKey: 'q7' } });
    expect(refused).toMatch(/^recording refused: the value for kit-apiKey is under 4 characters/u);
    expect(refused).not.toContain('q7');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: a value echoed in a form the swap does not know refuses the recording, and nothing is written', async () => {
    // Lowercase percent escapes: `real%2fa1`, where the swap knows `real%2Fa1`; the last check decodes them.
    const { refused, folder } = await recordOnFake(trello, { key: 'real-key-1', values: { apiKey: 'real/a1' },
      wrap: echoing(sent => encodeURIComponent(sent).toLowerCase()) });
    expect(refused).toBe('recording refused: the value for kit-apiKey is still in it after the swap, in a form the recorder does not know');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('a redirected identify keeps its location and replays', async () => {
    const moved: Wrap = fetch => (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/account') return Promise.resolve(new Response(null, { status: 307, headers: { location: `/v2/account${url.search}` } }));
      return fetch(new Request(request.url.replace('/v2/account', '/account'), request));
    };
    const { recording } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: moved });
    expect(recording?.exchanges[0]?.headers?.location).toBe(`/v2/account?api_key=${GOOD_KEY}`);
    expect(await replayed(serpapi, recording)).toMatchObject([{ account: { id: 'kit-account' } }, { code: 'rejected' }]);
  });

  test('an answer that is not JSON is written as null, its status kept, and the bad key still reads as rejected', async () => {
    const text: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return response.status === 401 ? new Response('Unauthorized: Jane Roe, 1 Main St', { status: 401 }) : response;
    };
    const { text: written, recording } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: text });
    expect(recording?.exchanges[1]).toMatchObject({ status: 401, response: null });
    expect(written).not.toContain('Jane Roe');
    expect(await replayed(serpapi, recording)).toMatchObject([{ account: { id: 'kit-account' } }, { code: 'rejected' }]);
  });

  test('a good answer that is not JSON stops the recording, naming the code and status, never the text', async () => {
    const text: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return response.ok ? new Response('<html>Jane Roe, 1 Main St</html>', { status: 200 }) : response;
    };
    const { refused, folder } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: text });
    expect(refused).toBe('recording stopped: the sign-in with the key failed with invalid_response (200)');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('a bad key that signs in, or fails otherwise, stops the recording', async () => {
    const open: Wrap = fetch => (input, init) => fetch(new Request(new Request(input, init).url.replace(BAD_KEY, 'real-key-1')));
    expect((await recordOnFake(serpapi, { key: 'real-key-1', wrap: open })).refused)
      .toBe('recording stopped: the bad key signed in; it must be refused as rejected');
    const down: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return response.status === 401 ? Response.json({ message: 'Jane Roe' }, { status: 500 }) : response;
    };
    expect((await recordOnFake(serpapi, { key: 'real-key-1', wrap: down })).refused)
      .toBe('recording stopped: the bad key must be refused as rejected, not unavailable (500)');
  });

  test('an id with no scenario and no entry fails, naming the id', async () => {
    await expect(record('nope', 'real-key-1', {})).rejects.toThrow('no kit scenario or entry for nope');
  });

  test('a malformed RECORD_VALUES fails without quoting it', () => {
    vi.stubEnv('RECORD_VALUES', '{"apiKey":real-a}');
    try {
      expect(recordValues).toThrow(/^RECORD_VALUES must be a JSON object of strings$/u);
    } finally { vi.unstubAllEnvs(); }
  });
});
