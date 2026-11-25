import type { KitScenario } from '../kit.test-support.js';
import { fathomClient, type FathomClient, type FathomMeeting } from './fathom.js';

export const fathomScenario: KitScenario<FathomClient, FathomMeeting> = {
  provider: 'fathom',
  client: ({ apiKey, fetch }) => fathomClient({ apiKey, fetch, minIntervalMs: 0 }),
  identify: client => client.meetings({}),
  page: (client, { since, cursor }) => client.meetings({ createdAfter: since, cursor }),
  id: meeting => String(meeting.recording_id),
  changedAt: meeting => meeting.created_at,
  since: '2026-11-05T00:00:00Z',
  retriesRateLimit: true,
};
