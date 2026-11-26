import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { paginate, type Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { granola } from '../catalogue/granola.js';
import { datetime } from '../shapes.js';

// Granola's own field names: an app stores these values and reads them back with its own schema.
export type GranolaUser = { name: string | null; email: string };
export type GranolaNoteSummary = { id: string; title: string | null; owner: GranolaUser; created_at: string;
  updated_at: string; deleted_at: string | null };
export type GranolaTranscriptItem = {
  speaker: { source: string; attribution?: 'me' | 'them' | undefined; diarization_label?: string | undefined; name?: string | undefined };
  text: string; start_time: string; end_time: string;
};
export type GranolaNote = GranolaNoteSummary & {
  web_url: string;
  // An all-day event's times are dates (`2026-10-05`), not date-times: read as text.
  calendar_event: { calendar_event_id: string | null; scheduled_start_time: string | null; scheduled_end_time: string | null } | null;
  attendees: { name: string | null; email: string | null }[];
  transcript: GranolaTranscriptItem[];
};
export type GranolaClient = {
  notes(query: { createdAfter?: string | undefined; updatedAfter?: string | undefined; cursor?: string | undefined }): Promise<Page<GranolaNoteSummary>>;
  /** The note with its transcript: inline when Granola can, else page by page, at most 50 pages of 100 lines;
   * `transcriptCut` says the cap stopped it with more left. */
  note(id: string): Promise<{ note: GranolaNote; transcriptCut: boolean }>;
};

const userSchema = z.object({ name: z.string().nullable(), email: z.string() });
const summarySchema = z.object({ id: z.string().min(1).max(200), title: z.string().nullable(), owner: userSchema,
  created_at: datetime, updated_at: datetime, deleted_at: z.string().nullable() });
const transcriptItemSchema = z.object({
  speaker: z.object({ source: z.string(), attribution: z.enum(['me', 'them']).optional(),
    diarization_label: z.string().optional(), name: z.string().optional() }),
  text: z.string(), start_time: datetime, end_time: datetime,
});
// Every key it does not name is dropped, so Granola's summary and the owner's private notes never leave the client.
const noteSchema = summarySchema.extend({
  web_url: z.string(),
  calendar_event: z.object({ calendar_event_id: z.string().nullable(), scheduled_start_time: z.string().nullable(),
    scheduled_end_time: z.string().nullable() }).nullable(),
  attendees: z.array(z.object({ name: z.string().nullable(), email: z.string().nullable() })),
  transcript: z.array(transcriptItemSchema).nullable().transform(items => items ?? []),
});
const listSchema = z.object({ notes: z.array(z.unknown()), hasMore: z.boolean(), cursor: z.string().nullable() });
const transcriptPageSchema = z.object({ transcript: z.array(transcriptItemSchema), hasMore: z.boolean(), cursor: z.string().nullable() });

/** 5,000 transcript lines: far past any meeting. */
const TRANSCRIPT_PAGES = 50;

export function granolaClient(input: { apiKey: string; fetch: typeof fetch; minIntervalMs?: number }): GranolaClient {
  const http = createClient(granola, { token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  /** The body, or null for a 413 (a transcript too large to inline). */
  const get = (path: string, query: Record<string, string>): Promise<unknown> => http.json(path, { query })
    .catch((error: unknown) => {
      if (error instanceof ProviderHttpError && error.status === 413) return null;
      throw error;
    });
  return {
    async notes({ createdAfter, updatedAfter, cursor }) {
      const query: Record<string, string> = { page_size: '30' };
      if (createdAfter) query.created_after = createdAfter;
      if (updatedAfter) query.updated_after = updatedAfter;
      if (cursor) query.cursor = cursor;
      const page = parseAnswer(listSchema, await get('/notes', query));
      return { ...parseEntries(summarySchema, page.notes), cursor: page.hasMore && page.cursor ? page.cursor : null };
    },
    async note(id) {
      const path = `/notes/${encodeURIComponent(id)}`;
      const inline = await get(path, { include: 'transcript' });
      if (inline !== null) return { note: parseAnswer(noteSchema, inline), transcriptCut: false };
      const note = parseAnswer(noteSchema, await get(path, {}));
      const transcript: GranolaTranscriptItem[] = [];
      let pages = 0;
      let transcriptCut = false;
      for await (const page of paginate(async cursor => {
        const result = parseAnswer(transcriptPageSchema, await get(`${path}/transcript`,
          { page_size: '100', ...(cursor ? { cursor } : {}) }));
        return { items: result.transcript, skipped: [], cursor: result.hasMore ? result.cursor : null };
      })) {
        transcript.push(...page.items);
        if (++pages === TRANSCRIPT_PAGES) {
          transcriptCut = page.cursor !== null;
          break;
        }
      }
      return { note: { ...note, transcript }, transcriptCut };
    },
  };
}
