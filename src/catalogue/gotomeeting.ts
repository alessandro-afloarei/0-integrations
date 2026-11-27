import { defineProvider } from '../catalogue.js';

/** GoTo Meeting: OAuth 2 (Basic), a client made alone with the scopes it asks for set on it:
 * https://developer.goto.com/guides/Get%20Started/02_HOW_createClient/; PKCE S256 is listed (issuer identity.goto.com):
 * https://authentication.logmeininc.com/.well-known/oauth-authorization-server. A 429 waits a second (10 a second):
 * https://developer.goto.com/guides/References/Ref-Rate-Limits/; no recording is read, past sessions are not listed. */
const written = { subject: { in: 'body', type: 'string', required: true, description: '100 characters at most.' },
  starttime: { in: 'body', type: 'string', required: true, description: 'A future ISO 8601 UTC time.' },
  endtime: { in: 'body', type: 'string', required: true, description: 'A future ISO 8601 UTC time.' },
  passwordrequired: { in: 'body', type: 'boolean', required: true },
  conferencecallinfo: { in: 'body', type: 'string', required: true, description: 'PSTN, Free, Hybrid, Private or VoIP.' },
  meetingtype: { in: 'body', type: 'string', required: true, enum: ['immediate', 'recurring', 'scheduled'] },
  timezonekey: { in: 'body', type: 'string', required: true, description: 'Deprecated: send an empty string.' },
  coorganizerKeys: { in: 'body', type: ['string'] } } as const;
const meetingId = { meetingId: { in: 'path', type: 'integer', required: true } } as const;
const ref = 'https://developer.goto.com/GoToMeetingV1#operation';

export const gotomeeting = defineProvider({
  id: 'gotomeeting', name: 'GoTo Meeting', docs: 'https://developer.goto.com/guides/Authentication/03_HOW_accessToken/',
  categories: ['meetings'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://authentication.logmeininc.com/oauth/authorize',
    tokenUrl: 'https://authentication.logmeininc.com/oauth/token', clientAuth: 'basic', authorizeParams: { response_type: 'code' } }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.getgo.com', retry: { defaultWaitMs: 1_000 } },
  identify: { request: { path: '/identity/v1/Users/me' }, id: 'id', name: ['displayName', 'userName'] },
  operations: {
    'meetings.list': { docs: `${ref}/getUpcomingMeetings`, path: '/G2M/rest/upcomingMeetings',
      result: [{ meetingId: 'string', subject: 'string', status: 'string', 'meetingType?': 'string', startTime: 'string',
        endTime: 'string', joinURL: 'string', organizerKey: 'string' }] },
    'meetings.get': { docs: `${ref}/getMeeting`, path: '/G2M/rest/meetings/{meetingId}', notFound: 'null', params: meetingId,
      result: [{ meetingId: 'integer', subject: 'string', status: 'string', meetingType: 'string', startTime: 'string',
        endTime: 'string', joinURL: 'string' }] },
    'meetings.create': { docs: `${ref}/createMeeting`, method: 'POST', path: '/G2M/rest/meetings', params: written,
      result: [{ meetingid: 'integer', joinURL: 'string', maxParticipants: 'integer', conferenceCallInfo: 'string' }] },
    'meetings.update': { docs: `${ref}/updateMeeting`, method: 'PUT', path: '/G2M/rest/meetings/{meetingId}',
      params: { ...meetingId, ...written } },
  },
});
