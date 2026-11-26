import { defineProvider } from '../catalogue.js';

/** Airtable: OAuth 2 from an integration with a client secret (Basic is refused without one) and, for other users, a
 * support email, privacy policy and terms (https://airtable.com/developers/web/api/oauth-reference.md), or a personal
 * access token. After a 429 wait 30 s (https://airtable.com/developers/web/api/rate-limits.md); an error's code is
 * `error.type` or `error` (https://airtable.com/developers/web/api/errors.md). */
const api = 'https://airtable.com/developers/web/api';
const record = { id: 'string', createdTime: 'string', fields: 'unknown' } as const;
const table = { baseId: { in: 'path', type: 'string', required: true }, tableIdOrName: { in: 'path', type: 'string', required: true } } as const;
const recordId = { in: 'path', type: 'string', required: true } as const;

export const airtable = defineProvider({
  id: 'airtable', name: 'Airtable', docs: `${api}/authentication.md`,
  categories: ['tasks'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'For an integration of your own, never a third-party service: an app for other people connects with the OAuth 2 sign-in, as Airtable requires. Give it the data.records:read, data.records:write, schema.bases:read and user.email:read scopes and add the bases it works on; writing needs editor access.' }],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://airtable.com/oauth2/v1/authorize', tokenUrl: 'https://airtable.com/oauth2/v1/token',
    clientAuth: 'basic', authorizeParams: { response_type: 'code' }, tokenTypes: ['Bearer '] }, { kind: 'key' }],
  scopes: { default: ['data.records:read', 'data.records:write', 'schema.bases:read', 'user.email:read'] },
  http: { baseUrl: 'https://api.airtable.com/v0', retry: { defaultWaitMs: 30_000 } },
  identify: { request: { path: '/meta/whoami' }, id: 'id', name: 'email' },
  errors: { detail: ['error.type', 'error'] },
  paging: { offset: { kind: 'cursor', next: 'offset', send: { query: 'offset' } } },
  operations: {
    'records.list': { docs: `${api}/list-records.md`, path: '/{baseId}/{tableIdOrName}', paging: 'offset', records: 'records',
      params: { ...table, pageSize: { in: 'query', type: 'number' } }, result: { records: [record] } },
    'records.get': { docs: `${api}/get-record.md`, path: '/{baseId}/{tableIdOrName}/{recordId}', notFound: 'null',
      params: { ...table, recordId }, result: record },
    'records.create': { docs: `${api}/create-records.md`, method: 'POST', path: '/{baseId}/{tableIdOrName}',
      params: { ...table, fields: { in: 'body', type: 'unknown' } }, result: record },
    'records.update': { docs: `${api}/update-record.md`, method: 'PATCH', path: '/{baseId}/{tableIdOrName}/{recordId}',
      params: { ...table, recordId, fields: { in: 'body', type: 'unknown', required: true } }, result: record },
    'bases.list': { docs: `${api}/list-bases.md`, path: '/meta/bases', paging: 'offset', records: 'bases',
      result: { bases: [{ id: 'string', name: 'string', permissionLevel: 'string' }] } },
  },
});
