import { defineProvider } from '../catalogue.js';

/** Guru: HTTP Basic, the Guru username and a user token. Lists page by a `Link` header under `rel="next-page"`
 * (https://developer.getguru.com/docs/paging), not declared: each list answers its first page. A card written without
 * `shareStatus` is private to its owner, and an update without `tags` removes the card's tags: send both back. */
const card = { id: 'string', preferredPhrase: 'string', 'verificationState?': 'string', 'collection?': { 'id?': 'string' },
  'slug?': 'string', 'dateCreated?': 'string', 'lastModified?': 'string' } as const;
const cardId = { in: 'path', type: 'string', required: true } as const;
const fields = { preferredPhrase: { in: 'body', type: 'string', required: true }, content: { in: 'body', type: 'string', required: true },
  shareStatus: { in: 'body', type: 'string', enum: ['PRIVATE', 'TEAM', 'PUBLIC'] } } as const;
const reference = 'https://developer.getguru.com/reference';

export const guru = defineProvider({
  id: 'guru', name: 'Guru', docs: 'https://developer.getguru.com/docs/getting-started',
  categories: ['docs'],
  fields: [{ name: 'username', title: 'Guru username' },
    { name: 'userToken', title: 'User token', secret: true,
      help: 'A user token (a collection token is read-only): Manage > Apps & Integrations > API Access > Generate User Token. Only an Admin, or a role with Manage Apps & Integrations, can make one; it does what its user can.' }],
  auth: [{ kind: 'key', send: { basic: ['{username}', '{userToken}'] } }],
  http: { baseUrl: 'https://api.getguru.com/api/v1' },
  identify: { request: { path: '/whoami' }, id: 'user.id', name: 'user.email' },
  operations: {
    'cards.search': { docs: `${reference}/getv1searchquerysearch`, path: '/search/query',
      params: { q: { in: 'query', type: 'string' }, maxResults: { in: 'query', type: 'integer' } }, result: [card] },
    'cards.get': { docs: `${reference}/getv1cardsgetextendedfact`, path: '/cards/{cardId}/extended', notFound: 'null',
      params: { cardId }, result: card },
    'cards.create': { docs: `${reference}/postv1cardscreateextendedfact`, method: 'POST', path: '/cards/extended',
      params: { ...fields, collection: { in: 'body', type: { id: 'string' } } }, result: card },
    'cards.update': { docs: `${reference}/putv1cardsupdateextendedfact`, method: 'PUT', path: '/cards/{cardId}/extended',
      params: { cardId, ...fields, tags: { in: 'body', type: ['unknown'] } }, result: card },
    'collections.list': { docs: `${reference}/getv1collectionsgetcollections`, path: '/collections',
      result: [{ id: 'string', 'name?': 'string', 'slug?': 'string', 'dateCreated?': 'string' }] },
  },
});
