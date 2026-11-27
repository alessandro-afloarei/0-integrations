import { defineProvider } from '../catalogue.js';

/** Daily: a domain's API key. Meetings are sessions, read back; rooms are created and updated. A next page starts after
 * its last record's id (starting_after): each list answers one page. https://docs.daily.co/docs/rest-api/errors
 * A 429 waits the 30-second window of the data reads: https://docs.daily.co/docs/rest-api/authentication. The webhook's
 * timestamp has no stated unit: not checked here. */
const meeting = { id: 'string', 'room?': 'string', 'start_time?': 'integer', 'duration?': 'integer', 'ongoing?': 'boolean',
  'max_participants?': 'integer', 'participants?': 'unknown' } as const;
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
    'meetings.list': { docs: `${ref}/meetings/list-meetings`, path: '/meetings',
      params: { room: { in: 'query', type: 'string', description: 'A room name.' },
        timeframe_start: { in: 'query', type: 'integer' }, timeframe_end: { in: 'query', type: 'integer' },
        ongoing: { in: 'query', type: 'boolean' }, ...page },
      result: { 'total_count?': 'integer', data: [meeting] } },
    'meetings.get': { docs: `${ref}/meetings/get-meeting`, path: '/meetings/{meeting}', notFound: 'null',
      params: { meeting: { in: 'path', type: 'string', required: true, description: 'The meeting session\'s id.' } }, result: meeting },
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
