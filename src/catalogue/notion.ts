import { defineProvider } from '../catalogue.js';

/** Notion: 180 requests a minute per connection (600 on Business and Enterprise) in a fixed window, plus a budget every
 * connection of the workspace shares. A 429 names its wait in Retry-After, at most a minute for the connection's own limit. */
export const notion = defineProvider({
  id: 'notion', name: 'Notion', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://developers.notion.com/reference/authentication',
  categories: ['docs'],
  auth: [{ kind: 'key' }],
  // The latest API version: it names a trashed page `in_trash` (`archived` is gone).
  http: { baseUrl: 'https://api.notion.com/v1', headers: { 'notion-version': '2026-03-11' }, minIntervalMs: 350, retry: {} },
  identify: { request: { path: '/users/me' }, id: 'id', name: 'bot.workspace_name' },
  paging: { cursor: { kind: 'cursor', next: 'next_cursor', more: 'has_more', send: { body: 'start_cursor' } } },
  operations: { 'pages.markdown': { docs: 'https://developers.notion.com/reference/retrieve-page-markdown',
    path: '/pages/{pageId}/markdown?markdown_version=v2',
    params: { pageId: { in: 'path', type: 'string', required: true } }, result: { markdown: 'string', truncated: 'boolean' } } },
});
