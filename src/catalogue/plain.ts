import { defineProvider } from '../catalogue.js';

/** Plain, GraphQL: a machine user's API key; its reads only, a thread's timeline one page (pass `after` yourself). A
 * mutation reports its failure inside a 2xx, in its own output: https://www.plain.com/docs/graphql/error-handling
 * Webhooks: hex HMAC-SHA256 of the body, once an admin sets a HMAC secret: https://www.plain.com/docs/request-signing;
 * the body's `id` is the event's, the same on every attempt: https://www.plain.com/docs/webhooks */
const at = '{ iso8601 }';
const threadFields = `id ref title status priority customer { id } createdAt ${at} updatedAt ${at}`;
const time = { iso8601: 'string' } as const;
const thread = { id: 'string', ref: 'string', title: 'string', status: 'string', priority: 'integer', customer: { id: 'string' },
  createdAt: time, updatedAt: time } as const;
const pageInfo = { hasNextPage: 'boolean', 'endCursor?': 'string' } as const;
const first = { first: { in: 'variables', type: 'integer', description: '25 by default, at most 100.' } } as const;
const page = { ...first, after: { in: 'variables', type: 'string', description: 'The `endCursor` of the page before.' } } as const;
const threadId = { threadId: { in: 'variables', type: 'string', required: true } } as const;
const reference = 'https://www.plain.com/docs/graphql-reference/queries';

export const plain = defineProvider({
  id: 'plain', name: 'Plain', docs: 'https://www.plain.com/docs/graphql/authentication',
  categories: ['support'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'A machine user\'s API key (Settings > Machine users & agents > Add API key), with the permissions thread:read, timeline:read and customer:read.' }],
  auth: [{ kind: 'key' }],
  // Every call is a POST of JSON: https://www.plain.com/docs/graphql/introduction
  // A 429 is a rate limit: https://www.plain.com/docs/graphql/sdk
  http: { baseUrl: 'https://core-api.uk.plain.com/graphql/v1', headers: { 'content-type': 'application/json' }, retry: {} },
  identify: { request: { graphql: 'query MyWorkspace { myWorkspace { id name } }' }, id: 'data.myWorkspace.id', name: 'data.myWorkspace.name' },
  // A query's error code is in `extensions.code`: https://www.plain.com/docs/graphql/reporting
  errors: { detail: 'errors.0.extensions.code', failed: { path: 'errors.0' } },
  webhook: { kind: 'hmac', header: 'plain-request-signature', deliveryId: { body: ['id'] } },
  // Relay paging (https://www.plain.com/docs/graphql/pagination), `hasNextPage` false on the last page:
  // https://relay.dev/graphql/connections.htm
  paging: { threads: { kind: 'cursor', next: 'data.threads.pageInfo.endCursor', more: 'data.threads.pageInfo.hasNextPage', send: { variables: 'after' } },
    search: { kind: 'cursor', next: 'data.searchThreads.pageInfo.endCursor', more: 'data.searchThreads.pageInfo.hasNextPage', send: { variables: 'after' } },
    customers: { kind: 'cursor', next: 'data.customers.pageInfo.endCursor', more: 'data.customers.pageInfo.hasNextPage', send: { variables: 'after' } } },
  operations: {
    'threads.list': { docs: `${reference}/threads`, kind: 'read', paging: 'threads', records: 'data.threads.edges',
      graphql: `query Threads($filters: ThreadsFilter, $first: Int, $after: String) { threads(filters: $filters, first: $first, after: $after) { edges { node { ${threadFields} } } pageInfo { hasNextPage endCursor } } }`,
      params: { filters: { in: 'variables', type: 'unknown', description: 'A ThreadsFilter (statuses, customer IDs, labels, …).' }, ...first },
      result: { data: { threads: { edges: [{ node: thread }], pageInfo } } } },
    'threads.search': { docs: `${reference}/searchThreads`, kind: 'read', paging: 'search', records: 'data.searchThreads.edges',
      graphql: `query SearchThreads($searchQuery: ThreadsSearchQuery!, $first: Int, $after: String) { searchThreads(searchQuery: $searchQuery, first: $first, after: $after) { edges { node { thread { ${threadFields} } } } pageInfo { hasNextPage endCursor } } }`,
      params: { searchQuery: { in: 'variables', required: true, type: { term: 'string' },
        description: '`term`, 3 to 500 characters, matched against titles, messages and customers\' names and emails.' }, ...first },
      result: { data: { searchThreads: { edges: [{ node: { thread } }], pageInfo } } } },
    'threads.get': { docs: `${reference}/thread`, kind: 'read',
      graphql: `query Thread($threadId: ID!) { thread(threadId: $threadId) { ${threadFields} } }`,
      params: threadId, result: { data: { 'thread?': thread } } },
    'timelineEntries.list': { docs: `${reference}/thread`, kind: 'read',
      graphql: 'query ThreadTimeline($threadId: ID!, $filters: ThreadTimelineEntriesFilter, $first: Int, $after: String) { thread(threadId: $threadId) { timelineEntries(filters: $filters, first: $first, after: $after) { edges { node { id timestamp { iso8601 } entry { __typename ... on ChatEntry { chatText: text } ... on EmailEntry { textContent } ... on NoteEntry { noteText: text } } } } pageInfo { hasNextPage endCursor } } } }',
      params: { ...threadId, filters: { in: 'variables', type: { 'isMessage?': 'boolean' }, description: '`isMessage: true` for messages only.' }, ...page },
      result: { data: { 'thread?': { timelineEntries: { edges: [{ node: { id: 'string', timestamp: time, entry: 'unknown' } }], pageInfo } } } } },
    'customers.list': { docs: `${reference}/customers`, kind: 'read', paging: 'customers', records: 'data.customers.edges',
      graphql: `query Customers($first: Int, $after: String) { customers(first: $first, after: $after) { edges { node { id externalId fullName shortName email { email } createdAt ${at} updatedAt ${at} } } pageInfo { hasNextPage endCursor } } }`,
      params: first,
      result: { data: { customers: { edges: [{ node: { id: 'string', 'externalId?': 'string', fullName: 'string', 'shortName?': 'string',
        email: { email: 'string' }, createdAt: time, updatedAt: time } }], pageInfo } } } },
  },
});
