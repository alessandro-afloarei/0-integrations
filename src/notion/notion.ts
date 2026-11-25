import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import type { Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { notion } from '../catalogue/notion.js';
import { datetime } from '../shapes.js';

// Notion's own field names, except `title`, which the client reads out of the page's title property.
export type NotionBot = { id: string; workspace_id: string | null; workspace_name: string | null };
export type NotionPage = { id: string; url: string; created_time: string; last_edited_time: string; in_trash: boolean;
  /** The title property's plain text, empty on an untitled page. */
  title: string };
export type NotionClient = {
  /** The connection's bot user: the key proof. */
  bot(): Promise<NotionBot>;
  /** One page of the pages shared with the connection, most recently edited first. With `editedAfter`, only those edited
   * at or after it: the read ends at the first older one. */
  pages(query: { editedAfter?: string | undefined; cursor?: string | undefined }): Promise<Page<NotionPage>>;
  /** A page as Notion-flavored Markdown; `cut` says Notion left part out (past about 20,000 blocks, or child content not
   * shared with the connection). */
  text(pageId: string): Promise<{ markdown: string; cut: boolean }>;
};

const id = z.string().min(1).max(200);
// The schema requires both workspace fields, yet Notion's own example of a bot omits its workspace id.
const botSchema = z.object({ id, type: z.literal('bot'), bot: z.object({ workspace_id: z.string().optional(),
  workspace_name: z.string().nullable().optional() }) });
const titleSchema = z.object({ type: z.literal('title'), title: z.array(z.object({ plain_text: z.string() })) });
/** Notion keys the title property by its display name ("Name", "Title", "title"), so it is found by its type. */
const titleOf = (properties: Record<string, unknown>): string => {
  for (const property of Object.values(properties)) {
    const parsed = titleSchema.safeParse(property);
    if (parsed.success) return parsed.data.title.map(text => text.plain_text).join('');
  }
  return '';
};
// Every key it does not name is dropped: icons, covers, parents, authors and the other properties never leave the client.
const pageSchema = z.object({ object: z.literal('page'), id, url: z.string(), created_time: datetime, last_edited_time: datetime,
  in_trash: z.boolean(), properties: z.record(z.string(), z.unknown()) })
  .transform(({ properties, ...page }): NotionPage => ({ id: page.id, url: page.url, created_time: page.created_time,
    last_edited_time: page.last_edited_time, in_trash: page.in_trash, title: titleOf(properties) }));
const listSchema = z.object({ results: z.array(z.unknown()), has_more: z.boolean(), next_cursor: z.string().nullable() });
const markdownSchema = z.object({ markdown: z.string(), truncated: z.boolean() });

/** `pageSize` is for tests: Notion answers at most 100 a page. */
export function notionClient(input: { apiKey: string; fetch: typeof fetch; minIntervalMs?: number; pageSize?: number }): NotionClient {
  const http = createClient(notion, { token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  return {
    async bot() {
      const { id: botId, bot } = parseAnswer(botSchema, await http.json('/users/me'));
      return { id: botId, workspace_id: bot.workspace_id ?? null, workspace_name: bot.workspace_name ?? null };
    },
    async pages({ editedAfter, cursor }) {
      // Notion rounds `last_edited_time` down to the minute: a page edited in `editedAfter`'s minute must not read as older.
      const since = editedAfter === undefined ? null : Math.floor(Date.parse(editedAfter) / 60_000) * 60_000;
      if (Number.isNaN(since)) throw new TypeError('date_invalid');
      // Newest edit first. Search filters on no time, so an incremental read stops where older pages begin instead of
      // paging the whole workspace. And a page edited during the read moves to the top, pushing the unread ones down (read
      // twice) where ascending order would move it to the end and pull them up past the cursor (never read).
      const answer = parseAnswer(listSchema, await http.json('/search', { method: 'POST', idempotent: true,
        query: { filter_properties: 'title' },
        json: { filter: { property: 'object', value: 'page' }, sort: { timestamp: 'last_edited_time', direction: 'descending' },
          page_size: input.pageSize ?? 100, ...(cursor ? { start_cursor: cursor } : {}) } }));
      const { items, skipped } = parseEntries(pageSchema, answer.results);
      const older = since === null ? -1 : items.findIndex(page => Date.parse(page.last_edited_time) < since);
      if (older >= 0) return { items: items.slice(0, older), skipped, cursor: null };
      if (answer.has_more && !answer.next_cursor) throw new ProviderHttpError('invalid_response', null, 'cursor_missing');
      return { items, skipped, cursor: answer.has_more ? answer.next_cursor : null };
    },
    async text(pageId) {
      const answer = parseAnswer(markdownSchema, await http.json(`/pages/${encodeURIComponent(pageId)}/markdown`,
        { query: { markdown_version: 'v2' } }));
      return { markdown: answer.markdown, cut: answer.truncated };
    },
  };
}
