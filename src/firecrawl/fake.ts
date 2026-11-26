import { z } from 'zod';
import { firecrawl } from '../catalogue/firecrawl.js';
import type { Route } from '../testing.js';

const scrapeRequest = z.object({ url: z.string(), actions: z.array(z.object({ type: z.string() })).default([]) });

/** Firecrawl over a site: `map` lists every page; each script a scrape runs returns the page's links, as a link-listing script would. */
export function fakeFirecrawl(site: { pages: readonly { url: string; title: string; markdown: string; links: readonly string[] }[] }): Route[] {
  const at = (path: string) => `${firecrawl.http.baseUrl}${path}`;
  return [
    { method: 'POST', url: at('/v2/map'),
      respond: () => Response.json({ success: true, links: site.pages.map(page => ({ url: page.url, title: page.title })) }) },
    { method: 'POST', url: at('/v2/scrape'), async respond(request) {
      const { url, actions } = scrapeRequest.parse(await request.json());
      const page = site.pages.find(candidate => candidate.url === url);
      if (!page) return Response.json({ success: true, data: { markdown: '', metadata: { title: '', url, statusCode: 404 } } });
      return Response.json({ success: true, data: {
        markdown: page.markdown, metadata: { title: page.title, url: page.url, sourceURL: page.url, statusCode: 200 },
        actions: { javascriptReturns: actions.filter(action => action.type === 'executeJavascript')
          .map(() => ({ type: 'object', value: page.links })) },
      } });
    } },
  ];
}
