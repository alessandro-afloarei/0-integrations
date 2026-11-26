import { defineProvider } from '../catalogue.js';

/** Attio: OAuth 2, its scopes set on the app in the developer console (unpublished, it installs in up to 25 workspaces),
 * or a workspace API key. 100 reads a second, list notes 10; a 429 names a date (usually the next second), which the
 * default wait covers. */
export const attio = defineProvider({
  id: 'attio', name: 'Attio', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  docs: 'https://docs.attio.com/rest-api/guides/authentication',
  categories: ['crm'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://app.attio.com/authorize', tokenUrl: 'https://app.attio.com/oauth/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: [] },
  revoke: { url: 'https://app.attio.com/oauth/revoke', token: ['access'] },
  http: { baseUrl: 'https://api.attio.com/v2', retry: { maxWaitMs: 10_000 } },
  identify: { request: { path: '/self' }, id: 'workspace_id', name: 'workspace_name',
    rejectWhen: [{ path: 'active', equals: false, detail: 'token_inactive' }, { status: 400 }] },
});
