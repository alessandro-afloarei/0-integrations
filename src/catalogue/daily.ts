import { defineProvider } from '../catalogue.js';

/** Daily: a domain's API key; rooms are listed, read, created and updated. Lists walk by starting_after, the last
 * record's id, to an empty page: https://docs.daily.co/docs/rest-api/errors. A 429 waits 30 s, the
 * window of GET /recordings; no webhook (its timestamp has no stated unit). Identify reads the domain's configuration:
 * https://docs.daily.co/reference/rest-api/domain/get-domain-config */
const room = { id: 'string', 'name?': 'string', 'privacy?': 'string', 'url?': 'string', 'api_created?': 'boolean',
  'created_at?': 'string', 'config?': 'unknown' } as const;
const limit = { in: 'query', type: 'integer', description: '100 by default and at most.' } as const;
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
  paging: { after: { kind: 'last', next: 'id', send: { query: 'starting_after' }, list: 'data' } },
  operations: {
    'rooms.list': { docs: `${ref}/rooms/list-rooms`, path: '/rooms', params: { limit }, paging: 'after', records: 'data',
      result: { 'total_count?': 'integer', data: [room] } },
    'rooms.get': { docs: `${ref}/rooms/get-room`, path: '/rooms/{room_name}', notFound: 'null',
      params: { room_name: { in: 'path', type: 'string', required: true } }, result: room },
    'recordings.list': { docs: `${ref}/recordings/list-recordings`, path: '/recordings', paging: 'after', records: 'data',
      params: { room_name: { in: 'query', type: 'string' }, limit },
      result: { 'total_count?': 'integer', data: [{ id: 'string', 'room_name?': 'string', 'mtgSessionId?': 'string',
        'start_ts?': 'integer', 'status?': 'string', 'duration?': 'integer', 'max_participants?': 'integer' }] } },
    'rooms.create': { docs: `${ref}/rooms/create-room`, method: 'POST', path: '/rooms',
      params: { name: { in: 'body', type: 'string' }, ...settings }, result: room },
    'rooms.update': { docs: `${ref}/rooms/update-room`, method: 'POST', path: '/rooms/{room_name}',
      params: { room_name: { in: 'path', type: 'string', required: true }, ...settings }, result: room },
  },
});
