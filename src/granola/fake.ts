import { granola } from '../providers.js';
import type { Route } from '../testing.js';
import type { GranolaNote } from './granola.js';

const NOTES = `${granola.baseUrl ?? ''}/notes`;

/**
 * Granola for one key at a time: `notes(key)` is what the key reads, null a key Granola refuses. The list is one page of
 * summaries, filtered by `created_after` and `updated_after`; a note answers with its transcript inline.
 */
export function fakeGranola(data: { notes: (apiKey: string) => readonly GranolaNote[] | null }): Route[] {
  const read = (request: Request) => data.notes((request.headers.get('authorization') ?? '').replace(/^Bearer /u, ''));
  const refused = () => Response.json({ message: 'Unauthorized' }, { status: 401 });
  return [
    { method: 'GET', url: NOTES, respond(request) {
      const notes = read(request);
      if (notes === null) return refused();
      const query = new URL(request.url).searchParams;
      const after = (value: string, field: string) => {
        const bound = query.get(field);
        return bound === null || Date.parse(value) > Date.parse(bound);
      };
      return Response.json({ hasMore: false, cursor: null, notes: notes
        .filter(note => after(note.created_at, 'created_after') && after(note.updated_at, 'updated_after'))
        .map(({ id, title, owner, created_at, updated_at, deleted_at }) =>
          ({ id, object: 'note', title, owner, created_at, updated_at, deleted_at })) });
    } },
    { method: 'GET', url: (url: URL) => url.origin + url.pathname.replace(/\/[^/]+$/u, '') === NOTES, respond(request) {
      const notes = read(request);
      if (notes === null) return refused();
      const id = decodeURIComponent(new URL(request.url).pathname.split('/').at(-1) ?? '');
      const note = notes.find(item => item.id === id);
      return note ? Response.json({ object: 'note', ...note }) : Response.json({ message: 'Not found' }, { status: 404 });
    } },
  ];
}
