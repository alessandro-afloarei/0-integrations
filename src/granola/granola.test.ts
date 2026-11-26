import { expect, test } from 'vitest';
import { fakeFetch, sequence } from '../testing.js';
import { fakeGranola } from './fake.js';
import { granolaClient, type GranolaNote } from './granola.js';

const owner = { name: 'Ana Reis', email: 'ana@lumen.test' };
const line = (text: string) => ({ speaker: { source: 'microphone', attribution: 'me' as const }, text,
  start_time: '2026-10-30T10:01:00Z', end_time: '2026-10-30T10:02:00Z' });
const note: GranolaNote = { id: 'not_1', title: 'Lumen intro', owner, created_at: '2026-10-30T10:30:00Z',
  updated_at: '2026-10-30T10:35:00Z', deleted_at: null, web_url: 'https://notes.granola.ai/d/not_1',
  calendar_event: { calendar_event_id: 'evt_1', scheduled_start_time: '2026-10-30T10:00:00Z', scheduled_end_time: '2026-10-30T10:30:00Z' },
  attendees: [{ name: 'Ana Reis', email: 'ana@lumen.test' }], transcript: [line('Hello')] };
const summary = ({ id, title, created_at, updated_at, deleted_at }: GranolaNote) =>
  ({ id, title, owner, created_at, updated_at, deleted_at });
const NOTES = 'https://public-api.granola.ai/v1/notes';
const client = (fake: { fetch: typeof fetch }, apiKey = 'grn_k') => granolaClient({ apiKey, fetch: fake.fetch, minIntervalMs: 0 });

test('round-trips through its fake', async () => {
  const fake = fakeFetch(fakeGranola({ notes: key => (key === 'grn_k' ? [note] : null) }));
  expect(await client(fake).notes({ createdAfter: '2026-10-01T00:00:00Z' }))
    .toEqual({ items: [summary(note)], skipped: [], cursor: null });
  expect(await client(fake).notes({ updatedAfter: '2026-10-31T00:00:00Z' })).toMatchObject({ items: [] });
  expect(await client(fake).note('not_1')).toEqual({ note, transcriptCut: false });
  await expect(client(fake).note('not_gone')).rejects.toMatchObject({ code: 'not_found' });
  await expect(client(fake, 'grn_other').notes({})).rejects.toMatchObject({ code: 'rejected' });
});

test("sends Granola's query and the key", async () => {
  const fake = fakeFetch(fakeGranola({ notes: () => [note] }));
  await client(fake).notes({ createdAfter: '2026-10-01T00:00:00Z', cursor: 'c2' });
  await client(fake).notes({ updatedAfter: '2026-10-02T00:00:00Z' });
  await client(fake).note('not_1');
  expect(fake.calls.map(call => call.url)).toEqual([
    `${NOTES}?page_size=30&created_after=2026-10-01T00%3A00%3A00Z&cursor=c2`,
    `${NOTES}?page_size=30&updated_after=2026-10-02T00%3A00%3A00Z`,
    `${NOTES}/not_1?include=transcript`,
  ]);
  expect(fake.calls[0]?.headers.authorization).toBe('Bearer grn_k');
});

test("drops a note's summary and private notes, which never reach an app's store", async () => {
  const fake = fakeFetch([{ url: `${NOTES}/not_1`, respond: () => Response.json({ ...note, object: 'note', folder_membership: [],
    summary_text: 'S', summary_markdown: '## S', private_notes_text: 'P', private_notes_markdown: 'P',
    calendar_event: { ...note.calendar_event, event_title: 'Lumen intro', organiser: 'ana@lumen.test' } }) }]);
  expect(await client(fake).note('not_1')).toEqual({ note, transcriptCut: false });
});

test('reads a transcript too large to inline page by page, and a missing one as empty', async () => {
  const fake = fakeFetch([{ url: /\/v1\/notes\/not_1/u, respond: sequence(
    () => Response.json({ message: 'too large' }, { status: 413 }),
    () => Response.json({ ...note, transcript: null }),
    () => Response.json({ transcript: [line('One')], hasMore: true, cursor: 't2' }),
    () => Response.json({ transcript: [line('Two')], hasMore: false, cursor: null }),
  ) }]);
  expect(await client(fake).note('not_1')).toEqual({ note: { ...note, transcript: [line('One'), line('Two')] }, transcriptCut: false });
  expect(fake.calls.map(call => call.url.replace(`${NOTES}/not_1`, ''))).toEqual(['?include=transcript', '',
    '/transcript?page_size=100', '/transcript?page_size=100&cursor=t2']);
  const empty = fakeFetch([{ url: `${NOTES}/not_1`, respond: () => Response.json({ ...note, transcript: null }) }]);
  expect(await client(empty).note('not_1')).toEqual({ note: { ...note, transcript: [] }, transcriptCut: false });
});

test('reports the entries it could not read, by id', async () => {
  const fake = fakeFetch([{ url: NOTES, respond: () => Response.json({ notes: [summary(note), { id: 'not_bad', title: 'x' }, 'junk'],
    hasMore: false, cursor: null }) }]);
  expect(await client(fake).notes({})).toEqual({ items: [summary(note)], skipped: ['not_bad', null], cursor: null });
});

test('a page claiming more with no cursor is cursor_missing', async () => {
  const fake = fakeFetch([{ url: NOTES, respond: () => Response.json({ notes: [], hasMore: true, cursor: null }) }]);
  await expect(client(fake).notes({})).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_missing' });
  const blank = fakeFetch([{ url: NOTES, respond: () => Response.json({ notes: [], hasMore: true, cursor: '' }) }]);
  await expect(client(blank).notes({})).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_missing' });
  const more = fakeFetch([{ url: NOTES, respond: () => Response.json({ notes: [], hasMore: true, cursor: 'c2' }) }]);
  expect(await client(more).notes({})).toMatchObject({ cursor: 'c2' });
});

test.each([null, ''])('a transcript page claiming more with cursor %j is cursor_missing', async cursor => {
  const fake = fakeFetch([{ url: /\/v1\/notes\/not_1/u, respond: sequence(
    () => Response.json({ message: 'too large' }, { status: 413 }),
    () => Response.json({ ...note, transcript: null }),
    () => Response.json({ transcript: [line('One')], hasMore: true, cursor }),
  ) }]);
  await expect(client(fake).note('not_1')).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_missing' });
  expect(fake.calls).toHaveLength(3);
});

test('refuses a list or a note in the wrong shape', async () => {
  const fake = fakeFetch([{ url: /\/v1\/notes/u, respond: () => Response.json({ notes: 'x' }) }]);
  await expect(client(fake).notes({})).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(client(fake).note('not_1')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('says when it stopped a transcript at its 50-page cap, whatever the pages held', async () => {
  const pages = (more: (page: number) => boolean) => fakeFetch([{ url: /\/v1\/notes\/not_1/u, respond: request => {
    const url = new URL(request.url);
    if (url.searchParams.get('include') === 'transcript') return Response.json({ message: 'too large' }, { status: 413 });
    if (!url.pathname.endsWith('/transcript')) return Response.json({ ...note, transcript: null });
    const page = Number(url.searchParams.get('cursor') ?? '0');
    return Response.json({ transcript: [line(`line ${String(page)}`)], hasMore: more(page), cursor: more(page) ? String(page + 1) : null });
  } }]);
  const cut = await client(pages(() => true)).note('not_1');
  expect(cut.transcriptCut).toBe(true);
  expect(cut.note.transcript).toHaveLength(50);
  const whole = await client(pages(page => page < 49)).note('not_1');
  expect(whole.transcriptCut).toBe(false);
  expect(whole.note.transcript).toHaveLength(50);
});
