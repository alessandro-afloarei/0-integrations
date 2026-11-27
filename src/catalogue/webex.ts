import { defineProvider } from '../catalogue.js';

/** Webex: OAuth 2, an integration made alone; Meetings needs a Webex Meetings account on Common Identity, and a create
 * or update emails the host and invitees unless sendEmail is false: https://developer.webex.com/meeting/docs/meetings
 * Link paging and a 429's Retry-After: https://developer.webex.com/docs/basics; the webhook checks X-Webex-Signature's
 * SHA-256 pair, not X-Spark-Signature: https://developer.webex.com/docs/receive-and-verify-webhooks */
const meeting = { id: 'string', 'meetingSeriesId?': 'string', title: 'string', meetingType: 'string', state: 'string',
  start: 'string', 'end?': 'string', webLink: 'string' } as const;
const meetingId = { meetingId: { in: 'path', type: 'string', required: true } } as const;
const fields = { agenda: { in: 'body', type: 'string' }, timezone: { in: 'body', type: 'string', description: 'An IANA time zone.' },
  recurrence: { in: 'body', type: 'string', description: 'An RFC 2445 rule, for a meeting series.' },
  sendEmail: { in: 'body', type: 'boolean', description: 'false sends no email to the host and invitees; true by default.' } } as const;
const when = { from: { in: 'query', type: 'string', description: 'ISO 8601, inclusive.' },
  to: { in: 'query', type: 'string', description: 'ISO 8601, exclusive.' } } as const;
const ref = 'https://developer.webex.com/meeting/docs/api/v1';

export const webex = defineProvider({
  id: 'webex', name: 'Webex', docs: 'https://developer.webex.com/docs/authentication',
  categories: ['meetings'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://webexapis.com/v1/authorize', tokenUrl: 'https://webexapis.com/v1/access_token',
    authorizeParams: { response_type: 'code' } }],
  scopes: { default: ['spark:people_read', 'meeting:schedules_read', 'meeting:schedules_write', 'meeting:recordings_read'] },
  http: { baseUrl: 'https://webexapis.com/v1', retry: {} },
  identify: { request: { path: '/people/me' }, id: 'id', name: ['displayName', 'emails.0'] },
  webhook: { kind: 'hmac', header: 'x-webex-signature', part: 'SHA-256' },
  paging: { link: { kind: 'linkHeader' } },
  operations: {
    'meetings.list': { docs: `${ref}/meetings/list-meetings`, path: '/meetings', paging: 'link', records: 'items',
      params: { meetingType: { in: 'query', type: 'string', enum: ['meetingSeries', 'scheduledMeeting', 'meeting'],
        description: 'meetingSeries by default; meeting lists ongoing and ended instances.' },
      state: { in: 'query', type: 'string', enum: ['active', 'scheduled', 'ready', 'lobby', 'inProgress', 'ended', 'missed', 'expired'] },
      meetingSeriesId: { in: 'query', type: 'string' }, ...when,
      max: { in: 'query', type: 'number', description: '10 by default, at most 100.' } },
      result: { items: [meeting] } },
    'meetings.get': { docs: `${ref}/meetings/get-a-meeting`, path: '/meetings/{meetingId}', notFound: 'null', params: meetingId,
      result: meeting },
    'recordings.list': { docs: `${ref}/recordings/list-recordings`, path: '/recordings', paging: 'link', records: 'items',
      params: { meetingId: { in: 'query', type: 'string' }, ...when,
        max: { in: 'query', type: 'number', description: 'From 1 to 100.' } },
      result: { items: [{ id: 'string', meetingId: 'string', topic: 'string', createTime: 'string', timeRecorded: 'string',
        playbackUrl: 'string', durationSeconds: 'number', status: 'string' }] } },
    'meetings.create': { docs: `${ref}/meetings/create-a-meeting`, method: 'POST', path: '/meetings', kind: 'write',
      params: { title: { in: 'body', type: 'string', required: true },
        start: { in: 'body', type: 'string', required: true, description: 'ISO 8601; 10 minutes to 23 hours 59 before end.' },
        end: { in: 'body', type: 'string', required: true, description: 'ISO 8601.' }, ...fields,
        invitees: { in: 'body', type: [{ email: 'string', 'displayName?': 'string', 'coHost?': 'boolean' }], description: 'At most 1000.' } },
      result: meeting },
    'meetings.update': { docs: `${ref}/meetings/update-a-meeting`, method: 'PUT', path: '/meetings/{meetingId}', kind: 'write',
      params: { ...meetingId, title: { in: 'body', type: 'string' }, start: { in: 'body', type: 'string', description: 'ISO 8601.' },
        end: { in: 'body', type: 'string', description: 'ISO 8601.' }, ...fields },
      result: meeting },
  },
});
