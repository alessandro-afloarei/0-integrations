import { defineProvider } from '../catalogue.js';

/** Avoma: an organization's API key, made by an admin, as Bearer; no endpoint names the account. 60 requests a minute;
 * a request times out after 60 seconds (narrow the dates). Webhooks: `X-Avoma-Signature`, the hex HMAC-SHA256 of the
 * body keyed with the organization's signing secret, no timestamp. */
const meeting = { uuid: 'string', subject: 'string', state: 'string', 'start_at?': 'string', 'end_at?': 'string', created: 'string',
  modified: 'string', 'transcription_uuid?': 'string' } as const;
const ref = 'https://dev.avoma.com/#tag';

export const avoma = defineProvider({
  id: 'avoma', name: 'Avoma', docs: 'https://help.avoma.com/api-integration-for-avoma',
  categories: ['meetings'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'From Settings, Organization, Developer (admins only): the whole key string, CLIENT_KEY:CLIENT_SECRET. A User key reads its user\'s meetings (with full access, everything that user can see, private ones included), an Organization key the organization\'s non-private ones.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.avoma.com', retry: { defaultWaitMs: 60_000 } },
  errors: { detail: 'code' },
  identify: { request: { path: '/v1/users/' } },
  webhook: { kind: 'hmac', header: 'x-avoma-signature' },
  paging: { next: { kind: 'nextUrl', next: 'next' } },
  operations: {
    'meetings.list': { docs: `${ref}/Meetings/paths/~1v1~1meetings~1/get`, path: '/v1/meetings/', paging: 'next', records: 'results',
      params: { from_date: { in: 'query', type: 'string',
        description: 'Meetings started at or after this date-time (UTC, RFC 3339). The schema marks it required; the operation says a call with no filter answers all meetings.' },
        to_date: { in: 'query', type: 'string',
        description: 'Meetings started at or before this date-time (UTC, RFC 3339). The schema marks it required; the operation says a call with no filter answers all meetings.' },
        page_size: { in: 'query', type: 'integer', description: '10 by default, at most 100.' } },
      result: { results: [meeting] } },
    'meetings.get': { docs: `${ref}/Meetings/paths/~1v1~1meetings~1{uuid}~1/get`, path: '/v1/meetings/{uuid}/', notFound: 'null',
      params: { uuid: { in: 'path', type: 'string', required: true } }, result: meeting },
    'transcriptions.get': { docs: `${ref}/Transcriptions/paths/~1v1~1transcriptions~1{uuid}~1/get`, path: '/v1/transcriptions/{uuid}/',
      notFound: 'null', params: { uuid: { in: 'path', type: 'string', required: true } },
      result: { uuid: 'string', meeting_uuid: 'string', transcription_vtt_url: 'string', speakers: 'unknown', transcript: 'unknown' } },
  },
});
