import { defineProvider } from '../catalogue.js';

/** Campaign Monitor API v3.3: OAuth 2 (its web application flow) or an API key as the Basic user. An account's clients
 * hold its lists: identify only checks the credential on the clients list, whose ClientID the list calls take. Lists
 * stop at NumberOfPages; there is no campaign get (its summary is a report), and only /transactional endpoints are rate
 * limited: https://www.campaignmonitor.com/api/v3-3/getting-started/ */
const subscriber = { EmailAddress: 'string', 'Name?': 'string', 'Date?': 'string', 'ListJoinedDate?': 'string', 'State?': 'string',
  'CustomFields?': 'unknown' } as const;
const listId = { listid: { in: 'path', type: 'string', required: true } } as const;
const clientId = { clientid: { in: 'path', type: 'string', required: true,
  description: 'A client\'s ClientID, from GET /clients.json.' } } as const;
const pageSize = { pagesize: { in: 'query', type: 'integer', description: '1000 by default.' } } as const;
const written = { Name: { in: 'body', type: 'string' }, MobileNumber: { in: 'body', type: 'string' },
  CustomFields: { in: 'body', type: [{ Key: 'string', Value: 'string' }] } } as const;
const consent = { in: 'body', type: 'string', required: true,
  description: 'Yes, No or Unchanged: whether opens and clicks may be tracked (a call without it is refused, code 214).' } as const;
const ref = 'https://www.campaignmonitor.com/api/v3-3';

export const campaignmonitor = defineProvider({
  id: 'campaignmonitor', name: 'Campaign Monitor', docs: 'https://www.campaignmonitor.com/api/v3-3/getting-started/',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From Account settings, API keys. Campaign Monitor prefers OAuth for an integration used by others, which connects with the OAuth 2 sign-in.' }],
  // An app registers in Campaign Monitor (Integrations, OAuth Registration); `type=web_server` is sent in place of
  // `response_type`. The refresh request the page shows names no client.
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.createsend.com/oauth', tokenUrl: 'https://api.createsend.com/oauth/token',
    scopeSeparator: ',', authorizeParams: { type: 'web_server' } }, { kind: 'key', send: { basic: ['{apiKey}', 'x'] } }],
  scopes: { default: ['ManageLists', 'ImportSubscribers', 'ViewReports', 'CreateCampaigns'] },
  http: { baseUrl: 'https://api.createsend.com/api/v3.3' },
  errors: { detail: 'Code' },
  identify: { request: { path: '/clients.json' } },
  paging: { page: { kind: 'page', send: { query: 'page' }, list: 'Results', total: { pages: 'NumberOfPages' } } },
  operations: {
    'lists.list': { docs: `${ref}/clients/#getting-subscriber-lists`, path: '/clients/{clientid}/lists.json', params: clientId,
      result: [{ ListID: 'string', 'Name?': 'string' }] },
    'subscribers.list': { docs: `${ref}/lists/#active-subscribers-2`, path: '/lists/{listid}/active.json', paging: 'page',
      records: 'Results', params: { ...listId, ...pageSize }, result: { Results: [subscriber] } },
    'subscribers.get': { docs: `${ref}/subscribers/#getting-a-subscribers-details`, path: '/subscribers/{listid}.json',
      params: { ...listId, email: { in: 'query', type: 'string', required: true,
        description: 'A subscriber not in the list is an error with detail 203.' } }, result: subscriber },
    // Adds or updates a subscriber. A new one is sent the list's follow-up email, and its verification email (double
    // opt-in) or confirmation email; no parameter stops them: https://www.campaignmonitor.com/api/v3-3/subscribers/
    'subscribers.create': { docs: `${ref}/subscribers/#adding-a-subscriber`, method: 'POST', path: '/subscribers/{listid}.json',
      params: { ...listId, EmailAddress: { in: 'body', type: 'string', required: true }, ...written,
        ConsentToTrack: consent }, result: 'string' },
    // Leaves out `Resubscribe`, which sends the welcome and confirmation emails an add sends.
    'subscribers.update': { docs: `${ref}/subscribers/#updating-a-subscriber`, method: 'PUT', path: '/subscribers/{listid}.json',
      params: { ...listId, email: { in: 'query', type: 'string', required: true, description: 'The subscriber\'s current email address.' },
        EmailAddress: { in: 'body', type: 'string', description: 'A new email address.' }, ...written, ConsentToTrack: consent } },
    'campaigns.list': { docs: `${ref}/clients/#getting-sent-campaigns-2`, path: '/clients/{clientid}/campaigns.json', paging: 'page',
      records: 'Results', params: { ...clientId, ...pageSize },
      result: { Results: [{ CampaignID: 'string', 'Name?': 'string', 'Subject?': 'string', 'SentDate?': 'string',
        'TotalRecipients?': 'integer', 'WebVersionURL?': 'string' }] } },
    // Creates (but does not send) a draft campaign; sending is another action, not declared.
    'campaigns.create': { docs: `${ref}/campaigns/#creating-draft-campaign`, method: 'POST', path: '/campaigns/{clientid}.json',
      params: { ...clientId, Name: { in: 'body', type: 'string', required: true }, Subject: { in: 'body', type: 'string', required: true },
        FromName: { in: 'body', type: 'string', required: true }, FromEmail: { in: 'body', type: 'string', required: true },
        ReplyTo: { in: 'body', type: 'string', required: true },
        HtmlUrl: { in: 'body', type: 'string', required: true, description: 'The URL of the campaign\'s HTML content.' },
        ListIDs: { in: 'body', type: ['string'] }, SegmentIDs: { in: 'body', type: ['string'], description: 'Sent instead of ListIDs.' } },
      anyOf: [['ListIDs'], ['SegmentIDs']], result: 'string' },
  },
});
