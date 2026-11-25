import type { KitScenario } from '../kit.test-support.js';
import { notionClient, type NotionClient, type NotionPage } from './notion.js';

/** Two pages a page, so a small workspace still pages. */
export const notionScenario: KitScenario<NotionClient, NotionPage> = {
  provider: 'notion',
  client: ({ apiKey, fetch }) => notionClient({ apiKey, fetch, minIntervalMs: 0, pageSize: 2 }),
  identify: client => client.bot(),
  page: (client, { since, cursor }) => client.pages({ editedAfter: since, cursor }),
  id: page => page.id,
  changedAt: page => page.last_edited_time,
  since: '2026-11-03T00:00:00Z',
  retriesRateLimit: true,
};
