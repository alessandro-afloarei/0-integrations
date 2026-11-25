import { breakcold } from '../providers.js';
import type { Route } from '../testing.js';
import type { BreakcoldField, BreakcoldFieldOption, BreakcoldMeeting, BreakcoldNote, BreakcoldObject, BreakcoldRecord,
  BreakcoldSegment, BreakcoldView, BreakcoldWorkspace } from './breakcold.js';

const API = new URL(breakcold.baseUrl ?? '');

/**
 * A Breakcold organisation that reads `data` with any key. Lists answer in one page, filtered as Breakcold filters them:
 * records by workspace, object and archived state, notes by record, meetings by workspace (with a transcript), fields by
 * object, and segments by meeting. An id it does not hold answers 404.
 */
export function fakeBreakcold(data: { workspaces: readonly BreakcoldWorkspace[]; objects: readonly BreakcoldObject[];
  fields: readonly BreakcoldField[]; views: (objectTypeId: string) => readonly BreakcoldView[];
  options: (fieldId: string) => readonly BreakcoldFieldOption[]; records: readonly BreakcoldRecord[];
  notes: readonly BreakcoldNote[]; meetings: readonly BreakcoldMeeting[]; segments: readonly BreakcoldSegment[];
  /** Additional direct reads which must not enter ingestion lists. Listed data wins duplicate ids. */
  readable?: { notes?: readonly BreakcoldNote[]; meetings?: readonly BreakcoldMeeting[] } }): Route[] {
  const page = (items: readonly unknown[]) => Response.json({ data: items, pagination: { cursor: null, hasMore: false } });
  const found = (key: string, item: unknown) => (item === undefined
    ? Response.json({ error: { code: 'not_found', message: 'Not found', requestId: 'fake' } }, { status: 404 })
    : Response.json({ [key]: item }));
  /** A GET on `route` under the API (`{id}` is one path segment), answered from that id and the request's query. */
  const get = (route: string, respond: (id: string, query: URLSearchParams) => Response): Route => {
    const pattern = new RegExp(`^${API.pathname}${route.replace('{id}', '([^/]+)')}$`, 'u');
    return { method: 'GET', url: (url: URL) => url.origin === API.origin && pattern.test(url.pathname), respond: request => {
      const url = new URL(request.url);
      return respond(decodeURIComponent(pattern.exec(url.pathname)?.[1] ?? ''), url.searchParams);
    } };
  };
  return [
    get('/workspaces', () => page(data.workspaces)),
    get('/crm/objects', (_id, query) => Response.json({ objects: data.objects.filter(object =>
      object.workspaceId === query.get('workspaceId')) })),
    get('/crm/objects/{id}/fields', id => Response.json({ fields: data.fields.filter(field => field.objectTypeId === id) })),
    get('/crm/objects/{id}/views', id => Response.json({ views: data.views(id) })),
    get('/crm/fields/{id}/options', id => Response.json({ options: data.options(id) })),
    get('/records', (_id, query) => page(data.records.filter(record => record.workspaceId === query.get('workspaceId')
      && record.objectTypeSlug === query.get('objectTypeSlug') && String(record.isArchived) === query.get('archived')))),
    get('/records/{id}', id => found('record', data.records.find(record => record.id === id))),
    get('/records/{id}/notes', id => page(data.notes.filter(note => note.recordId === id))),
    get('/notes/{id}', id => found('note', data.notes.find(note => note.id === id)
      ?? data.readable?.notes?.find(note => note.id === id))),
    get('/meetings', (_id, query) => page(data.meetings.filter(meeting => meeting.workspaceId === query.get('workspaceId')
      && meeting.hasTranscript))),
    get('/meetings/{id}', id => found('meeting', data.meetings.find(meeting => meeting.id === id)
      ?? data.readable?.meetings?.find(meeting => meeting.id === id))),
    get('/meetings/{id}/transcript', id => page(data.segments.filter(segment => segment.meetingId === id))),
  ];
}
