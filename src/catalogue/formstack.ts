import { defineProvider } from '../catalogue.js';

/** Formstack API V2025: a Personal Access Token as Bearer; no endpoint names the user, so identify is a credential
 * check on the forms list. A daily limit per token, by plan, answers 429 until midnight: no retry
 * (https://developers.formstack.com/reference/api-overview). Each list answers one page: its records may be null. */
const form = { id: 'integer', 'name?': 'string', 'url?': 'string', 'folder?': 'integer', 'submissionsCount?': 'integer',
  'created?': 'string', 'updated?': 'string' } as const;
const submission = { id: 'integer', 'formId?': 'integer', 'timestamp?': 'string', 'data?': 'unknown' } as const;
const page = { 'pageNumber?': 'integer', 'pageSize?': 'integer', 'totalElements?': 'integer', 'totalPages?': 'integer' } as const;
const formId = { formId: { in: 'path', type: 'integer', required: true } } as const;
const pageNumber = { in: 'query', type: 'integer', description: 'The page to return, from 1.' } as const;
const password = { in: 'header', type: 'string',
  description: 'Required when the form has encryption enabled and data is asked for: the password that decrypts it.' } as const;
const reference = 'https://developers.formstack.com/reference';

export const formstack = defineProvider({
  id: 'formstack', name: 'Formstack', docs: `${reference}/authentication`,
  categories: ['marketing'],
  fields: [{ name: 'accessToken', title: 'Personal access token', secret: true,
    help: 'A Formstack Personal Access Token (it starts with fs_pat_). It is tied to your user and follows your Formstack permissions; its daily limit depends on your plan.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://www.formstack.com/api/v2025' },
  identify: { request: { path: '/forms' } },
  operations: {
    'forms.list': { docs: `${reference}/getformslist-1`, path: '/forms',
      params: { pageNumber, pageSize: { in: 'query', type: 'integer', description: '50 by default, from 10 to 500.' },
        folder: { in: 'query', type: 'integer', description: 'Only the forms of this folder.' } },
      result: { 'page?': page, 'forms?': [form] } },
    'forms.get': { docs: `${reference}/getformdetails-1`, path: '/forms/{formId}', notFound: 'null', params: formId, result: form },
    'submissions.list': { docs: `${reference}/getformsubmissionslist-1`, path: '/forms/{formId}/submissions',
      params: { ...formId, pageNumber, pageSize: { in: 'query', type: 'integer', description: '25 by default, at most 100.' },
        data: { in: 'query', type: 'string', description: 'true includes each submission\'s field data.' },
        'x-fs-encryption-password': password },
      result: { 'page?': page, 'submissions?': [submission] } },
    'submissions.get': { docs: `${reference}/getsubmissiondetails-1`, path: '/submissions/{submissionId}', notFound: 'null',
      params: { submissionId: { in: 'path', type: 'integer', required: true }, 'x-fs-encryption-password': { ...password,
        description: 'Required when the form has encryption enabled: the password that decrypts the submission.' } },
      result: submission },
  },
});
