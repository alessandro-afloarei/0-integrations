import { defineProvider } from '../catalogue.js';

/** SurveyMonkey: OAuth 2 for an app reaching many accounts. A new app is a draft no other account can authenticate (90
 * days); a Private app (one team, paid plans) needs no review; a Public app is reviewed and approved by SurveyMonkey.
 * Scopes are set on the app (View Users, View Surveys, View Responses); tokens do not expire; the token answer's
 * `access_url` names the account's data center. A 429 resets by the minute or by the day: no retry. */
const survey = { id: 'string', 'title?': 'string', 'nickname?': 'string', 'href?': 'string' } as const;
const surveyId = { in: 'path', type: 'string', required: true } as const;
const perPage = { in: 'query', type: 'integer', description: 'Resources a page, at most 1000 unless otherwise specified.' } as const;
const hosts = ['api.surveymonkey.com', 'api.eu.surveymonkey.com', 'api.surveymonkey.ca'] as const;
const reference = 'https://api.surveymonkey.com/v3/docs';

export const surveymonkey = defineProvider({
  id: 'surveymonkey', name: 'SurveyMonkey', docs: reference,
  categories: ['marketing'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://api.surveymonkey.com/oauth/authorize', tokenUrl: 'https://api.surveymonkey.com/oauth/token',
    authorizeParams: { response_type: 'code' } }],
  scopes: { default: [] },
  save: { accessUrl: 'tokenAnswer.access_url' },
  http: { baseUrl: 'https://{accessUrl}/v3', host: hosts },
  errors: { detail: 'error.id', revoked: ['1013'] },
  identify: { request: { path: '/users/me' }, id: 'id', name: ['username', 'email'] },
  // Keyed with `<client id>&<API secret>`, as the page's example names them: the app's own, never a connection's.
  webhook: { kind: 'hmac', header: 'sm-signature', hash: 'sha1', encoding: 'base64', deliveryId: { body: ['event_id'] } },
  paging: { next: { kind: 'nextUrl', next: 'links.next' } },
  operations: {
    'surveys.list': { docs: `${reference}#api-endpoints-get-surveys`, path: '/surveys', paging: 'next', records: 'data',
      params: { per_page: perPage }, result: { data: [survey] } },
    'surveys.get': { docs: `${reference}#api-endpoints-get-surveys-id-`, path: '/surveys/{id}', notFound: 'null',
      params: { id: surveyId }, result: { ...survey, 'date_created?': 'string', 'date_modified?': 'string', 'response_count?': 'integer' } },
    'responses.list': { docs: `${reference}#api-endpoints-get-surveys-survey_id-responses`, path: '/surveys/{survey_id}/responses',
      paging: 'next', records: 'data', params: { survey_id: surveyId, per_page: perPage },
      result: { data: [{ id: 'string', 'href?': 'string' }] } },
    'responses.get': { docs: `${reference}#api-endpoints-get-surveys-survey_id-responses-response_id-`,
      path: '/surveys/{survey_id}/responses/{response_id}', notFound: 'null',
      params: { survey_id: surveyId, response_id: { in: 'path', type: 'string', required: true } },
      result: { id: 'string', 'survey_id?': 'string', 'collector_id?': 'string', 'date_created?': 'string', 'href?': 'string',
        'pages?': 'unknown' } },
  },
});
