import { expect, test } from 'vitest';
import { fakeFetch } from '../testing.js';
import { breakcoldClient, type BreakcoldMeeting, type BreakcoldNote, type BreakcoldRecord, type BreakcoldSegment } from './breakcold.js';
import { fakeBreakcold } from './fake.js';

const API = 'https://rest.breakcold.com/api/v1';
const at = 1_761_900_000_000;
const deal: BreakcoldRecord = { id: 'rec_deal1', workspaceId: 'ws_1', objectTypeId: 'obj_deal', objectTypeSlug: 'deal',
  displayName: 'Lumen pilot', fields: { amount: 12000 }, isArchived: false, createdAt: at, updatedAt: at };
const old: BreakcoldRecord = { ...deal, id: 'rec_deal0', isArchived: true };
const note: BreakcoldNote = { id: 'note_1', workspaceId: 'ws_1', recordId: 'rec_deal1', title: 'Call', content: '<p>Hi</p>',
  createdAt: at, updatedAt: at };
const meeting: BreakcoldMeeting = { id: 'mtg_1', workspaceId: 'ws_1', startTimeMs: at, hasTranscript: true, createdAt: at, updatedAt: at };
const segment: BreakcoldSegment = { id: 'seg_1', meetingId: 'mtg_1', segmentIndex: 0, text: 'Hello', startSec: 0, endSec: 2 };
const data = {
  workspaces: [{ id: 'ws_1', name: 'Lumen' }],
  objects: [{ id: 'obj_deal', workspaceId: 'ws_1', slug: 'deal', isSystem: true }],
  fields: [{ id: 'fld_stage', objectTypeId: 'obj_deal', slug: 'stage', name: 'Stage', fieldType: 'select' }],
  views: (objectTypeId: string) => (objectTypeId === 'obj_deal' ? [{ id: 'view_1', type: 'kanban' as const, kanbanFieldDefinitionId: 'fld_stage' }] : []),
  options: (fieldId: string) => (fieldId === 'fld_stage' ? [{ id: 'opt_won', label: 'Won' }] : []),
  records: [deal, old], notes: [note], meetings: [meeting], segments: [segment],
};
const client = (fake: { fetch: typeof fetch }, options: { beforeRequest?: (url: URL) => void | Promise<void> } = {}) =>
  breakcoldClient({ apiKey: 'bc_k', fetch: fake.fetch, userAgent: 'integrations-test', ...options });
const answering = (body: unknown, status = 200) => fakeFetch([{ url: /rest\.breakcold\.com/u, respond: () => Response.json(body, { status }) }]);
const page = <T>(items: T[]) => ({ items, skipped: [], cursor: null });

test('round-trips every call through its fake', async () => {
  const breakcold = client(fakeFetch(fakeBreakcold(data)));
  expect(await breakcold.workspaces()).toEqual(page(data.workspaces));
  expect(await breakcold.objects('ws_1')).toEqual(data.objects);
  expect(await breakcold.fields('obj_deal')).toEqual(data.fields);
  expect(await breakcold.views('obj_deal')).toEqual(data.views('obj_deal'));
  expect(await breakcold.fieldOptions('fld_stage')).toEqual(data.options('fld_stage'));
  expect(await breakcold.records({ workspaceId: 'ws_1', objectTypeSlug: 'deal', archived: false })).toEqual(page([deal]));
  expect(await breakcold.records({ workspaceId: 'ws_1', objectTypeSlug: 'deal', archived: true })).toEqual(page([old]));
  expect(await breakcold.records({ workspaceId: 'ws_1', objectTypeSlug: 'person', archived: false })).toEqual(page([]));
  expect(await breakcold.record('rec_deal1')).toEqual(deal);
  expect(await breakcold.notes('rec_deal1')).toEqual(page([note]));
  expect(await breakcold.notes('rec_deal0')).toEqual(page([]));
  expect(await breakcold.note('note_1')).toEqual(note);
  expect(await breakcold.meetings({ workspaceId: 'ws_1' })).toEqual(page([meeting]));
  expect(await breakcold.meeting('mtg_1')).toEqual(meeting);
  expect(await breakcold.segments('mtg_1')).toEqual(page([segment]));
  for (const missing of [breakcold.record('rec_gone'), breakcold.note('note_gone'), breakcold.meeting('mtg_gone')]) {
    await expect(missing).rejects.toMatchObject({ code: 'not_found' });
  }
});

test.each([false, true])('direct-only notes do not change an ingestion list (existing notes: %j)', async listed => {
  const directNote = { ...note, id: 'note_live', title: 'Live read only' };
  const notes = listed ? [note] : [];
  const breakcold = client(fakeFetch(fakeBreakcold({ ...data, notes, readable: { notes: [directNote] } })));
  expect(await breakcold.notes('rec_deal1')).toEqual(page(notes));
  await expect(breakcold.note('note_live')).resolves.toEqual(directNote);
  await expect(breakcold.note('note_missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  expect(await breakcold.meeting('mtg_1')).toEqual(meeting);
});

test.each([false, true])('direct-only meetings stay readable without entering ingestion (existing meetings: %j)', async listed => {
  const directMeeting = { ...meeting, id: 'mtg_live' };
  const directSegment = { ...segment, id: 'seg_live', meetingId: 'mtg_live' };
  const meetings = listed ? [meeting] : [];
  const breakcold = client(fakeFetch(fakeBreakcold({ ...data, meetings, segments: [segment, directSegment],
    readable: { meetings: [directMeeting] } })));
  expect(await breakcold.meetings({ workspaceId: 'ws_1' })).toEqual(page(meetings));
  await expect(breakcold.meeting('mtg_live')).resolves.toEqual(directMeeting);
  expect(await breakcold.segments('mtg_live')).toEqual(page([directSegment]));
  await expect(breakcold.meeting('mtg_missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  expect(await breakcold.note('note_1')).toEqual(note);
});

test('a direct-only duplicate cannot replace the listed note or meeting', async () => {
  const breakcold = client(fakeFetch(fakeBreakcold({ ...data,
    readable: { notes: [{ ...note, title: 'Different' }], meetings: [{ ...meeting, startTimeMs: at + 1 }] } })));
  expect(await breakcold.note('note_1')).toEqual(note);
  expect(await breakcold.meeting('mtg_1')).toEqual(meeting);
});

test("sends Breakcold's query, the key and the app's user agent", async () => {
  const fake = fakeFetch(fakeBreakcold(data));
  await client(fake).records({ workspaceId: 'ws_1', objectTypeSlug: 'deal', archived: false, cursor: 'c2' });
  await client(fake).meetings({ workspaceId: 'ws_1' });
  await client(fake).segments('mtg_1', 'c3');
  expect(fake.calls.map(call => call.url)).toEqual([
    `${API}/records?limit=100&workspaceId=ws_1&objectTypeSlug=deal&archived=false&cursor=c2`,
    `${API}/meetings?limit=100&workspaceId=ws_1&eventState=active&hasTranscript=true`,
    `${API}/meetings/mtg_1/transcript?limit=100&cursor=c3`,
  ]);
  expect(fake.calls[0]?.headers).toMatchObject({ authorization: 'Bearer bc_k', 'user-agent': 'integrations-test' });
});

test("meters through the app's beforeRequest, once per call", async () => {
  const fake = fakeFetch(fakeBreakcold(data));
  const metered: string[] = [];
  const breakcold = client(fake, { beforeRequest: url => { metered.push(url.pathname); } });
  await breakcold.workspaces();
  await breakcold.record('rec_deal1');
  expect(metered).toEqual(['/api/v1/workspaces', '/api/v1/records/rec_deal1']);
});

test('reports the entries it could not read, by id, and drops unreadable metadata', async () => {
  const listing = answering({ data: [deal, { id: 'rec_bad', fields: {} }, 7], pagination: { cursor: null, hasMore: false } });
  expect(await client(listing).records({ workspaceId: 'ws_1', objectTypeSlug: 'deal', archived: false }))
    .toEqual({ items: [deal], skipped: ['rec_bad', null], cursor: null });
  const objects = answering({ objects: [...data.objects, { id: 'obj_bad' }] });
  expect(await client(objects).objects('ws_1')).toEqual(data.objects);
  await expect(client(answering({ fields: 'x' })).fields('obj_deal')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('reads a note or a meeting wrapped in its key or bare, and refuses any other shape', async () => {
  for (const body of [{ note }, note]) expect(await client(answering(body)).note('note_1')).toEqual(note);
  for (const body of [{ meeting }, meeting]) expect(await client(answering(body)).meeting('mtg_1')).toEqual(meeting);
  await expect(client(answering({ note: { id: 'note_1' } })).note('note_1')).rejects.toMatchObject({ code: 'invalid_response' });
  await expect(client(answering({ record: { id: 'rec_bad' } })).record('rec_bad')).rejects.toMatchObject({ code: 'invalid_response' });
});

test('a page claiming more with no cursor is refused, never read as the last', async () => {
  for (const cursor of [null, '']) {
    await expect(client(answering({ data: [], pagination: { cursor, hasMore: true } })).workspaces())
      .rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_missing' });
  }
  expect(await client(answering({ data: [], pagination: { cursor: 'c2', hasMore: true } })).workspaces()).toMatchObject({ cursor: 'c2' });
});

test('reads Breakcold delivery id without changing its bytes', async () => {
  const { parseWebhook } = await import('./breakcold.js');
  expect(parseWebhook(new Headers({ 'x-webhook-delivery-id': 'delivery:1', 'x-webhook-event': 'record.updated' })))
    .toEqual({ deliveryId: 'delivery:1' });
  expect(parseWebhook(new Headers())).toBeNull();
  expect(parseWebhook(new Headers({ 'x-webhook-delivery-id': '' }))).toBeNull();
});
