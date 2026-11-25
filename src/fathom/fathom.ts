import { z } from 'zod';
import { createClient } from '../http.js';
import type { Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { fathom } from '../providers.js';
import { datetime, orNull } from '../shapes.js';

// Fathom's own field names: an app stores these values and reads them back with its own schema.
export type FathomUser = { name: string; email: string; team: string | null };
export type FathomInvitee = { name: string | null; email: string | null; is_external: boolean };
export type FathomMeeting = {
  recording_id: number; title: string; meeting_title: string | null; url: string; share_url: string;
  /** The call's own link (Zoom, Meet, Teams), when Fathom knows it. */
  meeting_url: string | null;
  created_at: string;
  // Fathom marks the schedule required, yet an impromptu call has none: read as nullable text.
  scheduled_start_time: string | null; scheduled_end_time: string | null;
  recording_start_time: string; recording_end_time: string;
  calendar_invitees: FathomInvitee[]; recorded_by: FathomUser;
};
export type FathomTranscriptItem = {
  speaker: { display_name: string; matched_calendar_invitee_email: string | null };
  text: string;
  /** From the start of the recording, `HH:MM:SS`. */
  timestamp: string;
};
export type FathomClient = {
  /** Ten meetings a page (Fathom's fixed size), without transcripts: listing stays a light call. */
  meetings(query: { createdAfter?: string | undefined; recordedBy?: string | undefined;
    cursor?: string | undefined }): Promise<Page<FathomMeeting>>;
  /** A recording's transcript: Fathom counts it as a heavy call. */
  transcript(recordingId: number): Promise<FathomTranscriptItem[]>;
};

const userSchema = z.object({ name: z.string(), email: z.string(), team: z.string().nullable() });
// Every key it does not name is dropped, so Fathom's summary, action items and CRM matches never leave the client.
const meetingSchema = z.object({
  recording_id: z.number().int().positive(), title: z.string(), meeting_title: z.string().nullable(),
  url: z.string(), share_url: z.string(), meeting_url: orNull(z.string()),
  created_at: datetime, scheduled_start_time: z.string().nullable(), scheduled_end_time: z.string().nullable(),
  recording_start_time: datetime, recording_end_time: datetime,
  calendar_invitees: z.array(z.object({ name: z.string().nullable(), email: z.string().nullable(), is_external: z.boolean() })),
  recorded_by: userSchema,
});
const transcriptItemSchema = z.object({
  speaker: z.object({ display_name: z.string(), matched_calendar_invitee_email: z.string().nullable() }),
  text: z.string(), timestamp: z.string().regex(/^\d{2,}:\d{2}:\d{2}$/u),
});
const listSchema = z.object({ items: z.array(z.unknown()), next_cursor: z.string().nullable() });
const transcriptSchema = z.object({ transcript: z.array(transcriptItemSchema).nullable().transform(items => items ?? []) });

export function fathomClient(input: { apiKey: string; fetch: typeof fetch; minIntervalMs?: number }): FathomClient {
  const http = createClient({ provider: fathom, token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  return {
    async meetings({ createdAfter, recordedBy, cursor }) {
      const query: Record<string, string> = {};
      if (createdAfter) query.created_after = createdAfter;
      if (recordedBy) query['recorded_by[]'] = recordedBy;
      if (cursor) query.cursor = cursor;
      const page = parseAnswer(listSchema, await http.json('/meetings', { query }));
      const recordingId = (entry: object) => ('recording_id' in entry ? entry.recording_id : null);
      return { ...parseEntries(meetingSchema, page.items, recordingId), cursor: page.next_cursor };
    },
    async transcript(recordingId) {
      return parseAnswer(transcriptSchema, await http.json(`/recordings/${String(recordingId)}/transcript`)).transcript;
    },
  };
}
