import { defineProvider } from '../catalogue.js';

/** Smartsheet (Smartsheet.com; Gov, Europe and Australia are on other hosts): an access token as Bearer. 300 requests a
 * minute per token; after a 429, wait at least 60 seconds
 * (https://developers.smartsheet.com/api/smartsheet/guides/advanced-topics/scalability-options.md). A page past the
 * last answers the last page: page `sheets.list` by its `totalPages`. */
const reference = 'https://developers.smartsheet.com/api/smartsheet/openapi';
const row = { id: 'number', 'sheetId?': 'number', 'parentId?': 'number', 'rowNumber?': 'number', 'permaLink?': 'string',
  'createdAt?': 'unknown', 'modifiedAt?': 'unknown', 'cells?': [{ 'columnId?': 'number', 'value?': 'unknown' }] } as const;
const sheetId = { in: 'path', type: 'number', required: true } as const;
const location = { cells: { in: 'body', type: [{ columnId: 'number', 'value?': 'unknown' }] },
  toTop: { in: 'body', type: 'boolean' }, toBottom: { in: 'body', type: 'boolean' }, parentId: { in: 'body', type: 'number' } } as const;
const outcome = { 'message?': 'string', 'resultCode?': 'number' } as const;

export const smartsheet = defineProvider({
  id: 'smartsheet', name: 'Smartsheet', docs: 'https://developers.smartsheet.com/api/smartsheet/guides/basics/authentication.md',
  categories: ['tasks'],
  fields: [{ name: 'accessToken', title: 'API access token', secret: true,
    help: 'A token made on Smartsheet.com (Gov and Europe use their own). The API needs a Business or Enterprise plan, and a viewer cannot write to a sheet.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.smartsheet.com/2.0', minIntervalMs: 200, retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/users/me' }, id: 'id', name: 'email' },
  operations: {
    'rows.get': { docs: `${reference}/rows/row-get.md`, path: '/sheets/{sheetId}/rows/{rowId}', notFound: 'null',
      params: { sheetId, rowId: { in: 'path', type: 'number', required: true } }, result: row },
    'rows.create': { docs: `${reference}/rows/rows-addtosheet.md`, method: 'POST', path: '/sheets/{sheetId}/rows',
      params: { sheetId, ...location }, result: { ...outcome, 'result?': row } },
    'rows.update': { docs: `${reference}/rows/update-rows.md`, method: 'PUT', path: '/sheets/{sheetId}/rows',
      params: { sheetId, id: { in: 'body', type: 'number', required: true }, ...location }, result: { ...outcome, 'result?': [row] } },
    'sheets.list': { docs: `${reference}/sheets/list-sheets.md`, path: '/sheets',
      params: { page: { in: 'query', type: 'number' }, pageSize: { in: 'query', type: 'number' } },
      result: { 'pageNumber?': 'number', 'totalPages?': 'number', data: [{ id: 'number', 'name?': 'string', 'permalink?': 'string',
        'createdAt?': 'unknown', 'modifiedAt?': 'unknown' }] } },
  },
});
