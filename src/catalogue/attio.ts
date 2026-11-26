import { defineProvider } from '../catalogue.js';

/** Attio: 100 reads a second, list notes 10; a 429 names a date (usually the next second), which the default wait covers. */
export const attio = defineProvider({
  id: 'attio', name: 'Attio', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.attio.com/v2', minIntervalMs: 100, retry: { maxWaitMs: 10_000 } },
  identify: { request: { path: '/self' }, id: 'workspace_id', name: 'workspace_name',
    rejectWhen: [{ path: 'active', equals: false, detail: 'token_inactive' }, { status: 400 }] },
});
