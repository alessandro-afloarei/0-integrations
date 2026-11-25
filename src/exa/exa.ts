import { z } from 'zod';
import { createClient } from '../http.js';
import { parseAnswer } from '../parse.js';
import { exa } from '../providers.js';

export type SearchHit = { url: string; title: string; text: string; publishedDate: string | null };
export type SearchOptions = { category?: 'news'; numResults: number };
export type ExaClient = { search(query: string, options: SearchOptions): Promise<{ hits: SearchHit[]; costUsd: number }> };

const searchSchema = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string().nullish(), text: z.string().nullish(), publishedDate: z.string().nullish() })),
  costDollars: z.object({ total: z.number() }).nullish(),
});

export function exaClient(input: { apiKey: string; fetch: typeof fetch }): ExaClient {
  const http = createClient({ provider: exa, token: () => Promise.resolve(input.apiKey), fetch: input.fetch });
  return {
    async search(query, options) {
      const json = { query, type: 'auto', numResults: options.numResults, contents: { text: { maxCharacters: 2000 } },
        category: options.category };
      // A search reads nothing it changes, so a 429 is waited out like a GET's.
      const answer = parseAnswer(searchSchema, await http.json('/search', { method: 'POST', json, idempotent: true }));
      return {
        hits: answer.results.flatMap(result => (result.text
          ? [{ url: result.url, title: result.title ?? result.url, text: result.text, publishedDate: result.publishedDate ?? null }] : [])),
        costUsd: answer.costDollars?.total ?? 0,
      };
    },
  };
}
