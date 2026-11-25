import { expect, test, vi } from 'vitest';
import { ProviderHttpError } from '../errors.js';
import { fakeFetch } from '../testing.js';
import { fakeExa } from './fake.js';
import { exaClient, type SearchHit } from './exa.js';

const hit: SearchHit = { url: 'https://podcast.test/ep-1', title: 'Ep 1', text: 'Ana on payroll', publishedDate: '2026-09-01' };
const answering = (body: unknown, status = 200) => fakeFetch([{ url: 'https://api.exa.ai/search', respond: () => Response.json(body, { status }) }]);

test('searches through its fake', async () => {
  const fake = fakeFetch(fakeExa({ hits: query => (query === 'Lumen founder' ? [hit] : []), costUsd: 0.012 }));
  const exa = exaClient({ apiKey: 'exa-key', fetch: fake.fetch });
  expect(await exa.search('Lumen founder', { category: 'news', numResults: 5 })).toEqual({ hits: [hit], costUsd: 0.012 });
  expect(fake.calls[0]?.headers['x-api-key']).toBe('exa-key');
  expect(JSON.parse(fake.calls[0]?.body ?? '')).toEqual({
    query: 'Lumen founder', type: 'auto', numResults: 5, contents: { text: { maxCharacters: 2000 } }, category: 'news',
  });
});

test('drops a result without text and titles an untitled one by its address', async () => {
  const fake = answering({ results: [{ url: 'https://a.test', text: null }, { url: 'https://b.test', title: null, text: 't' }] });
  expect(await exaClient({ apiKey: 'k', fetch: fake.fetch }).search('q', { numResults: 2 }))
    .toEqual({ hits: [{ url: 'https://b.test', title: 'https://b.test', text: 't', publishedDate: null }], costUsd: 0 });
});

test('waits out a 429 three times, then throws rate_limited', async () => {
  vi.useFakeTimers();
  try {
    const fake = answering({ error: 'slow down' }, 429);
    const pending = exaClient({ apiKey: 'k', fetch: fake.fetch }).search('q', { numResults: 1 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(90_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ code: 'rate_limited' });
    expect(fake.calls).toHaveLength(4);
    expect(new Set(fake.calls.map(call => call.body)).size).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test('refuses an answer in the wrong shape', async () => {
  const pending = exaClient({ apiKey: 'k', fetch: answering({ results: 'x' }).fetch }).search('q', { numResults: 1 });
  await expect(pending).rejects.toMatchObject({ code: 'invalid_response' });
});
