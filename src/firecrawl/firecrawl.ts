import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { parseAnswer } from '../parse.js';
import { firecrawl } from '../providers.js';

export type FirecrawlAction = { type: 'wait'; milliseconds: number } | { type: 'executeJavascript'; script: string };
export type ScrapedPage = { url: string; status: number; title: string; markdown: string; scriptReturns: unknown[] };
export type FirecrawlClient = {
  map(url: string, limit: number): Promise<string[]>;
  scrape(url: string, actions?: readonly FirecrawlAction[]): Promise<ScrapedPage>;
};

// Firecrawl refuses browser actions on a PDF; an Office file is parsed the same way.
const DOCUMENT = /\.(pdf|docx?|xlsx?|pptx?)$/iu;

const textish = z.union([z.string(), z.array(z.string())]).nullish();
const mapSchema = z.object({ links: z.array(z.object({ url: z.string() })) });
const scrapeSchema = z.object({ data: z.object({ markdown: z.string().nullish(), metadata: z.object({
  title: textish, url: z.string().nullish(), sourceURL: z.string().nullish(), statusCode: z.number().nullish(),
}), actions: z.object({ javascriptReturns: z.array(z.object({ value: z.unknown() })).nullish() }).nullish() }) });

/**
 * A render the browser could not finish (a click that navigates away, a page too slow): read the page as it loads.
 * A 402 is our credits, not the render. A rendered answer in a shape the client cannot read is not re-read either: it is
 * parsed after this, so Firecrawl's drift stays loud.
 */
const renderFailed = (error: unknown) => error instanceof ProviderHttpError && (error.code === 'unavailable'
  || error.code === 'invalid_response' || (error.code === 'request_failed' && error.status !== 402));

export function firecrawlClient(input: { apiKey: string; fetch: typeof fetch }): FirecrawlClient {
  const http = createClient({ provider: firecrawl, token: () => Promise.resolve(input.apiKey), fetch: input.fetch });
  // A map or a scrape changes nothing, so a 429 is waited out like a GET's.
  const post = (path: string, json: unknown) => http.json(path, { method: 'POST', json, idempotent: true });
  const send = (url: string, actions?: readonly FirecrawlAction[]) => post('/v2/scrape',
    { url, formats: ['markdown'], onlyMainContent: true, timeout: 60_000, actions });
  const read = async (url: string, actions?: readonly FirecrawlAction[]): Promise<unknown> => {
    if (!actions?.length || DOCUMENT.test(new URL(url).pathname)) return send(url);
    try {
      return await send(url, actions);
    } catch (error) {
      if (!renderFailed(error)) throw error;
      return send(url);
    }
  };
  return {
    async map(url, limit) {
      const answer = parseAnswer(mapSchema, await post('/v2/map', { url, limit, sitemap: 'include', ignoreQueryParameters: true }));
      return answer.links.map(link => link.url);
    },
    async scrape(url, actions) {
      const { data } = parseAnswer(scrapeSchema, await read(url, actions));
      const { title } = data.metadata;
      return { url: data.metadata.url ?? data.metadata.sourceURL ?? url, status: data.metadata.statusCode ?? 200,
        title: (Array.isArray(title) ? title[0] : title) ?? '', markdown: data.markdown ?? '',
        scriptReturns: data.actions?.javascriptReturns?.map(entry => entry.value) ?? [] };
    },
  };
}
