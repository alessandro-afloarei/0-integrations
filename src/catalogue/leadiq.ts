import { defineProvider } from '../catalogue.js';

/** LeadIQ (GraphQL): a query spends UC credits on the data points it selects (email 1, phone 10, company information
 * 3, profile information 0.1), `account` none. Errors come in `errors`, even on a 200; a 402 means no credits left.
 * Advanced searches page by `skip` and `limit` or `after` inside `input`: each call answers one page.
 * Reference: https://developer.leadiq.com/ */
const ref = 'https://developer.leadiq.com/';
const page = { 'skip?': 'integer', 'limit?': 'integer', 'after?': [{ key: 'string', value: 'string' }] } as const;
const after = { 'after?': [{ key: 'string', value: 'string' }] } as const;
const person = { id: 'string', companyId: 'string', 'name?': 'string', 'title?': 'string', 'linkedinUrl?': 'string',
  'updatedAt?': 'unknown' } as const;
const company = { id: 'string', 'name?': 'string', 'domain?': 'string', 'industry?': 'string', 'employeeCount?': 'integer' } as const;
const companyInfo = { id: 'string', name: 'string', 'domain?': 'string', 'industry?': 'string', 'numberOfEmployees?': 'integer',
  'linkedinUrl?': 'string', 'updatedDate?': 'unknown' } as const;

export const leadiq = defineProvider({
  id: 'leadiq', name: 'LeadIQ', docs: 'https://leadiqhelp.zendesk.com/hc/en-us/articles/29375289152795-LeadIQ-Public-API-Guide',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From Settings, then API, in LeadIQ, exactly as shown (it is already Base64-encoded). Searches and lookups spend the account\'s UC credits.' }],
  auth: [{ kind: 'key', send: { header: 'authorization', value: 'Basic {token}' } }],
  http: { baseUrl: 'https://api.leadiq.com/graphql', headers: { 'content-type': 'application/json' }, retry: {} },
  identify: { request: { graphql: 'query Account { account { plans { name product status } } }' } },
  errors: { failed: { path: 'errors.0' } },
  operations: {
    'people.search': { docs: `${ref}#query-flatAdvancedSearch`, kind: 'write',
      graphql: 'query FlatAdvancedSearch($input: FlatSearchInput!) { flatAdvancedSearch(input: $input) { people { id companyId name title linkedinUrl updatedAt } after { key value } } }',
      params: { input: { in: 'variables', required: true, type: { 'companyFilter?': 'unknown', 'contactFilter?': 'unknown', ...page } } },
      result: { data: { flatAdvancedSearch: { people: [person], ...after } } } },
    'people.get': { docs: `${ref}#query-searchPeople`, kind: 'write',
      graphql: 'query SearchPeople($input: SearchPeopleInput!) { searchPeople(input: $input) { totalResults hasMore results { id name { fullName } linkedin { linkedinUrl } currentPositions { companyId title } updatedAt } } }',
      params: { input: { in: 'variables', required: true,
        type: { 'email?': 'string', 'linkedinUrl?': 'string', 'id?': 'string', 'firstName?': 'string', 'lastName?': 'string',
          'company?': { 'name?': 'string', 'domain?': 'string' } },
        description: 'The person, by identifying information (name, company, social profiles, email); linkedinUrl is the most precise.' } },
      result: { data: { searchPeople: { totalResults: 'integer', hasMore: 'boolean', results: [{ id: 'string',
        name: { fullName: 'string' }, 'linkedin?': { 'linkedinUrl?': 'string' },
        currentPositions: [{ companyId: 'string', 'title?': 'string' }], 'updatedAt?': 'unknown' }] } } } },
    'companies.search': { docs: `${ref}#query-groupedAdvancedSearch`, kind: 'write',
      graphql: 'query GroupedAdvancedSearch($input: GroupedSearchInput!) { groupedAdvancedSearch(input: $input) { companies { totalContactsInCompany company { id name domain industry employeeCount } } after { key value } } }',
      params: { input: { in: 'variables', required: true, type: { 'companyFilter?': 'unknown', 'contactFilter?': 'unknown', ...page } } },
      result: { data: { groupedAdvancedSearch: { companies: [{ totalContactsInCompany: 'integer', company }], ...after } } } },
    'companies.get': { docs: `${ref}#query-searchCompany`, kind: 'write',
      graphql: 'query SearchCompany($input: SearchCompanyInput!) { searchCompany(input: $input) { totalResults hasMore results { id name domain industry numberOfEmployees linkedinUrl updatedDate } } }',
      params: { input: { in: 'variables', required: true,
        type: { 'domain?': 'string', 'name?': 'string', 'id?': 'string', 'linkedinUrl?': 'string' },
        description: 'The company, by identifying information.' } },
      result: { data: { searchCompany: { totalResults: 'integer', hasMore: 'boolean', results: [companyInfo] } } } },
  },
});
