import { z } from 'zod';
import { exa } from '../providers.js';
import type { Route } from '../testing.js';
import type { SearchHit } from './exa.js';

const searchRequest = z.object({ query: z.string() });

/** Exa's search: each query gets the hits the caller gives for it, never cut to `numResults`. */
export function fakeExa(data: { hits: (query: string) => readonly SearchHit[]; costUsd: number }): Route[] {
  return [{ method: 'POST', url: `${exa.baseUrl ?? ''}/search`, async respond(request) {
    const { query } = searchRequest.parse(await request.json());
    return Response.json({ results: data.hits(query), costDollars: { total: data.costUsd } });
  } }];
}
