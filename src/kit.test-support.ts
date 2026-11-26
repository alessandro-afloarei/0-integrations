import { isDeepStrictEqual } from 'node:util';
import { describe, expect, test } from 'vitest';
import type { ProviderHttpError } from './errors.js';
import { paginate, type Page } from './paginate.js';
import { fakeFetch, type Route } from './testing.js';

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

const requestBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text ? JSON.parse(text) as unknown : undefined;
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

/** Records every exchange a real fetch makes, the key replaced with the kit's, for `src/record.test.ts`. */
export function recorder(real: typeof fetch, apiKey: string, key: Exchange['key']): { fetch: typeof fetch; exchanges: Exchange[] } {
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
    exchanges.push({ key, method: request.method, url: request.url.replaceAll(apiKey, GOOD_KEY),
      ...(body === undefined ? {} : { body }), status: response.status, headers,
      response: text ? JSON.parse(text) as unknown : null });
    return response;
  } };
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
