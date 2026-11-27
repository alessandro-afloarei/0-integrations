import { defineProvider } from '../catalogue.js';

/** Smartsheet, on its product's host: an access token as Bearer; 300 requests a minute per token, after a 429 wait at
 * least 60 seconds: https://developers.smartsheet.com/api/smartsheet/guides/advanced-topics/scalability-options.md
 * A page past the last answers the last page again: page `sheets.list` by `totalPages`, `rows.list` (a sheet's rows,
 * 100 a page unless `pageSize` says otherwise) by `totalRowCount`. */
const reference = 'https://developers.smartsheet.com/api/smartsheet/openapi';
const row = { id: 'number', 'sheetId?': 'number', 'parentId?': 'number', 'rowNumber?': 'number', 'permaLink?': 'string',
  'createdAt?': 'unknown', 'modifiedAt?': 'unknown', 'cells?': [{ 'columnId?': 'number', 'value?': 'unknown' }] } as const;
const sheetId = { in: 'path', type: 'number', required: true } as const;
const written = { cells: { in: 'body', type: [{ columnId: 'number', value: 'unknown' }],
  description: 'Each cell names its column and its value (Smartsheet also takes a formula or an objectValue instead).' },
  parentId: { in: 'body', type: 'number' } } as const;
/** Each product's host, each with its own tokens:
 * https://developers.smartsheet.com/api/smartsheet/guides/basics/base-url.md
 * https://developers.smartsheet.com/api/smartsheet/guides/getting-started.md */
const hosts = ['api.smartsheet.com', 'api.smartsheetgov.com', 'api.smartsheet.eu', 'api.smartsheet.au'] as const;
const outcome = { 'message?': 'string', 'resultCode?': 'number' } as const;

export const smartsheet = defineProvider({
  id: 'smartsheet', name: 'Smartsheet', docs: 'https://developers.smartsheet.com/api/smartsheet/guides/basics/authentication.md',
  categories: ['tasks'],
  fields: [{ name: 'apiHost', title: 'Smartsheet product', choices: hosts, default: 'api.smartsheet.com',
    help: 'Each product has its own host: api.smartsheet.com for Smartsheet, api.smartsheetgov.com for Smartsheet Gov, api.smartsheet.eu for Smartsheet Regions Europe, api.smartsheet.au for Smartsheet Regions Australia.' },
  { name: 'accessToken', title: 'API access token', secret: true,
    help: 'For your own Smartsheet account, made in the product you picked (a token works there alone): Smartsheet recommends OAuth for apps acting for other people. The API needs a Business or Enterprise plan, and a viewer cannot write to a sheet.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://{apiHost}/2.0', host: hosts, minIntervalMs: 200, retry: { defaultWaitMs: 60_000 } },
  identify: { request: { path: '/users/me' }, id: 'id', name: 'email' },
  operations: {
    'rows.list': { docs: `${reference}/sheets/getsheet.md`, path: '/sheets/{sheetId}',
      params: { sheetId, page: { in: 'query', type: 'number' }, pageSize: { in: 'query', type: 'number' } },
      result: { 'totalRowCount?': 'number', rows: [row] } },
    'rows.get': { docs: `${reference}/rows/row-get.md`, path: '/sheets/{sheetId}/rows/{rowId}', notFound: 'null',
      params: { sheetId, rowId: { in: 'path', type: 'number', required: true } }, result: row },
    'rows.create': { docs: `${reference}/rows/rows-addtosheet.md`, method: 'POST', path: '/sheets/{sheetId}/rows',
      params: { sheetId, ...written }, result: { ...outcome, 'result?': 'unknown' } },
    'rows.update': { docs: `${reference}/rows/update-rows.md`, method: 'PUT', path: '/sheets/{sheetId}/rows',
      params: { sheetId, id: { in: 'body', type: 'number', required: true }, ...written }, result: { ...outcome, 'result?': [row] } },
    'sheets.list': { docs: `${reference}/sheets/list-sheets.md`, path: '/sheets',
      params: { page: { in: 'query', type: 'number' }, pageSize: { in: 'query', type: 'number' } },
      result: { 'pageNumber?': 'number', 'totalPages?': 'number', data: [{ id: 'number', 'name?': 'string', 'permalink?': 'string',
        'createdAt?': 'unknown', 'modifiedAt?': 'unknown' }] } },
  },
});
