import { fathom } from '../catalogue/fathom.js';
import type { Route } from '../testing.js';
import type { FathomMeeting, FathomTranscriptItem } from './fathom.js';

export type FakeFathomMeeting = FathomMeeting & { transcript: FathomTranscriptItem[] };

const BASE = fathom.http.baseUrl;
const PAGE = 10;

/**
 * Fathom for one key at a time: `meetings(key)` is what the key reads, null a key Fathom refuses. The list answers ten
 * meetings a page, newest first, filtered by `created_after` and `recorded_by[]`; a recording answers its transcript.
 */
export function fakeFathom(data: { meetings: (apiKey: string) => readonly FakeFathomMeeting[] | null }): Route[] {
  const read = (request: Request) => data.meetings(request.headers.get('x-api-key') ?? '');
  const refused = () => Response.json({ message: 'Unauthorized' }, { status: 401 });
  return [
    { method: 'GET', url: `${BASE}/meetings`, respond(request) {
      const meetings = read(request);
      if (meetings === null) return refused();
      const query = new URL(request.url).searchParams;
      const after = query.get('created_after');
      const recorder = query.get('recorded_by[]')?.toLowerCase();
      const listed = meetings
        .filter(meeting => (after === null || Date.parse(meeting.created_at) > Date.parse(after))
          && (recorder === undefined || meeting.recorded_by.email.toLowerCase() === recorder))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const offset = Number(query.get('cursor') ?? '0');
      const next = offset + PAGE < listed.length ? String(offset + PAGE) : null;
      return Response.json({ limit: PAGE, next_cursor: next,
        items: listed.slice(offset, offset + PAGE).map(meeting => ({ ...meeting, transcript: undefined })) });
    } },
    { method: 'GET', url: /\/recordings\/\d+\/transcript$/u, respond(request) {
      const meetings = read(request);
      if (meetings === null) return refused();
      const id = Number(new URL(request.url).pathname.split('/').at(-2));
      const meeting = meetings.find(item => item.recording_id === id);
      return meeting ? Response.json({ transcript: meeting.transcript }) : Response.json({ message: 'Not found' }, { status: 404 });
    } },
  ];
}
