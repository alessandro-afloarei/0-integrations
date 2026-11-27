import { existsSync, globSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { lookupNames } from './account.js';
import { defineProvider, type Entry, type Value } from './catalogue.js';
import { intercom } from './catalogue/intercom.js';
import { serpapi } from './catalogue/serpapi.js';
import { trello } from './catalogue/trello.js';
import { zoom } from './catalogue/zoom.js';
import { ProviderHttpError } from './errors.js';
import { classify } from './http-response.js';
import { defaultFetch, filledBase } from './http.js';
import { answerReads, BAD_KEY, GOOD_KEY, kitValues, onlyRead, playScenario, recordedSignIn, recorder, replay, replayProblem, scrub, signIn, type Exchange,
  type KitScenario, type Recording, type Swap, waitHeaders } from './kit.test-support.js';
import { parseJson, placeholders, readPath } from './rules.js';
import { fakeFetch, fakeProvider } from './testing.js';
import { tierOf } from './tier.js';

/**
 * Records a provider from a test account, replacing its recording:
 * `RECORD_PROVIDER=<id> RECORD_KEY=… [RECORD_VALUES='{"<plain field>":"…"}'] pnpm vitest run src/record.test.ts`.
 * A module's kit scenario of that name is recorded; else an entry with no module, `src/catalogue/<id>.ts`, signs in,
 * and only what the entry reads from each answer is written. A scenario that names a stand-in also takes the test account's own as
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

/** The library's own messages: a code, then maybe an entry id and a `{field}` (`template_missing: zoom {accountId}`). */
const OWN_MESSAGE = /^[a-z_]+(: [\w.-]+( \{[\w.]+\})?)?$/u;
/** What failed, by its code and status alone: a provider's text, or a message quoting a value (Node's `Headers.set`
 * quotes its input), never reaches the test's output. */
const failure = (what: string, error: unknown) => `${what} ${error instanceof ProviderHttpError
  ? `${error.code}${error.status === null ? '' : ` (${String(error.status)})`}`
  : error instanceof Error && OWN_MESSAGE.test(error.message) ? error.message : 'an error whose message is not shown'}`;

/** The paths identify or `save` reads a value at, in its answer or in the token answer (`tokenAnswer.` stripped). */
const identityPaths = (value: Value | undefined) => (value === undefined ? [] : lookupNames({ identify: { id: value } })
  .filter(name => !name.startsWith('connection.')).map(name => name.replace(/^tokenAnswer\./u, '')));

/** Signs in to an entry with the test account's key and plain values (a token entry's token request, then identify),
 * then with a bad key, which must be refused as `rejected`; a redirected sign-in is refused. Each answer keeps only the
 * paths the entry reads, and of its headers `retry-after` and the declared wait headers; the key, each plain value
 * given, every token issued, the account identify names and the saved values are swapped for the kit's stand-ins. The
 * result is replayed as the table test replays it, and written only when both sign-ins end as they did live. */
async function recordEntry(whole: Entry, secret: string, given: Readonly<Record<string, string>>, real: typeof fetch): Promise<Exchange[]> {
  const entry = recordedSignIn(whole);
  // A real key goes only to the host the owner names: one the kit fills in may be another's, and a field's default or
  // first choice another region's than the account's.
  const typed = placeholders(/^https:\/\/[^/]*/u.exec(entry.http.baseUrl)?.[0] ?? '');
  const unnamed = typed.find(name => (given[name] ?? '').trim() === '');
  if (unnamed !== undefined) throw new Error(`recording refused: give ${unnamed}, in the base's host, in RECORD_VALUES`);
  // An origin (a token answer's `api_domain`) is sent as its host alone: swapped whole, it leaves no file that replays.
  const origin = typed.find(name => given[name]?.includes('/'));
  if (origin !== undefined) throw new Error(`recording refused: give ${origin}, in RECORD_VALUES, as the host alone`);
  const [auth] = entry.auth;
  if (auth.kind !== 'token' && entry.identify?.request === undefined) throw new Error(`${entry.id} sends no request when it signs in: nothing to record`);
  const kit = kitValues(entry);
  const waits = waitHeaders(entry);
  const good = recorder(real, 'good', waits);
  const bad = recorder(real, 'bad', waits);
  await signIn(entry, secret, good.fetch, { ...kit, ...given }).catch((error: unknown) => {
    throw new Error(failure('recording stopped: the sign-in with the key failed with', error));
  });
  const refused = await signIn(entry, BAD_KEY, bad.fetch, { ...kit, ...given }).then(() => undefined, (error: unknown) => error);
  if (refused === undefined) throw new Error('recording stopped: the bad key signed in; it must be refused as rejected');
  if (!(refused instanceof ProviderHttpError && refused.code === 'rejected')) {
    throw new Error(failure('recording stopped: the bad key must be refused as rejected, not', refused));
  }
  const exchanges = [...good.exchanges, ...bad.exchanges];
  // A redirect's target can name the account, and the replay answers each request once.
  if (exchanges.some(({ status }) => status >= 300 && status < 400)) throw new Error('recording refused: the sign-in was redirected: point the entry at the final URL');
  /** Each string or number the good answers hold at one of `paths`, for the stand-in `stand`; a blank one holds nothing. */
  const found = (paths: readonly string[], stand: string) => good.exchanges.flatMap(({ response }) => paths.map(path => readPath(response, path)))
    .flatMap((value): Swap[] => ((typeof value === 'string' && value.trim() !== '') || typeof value === 'number' ? [[String(value), stand]] : []));
  const { values, codes } = answerReads(entry);
  // An answer the sign-in did not accept names no account: there every kept string must be a code, whatever its path.
  // A 2xx token answer is accepted as it is, as `requestToken` takes it; identify's is also read by the entry's rules.
  const tokenUrl = auth.kind === 'token' ? new URL(filledBase(entry, { ...kit, ...given }, auth.request.url)).href : undefined;
  const unaccepted = ({ key: side, method, url, status, headers = {}, response }: Exchange) => side === 'bad' || status < 200 || status >= 300
    || (!(method === 'POST' && url === tokenUrl) && classify(entry, { status, headers: new Headers(headers), data: response }) !== null);
  // Sign-in reads no other header but a declared wait's: a `link` or `content-type` may name the account.
  const kept = (exchange: Exchange): Exchange => ({ ...exchange,
    response: onlyRead(exchange.response, [...values, ...codes], unaccepted(exchange) ? [...values, ...codes] : codes) ?? null,
    headers: Object.fromEntries(Object.entries(exchange.headers ?? {}).filter(([name]) => name === 'retry-after' || waits.includes(name))) });
  const swaps: { sent: Swap[]; answered: Swap[] } = {
    sent: [[secret, GOOD_KEY],
      ...Object.entries(kit).flatMap(([name, stand]): Swap[] => (given[name] === undefined || given[name] === stand ? [] : [[given[name], stand]])),
      ...auth.kind === 'token' ? found([auth.request.token ?? 'access_token'], 'kit-token') : []],
    answered: [...found(identityPaths(entry.identify?.id), 'kit-account'), ...found(identityPaths(entry.identify?.name), 'kit-name'),
      ...Object.entries(entry.save ?? {}).flatMap(([name, value]) => found(identityPaths(value), `kit-${name}`))] };
  const written = scrub(exchanges.map(kept), swaps);
  // What dropping and swapping may have changed (a rule on a header not written, a message a rule compared): the file
  // must pass the table test's own replay check.
  const problem = await replayProblem(entry, { provider: entry.id, synthetic: false, source: '', recordedAt: '', exchanges: written });
  if (problem !== null) throw new Error(`recording refused: the file does not replay ${problem}`);
  return written;
}

/** A module's kit scenario of that name, else an entry with no module, recorded from a test account. */
async function record(id: string, secret: string, given: Readonly<Record<string, string>>): Promise<Exchange[]> {
  const scenario = await findScenario(id);
  if (scenario) return recordScenario(scenario, secret);
  // A module's recording is its kit's: a sign-in alone would replace it.
  if (/^[a-z][a-z0-9]*$/u.test(id) && existsSync(`src/${id}/${id}.ts`)) {
    throw new Error(`${id} has a module: it is recorded through a kit scenario in src/${id}/scenario.test-support.ts, and none is named ${id}`);
  }
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

  /** Records the entry with a test account's `key` and plain `values` (each beside the kit's), then reads the file back.
   * The fake answers the sign-in a recording is of, as the provider answers the pasted key. */
  async function recordOnFake(entry: Entry, data: { key: string; values?: Record<string, string>; account?: unknown; wrap?: Wrap }) {
    const folder = mkdtempSync(join(parent, 'run-'));
    const { values = {}, wrap = (fetch: typeof globalThis.fetch) => fetch } = data;
    const { fetch } = fakeFetch(fakeProvider(recordedSignIn(entry), { key: data.key, values: { ...kitValues(entry), ...values }, account: data.account }));
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
  /** A provider whose answers carry a `retry-after` header (the one kept) made from what was sent, written by `as`, and
   * `link` and `location` headers naming a profile (dropped). */
  const echoing = (as: (sent: string) => string = sent => sent): Wrap => fetch => async (input, init) => {
    const request = new Request(input, init);
    const [url = '', body = '', authorization = ''] = [request.url, await request.clone().text(), request.headers.get('authorization') ?? ''].map(as);
    const response = await fetch(request);
    return new Response(response.body, { status: response.status, headers: { link: '<https://acme.test/people/ana-lopez>; rel="profile"',
      location: '/people/ana-lopez', 'retry-after': `url=${url}&body=${body}&auth=${authorization}&encoded=${encodeURIComponent(authorization)}` } });
  };
  /** The refusal for a real value still in exchange `at`'s `part`. */
  const stillIn = (kit: string, at: number, part: string) => `recording refused: the value for ${kit} is still in exchange ${String(at)}'s ${part} after the swap`;

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

  test('a plain value in a header: echoed as is and percent-encoded in `retry-after`, it is written as its kit value; no other header is', async () => {
    const { text, recording } = await recordOnFake(trello, { key: 'real-key-1', values: { apiKey: 'real a/1' }, wrap: echoing() });
    const sent = `OAuth oauth_consumer_key="kit-apiKey", oauth_token="${GOOD_KEY}"`;
    expect(recording?.exchanges[0]?.headers).toEqual({ 'retry-after': expect.stringContaining(`&auth=${sent}&encoded=${encodeURIComponent(sent)}`) as unknown });
    for (const real of ['real a/1', encodeURIComponent('real a/1'), 'real-key-1', 'ana-lopez']) expect(text).not.toContain(real);
    expect(await replayed(trello, recording)).toMatchObject([{ account: { id: 'kit-account', name: 'kit-name' } }, { code: 'rejected' }]);
  });

  test('a typed host the kit would fill is refused before any request, until RECORD_VALUES names it', async () => {
    const typedHost = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'host', title: 'Host' },
      { name: 'apiKey', title: 'API key', secret: true }], auth: [{ kind: 'key' }],
      http: { baseUrl: 'https://{host}/api', host: ['*.acme.test', '*.acme.example'] }, identify: { request: { path: '/me' }, id: 'id' } });
    const sent: string[] = [];
    const counting: Wrap = fetch => async (input, init) => { sent.push(new Request(input, init).url); return fetch(input, init); };
    expect((await recordOnFake(typedHost, { key: 'real-key-1', wrap: counting })).refused)
      .toBe('recording refused: give host, in the base\'s host, in RECORD_VALUES');
    expect(sent).toEqual([]);
    const { recording, refused } = await recordOnFake(typedHost, { key: 'real-key-1', values: { host: 'eu.acme.example' }, account: { id: 'u-real-881' }, wrap: counting });
    expect(refused).toBeUndefined();
    expect(sent[0]).toBe('https://eu.acme.example/api/me');
    expect(recording?.exchanges[0]?.url).toBe('https://kit.acme.test/api/me');
  });

  test('a host the token answer names is refused before any request, until RECORD_VALUES names it', async () => {
    const named = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://oauth.acme.test/authorize', tokenUrl: 'https://oauth.acme.test/token' }], scopes: { default: [] },
      save: { apiDomain: 'tokenAnswer.api_domain' }, http: { baseUrl: 'https://{apiDomain}/api', host: '*.acme.test' },
      identify: { request: { path: '/me' }, id: 'id' } });
    const sent: string[] = [];
    const counting: Wrap = fetch => async (input, init) => { sent.push(new Request(input, init).url); return fetch(input, init); };
    expect((await recordOnFake(named, { key: 'real-key-1', wrap: counting })).refused)
      .toBe('recording refused: give apiDomain, in the base\'s host, in RECORD_VALUES');
    expect(sent).toEqual([]);
    const { recording, refused } = await recordOnFake(named, { key: 'real-key-1', values: { apiDomain: 'eu.acme.test' }, account: { id: 'u-real-881' }, wrap: counting });
    expect(refused).toBeUndefined();
    expect(sent[0]).toBe('https://eu.acme.test/api/me');
    expect(recording?.exchanges[0]?.url).toBe('https://kit.acme.test/api/me');
  });

  test('hostile: a named host given as the origin the token answer holds is refused before any request', async () => {
    const named = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://oauth.acme.test/authorize', tokenUrl: 'https://oauth.acme.test/token' }], scopes: { default: [] },
      save: { apiDomain: 'tokenAnswer.api_domain' }, http: { baseUrl: 'https://{apiDomain}/api', host: '*.acme.test' },
      identify: { request: { path: '/me' }, id: 'id' } });
    for (const origin of ['https://eu.acme.test', 'https://eu.acme.test/']) {
      const sent: string[] = [];
      const counting: Wrap = fetch => async (input, init) => { sent.push(new Request(input, init).url); return fetch(input, init); };
      expect((await recordOnFake(named, { key: 'real-key-1', values: { apiDomain: origin }, account: { id: 'u-real-881' }, wrap: counting })).refused)
        .toBe('recording refused: give apiDomain, in RECORD_VALUES, as the host alone');
      expect(sent).toEqual([]);
    }
  });

  test('a host field with a default and choices (Intercom\'s region) is refused before any request too', async () => {
    // A stub that never reaches the network: a blank value is no host, whatever the field's default.
    const sent = vi.fn<typeof fetch>();
    for (const given of [{}, { apiHost: '' }, { apiHost: '  ' }]) {
      await expect(recordEntry(intercom, 'real-key-1', given, sent)).rejects.toThrow('recording refused: give apiHost, in the base\'s host, in RECORD_VALUES');
    }
    expect(sent).not.toHaveBeenCalled();
  });

  test('a declared wait header is kept beside `retry-after`, and no other header the answer carries', async () => {
    const waiting = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test', retry: { wait: { header: 'ratelimit-reset', unit: 's' } } },
      identify: { request: { path: '/me' }, id: 'id' } });
    const limits: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return new Response(response.body, { status: response.status,
        headers: { 'retry-after': '1', 'ratelimit-reset': '3', 'ratelimit-remaining': '7', 'x-request-id': 'req-ana-lopez' } });
    };
    const { recording } = await recordOnFake(waiting, { key: 'real-key-1', account: { id: 'u-real-881' }, wrap: limits });
    expect(recording?.exchanges.map(exchange => exchange.headers)).toEqual([{ 'retry-after': '1', 'ratelimit-reset': '3' },
      { 'retry-after': '1', 'ratelimit-reset': '3' }]);
  });

  test('hostile: a declared wait header that is not the number the engine reads is dropped, so its text is never written', async () => {
    const waiting = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test', retry: { wait: { header: 'ratelimit-reset', unit: 's' } } },
      identify: { request: { path: '/me' }, id: 'id' } });
    const prose: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return new Response(response.body, { status: response.status, headers: { 'ratelimit-reset': 'in 3 s, ask ana.lopez@lumen.io' } });
    };
    const { text, recording } = await recordOnFake(waiting, { key: 'real-key-1', account: { id: 'u-real-881' }, wrap: prose });
    expect(recording?.exchanges.map(exchange => exchange.headers)).toEqual([{}, {}]);
    expect(text).not.toContain('ana.lopez');
  });

  test('an ISO 8601 wait header is kept as the instant the engine reads; one holding other text is dropped', async () => {
    const waiting = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test', retry: { wait: { header: 'x-ratelimit-reset', unit: 'iso8601' } } },
      identify: { request: { path: '/me' }, id: 'id' } });
    const resets: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      const reset = response.ok ? '2021-06-15T10:51:23.035+0100' : '2021-06-15T10:51:23 ask ana.lopez@lumen.io';
      return new Response(response.body, { status: response.status, headers: { 'x-ratelimit-reset': reset } });
    };
    const { text, recording } = await recordOnFake(waiting, { key: 'real-key-1', account: { id: 'u-real-881' }, wrap: resets });
    expect(recording?.exchanges.map(exchange => exchange.headers)).toEqual([{ 'x-ratelimit-reset': '2021-06-15T10:51:23.035+0100' }, {}]);
    expect(text).not.toContain('ana.lopez');
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
      retry: { wait: { path: 'wait_ms', unit: 'ms' } } },
    identify: { request: { path: '/me' }, id: 'user.id', name: ['user.display', 'user.login'], rejectWhen: [{ path: 'state', equals: 'disabled' }] },
    save: { plan: 'org.plan' }, errors: { detail: ['error.message', 'error.code'], rules: [{ when: { path: 'owner', equals: 'none' }, code: 'not_found' },
      { when: { path: 'gone', equals: true }, code: 'not_found' }] } });

  test('hostile: only the paths the entry reads are written; tokens, names, a phone, an address and other people are dropped', async () => {
    const { text, recording } = await recordOnFake(reading, { key: 'real-key-1', account: {
      user: { id: 'u-real-881', display: 'Ana Lopez', login: 'alopez', full_name: 'Ana Maria Lopez', phone: '(415) 867-5309' },
      org: { plan: 'team', address: '1 Main St, Springfield', members: [{ name: 'Bob Stone' }] },
      refresh_token: 'rt-real-99', id_token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1LXJlYWwtODgxIn0.', state: 'active',
      limits: { left: 5, total: 100 }, wait_ms: 10, gone: false, error: { code: 'none', message: 'Jane Roe was here' },
      owner: { name: 'Carl Diaz', email: 'carl@acme.io', phone: '(415) 555-2671' } } });
    expect(recording?.exchanges[0]?.response).toEqual({ user: { id: 'kit-account', display: 'kit-name', login: 'kit-name' },
      org: { plan: 'kit-plan' }, state: 'active', limits: { left: 5 }, wait_ms: 10, gone: false, error: { code: 'none' }, owner: {} });
    for (const real of ['rt-real-99', 'eyJ', 'Ana', 'alopez', '867-5309', 'Main St', 'Bob Stone', 'Jane Roe', 'total', 'u-real-881', 'team',
      'Carl', 'carl@', '555-2671']) {
      expect(text).not.toContain(real);
    }
    expect(answerReads(reading)).toEqual({ values: ['user.id', 'user.display', 'user.login', 'org.plan', 'wait_ms'],
      codes: ['state', 'owner', 'gone', 'limits.left', 'error.message', 'error.code'] });
  });

  test('a path read as one whole key, and an array, keep the answer\'s own shape', () => {
    expect(onlyRead({ '@odata.nextLink': 'n', '@odata': { nextLink: 'x' }, other: 1 }, ['@odata.nextLink'])).toEqual({ '@odata.nextLink': 'n' });
    expect(onlyRead([{ id: 'a', name: 'n', secret: 's' }, { id: 'b' }], ['0.id', '0.name'])).toEqual([{ id: 'a', name: 'n' }]);
    expect(onlyRead('text', ['id'])).toBeUndefined();
  });

  test('hostile: at an error-code or condition path only a provider code is written, never a message', async () => {
    const { text, recording } = await recordOnFake(reading, { key: 'real-key-1',
      wrap: answering(body => ({ ...body as object, state: 'active', error: { code: 'invalid_key', message: 'No user Ana Lopez' } })) });
    expect(recording?.exchanges[0]?.response).toMatchObject({ state: 'active', error: { code: 'invalid_key' } });
    expect(text).not.toContain('Ana Lopez');
    expect(onlyRead({ a: 'two words', b: 'x/y', c: 7, d: true, e: 'ok.code-1' }, ['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e']))
      .toEqual({ c: 7, d: true, e: 'ok.code-1' });
  });

  test('hostile: a path that reaches an object or a list keeps only its shell, which the paths inside it fill', () => {
    const answer = { errors: [{ code: 'E1', message: 'Jane Roe', email: 'jane@acme.io' }], owner: { name: 'Carl', id: 'o-1' }, count: 3 };
    expect(onlyRead(answer, ['errors', 'owner', 'count'])).toEqual({ errors: [], owner: {}, count: 3 });
    expect(onlyRead(answer, ['errors.0', 'errors.0.code', 'owner', 'owner.id'])).toEqual({ errors: [{ code: 'E1' }], owner: { id: 'o-1' } });
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

  test('hostile: a saved value (a site, a team) is written as its kit value, not as the provider answered it', async () => {
    const { text, recording } = await recordOnFake(reading, { key: 'real-key-1',
      wrap: answering(body => ({ ...body as object, org: { plan: 'https://ana-lopez.atlassian.net' } })) });
    expect(recording?.exchanges[0]?.response).toMatchObject({ org: { plan: 'kit-plan' } });
    expect(text).not.toContain('ana-lopez');
  });

  test('a code that is a real value is swapped whole', async () => {
    const swapped = await recordOnFake(reading, { key: 'real-key-1', wrap: answering(body => ({ ...body as object, error: { code: 'real-key-1' } })) });
    expect(swapped.recording?.exchanges[0]?.response).toMatchObject({ error: { code: GOOD_KEY } });
  });

  test('a number is replaced only when it is the whole real value; one holding it by part is never rewritten, and refuses', async () => {
    const id = (left: number) => answering(body => ({ ...body as object, user: { id: 48213, display: 'Ana Lopez' }, limits: { left } }));
    expect((await recordOnFake(reading, { key: 'real-key-1', wrap: id(5) })).recording?.exchanges[0]?.response)
      .toMatchObject({ user: { id: 'kit-account', display: 'kit-name' }, limits: { left: 5 } });
    expect((await recordOnFake(reading, { key: 'real-key-1', wrap: id(482130) })).refused).toBe(stillIn('kit-account', 1, 'response'));
    // In a request body too: a number is never rewritten into a string by part.
    const sent = (n: number): Exchange[] => [{ key: 'good', method: 'POST', url: 'https://api.acme.test/a', body: { n }, status: 200, response: null }];
    expect(scrub(sent(48213), { sent: [['48213', 'kit-account']] })[0]?.body).toEqual({ n: 'kit-account' });
    expect(() => scrub(sent(482130), { sent: [['48213', 'kit-account']] })).toThrow(stillIn('kit-account', 1, 'body'));
  });

  const based = (sent: string) => Buffer.from(sent).toString('base64');
  test.each<[string, (sent: string) => string]>([
    ['upper-cased', sent => sent.toUpperCase()],
    ['as base64', based],
    ['as base64 after `state=`', sent => `state=${based(sent)}`],
    ['as base64 after `a=`', sent => `a=${based(sent)}`],
    ['as base64 right after letters', sent => `abc${based(sent)}`],
    ['as base64 after `auth=Basic`', sent => `auth=Basic${based(sent)}`],
    ['inside a JWT\'s payload', sent => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: sent })).toString('base64url')}.sig`],
    // A `-` written `%2d`: no form the swap knows, but the last check decodes it.
    ['with a percent escape the swap does not know', sent => sent.replaceAll('-', '%2d')],
  ])('hostile: the key echoed %s refuses the recording, naming where, and nothing is written', async (_, as) => {
    const { refused, folder } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: echoing(as) });
    expect(refused).toBe(stillIn('kit-good-key', 1, 'headers'));
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: a real value that spells a stand-in inside it, echoed in another case, still refuses the recording', async () => {
    const { refused } = await recordOnFake(serpapi, { key: 'Kit-Good-Key-9f3', wrap: echoing(sent => sent.toUpperCase()) });
    expect(refused).toBe(stillIn('kit-good-key', 1, 'headers'));
  });

  test.each([['alone', (b64: string) => b64], ['after `state=`', (b64: string) => `state=${b64}`]])(
    'hostile: a 5-character account id echoed as padded base64 %s refuses the recording', async (_, as) => {
      const echoed: Wrap = fetch => async (input, init) => {
        const response = await fetch(input, init);
        return new Response(response.body, { status: response.status, headers: { 'retry-after': as(Buffer.from('48213').toString('base64')) } });
      };
      const { refused } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: echoed, account: { account_id: 48213, account_email: 'kit-name' } });
      expect(refused).toBe(stillIn('kit-account', 1, 'headers'));
    });

  test('hostile: an account id echoed lower-cased in a header refuses the recording', async () => {
    const lowered: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return new Response(response.body, { status: response.status, headers: { 'retry-after': '/users/acct-7f3a90' } });
    };
    const { refused } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: lowered, account: { account_id: 'ACCT-7F3A90', account_email: 'kit-name' } });
    expect(refused).toBe(stillIn('kit-account', 1, 'headers'));
  });

  test('hostile: a value too short to swap safely refuses the recording, and nothing is written', async () => {
    const { refused, folder } = await recordOnFake(trello, { key: 'real-key-1', values: { apiKey: 'q7' } });
    expect(refused).toMatch(/^recording refused: the value for kit-apiKey is under 4 characters/u);
    expect(refused).not.toContain('q7');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: in an answer the sign-in did not accept, a shared identity path writes only a code, never prose', async () => {
    const shared = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
      identify: { request: { path: '/me' }, id: 'id', name: 'name' }, errors: { detail: 'name' } });
    const { refused, text, recording } = await recordOnFake(shared, { key: 'real-key-1', account: { id: 'u-real-881', name: 'Ana Lopez' },
      wrap: fetch => async (input, init) => {
        const response = await fetch(input, init);
        return response.status === 401 ? Response.json({ name: 'No user Ana Lopez' }, { status: 401 }) : response;
      } });
    expect(refused).toBeUndefined();
    expect(recording?.exchanges[1]).toMatchObject({ status: 401, response: {} });
    expect(text).not.toContain('Ana Lopez');
  });

  test.each<[string, Entry, unknown]>([
    ['an id template reading two answer paths', defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
      fields: [{ name: 'apiKey', title: 'API key', secret: true }], auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
      identify: { request: { path: '/me' }, id: '{org.id}/{user.id}', name: 'user.name' } }),
    { org: { id: 'org-real-12' }, user: { id: 'u-real-881', name: 'Ana Lopez' } }],
    ['an id that `lowercase` trims', defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
      fields: [{ name: 'apiKey', title: 'API key', secret: true }], auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
      identify: { request: { path: '/me' }, id: 'email', name: 'email', lowercase: true } }),
    { email: '  Ana.Lopez@Lumen.TEST ' }],
  ])('%s is recorded, and the table\'s replay accepts the file', async (_, entry, account) => {
    const { refused, recording } = await recordOnFake(entry, { key: 'real-key-1', account });
    expect(refused).toBeUndefined();
    if (recording === undefined) return;
    expect(await replayProblem(entry, recording)).toBeNull();
  });

  /** A token entry whose id falls back from the token answer to the profile. */
  const fallback = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
    fields: [{ name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Client secret', secret: true }],
    auth: [{ kind: 'token', request: { url: 'https://api.acme.test/oauth2/token', body: { grant_type: 'client_credentials' },
      basic: ['{clientId}', '{clientSecret}'] } }],
    http: { baseUrl: 'https://api.acme.test' }, identify: { request: { path: '/account' }, id: ['tokenAnswer.app_id', 'account_id'] } });

  test.each<[string, (body: Record<string, unknown>) => unknown]>([
    ['the token answer omits the first path', body => Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'app_id'))],
    ['the token answer holds the first path', body => ({ ...body, app_id: 'APP-real-77' })],
  ])('an id that falls back across the token answer and the profile, when %s, records and replays', async (_, edit) => {
    const tokenEdited: Wrap = fetch => async (input, init) => {
      const request = new Request(input, init);
      const response = await fetch(request.clone());
      return request.url.endsWith('/oauth2/token') && response.ok ? Response.json(edit(await response.json() as Record<string, unknown>)) : response;
    };
    const { refused, recording } = await recordOnFake(fallback, { key: 'real-key-1', values: { clientId: 'real-cid-1' },
      account: { account_id: 'acct-real-55' }, wrap: tokenEdited });
    expect(refused).toBeUndefined();
    if (recording !== undefined) expect(await replayProblem(fallback, recording)).toBeNull();
  });

  /** A token entry whose id falls back from the token answer to a profile field of the same name. */
  const sameName = defineProvider({ ...fallback, identify: { request: { path: '/account' }, id: ['tokenAnswer.account_id', 'account_id'] } });
  test.each<[string, (body: Record<string, unknown>) => unknown]>([
    ['supplies `account_id`', body => ({ ...body, account_id: 'tok-acct-real-9' })],
    ['omits `account_id`, so the profile\'s is read', body => Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'account_id'))],
  ])('an id that falls back to a profile field of the same name, when the token answer %s, records and replays', async (_, edit) => {
    const tokenEdited: Wrap = fetch => async (input, init) => {
      const request = new Request(input, init);
      const response = await fetch(request.clone());
      return request.url.endsWith('/oauth2/token') && response.ok ? Response.json(edit(await response.json() as Record<string, unknown>)) : response;
    };
    const { refused, recording } = await recordOnFake(sameName, { key: 'real-key-1', values: { clientId: 'real-cid-1' },
      account: { account_id: 'acct-real-55' }, wrap: tokenEdited });
    expect(refused).toBeUndefined();
    if (recording !== undefined) expect(await replayProblem(sameName, recording)).toBeNull();
  });

  test('a 2xx token answer is accepted as `requestToken` accepts it, whatever an error rule reads in it', async () => {
    const noted = defineProvider({ ...tokenRead, errors: { detail: 'message', failed: { path: 'message', equals: 'ok' } } });
    const { refused, recording } = await recordOnFake(noted, { key: 'real-key-1', values: { clientId: 'real-cid-1' },
      wrap: answering(body => ({ ...body as object, access_token: 'tok/en+real==', message: 'ok', app_id: 'APP-real-77' })) });
    expect(refused).toBeUndefined();
    expect(recording?.exchanges[0]?.response).toMatchObject({ access_token: 'kit-token' });
    if (recording !== undefined) expect(await replayProblem(noted, recording)).toBeNull();
  });

  test('a blank value at an identity path is written as it is, and the recording replays', async () => {
    const blank = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
      identify: { request: { path: '/me' }, id: 'id', name: ['global_name', 'username'] } });
    const { refused, recording } = await recordOnFake(blank, { key: 'real-key-1', account: { id: 'u-real-881', global_name: '', username: 'alopez' } });
    expect(refused).toBeUndefined();
    expect(recording?.exchanges[0]?.response).toEqual({ id: 'kit-account', global_name: '', username: 'kit-name' });
    // The engine reads the blank first path, so the name falls back to the id, as it did live.
    expect(await replayed(blank, recording)).toMatchObject([{ account: { id: 'kit-account', name: 'kit-account' } }, { code: 'rejected' }]);
  });

  test('hostile: a redirected sign-in is refused, and nothing is written', async () => {
    const moved: Wrap = fetch => (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/account') return Promise.resolve(new Response(null, { status: 307, headers: { location: `/people/ana-lopez${url.search}` } }));
      return fetch(new Request(request.url.replace('/people/ana-lopez', '/account'), request));
    };
    const { refused, folder } = await recordOnFake(serpapi, { key: 'real-key-1', wrap: moved });
    expect(refused).toBe('recording refused: the sign-in was redirected: point the entry at the final URL');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: a file that no longer signs in as the account did live is refused', async () => {
    // A rule on a header refuses the bad key live; the header is not written, so the file would let it pass.
    const headed = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
      identify: { request: { path: '/me' }, rejectWhen: [{ header: 'x-account-state', equals: 'disabled' }] } });
    const disabled: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return response.status === 401 ? Response.json({}, { headers: { 'x-account-state': 'disabled' } }) : response;
    };
    const { refused, folder } = await recordOnFake(headed, { key: 'real-key-1', wrap: disabled });
    expect(refused).toBe('recording refused: the file does not replay the bad key as rejected');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: a swap a condition tests, which changes the sign-in with the key, is refused', async () => {
    // Swapped, the name equals what the rule refuses: the file would turn the good key away.
    const named = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
      identify: { request: { path: '/me' }, id: 'id', name: 'name', rejectWhen: [{ path: 'name', equals: 'kit-name' }] } });
    const { refused, folder } = await recordOnFake(named, { key: 'real-key-1', account: { id: 'u-real-881', name: 'Ana Lopez' } });
    expect(refused).toBe('recording refused: the file does not replay the sign-in with the key');
    expect(readdirSync(folder)).toEqual([]);
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

  test('a provider with a module but no kit scenario of that name is refused before anything is sent', async () => {
    await expect(record('lusha', 'real-key-1', {})).rejects
      .toThrow('lusha has a module: it is recorded through a kit scenario in src/lusha/scenario.test-support.ts, and none is named lusha');
  });

  test('an entry with OAuth 2 then a key records its key: the file replays the key sign-in', async () => {
    const both = defineProvider({ id: 'acme', name: 'Acme', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://acme.test/authorize', tokenUrl: 'https://api.acme.test/token' },
        { kind: 'key', send: { header: 'authorization' } }], scopes: { default: [] },
      http: { baseUrl: 'https://api.acme.test' }, identify: { request: { path: '/me' }, id: 'id' } });
    const { recording } = await recordOnFake(both, { key: 'real-key-9', account: { id: 'acct-55' } });
    expect(recording?.exchanges.map(({ key, url, response }) => [key, url, response]))
      .toEqual([['good', 'https://api.acme.test/me', { id: 'kit-account' }], ['bad', 'https://api.acme.test/me', {}]]);
    expect(await replayProblem(both, { provider: 'acme', synthetic: false, source: '', recordedAt: '', exchanges: recording?.exchanges ?? [] })).toBeNull();
  });

  test('an entry that sends no request when it signs in is refused: nothing to record', async () => {
    const answerOnly = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs',
      auth: [{ kind: 'oauth2', authorizeUrl: 'https://acme.test/authorize', tokenUrl: 'https://acme.test/token' }], scopes: { default: [] },
      http: { baseUrl: 'https://api.acme.test' }, identify: { id: 'tokenAnswer.user_id' } });
    const sent = vi.fn(fetch);
    await expect(recordEntry(answerOnly, 'real-key-1', {}, sent)).rejects.toThrow('acme sends no request when it signs in: nothing to record');
    expect(sent).not.toHaveBeenCalled();
  });

  test.each<[string, unknown, string]>([
    ['a provider error', new ProviderHttpError('rejected', 401, 'invalid_key'), 'rejected (401)'],
    ['the library\'s own message', new TypeError('template_missing: zoom {accountId}'), 'template_missing: zoom {accountId}'],
    ['a bare code', new TypeError('url_outside_origin'), 'url_outside_origin'],
    ['a message quoting a header value', new TypeError('Headers.set: "Bearer real-key-1" is an invalid header value.'), 'an error whose message is not shown'],
    ['a parse error quoting the answer', new SyntaxError('Unexpected token \'<\', "<html>Jane Roe" is not valid JSON'), 'an error whose message is not shown'],
  ])('a failure from %s is told without what it quotes', (_, error, told) => {
    expect(failure('failed with', error)).toBe(`failed with ${told}`);
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
