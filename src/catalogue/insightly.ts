import { defineProvider } from '../catalogue.js';

/** Insightly API v3.1 on the instance's pod: the API key as the Basic username, the password blank. At most 10 requests
 * a second and a daily quota by plan, both per instance, then a 429. Lists and searches page by `skip` (records
 * skipped) and `top` (100 by default, at most 500); an update sends the record's id in the body. */
const swagger = 'https://api.insightly.com/v3.1/swagger/docs/v3.1';
const contact = { CONTACT_ID: 'integer', FIRST_NAME: 'string', 'LAST_NAME?': 'string', 'EMAIL_ADDRESS?': 'string',
  'ORGANISATION_ID?': 'integer', 'OWNER_USER_ID?': 'integer', 'DATE_CREATED_UTC?': 'string', 'DATE_UPDATED_UTC?': 'string' } as const;
const top = { top: { in: 'query', type: 'integer', description: 'Records a page: 100 by default, at most 500.' } } as const;
const written = { LAST_NAME: { in: 'body', type: 'string' }, EMAIL_ADDRESS: { in: 'body', type: 'string' },
  TITLE: { in: 'body', type: 'string' }, ORGANISATION_ID: { in: 'body', type: 'integer' }, OWNER_USER_ID: { in: 'body', type: 'integer' } } as const;

export const insightly = defineProvider({
  id: 'insightly', name: 'Insightly', docs: 'https://api.insightly.com/v3.1/Help',
  categories: ['crm'],
  fields: [{ name: 'pod', title: 'Pod',
    help: 'The pod in your API URL, shown under your API key in User Settings: na1 in https://api.na1.insightly.com/v3.1/.' },
  { name: 'apiKey', title: 'API key', secret: true,
    help: 'Your API key, under User Settings: the API acts with your permissions in Insightly.' }],
  auth: [{ kind: 'key', send: { basic: ['{apiKey}', ''] } }],
  http: { baseUrl: 'https://api.{pod}.insightly.com/v3.1', host: '*.insightly.com', retry: {} },
  identify: { request: { path: '/Users/Me' }, id: 'USER_ID', name: ['EMAIL_ADDRESS', 'FIRST_NAME'] },
  paging: { skip: { kind: 'offset', send: { query: 'skip' } } },
  operations: {
    'contacts.list': { docs: swagger, path: '/Contacts', paging: 'skip', params: top, result: [contact] },
    'contacts.search': { docs: swagger, path: '/Contacts/Search', paging: 'skip',
      params: { field_name: { in: 'query', type: 'string', description: 'A field name; sent with field_value.' },
        field_value: { in: 'query', type: 'string', description: 'The value field_name must have; sent with field_name.' },
        ...top },
      result: [contact] },
    'contacts.get': { docs: swagger, path: '/Contacts/{id}', notFound: 'null',
      params: { id: { in: 'path', type: 'integer', required: true } }, result: contact },
    'contacts.create': { docs: swagger, method: 'POST', path: '/Contacts',
      params: { FIRST_NAME: { in: 'body', type: 'string', required: true }, ...written }, result: contact },
    'contacts.update': { docs: swagger, method: 'PUT', path: '/Contacts',
      params: { CONTACT_ID: { in: 'body', type: 'integer', required: true }, FIRST_NAME: { in: 'body', type: 'string' }, ...written },
      result: contact },
    'organisations.list': { docs: swagger, path: '/Organisations', paging: 'skip', params: top,
      result: [{ ORGANISATION_ID: 'integer', ORGANISATION_NAME: 'string', 'WEBSITE?': 'string', 'OWNER_USER_ID?': 'integer',
        'DATE_CREATED_UTC?': 'string', 'DATE_UPDATED_UTC?': 'string' }] },
    'opportunities.list': { docs: swagger, path: '/Opportunities', paging: 'skip', params: top,
      result: [{ OPPORTUNITY_ID: 'integer', OPPORTUNITY_NAME: 'string', 'OPPORTUNITY_STATE?': 'string', 'ORGANISATION_ID?': 'integer',
        'PIPELINE_ID?': 'integer', 'STAGE_ID?': 'integer', 'OWNER_USER_ID?': 'integer', 'DATE_CREATED_UTC?': 'string' }] },
  },
});
