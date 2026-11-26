import { isDeepStrictEqual } from 'node:util';
import { describe, expect, test } from 'vitest';
import { identifyAccount, lookupNames } from './account.js';
import type { Entry } from './catalogue.js';
import { finishConnect } from './connect.js';
import { ProviderHttpError } from './errors.js';
import { paginate, type Page } from './paginate.js';
import { safeDetail } from './http-response.js';
import { parseJson } from './rules.js';
import { fakeFetch, fakeProvider, type Route } from './testing.js';

/** One request and its answer. `key` says which key sent it: the scenario's good key or a bad one. */
export type Exchange = { key: 'good' | 'bad'; method: string; url: string; body?: unknown; status: number;
  headers?: Record<string, string>; response: unknown };
/**
 * What a provider answered the kit's scenario. `synthetic` recordings are built from the provider's documented samples
 * (`source` names them); the others were recorded from a test account by `src/record.test.ts`.
 */
export type Recording = { provider: string; synthetic: boolean; source: string; recordedAt: string; exchanges: Exchange[] };

/** The calls every provider's client must get right, written once per provider. */
export type KitScenario<C, I> = {
  /** The recording's name: `src/catalogue/<provider>.recording.json`. */
  provider: string;
  /** What the scenario names in place of the test account's own (an account id, an address): swapped when recording. */
  standIn?: string;
  client(input: { apiKey: string; fetch: typeof fetch }): C;
  /** The call that proves a key works. */
  identify(client: C): Promise<unknown>;
  /** One page of what the app syncs; `since` bounds an incremental read. */
  page(client: C, input: { since?: string | undefined; cursor?: string | undefined }): Promise<Page<I>>;
  id(item: I): string;
  /** The time the incremental read compares with `since`. */
  changedAt(item: I): string;
  since: string;
  /** Whether the client waits out a 429 (the provider's retry policy), or reports it. */
  retriesRateLimit: boolean;
};

export const GOOD_KEY = 'kit-good-key';
export const BAD_KEY = 'kit-bad-key';

/** An entry's plain fields as the kit fills them: the default, else the first choice, else `kit-<name>`. */
export function kitValues(entry: Entry): Record<string, string> {
  return Object.fromEntries((entry.fields ?? []).filter(field => field.secret !== true)
    .map(({ name, default: given, choices }) => [name, given ?? choices?.[0] ?? `kit-${name}`]));
}

/** Signs in with a key: a key or token entry through `finishConnect` on its plain values (the kit's unless given), an
 * OAuth entry's token through `identifyAccount`. */
export function signIn(entry: Entry, key: string, fetch: typeof globalThis.fetch, values = kitValues(entry)) {
  if (entry.auth[0].kind === 'oauth2') return identifyAccount(entry, { token: key, fetch });
  const secret = (entry.fields ?? []).find(field => field.secret === true)?.name ?? '';
  return finishConnect(entry, { secret: { [secret]: key }, values, fetch });
}

/** A request's JSON body, or its text when it is a form (a token request's). */
const requestBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text === '' ? undefined : parseJson(text) ?? text;
};

/** A fetch answering from a recording: each request must match one exchange of that key, or the test names it. */
export function replay(recording: Recording, key: Exchange['key']): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const body = await requestBody(request);
    const exchange = recording.exchanges.find(item => item.key === key && item.method === request.method
      && item.url === request.url && isDeepStrictEqual(item.body, body));
    if (!exchange) throw new Error(`${recording.provider} recording: no ${key}-key answer for ${request.method} ${request.url}`);
    return Response.json(exchange.response, { status: exchange.status, headers: exchange.headers ?? {} });
  };
}

/**
 * The one replay check, which the table test runs on every recording beside an entry and the recorder runs before it
 * writes one: the good key signs in, sending each request once (a token entry's token request, then identify's), and the
 * bad key is `rejected` at its first request. A recording the recorder wrote from an account (`fromAccount`) holds the
 * kit's stand-ins, so its account is the one the entry's own rule gives over the kit values: the account its derived
 * fake signs in to. One written by hand holds the provider's documented values, so its account id is one of them, and
 * there is no account only when the entry names no id. Null when all of this holds, else the sign-in it changes.
 */
export async function replayProblem(entry: Entry, recording: Recording, fromAccount: boolean): Promise<string | null> {
  const sent = { good: 0, bad: 0 };
  const counted = (key: Exchange['key']): typeof fetch => (input, init) => { sent[key] += 1; return replay(recording, key)(input, init); };
  const good = await signIn(entry, GOOD_KEY, counted('good')).catch(() => undefined);
  const id = good?.account?.id ?? null;
  const kit = fakeFetch(fakeProvider(entry, { key: GOOD_KEY, values: kitValues(entry) })).fetch;
  const recorded = JSON.stringify([recording.exchanges.filter(item => item.key === 'good').map(item => item.response), kitValues(entry)]);
  const holds = fromAccount ? id === (await signIn(entry, GOOD_KEY, kit).then(({ account }) => account?.id ?? null, () => undefined))
    : id === null ? entry.identify?.id === undefined : recorded.toLowerCase().includes(id.toLowerCase());
  if (good === undefined || !holds || sent.good !== Number(entry.auth[0].kind === 'token') + Number(entry.identify?.request !== undefined)) {
    return 'the sign-in with the key';
  }
  const bad = await signIn(entry, BAD_KEY, counted('bad')).then(() => undefined, (error: unknown) => error);
  return bad instanceof ProviderHttpError && bad.code === 'rejected' && sent.bad === 1 ? null : 'the bad key as rejected';
}

/** Records every exchange a real fetch makes, as sent and answered, for `src/record.test.ts`: `scrub` makes them safe to
 * write. */
export function recorder(real: typeof fetch, key: Exchange['key']): { fetch: typeof fetch; exchanges: Exchange[] } {
  const exchanges: Exchange[] = [];
  return { exchanges, async fetch(input, init) {
    const request = new Request(input, init);
    const body = await requestBody(request.clone());
    const response = await real(request);
    const text = await response.clone().text();
    // `link` names GitHub's next page.
    const headers = Object.fromEntries(['retry-after', 'content-type', 'link'].flatMap(name => {
      const value = response.headers.get(name);
      return value === null ? [] : [[name, value]];
    }));
    // An answer that is not JSON is written as null: the engine reads nothing from it.
    exchanges.push({ key, method: request.method, url: request.url, ...(body === undefined ? {} : { body }),
      status: response.status, headers, response: parseJson(text) ?? null });
    return response;
  } };
}

/** Every path the engine reads from an entry's answers. `values`: identify's and `save`'s (with `tokenAnswer.` stripped,
 * read from the token answer), a token answer's token and `expires_in`, and the body's wait. `codes`: each condition's
 * `path` and the error code's paths, where only a provider code is kept. */
export function answerReads(entry: Entry): { values: string[]; codes: string[] } {
  const { identify, errors, http } = entry;
  const [auth] = entry.auth;
  const detail = errors?.detail ?? [];
  const values = [...lookupNames(entry).filter(name => !name.startsWith('connection.')).map(name => name.replace(/^tokenAnswer\./u, '')),
    ...auth.kind === 'token' ? [auth.request.token ?? 'access_token', 'expires_in'] : [],
    ...http.retry?.waitFromBody === undefined ? [] : [http.retry.waitFromBody.path]];
  const codes = [...[...identify?.rejectWhen ?? [], errors?.failed, ...(errors?.rules ?? []).map(rule => rule.when), ...http.rateLimit?.when ?? []]
    .flatMap(when => (when?.path === undefined ? [] : [when.path])), ...typeof detail === 'string' ? [detail] : detail];
  return { values, codes: codes.filter(path => !values.includes(path)) };
}

/** Only what `paths` read from `value`, found as `readPath` finds it (a whole key first, then a key and the rest), in
 * the answer's own shape; nothing else. A path that reaches an object or a list keeps only its shell (`{}`, `[]`), which
 * the paths read inside it fill. At a path of `codes`, a string is kept only when it is a provider code as an error's
 * detail takes one (`safeDetail`). Undefined when nothing is an object to read from. */
export function onlyRead(value: unknown, paths: readonly string[], codes: readonly string[] = [], prefix = ''): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const whole = paths.filter(path => Object.hasOwn(record, path));
  const nested = new Map<string, string[]>();
  for (const path of paths) {
    const head = path.slice(0, path.indexOf('.'));
    if (!whole.includes(path) && path.includes('.') && Object.hasOwn(record, head)) nested.set(head, [...nested.get(head) ?? [], path.slice(head.length + 1)]);
  }
  const shell = (item: unknown) => (Array.isArray(item) ? [] : typeof item === 'object' && item !== null ? {} : item);
  const prose = (path: string, item: unknown) => typeof item === 'string' && codes.includes(prefix + path) && safeDetail(item) !== item;
  const kept: Record<string, unknown> = Object.fromEntries([...whole.flatMap((path): [string, unknown][] =>
    (prose(path, record[path]) ? [] : [[path, shell(record[path])]])),
    ...[...nested].flatMap(([head, rest]): [string, unknown][] => {
      const inner = onlyRead(record[head], rest, codes, `${prefix}${head}.`);
      return inner === undefined ? [] : [[head, inner]];
    })]);
  return Array.isArray(value) ? Object.assign([], kept) : kept;
}

/** A real value the recorder found, and the kit's stand-in written in its place. */
export type Swap = [real: string, kit: string];
/** A shorter value would match unrelated text: swapping it would not be safe. */
const SHORTEST_SWAP = 4;
/** A value as a recording may hold it: as it is, JSON-escaped, percent-encoded and form-encoded. */
const forms = (value: string) => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value),
  new URLSearchParams({ v: value }).toString().slice(2)];
/** `value` with each string through `text` and each number replaced only when it is a whole real value. */
function swapped(value: unknown, text: (text: string) => string, whole: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number') return whole.get(String(value)) ?? value;
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(item => swapped(item, text, whole));
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, swapped(item, text, whole)]));
}
/** Percent and `+` escapes decoded, so no encoding hides a value from the last check. */
const decoded = (text: string) => text.replaceAll('+', ' ').replace(/%([0-9a-f]{2})/giu, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
/** Each run that may be base64 or base64url (a Basic pair, a JWT's part), decoded from each of its first four
 * characters, so one that starts inside a run (`abc<b64>`, `Basic<b64>`) is decoded on its own boundary too. A run ends
 * at `=`, where Node stops decoding (`state=<b64>`). */
const unbased = (text: string) => (text.match(/[A-Za-z0-9+/_-]{6,}/gu) ?? [])
  .flatMap(run => [0, 1, 2, 3].map(at => Buffer.from(run.slice(at), 'base64').toString('utf8')));

/**
 * The exchanges safe to write. Each real value of `sent` (the key, a plain value, a token issued) is replaced by its
 * stand-in inside the URL, the request body's strings and the headers kept; in the answer, a value of `sent` or
 * `answered` (the account's id and name, a saved value) is replaced only where it is a whole string or number. Then each
 * part of each exchange is searched, ignoring case, percent-decoded and with each base64-like run decoded: a real value
 * still in it, or one too short to swap safely, refuses the recording, naming the exchange and the part. Nothing is
 * written partly scrubbed, and no message holds a real value.
 */
export function scrub(exchanges: readonly Exchange[], swaps: { sent: readonly Swap[]; answered?: readonly Swap[] }): Exchange[] {
  const all = [...swaps.sent, ...swaps.answered ?? []];
  const short = all.find(([real]) => real.length < SHORTEST_SWAP);
  if (short) throw new Error(`recording refused: the value for ${short[1]} is under ${String(SHORTEST_SWAP)} characters, too short to swap safely`);
  // Each real value is first replaced by a marker no JSON text holds (a raw NUL), checked, then by its stand-in: the
  // check exempts only what the scrub put in, never text that merely spells a stand-in.
  const marker = (at: number) => `\u0000${String(at)}\u0000`;
  const standIn = new Map<string, string>();
  all.forEach(([real], at) => { if (at < swaps.sent.length) for (const form of forms(real)) if (!standIn.has(form)) standIn.set(form, marker(at)); });
  // One pass, longest first: a stand-in written is never read again.
  const pattern = new RegExp([...standIn.keys()].sort((a, b) => b.length - a.length)
    .map(form => form.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')).join('|') || '(?!)', 'gu');
  const inText = (text: string) => text.replace(pattern, form => standIn.get(form) ?? form);
  const whole = new Map(all.map(([real], at): [string, string] => [real, marker(at)]).reverse());
  const out = exchanges.map(({ response, ...exchange }) => ({ ...Object.fromEntries(Object.entries(exchange).map(([part, value]) =>
    [part, ['key', 'method', 'status'].includes(part) ? value : swapped(value, inText, whole)])),
  response: swapped(response, text => whole.get(text) ?? text, whole) }) as Exchange);
  // What is left in each part of each exchange: as written, decoded and unbased, ignoring case. The refusal names where,
  // never what.
  out.forEach((exchange, at) => {
    for (const part of ['url', 'headers', 'body', 'response'] as const) {
      const written = JSON.stringify(exchange[part] ?? null);
      const seen = [written, decoded(written)].flatMap(text => [text, ...unbased(text)]).map(text => text.toLowerCase());
      const left = all.find(([real]) => forms(real).some(form => seen.some(text => text.includes(form.toLowerCase()))));
      if (left) throw new Error(`recording refused: the value for ${left[1]} is still in exchange ${String(at + 1)}'s ${part} after the swap`);
    }
  });
  return out.map(exchange => swapped(exchange, text => text.replace(/\u0000(\d+)\u0000/gu, (_, at: string) => all[Number(at)]?.[1] ?? ''), new Map()) as Exchange);
}

/** Runs the scenario's calls on a real key: what `src/record.test.ts` saves as a provider's recording. */
export async function playScenario<C, I>(scenario: KitScenario<C, I>, fetchFor: (key: Exchange['key']) => typeof fetch,
  keys: { good: string; bad: string } = { good: GOOD_KEY, bad: BAD_KEY }): Promise<{ all: I[][]; changed: I[] }> {
  const client = scenario.client({ apiKey: keys.good, fetch: fetchFor('good') });
  await scenario.identify(client);
  const all: I[][] = [];
  for await (const page of paginate(cursor => scenario.page(client, { cursor }))) all.push(page.items);
  const changed: I[] = [];
  for await (const page of paginate(cursor => scenario.page(client, { since: scenario.since, cursor }))) changed.push(...page.items);
  await scenario.identify(scenario.client({ apiKey: keys.bad, fetch: fetchFor('bad') })).catch(() => undefined);
  return { all, changed };
}

/** The first request answers 429, then the transport answers as usual. */
function rateLimitedOnce(fetchImpl: typeof fetch): typeof fetch {
  let limited = false;
  return (input, init) => {
    if (limited) return fetchImpl(input, init);
    limited = true;
    return Promise.resolve(Response.json({ message: 'Too many requests' }, { status: 429, headers: { 'retry-after': '0.001' } }));
  };
}

type Transports = { recording: Recording; fake: Route[] };

/** The provider's recording and its fake (built to accept `GOOD_KEY`), each as a fetch for a key. */
const sourcesOf = ({ recording, fake }: Transports): [string, (key: Exchange['key']) => typeof fetch][] => [
  [`recording${recording.synthetic ? ' (synthetic)' : ''}`, key => replay(recording, key)],
  ['fake', () => fakeFetch(fake).fetch],
];

/**
 * The kit: sign in, a bad key, the first page, paging to the end, an incremental read and a 429, against the provider's
 * recording and against its fake, so the fake an app tests with answers as the provider does.
 */
export function providerKit<C, I>(scenario: KitScenario<C, I>, transports: Transports): void {
  describe.each(sourcesOf(transports))(`${scenario.provider} kit on its %s`, (_name, fetchFor) => {
    const client = (key: Exchange['key'], wrap: (fetchImpl: typeof fetch) => typeof fetch = f => f) =>
      scenario.client({ apiKey: key === 'good' ? GOOD_KEY : BAD_KEY, fetch: wrap(fetchFor(key)) });

    test('signs in with a key', async () => {
      await expect(scenario.identify(client('good'))).resolves.toBeDefined();
    });

    test('refuses a bad key as rejected', async () => {
      await expect(scenario.identify(client('bad'))).rejects.toMatchObject({ code: 'rejected' });
    });

    test('reads the first page', async () => {
      const page = await scenario.page(client('good'), {});
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.skipped).toEqual([]);
    });

    test('pages to the end, every item once', async () => {
      const { all } = await playScenario(scenario, fetchFor);
      const ids = all.flat().map(item => scenario.id(item));
      expect(all.length).toBeGreaterThan(1);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('reads only what changed since a time', async () => {
      const { all, changed } = await playScenario(scenario, fetchFor);
      const since = Date.parse(scenario.since);
      expect(changed.length).toBeGreaterThan(0);
      expect(changed.length).toBeLessThan(all.flat().length);
      for (const item of changed) expect(Date.parse(scenario.changedAt(item))).toBeGreaterThanOrEqual(since);
    });

    test(scenario.retriesRateLimit ? 'waits out a 429, then reads' : 'reports a 429 as rate_limited', async () => {
      const read = scenario.page(client('good', rateLimitedOnce), {});
      if (scenario.retriesRateLimit) await expect(read).resolves.toMatchObject({ skipped: [] });
      else await expect(read).rejects.toMatchObject({ code: 'rate_limited' } satisfies Partial<ProviderHttpError>);
    });
  });
}

/** What a lookup found (null: no match) and the credits the provider says it charged (null: its answer does not say). */
type Lookup = { found: unknown; credits: number | null };

/** The calls every lookup provider's client must get right: a lookup has no pages, so it has its own kit. */
export type LookupScenario<C> = {
  provider: string;
  client(input: { apiKey: string; fetch: typeof fetch }): C;
  /** The credit-free call that proves a key works. */
  identify(client: C): Promise<unknown>;
  /** Looks up a person the provider knows, or one it does not. */
  person(client: C, known: boolean): Promise<Lookup>;
  company(client: C): Promise<Lookup>;
  /** The credits a no-match reports: what the provider says it charged, or null when it reports no spend. */
  noMatchCredits: number | null;
  retriesRateLimit: boolean;
};

/** The lookup kit: the key proof, a bad key, a person found and one not, a company and a 429, on the recording and the fake. */
export function lookupKit<C>(scenario: LookupScenario<C>, transports: Transports): void {
  describe.each(sourcesOf(transports))(`${scenario.provider} lookup kit on its %s`, (_name, fetchFor) => {
    const client = (key: Exchange['key'], wrap: (fetchImpl: typeof fetch) => typeof fetch = f => f) =>
      scenario.client({ apiKey: key === 'good' ? GOOD_KEY : BAD_KEY, fetch: wrap(fetchFor(key)) });

    test('proves a key', async () => {
      await expect(scenario.identify(client('good'))).resolves.toBeDefined();
    });

    test('refuses a bad key as rejected', async () => {
      await expect(scenario.identify(client('bad'))).rejects.toMatchObject({ code: 'rejected' });
    });

    test('finds a person it knows', async () => {
      expect((await scenario.person(client('good'), true)).found).not.toBeNull();
    });

    const spend = scenario.noMatchCredits === null ? 'its spend unreported' : `charging ${String(scenario.noMatchCredits)}`;
    test(`answers a person it does not know with null, not an error, ${spend}`, async () => {
      await expect(scenario.person(client('good'), false)).resolves.toEqual({ found: null, credits: scenario.noMatchCredits });
    });

    test('finds a company', async () => {
      expect((await scenario.company(client('good'))).found).not.toBeNull();
    });

    test(scenario.retriesRateLimit ? 'waits out a 429, then looks up' : 'reports a 429 as rate_limited', async () => {
      const lookup = scenario.person(client('good', rateLimitedOnce), true);
      if (scenario.retriesRateLimit) expect((await lookup).found).not.toBeNull();
      else await expect(lookup).rejects.toMatchObject({ code: 'rate_limited' } satisfies Partial<ProviderHttpError>);
    });
  });
}
