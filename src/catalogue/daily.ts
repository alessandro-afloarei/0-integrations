import { defineProvider } from '../catalogue.js';

/** Daily: a domain's API key; rooms are listed, read, created and updated. A next page starts after its last record's
 * id (starting_after): each list answers one page: https://docs.daily.co/docs/rest-api/errors. A 429 waits 30 s, the
 * window of GET /recordings; no webhook (its timestamp has no stated unit). Identify reads the domain's configuration:
 * https://docs.daily.co/reference/rest-api/domain/get-domain-config */
const room = { id: 'string', 'name?': 'string', 'privacy?': 'string', 'url?': 'string', 'api_created?': 'boolean',
  'created_at?': 'string', 'config?': 'unknown' } as const;
const page = { limit: { in: 'query', type: 'integer', description: '100 by default and at most.' },
  starting_after: { in: 'query', type: 'string', description: 'The last id of the page before: the next page.' },
  ending_before: { in: 'query', type: 'string', description: 'OLDEST starts from the oldest.' } } as const;
const settings = { privacy: { in: 'body', type: 'string', description: 'public by default.' },
  properties: { in: 'body', type: 'unknown', description: 'The room\'s configuration properties.' } } as const;
const ref = 'https://docs.daily.co/reference/rest-api';

export const daily = defineProvider({
  id: 'daily', name: 'Daily', docs: 'https://docs.daily.co/docs/rest-api/authentication',
  categories: ['meetings'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'In the Developers section of the Daily dashboard, where only Admins see it. Each key belongs to one Daily domain.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.daily.co/v1', retry: { defaultWaitMs: 30_000 } },
  identify: { request: { path: '/' }, id: 'domain_id', name: 'domain_name' },
  errors: { detail: 'error' },
  operations: {
    'rooms.list': { docs: `${ref}/rooms/list-rooms`, path: '/rooms', params: page,
      result: { 'total_count?': 'integer', data: [room] } },
    'rooms.get': { docs: `${ref}/rooms/get-room`, path: '/rooms/{room_name}', notFound: 'null',
      params: { room_name: { in: 'path', type: 'string', required: true } }, result: room },
    'recordings.list': { docs: `${ref}/recordings/list-recordings`, path: '/recordings',
      params: { room_name: { in: 'query', type: 'string' }, ...page },
      result: { 'total_count?': 'integer', data: [{ id: 'string', 'room_name?': 'string', 'mtgSessionId?': 'string',
        'start_ts?': 'integer', 'status?': 'string', 'duration?': 'integer', 'max_participants?': 'integer' }] } },
    'rooms.create': { docs: `${ref}/rooms/create-room`, method: 'POST', path: '/rooms',
      params: { name: { in: 'body', type: 'string' }, ...settings }, result: room },
    'rooms.update': { docs: `${ref}/rooms/update-room`, method: 'POST', path: '/rooms/{room_name}',
      params: { room_name: { in: 'path', type: 'string', required: true }, ...settings }, result: room },
  },
});
