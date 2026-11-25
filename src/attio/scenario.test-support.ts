import type { KitScenario } from '../kit.test-support.js';
import { attioClient, type AttioClient, type AttioRecord } from './attio.js';

/** Two records a page, so a small workspace still pages. */
export const attioScenario: KitScenario<AttioClient, AttioRecord> = {
  provider: 'attio',
  client: ({ apiKey, fetch }) => attioClient({ apiKey, fetch, minIntervalMs: 0, pageSize: 2 }),
  identify: client => client.workspace(),
  page: (client, { since, cursor }) => client.records({ object: 'companies', createdAfter: since, cursor }),
  id: record => record.id.record_id,
  changedAt: record => record.created_at,
  since: '2026-11-03T00:00:00Z',
  retriesRateLimit: true,
};
