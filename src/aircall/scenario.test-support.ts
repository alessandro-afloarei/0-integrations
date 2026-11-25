import type { KitScenario } from '../kit.test-support.js';
import { aircallClient, type AircallCall, type AircallClient } from './aircall.js';

/** The kit's key is the API token, or `api_id:api_token` when recording from a test account; two calls a page, so a small
 * account still pages. */
export const aircallScenario: KitScenario<AircallClient, AircallCall> = {
  provider: 'aircall',
  client: ({ apiKey, fetch }) => {
    const colon = apiKey.indexOf(':');
    return aircallClient({ apiId: colon < 0 ? 'kit-id' : apiKey.slice(0, colon), apiToken: apiKey.slice(colon + 1), fetch,
      minIntervalMs: 0, pageSize: 2 });
  },
  identify: client => client.company(),
  page: (client, { since, cursor }) => client.calls({ from: since === undefined ? undefined : Date.parse(since) / 1000, cursor }),
  id: call => String(call.id),
  changedAt: call => new Date(call.started_at * 1000).toISOString(),
  since: '2026-11-03T00:00:00Z',
  retriesRateLimit: true,
};
