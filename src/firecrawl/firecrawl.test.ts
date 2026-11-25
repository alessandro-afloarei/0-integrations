import { expect, test, vi } from 'vitest';
import { ProviderHttpError } from '../errors.js';
import { fakeFetch, sequence } from '../testing.js';
import { fakeFirecrawl } from './fake.js';
import { firecrawlClient, type FirecrawlAction } from './firecrawl.js';

const pages = [
  { url: 'https://lumen.test/', title: 'Home', markdown: '# Home', links: ['https://lumen.test/pricing'] },
  { url: 'https://lumen.test/pricing', title: 'Pricing', markdown: '# Pricing', links: ['https://lumen.test/'] },
];
const WAIT: FirecrawlAction[] = [{ type: 'wait', milliseconds: 1500 }];
const RENDER: FirecrawlAction[] = [...WAIT, { type: 'executeJavascript', script: 'listLinks()' }];
const SCRAPE = 'https://api.firecrawl.dev/v2/scrape';
const client = (fake: { fetch: typeof fetch }) => firecrawlClient({ apiKey: 'fc-1', fetch: fake.fetch });
const bodies = (fake: ReturnType<typeof fakeFetch>) => fake.calls.map(call => JSON.parse(call.body) as Record<string, unknown>);
const page = (metadata: Record<string, unknown>, status = 200) => Response.json({ success: true, data: { markdown: '# Hi', metadata } }, { status });

test('maps and scrapes through its fake', async () => {
  const firecrawl = client(fakeFetch(fakeFirecrawl({ pages })));
  expect(await firecrawl.map('https://lumen.test', 60)).toEqual(['https://lumen.test/', 'https://lumen.test/pricing']);
  expect(await firecrawl.scrape('https://lumen.test/pricing', RENDER))
    .toEqual({ url: 'https://lumen.test/pricing', status: 200, title: 'Pricing', markdown: '# Pricing', scriptReturns: [['https://lumen.test/']] });
  expect(await firecrawl.scrape('https://lumen.test/pricing', WAIT)).toMatchObject({ scriptReturns: [] });
  expect(await firecrawl.scrape('https://lumen.test/pricing')).toMatchObject({ scriptReturns: [] });
  expect(await firecrawl.scrape('https://lumen.test/gone', WAIT))
    .toEqual({ url: 'https://lumen.test/gone', status: 404, title: '', markdown: '', scriptReturns: [] });
});

test("sends the key and Firecrawl's options", async () => {
  const fake = fakeFetch(fakeFirecrawl({ pages }));
  await client(fake).map('https://lumen.test', 60);
  await client(fake).scrape('https://lumen.test/', WAIT);
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer fc-1');
  expect(bodies(fake)).toEqual([
    { url: 'https://lumen.test', limit: 60, sitemap: 'include', ignoreQueryParameters: true },
    { url: 'https://lumen.test/', formats: ['markdown'], onlyMainContent: true, timeout: 60000, actions: WAIT },
  ]);
});

test('reads the first of several titles, a missing status as 200, and the address it was given last', async () => {
  const answering = (metadata: Record<string, unknown>) => client(fakeFetch([{ url: SCRAPE, respond: () => page(metadata) }]));
  expect(await answering({ title: ['A', 'B'], sourceURL: 'https://x.test/source' }).scrape('https://x.test'))
    .toEqual({ url: 'https://x.test/source', status: 200, title: 'A', markdown: '# Hi', scriptReturns: [] });
  expect(await answering({}).scrape('https://x.test/asked')).toMatchObject({ url: 'https://x.test/asked', title: '' });
});

test('sends no actions to a document', async () => {
  const fake = fakeFetch([{ url: SCRAPE, respond: () => page({ title: 'Doc' }) }]);
  await client(fake).scrape('https://x.test/brochure.PDF', WAIT);
  await client(fake).scrape('https://x.test/deck.pptx?v=2', WAIT);
  expect(bodies(fake).map(body => 'actions' in body)).toEqual([false, false]);
});

test('reads a page as it loads when its render could not finish, never after a 402', async () => {
  const rendering = fakeFetch([{ url: SCRAPE, async respond(request) {
    const { actions } = await request.json() as { actions?: unknown };
    return actions ? Response.json({ success: false, error: 'Action(s) failed to complete' }, { status: 500 }) : page({ title: 'FAQ' });
  } }]);
  expect(await client(rendering).scrape('https://x.test/faq', WAIT)).toMatchObject({ title: 'FAQ', markdown: '# Hi' });
  expect(bodies(rendering).map(body => 'actions' in body)).toEqual([true, false]);

  const broke = fakeFetch([{ url: SCRAPE, respond: () => Response.json({ success: false, error: 'Payment required' }, { status: 402 }) }]);
  await expect(client(broke).scrape('https://x.test/faq', WAIT)).rejects.toEqual(new ProviderHttpError('request_failed', 402));
  expect(broke.calls).toHaveLength(1);

  // A render answered in a shape the client cannot read is Firecrawl's drift, not a render that failed: never re-read quietly.
  const drifted = fakeFetch([{ url: SCRAPE, respond: () => Response.json({ success: true, data: { markdown: 1, metadata: {} } }) }]);
  await expect(client(drifted).scrape('https://x.test/faq', WAIT)).rejects.toMatchObject({ code: 'invalid_response' });
  expect(drifted.calls).toHaveLength(1);

  // A render answered with no JSON at all (a proxy's error page) is read as it loads, as before 0.2.0.
  const garbled = fakeFetch([{ url: SCRAPE, async respond(request) {
    const { actions } = await request.json() as { actions?: unknown };
    return actions ? new Response('<html>Bad gateway</html>', { status: 200 }) : page({ title: 'FAQ' });
  } }]);
  expect(await client(garbled).scrape('https://x.test/faq', WAIT)).toMatchObject({ title: 'FAQ' });
  expect(garbled.calls).toHaveLength(2);

  const down = fakeFetch([{ url: SCRAPE, respond: () => new Response(null, { status: 503 }) }]);
  await expect(client(down).scrape('https://x.test/faq', WAIT)).rejects.toMatchObject({ code: 'unavailable' });
  expect(down.calls).toHaveLength(2);
});

test("waits out a scrape's 429 and resends the same body", async () => {
  vi.useFakeTimers();
  try {
    const fake = fakeFetch([{ url: SCRAPE, method: 'POST', respond: sequence(
      () => new Response(null, { status: 429, headers: { 'retry-after': '2' } }),
      () => page({ title: 'Plans' }),
    ) }]);
    const pending = client(fake).scrape('https://x.test/plans');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ title: 'Plans' });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.body).toBe(fake.calls[0]?.body);
  } finally {
    vi.useRealTimers();
  }
});

test('ends a stalled map at 120 seconds', async () => {
  vi.useFakeTimers();
  try {
    const fake = fakeFetch([{ url: 'https://api.firecrawl.dev/v2/map', respond: () => new Promise<Response>(() => undefined) }]);
    let settled = false;
    const pending = client(fake).map('https://x.test', 5).catch((error: unknown) => error).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ code: 'unavailable' });
  } finally {
    vi.useRealTimers();
  }
});
