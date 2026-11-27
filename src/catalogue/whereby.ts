import { defineProvider } from '../catalogue.js';

/** Whereby Embedded: an API key; its sign-in checks the key on a one-meeting list, naming no account. A meeting is a
 * transient room with an end date, and no API call updates it. A 429 waits Retry-After or the body's data.msLeft:
 * https://docs.whereby.com/reference/whereby-rest-api-reference; webhooks, set up in the dashboard, sign `t.body`:
 * https://docs.whereby.com/whereby-product-features/insights-suite-and-api/webhooks */
const meeting = { meetingId: 'string', 'roomName?': 'string', roomUrl: 'string', 'startDate?': 'string', endDate: 'string',
  'hostRoomUrl?': 'string', 'viewerRoomUrl?': 'string' } as const;
const limit = { limit: { in: 'query', type: 'integer', description: '50 by default, 1 to 100.' } } as const;
const ref = 'https://docs.whereby.com/reference/whereby-rest-api-reference';

export const whereby = defineProvider({
  id: 'whereby', name: 'Whereby', docs: 'https://docs.whereby.com/getting-started/overview-of-whereby-embedded/initial-setup',
  categories: ['meetings'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'A Whereby Embedded key (Configure, API, Generate key; it may expire after 7, 30 or 90 days): Whereby Meetings has no API.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.whereby.dev/v1', retry: { wait: { path: 'data.msLeft', unit: 'ms' } } },
  identify: { request: { path: '/meetings', query: { limit: '1' } } },
  webhook: { kind: 'hmac', header: 'whereby-signature', signed: '{timestamp}.{body}', part: 'v1', timestamp: { part: 't' },
    deliveryId: { body: ['id'] } },
  paging: { cursor: { kind: 'cursor', next: 'cursor', send: { query: 'cursor' } } },
  operations: {
    'meetings.list': { docs: `${ref}/meetings`, path: '/meetings', paging: 'cursor', records: 'results', params: limit,
      result: { results: [meeting] } },
    'meetings.get': { docs: `${ref}/meetings`, path: '/meetings/{meetingId}', notFound: 'null',
      params: { meetingId: { in: 'path', type: 'string', required: true } }, result: meeting },
    'recordings.list': { docs: `${ref}/recordings`, path: '/recordings', paging: 'cursor', records: 'results',
      params: { roomName: { in: 'query', type: 'string' }, ...limit },
      result: { results: [{ recordingId: 'string', roomSessionId: 'string', filename: 'string', startDate: 'string',
        endDate: 'string', sizeInMegaBytes: 'number' }] } },
    'meetings.create': { docs: `${ref}/meetings`, method: 'POST', path: '/meetings',
      params: { endDate: { in: 'body', type: 'string', required: true, description: 'ISO 8601, UTC unless an offset is given.' },
        roomMode: { in: 'body', type: 'string', enum: ['group', 'normal'], description: 'normal (the default) for up to 4 people.' },
        roomNamePrefix: { in: 'body', type: 'string' }, roomNamePattern: { in: 'body', type: 'string', enum: ['uuid', 'human-short'] },
        isLocked: { in: 'body', type: 'boolean' },
        fields: { in: 'body', type: ['string'], description: 'hostRoomUrl, viewerRoomUrl: links to include in the answer.' } },
      result: meeting },
  },
});
