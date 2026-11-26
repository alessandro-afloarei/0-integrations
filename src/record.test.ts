import { existsSync, globSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { lookupNames } from './account.js';
import type { Entry, Value } from './catalogue.js';
import { serpapi } from './catalogue/serpapi.js';
import { trello } from './catalogue/trello.js';
import { zoom } from './catalogue/zoom.js';
import { defaultFetch } from './http.js';
import { BAD_KEY, GOOD_KEY, kitValues, playScenario, recorder, replay, scrub, signIn, type Exchange, type KitScenario,
  type Recording, type Swap } from './kit.test-support.js';
import { parseJson, readPath } from './rules.js';
import { fakeFetch, fakeProvider } from './testing.js';
import { tierOf } from './tier.js';

/**
 * Records a provider from a test account, replacing its synthetic recording:
 * `RECORD_PROVIDER=<id> RECORD_KEY=… [RECORD_VALUES='{"<plain field>":"…"}'] pnpm vitest run src/record.test.ts`.
 * A module's kit scenario of that name is recorded first; else the entry `src/catalogue/<id>.ts` signs in. A scenario
 * that names a stand-in also takes the test account's own as `RECORD_ACCOUNT`. Read the file before committing it: a
 * scenario's recording holds the test account's data as the provider answered.
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
  return scrub([...good.exchanges, ...bad.exchanges], [[secret, GOOD_KEY]]);
}

/** The paths a value reads from identify's answer: never the token answer or a connection value. */
const answerPaths = (value: Value | undefined) => (value === undefined ? [] : lookupNames({ identify: { id: value } })
  .filter(name => !name.startsWith('tokenAnswer.') && !name.startsWith('connection.')));

/** Signs in to an entry with the test account's key and plain values, then with a bad key: a token entry's token request
 * and identify. The recording replays with the kit's key and values: the key, each plain value given, every token the
 * provider issued and the account identify names are swapped for the kit's stand-ins wherever the provider put them. */
async function recordEntry(entry: Entry, secret: string, given: Readonly<Record<string, string>>, real: typeof fetch): Promise<Exchange[]> {
  const kit = kitValues(entry);
  const good = recorder(real, 'good');
  const bad = recorder(real, 'bad');
  await signIn(entry, secret, good.fetch, { ...kit, ...given });
  await signIn(entry, BAD_KEY, bad.fetch, { ...kit, ...given }).catch(() => undefined);
  const [auth] = entry.auth;
  /** Each string or number the good answers hold at one of `paths`, for the stand-in `kit`. */
  const found = (paths: readonly string[], stand: string) => good.exchanges.flatMap(({ response }) => paths.map(path => readPath(response, path)))
    .filter(value => typeof value === 'string' || typeof value === 'number').map((value): Swap => [String(value), stand]);
  return scrub([...good.exchanges, ...bad.exchanges], [[secret, GOOD_KEY],
    ...Object.entries(kit).flatMap(([name, stand]): Swap[] => (given[name] === undefined || given[name] === stand ? [] : [[given[name], stand]])),
    ...auth.kind === 'token' ? found([auth.request.token ?? 'access_token'], 'kit-token') : [],
    ...found(answerPaths(entry.identify?.id), 'kit-account'), ...found(answerPaths(entry.identify?.name), 'kit-name')]);
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

/** Writes `<folder>/<provider>.recording.json`, marked as recorded from a test account. */
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
  const parent = mkdtempSync(fileURLToPath(new URL('../.record-test-', import.meta.url)));
  afterAll(() => { rmSync(parent, { recursive: true, force: true }); });
  type Wrap = (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;

  /** Records the entry with a test account's `key` and plain `values` (each beside the kit's), then reads the file back. */
  async function recordOnFake(entry: Entry, data: { key: string; values?: Record<string, string>; account?: unknown; wrap?: Wrap },
    folder = mkdtempSync(join(parent, 'run-'))) {
    const { values = {}, wrap = (fetch: typeof globalThis.fetch) => fetch } = data;
    const { fetch } = fakeFetch(fakeProvider(entry, { key: data.key, values: { ...kitValues(entry), ...values }, account: data.account }));
    const file = write(folder, entry.id, await recordEntry(entry, data.key, values, wrap(fetch)));
    const text = readFileSync(file, 'utf8');
    return { file, text, recording: JSON.parse(text) as Recording };
  }

  /** A provider that echoes what it was sent (the URL, the body, the authorization header), written by `as`, in its answer
   * at depth, its `link` header and its `content-type`. */
  const echoing = (as: (sent: string) => string = sent => sent): Wrap => fetch => async (input, init) => {
    const request = new Request(input, init);
    const [url = '', body = '', authorization = ''] = [request.url, await request.clone().text(), request.headers.get('authorization') ?? ''].map(as);
    const response = await fetch(request);
    return Response.json({ ...await response.json() as object, echo: { at: [{ depth: [url, body, authorization] }] } }, { status: response.status,
      headers: { link: `<${url}>; rel="self"; auth="${encodeURIComponent(authorization)}"`, 'content-type': `application/json; echo=${encodeURIComponent(body)}` } });
  };

  /** Signs in on the recording with the kit's key and values, as the table test does. */
  const replayed = (entry: Entry, recording: Recording) => Promise.all([signIn(entry, GOOD_KEY, replay(recording, 'good')),
    signIn(entry, BAD_KEY, replay(recording, 'bad')).catch((error: unknown) => error)]);

  test('a key in the query: the URLs hold the kit key, the account is the kit account, and the file replays as recorded', async () => {
    const { file, text, recording } = await recordOnFake(serpapi, { key: 'real-k', wrap: echoing(),
      account: { account_id: 'acct-7f3a90', account_email: 'ana.lopez@lumen.io' } });
    expect(recording.exchanges.map(exchange => exchange.url)).toEqual([`https://serpapi.com/account?api_key=${GOOD_KEY}`,
      `https://serpapi.com/account?api_key=${BAD_KEY}`]);
    for (const real of ['real-k', 'acct-7f3a90', 'ana.lopez']) expect(text).not.toContain(real);
    expect(await replayed(serpapi, recording)).toMatchObject([{ account: { id: 'kit-account', name: 'kit-name' } }, { code: 'rejected' }]);
    expect(tierOf('serpapi', [{ file: basename(file), synthetic: recording.synthetic }])).toBe('recorded');
    expect(recording).toMatchObject({ provider: 'serpapi', synthetic: false, source: 'Recorded from a test account by src/record.test.ts.' });
  });

  test('a plain value in a header: echoed as is and percent-encoded, it is written as its kit value', async () => {
    const { text, recording } = await recordOnFake(trello, { key: 'real-k', values: { apiKey: 'real a/1' }, wrap: echoing() });
    expect(recording.exchanges[0]?.headers?.link).toContain(encodeURIComponent(`oauth_consumer_key="kit-apiKey", oauth_token="${GOOD_KEY}"`));
    for (const real of ['real a/1', encodeURIComponent('real a/1'), 'real-k']) expect(text).not.toContain(real);
    expect(await replayed(trello, recording)).toMatchObject([{ account: { id: 'kit-account', name: 'kit-name' } }, { code: 'rejected' }]);
  });

  test('a token entry: the issued token is written as kit-token, the body holds the kit values, and the file replays', async () => {
    const issuing: Wrap = fetch => async (input, init) => {
      const response = await fetch(input, init);
      return new Response((await response.text()).replaceAll('kit-token', 'zoom-issued-7Hk2'), { status: response.status, headers: response.headers });
    };
    const { text, recording } = await recordOnFake(zoom, { key: 'real-k', values: { accountId: 'real-acct-1', clientId: 'real-cid-1' }, wrap: issuing });
    expect(recording.exchanges.map(({ key: side, body, response }) => [side, body, response])).toEqual([
      ['good', 'grant_type=account_credentials&account_id=kit-accountId', { access_token: 'kit-token', expires_in: 3600 }],
      ['bad', 'grant_type=account_credentials&account_id=kit-accountId', { error: 'invalid_client' }]]);
    for (const real of ['zoom-issued-7Hk2', 'real-acct-1', 'real-cid-1', 'real-k']) expect(text).not.toContain(real);
    expect(await replayed(zoom, recording)).toMatchObject([{ account: { id: 'kit-accountId' } }, { code: 'rejected' }]);
  });

  test('hostile: an answer that echoes the key is written with the kit key', async () => {
    const { text, recording } = await recordOnFake(serpapi, { key: 'real-k',
      account: { account_id: 'acct-7f3a90', account_email: 'kit-name', token: 'real-k', nested: [{ 'real-k': 'real-k' }] } });
    expect(recording.exchanges[0]?.response).toMatchObject({ token: GOOD_KEY, nested: [{ [GOOD_KEY]: GOOD_KEY }] });
    expect(text).not.toContain('real-k');
  });

  test('hostile: a value too short to swap safely refuses the recording, and nothing is written', async () => {
    const folder = mkdtempSync(join(parent, 'run-'));
    const refused = await recordOnFake(trello, { key: 'real-k', values: { apiKey: 'q7' } }, folder).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toMatch(/^recording refused: the value for kit-apiKey is under 4 characters/u);
    expect((refused as Error).message).not.toContain('q7');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('hostile: a value echoed in a form the swap does not know refuses the recording, and nothing is written', async () => {
    const folder = mkdtempSync(join(parent, 'run-'));
    // Lowercase percent escapes: `real%2fa1`, where the swap knows `real%2Fa1`.
    const refused = await recordOnFake(trello, { key: 'real-k', values: { apiKey: 'real/a1' },
      wrap: echoing(sent => encodeURIComponent(sent).toLowerCase()) }, folder).catch((error: unknown) => error);
    expect((refused as Error).message).toBe('recording refused: the value for kit-apiKey is still in it after the swap, in a form the recorder does not know');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('an id with no scenario and no entry fails, naming the id', async () => {
    await expect(record('nope', 'real-k', {})).rejects.toThrow('no kit scenario or entry for nope');
  });

  test('a malformed RECORD_VALUES fails without quoting it', () => {
    vi.stubEnv('RECORD_VALUES', '{"apiKey":real-a}');
    try {
      expect(recordValues).toThrow(/^RECORD_VALUES must be a JSON object of strings$/u);
    } finally { vi.unstubAllEnvs(); }
  });
});
