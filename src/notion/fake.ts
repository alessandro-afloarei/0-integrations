import { notion } from '../catalogue/notion.js';
import type { Route } from '../testing.js';
import type { NotionPage } from './notion.js';

/** A page and what its markdown answers; `cut` is Notion's `truncated`. */
export type FakeNotionPage = NotionPage & { markdown: string; cut?: boolean };
export type FakeNotionWorkspace = { workspace_id: string; workspace_name: string | null; pages: readonly FakeNotionPage[] };

const BASE = notion.http.baseUrl;
const MARKDOWN = new RegExp(`^${BASE.replaceAll('.', '\\.')}/pages/([^/]+)/markdown$`, 'u');
const error = (status: number, code: string, message: string) => Response.json({ object: 'error', status, code, message }, { status });

/**
 * Notion for one token at a time: `workspace(token)` is what the connection reads, null a token Notion refuses. Search
 * answers the pages out of the trash, by last edit (newest first unless asked otherwise), the title as its property.
 */
export function fakeNotion(data: { workspace: (token: string) => FakeNotionWorkspace | null }): Route[] {
  const read = (request: Request) => data.workspace((request.headers.get('authorization') ?? '').replace(/^Bearer /u, ''));
  const refused = () => error(401, 'unauthorized', 'API token is invalid.');
  return [
    { method: 'GET', url: `${BASE}/users/me`, respond(request) {
      const workspace = read(request);
      if (!workspace) return refused();
      return Response.json({ object: 'user', id: '9188c6a5-7381-452f-b3dc-d4865aa89bdf', name: 'Test Connection', avatar_url: null,
        type: 'bot', bot: { owner: { type: 'workspace', workspace: true }, workspace_id: workspace.workspace_id,
          workspace_name: workspace.workspace_name, workspace_limits: { max_file_upload_size_in_bytes: 5242880 } } });
    } },
    { method: 'POST', url: `${BASE}/search`, async respond(request) {
      const workspace = read(request);
      if (!workspace) return refused();
      const body = await request.json() as { sort?: { direction?: string }; page_size?: number; start_cursor?: string };
      const order = body.sort?.direction === 'ascending' ? 1 : -1;
      const listed = workspace.pages.filter(page => !page.in_trash)
        .sort((a, b) => order * (Date.parse(a.last_edited_time) - Date.parse(b.last_edited_time)));
      const offset = Number(body.start_cursor ?? '0');
      const size = body.page_size ?? 100;
      const more = offset + size < listed.length;
      return Response.json({ object: 'list', type: 'page_or_data_source', page_or_data_source: {}, has_more: more,
        next_cursor: more ? String(offset + size) : null,
        results: listed.slice(offset, offset + size).map(({ id, url, created_time, last_edited_time, in_trash, title }) => ({
          object: 'page', id, url, created_time, last_edited_time, in_trash, is_archived: false, is_locked: false,
          properties: { title: { id: 'title', type: 'title', title: title ? [{ type: 'text', text: { content: title, link: null },
            plain_text: title, href: null }] : [] } } })) });
    } },
    { method: 'GET', url: url => MARKDOWN.test(`${url.origin}${url.pathname}`), respond(request) {
      const workspace = read(request);
      if (!workspace) return refused();
      const { origin, pathname } = new URL(request.url);
      const pageId = decodeURIComponent(MARKDOWN.exec(`${origin}${pathname}`)?.[1] ?? '');
      const page = workspace.pages.find(item => item.id === pageId);
      if (!page) return error(404, 'object_not_found', `Could not find page with ID: ${pageId}.`);
      return Response.json({ object: 'page_markdown', id: page.id, markdown: page.markdown, truncated: page.cut ?? false,
        unknown_block_ids: [] });
    } },
  ];
}
