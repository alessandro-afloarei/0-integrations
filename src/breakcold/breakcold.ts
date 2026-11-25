import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import type { Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { breakcold } from '../catalogue/breakcold.js';

// Breakcold's own field names: an app stores records, notes, meetings and segments and reads them back with its own schema.
export type BreakcoldWorkspace = { id: string; name: string };
export type BreakcoldObject = { id: string; workspaceId: string; slug: string; isSystem: boolean };
export type BreakcoldView = { id: string; type: 'table' | 'kanban'; isDefault?: boolean | undefined;
  kanbanFieldDefinitionId?: string | null | undefined };
export type BreakcoldField = { id: string; objectTypeId: string; slug: string; name: string; fieldType: string;
  targetObjectTypeId?: string | null | undefined };
export type BreakcoldFieldOption = { id: string; value?: string | undefined; label: string };
export type BreakcoldRecord = { id: string; workspaceId: string; objectTypeId: string; objectTypeSlug?: string | undefined;
  displayName?: string | undefined; fields: Record<string, unknown>; isArchived: boolean; createdAt: number; updatedAt: number };
export type BreakcoldNote = { id: string; workspaceId: string; recordId?: string | undefined; title: string; content: string;
  contentPlain?: string | undefined; author?: { name: string } | undefined; createdAt: number; updatedAt: number };
export type BreakcoldMeeting = { id: string; workspaceId: string; startTimeMs: number; startedAtMs?: number | undefined;
  title?: string | undefined; meetingUrl?: string | undefined; durationSec?: number | undefined;
  participants?: { id: string; name: string; email?: string | undefined }[] | undefined; hasTranscript: boolean;
  createdAt: number; updatedAt: number };
export type BreakcoldSegment = { id: string; meetingId: string; segmentIndex: number; participantName?: string | undefined;
  text: string; startSec: number; endSec: number };

export type BreakcoldClient = {
  workspaces(cursor?: string): Promise<Page<BreakcoldWorkspace>>;
  /** Metadata lists: an entry the client cannot read is dropped. */
  objects(workspaceId: string): Promise<BreakcoldObject[]>;
  fields(objectTypeId: string): Promise<BreakcoldField[]>;
  views(objectTypeId: string): Promise<BreakcoldView[]>;
  fieldOptions(fieldId: string): Promise<BreakcoldFieldOption[]>;
  records(input: { workspaceId: string; objectTypeSlug: string; archived: boolean; cursor?: string | undefined }): Promise<Page<BreakcoldRecord>>;
  record(recordId: string): Promise<BreakcoldRecord>;
  note(noteId: string): Promise<BreakcoldNote>;
  notes(recordId: string, cursor?: string): Promise<Page<BreakcoldNote>>;
  meetings(input: { workspaceId: string; cursor?: string | undefined }): Promise<Page<BreakcoldMeeting>>;
  meeting(meetingId: string): Promise<BreakcoldMeeting>;
  segments(meetingId: string, cursor?: string): Promise<Page<BreakcoldSegment>>;
};

const id = z.string().min(1).max(1000).regex(/\S/u);
const timestamp = z.number().int().nonnegative().max(253_402_300_799_999);
const workspaceSchema = z.object({ id, name: z.string().min(1).max(500) });
const objectSchema = z.object({ id, workspaceId: id, slug: z.string(), isSystem: z.boolean() });
const viewSchema = z.object({ id, type: z.enum(['table', 'kanban']), isDefault: z.boolean().optional(),
  kanbanFieldDefinitionId: id.nullable().optional() });
const fieldSchema = z.object({ id, objectTypeId: id, slug: z.string(), name: z.string(), fieldType: z.string(),
  targetObjectTypeId: id.nullable().optional() });
const fieldOptionSchema = z.object({ id, value: z.string().optional(), label: z.string().max(500) });
const recordSchema = z.object({ id, workspaceId: id, objectTypeId: id, objectTypeSlug: z.string().optional(),
  displayName: z.string().max(500).optional(), fields: z.record(z.string(), z.unknown()), isArchived: z.boolean(),
  createdAt: timestamp, updatedAt: timestamp });
const noteSchema = z.object({ id, workspaceId: id, recordId: id.optional(), title: z.string().max(500), content: z.string(),
  contentPlain: z.string().max(45_000).optional(), author: z.object({ name: z.string().max(500) }).optional(),
  createdAt: timestamp, updatedAt: timestamp });
const meetingSchema = z.object({ id, workspaceId: id, startTimeMs: timestamp, startedAtMs: timestamp.optional(),
  title: z.string().max(500).optional(), meetingUrl: z.string().max(2000).optional(),
  durationSec: z.number().nonnegative().optional(),
  participants: z.array(z.object({ id, name: z.string().max(500), email: z.string().max(320).optional() })).max(500).optional(),
  hasTranscript: z.boolean(), createdAt: timestamp, updatedAt: timestamp });
const segmentSchema = z.object({ id, meetingId: id, segmentIndex: z.number().int(), participantName: z.string().max(500).optional(),
  text: z.string().max(10_000), startSec: z.number(), endSec: z.number() });
const pageSchema = z.object({ data: z.array(z.unknown()), pagination: z.object({ cursor: z.string().nullable(), hasMore: z.boolean() }) });
const recordAnswerSchema = z.object({ record: recordSchema });
/** A single item answers inside its key (`{ note }`) or bare. */
const unwrap = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null && key in body ? (body as Record<string, unknown>)[key] : body;
const path = (...parts: string[]) => parts.map(part => `/${encodeURIComponent(part)}`).join('');

export function breakcoldClient(input: { apiKey: string; fetch: typeof fetch; userAgent: string;
  /** Every call ends with this deadline, and a 429 is answered at once instead of waited out. */
  signal?: AbortSignal; beforeRequest?: (url: URL) => void | Promise<void> }): BreakcoldClient {
  const http = createClient(breakcold, { token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    headers: { 'user-agent': input.userAgent }, ...(input.beforeRequest ? { beforeRequest: input.beforeRequest } : {}) });
  const get = (route: string, query: Record<string, string> = {}) =>
    http.json(route, { query, ...(input.signal ? { signal: input.signal } : {}) });

  async function paged<T>(route: string, schema: z.ZodType<T>, cursor: string | undefined, query: Record<string, string> = {}): Promise<Page<T>> {
    const page = parseAnswer(pageSchema, await get(route, { limit: '100', ...query, ...(cursor ? { cursor } : {}) }));
    const next = page.pagination.hasMore ? page.pagination.cursor : null;
    if (page.pagination.hasMore && !next) throw new ProviderHttpError('invalid_response', null, 'cursor_missing');
    return { ...parseEntries(schema, page.data), cursor: next };
  }
  async function listed<T>(route: string, key: string, schema: z.ZodType<T>, query: Record<string, string> = {}): Promise<T[]> {
    const answer = parseAnswer(z.object({ [key]: z.array(z.unknown()) }), await get(route, query));
    return parseEntries(schema, answer[key] ?? []).items;
  }

  return {
    workspaces: cursor => paged('/workspaces', workspaceSchema, cursor),
    objects: workspaceId => listed('/crm/objects', 'objects', objectSchema, { workspaceId }),
    fields: objectTypeId => listed(`/crm/objects${path(objectTypeId)}/fields`, 'fields', fieldSchema),
    views: objectTypeId => listed(`/crm/objects${path(objectTypeId)}/views`, 'views', viewSchema),
    fieldOptions: fieldId => listed(`/crm/fields${path(fieldId)}/options`, 'options', fieldOptionSchema),
    records: ({ workspaceId, objectTypeSlug, archived, cursor }) => paged('/records', recordSchema, cursor,
      { workspaceId, objectTypeSlug, archived: String(archived) }),
    record: async recordId => parseAnswer(recordAnswerSchema, await get(`/records${path(recordId)}`)).record,
    note: async noteId => parseAnswer(noteSchema, unwrap(await get(`/notes${path(noteId)}`), 'note')),
    notes: (recordId, cursor) => paged(`/records${path(recordId)}/notes`, noteSchema, cursor),
    meetings: ({ workspaceId, cursor }) => paged('/meetings', meetingSchema, cursor,
      { workspaceId, eventState: 'active', hasTranscript: 'true' }),
    meeting: async meetingId => parseAnswer(meetingSchema, unwrap(await get(`/meetings${path(meetingId)}`), 'meeting')),
    segments: (meetingId, cursor) => paged(`/meetings${path(meetingId)}/transcript`, segmentSchema, cursor),
  };
}

/** Reads the delivery key after signature verification; routing and deduplication belong to the app. */
export function parseWebhook(headers: Headers): { deliveryId: string } | null {
  const deliveryId = headers.get('x-webhook-delivery-id');
  return deliveryId ? { deliveryId } : null;
}
