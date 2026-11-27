import { defineProvider } from '../catalogue.js';

/** ZoomInfo (GTM API) by client credentials: searches are free, an enrichment spends a bulk data credit per new record
 * (https://docs.gtm.ai/docs/credit-usage-and-limits). Bodies are JSON:API (`data.type`, `data.attributes`); a search
 * pages to `meta.page.total`, at most 100 (https://docs.gtm.ai/docs/pagination-batching-and-bulk). An error's code is
 * `error.code` or `errors[].code` (https://docs.gtm.ai/docs/status-codes-and-errors); a 429 may name `Retry-After`. */
const ref = 'https://docs.gtm.ai/reference';
const size = { 'page[size]': { in: 'query', type: 'integer', description: 'Records per page, 1 to 100 (25 by default).' } } as const;
const meta = { 'meta?': { 'totalResults?': 'integer', 'page?': { 'number?': 'integer', 'total?': 'integer' } } } as const;
const contact = { id: 'string', type: 'string', 'attributes?': { 'firstName?': 'string', 'lastName?': 'string', 'jobTitle?': 'string',
  'email?': 'string', 'lastUpdatedDate?': 'string', 'company?': { 'id?': 'integer', 'name?': 'string' } },
  'meta?': { 'matchStatus?': 'string' } } as const;
const company = { id: 'string', type: 'string', 'attributes?': { 'name?': 'string', 'website?': 'string', 'city?': 'string',
  'country?': 'string', 'employeeCount?': 'unknown', 'lastUpdatedDate?': 'string' }, 'meta?': { 'matchStatus?': 'string' } } as const;

export const zoominfo = defineProvider({
  id: 'zoominfo', name: 'ZoomInfo', docs: 'https://docs.gtm.ai/docs/client-credentials-flow',
  categories: ['sales'],
  fields: [{ name: 'clientId', title: 'Client ID' }, { name: 'clientSecret', title: 'Client secret', secret: true,
    help: 'From a Client Credentials app you create in the ZoomInfo Developer Portal (or GTM.ai), with the api:data:contact and api:data:company scopes; its integration user needs API access. Enrichments spend the account\'s credits.' }],
  auth: [{ kind: 'token', request: { url: 'https://api.zoominfo.com/gtm/oauth/v1/token',
    body: { grant_type: 'client_credentials' }, basic: ['{clientId}', '{clientSecret}'] } }],
  http: { baseUrl: 'https://api.zoominfo.com/gtm', headers: { 'content-type': 'application/json', accept: 'application/json' },
    retry: {} },
  errors: { detail: ['error.code', 'errors.0.code'] },
  identify: { request: { path: '/data/v1/users/usage' } },
  paging: { search: { kind: 'page', send: { query: 'page[number]' }, list: 'data', total: { pages: 'meta.page.total' } } },
  operations: {
    'contacts.search': { docs: `${ref}/searchinterface_searchcontact`, method: 'POST', path: '/data/v1/contacts/search', kind: 'read',
      paging: 'search', records: 'data',
      params: { ...size, data: { in: 'body', type: { type: 'string', attributes: 'unknown' }, required: true,
        description: '{ "type": "ContactSearch", "attributes": { … } } with at least one search field.' } },
      result: { data: [contact], ...meta } },
    'contacts.get': { docs: `${ref}/enrichinterface_enrichcontact`, method: 'POST', path: '/data/v1/contacts/enrich', kind: 'write',
      params: { data: { in: 'body', required: true,
        type: { type: 'string', attributes: { outputFields: ['string'], matchPersonInput: ['unknown'], 'requiredFields?': ['string'] } },
        description: '{ "type": "ContactEnrich", "attributes": { "outputFields": [...], "matchPersonInput": [{ "emailAddress": … }] } }; up to 25 people, one credit for each new record found.' } },
      result: { data: [contact] } },
    'companies.search': { docs: `${ref}/searchinterface_searchcompany`, method: 'POST', path: '/data/v1/companies/search', kind: 'read',
      paging: 'search', records: 'data',
      params: { ...size, data: { in: 'body', type: { type: 'string', attributes: 'unknown' }, required: true,
        description: '{ "type": "CompanySearch", "attributes": { … } } with at least one search field.' } },
      result: { data: [company], ...meta } },
    'companies.get': { docs: `${ref}/enrichinterface_enrichcompany`, method: 'POST', path: '/data/v1/companies/enrich', kind: 'write',
      params: { data: { in: 'body', required: true,
        type: { type: 'string', attributes: { outputFields: ['string'], matchCompanyInput: ['unknown'] } },
        description: '{ "type": "CompanyEnrich", "attributes": { "outputFields": [...], "matchCompanyInput": [{ "companyWebsite": … }] } }; up to 25 companies, one credit for each new record found.' } },
      result: { data: [company] } },
  },
});
