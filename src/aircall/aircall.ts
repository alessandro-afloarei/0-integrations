import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { client } from '../client.js';
import type { Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { aircall } from '../catalogue/aircall.js';

// Aircall's own field names: an app stores these values and reads them back with its own schema.
export type AircallUser = { id: number; name: string; email: string };
export type AircallContact = { id: number; first_name: string | null; last_name: string | null; company_name: string | null;
  emails: { value: string }[] };
export type AircallCall = {
  id: number; direction: 'inbound' | 'outbound'; status: string;
  /** Unix seconds; `answered_at` is null on a missed call. */
  started_at: number; answered_at: number | null; ended_at: number | null;
  raw_digits: string;
  /** The call's page in Aircall, behind the customer's sign-in. */
  asset: string | null;
  user: AircallUser | null; contact: AircallContact | null;
};
export type AircallUtterance = {
  /** Seconds from the start of the call. */
  start_time: number; end_time: number; text: string;
  participant_type: 'internal' | 'external' | 'ai_voice_agent';
  user_id?: number | undefined; phone_number?: string | undefined;
};
export type AircallClient = {
  /** The company the key belongs to (Aircall gives no id for it). */
  company(): Promise<{ name: string }>;
  /** One page of calls created since a time, oldest first, with their contact; `cursor` is the next page. Aircall serves
   * the first 10,000 calls of a listing only, so the page that reaches them carries on from a second before its last call:
   * the calls of those two seconds are read twice. */
  calls(query: { from?: number | undefined; cursor?: string | undefined }): Promise<Page<AircallCall>>;
  /** A call's transcript; null while it has none (not ready yet, or a call Aircall does not transcribe). A company
   * without Aircall's AI Assist is refused as `request_failed` 403 with detail `ai_assist_required`. */
  transcript(callId: number): Promise<AircallUtterance[] | null>;
};

const userSchema = z.object({ id: z.number().int(), name: z.string(), email: z.string() });
// Every key it does not name is dropped: recordings, costs, comments and tags never leave the client.
const callSchema = z.object({
  id: z.number().int().positive(), direction: z.enum(['inbound', 'outbound']), status: z.string(),
  started_at: z.number().int(), answered_at: z.number().int().nullable(), ended_at: z.number().int().nullable(),
  raw_digits: z.string(), asset: z.string().nullable(), user: userSchema.nullable(),
  contact: z.object({ id: z.number().int(), first_name: z.string().nullable(), last_name: z.string().nullable(),
    company_name: z.string().nullable(), emails: z.array(z.object({ value: z.string() })) }).nullable().optional()
    .transform(contact => contact ?? null),
});
const utteranceSchema = z.object({ start_time: z.number(), end_time: z.number(), text: z.string(),
  participant_type: z.enum(['internal', 'external', 'ai_voice_agent']),
  // Aircall's webhooks send the user id as a string, so a string is read too.
  user_id: z.union([z.number().int(), z.string().regex(/^\d+$/u).transform(Number)]).nullish().transform(id => id ?? undefined),
  phone_number: z.string().nullish().transform(phone => phone ?? undefined) });
const listSchema = z.object({ calls: z.array(z.unknown()), meta: z.object({ next_page_link: z.string().nullable() }) });
const transcriptSchema = z.object({ transcription: z.object({ content: z.object({ utterances: z.array(utteranceSchema) }) }) });
const companySchema = z.object({ company: z.object({ name: z.string() }) });
/** The calls one listing serves, whatever its pages. */
const LISTING_CAP = 10_000;
/** `<from>:<page>`: the listing's start (empty for none) and its page. */
const CURSOR = /^(\d*):([1-9]\d*)$/u;

/** Aircall pages up to 50 calls; `pageSize` is for tests. */
export function aircallClient(input: { apiId: string; apiToken: string; fetch: typeof fetch; minIntervalMs?: number;
  pageSize?: number }): AircallClient {
  const api = client(aircall, { token: input.apiToken, values: { apiId: input.apiId }, fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  return {
    async company() {
      return parseAnswer(companySchema, await api.json('/company')).company;
    },
    async calls({ from, cursor }) {
      const position = cursor === undefined ? null : CURSOR.exec(cursor);
      if (cursor !== undefined && !position) throw new TypeError('cursor_invalid');
      const start = position ? (position[1] ? Number(position[1]) : undefined) : from;
      const pageNumber = position ? Number(position[2]) : 1;
      const perPage = input.pageSize ?? 50;
      const query: Record<string, string> = { order: 'asc', per_page: String(perPage), fetch_contact: 'true' };
      if (start !== undefined) query.from = String(start);
      if (pageNumber > 1) query.page = String(pageNumber);
      const page = parseAnswer(listSchema, await api.json('/calls', { query }));
      const parsed = parseEntries(callSchema, page.calls);
      // A second before the last call: whether `from` counts its own second or not, no call of that second is missed.
      const restart = (parsed.items.at(-1)?.started_at ?? 0) - 1;
      if (pageNumber * perPage >= LISTING_CAP && page.calls.length === perPage && restart > (start ?? 0)) {
        return { ...parsed, cursor: `${String(restart)}:1` };
      }
      const next = `${start === undefined ? '' : String(start)}:${String(pageNumber + 1)}`;
      return { ...parsed, cursor: page.meta.next_page_link === null ? null : next };
    },
    async transcript(callId) {
      const answer = await api.calls.transcript({ callId }).catch((error: unknown) => {
        if (error instanceof ProviderHttpError && error.status === 403) {
          throw new ProviderHttpError('request_failed', 403, 'ai_assist_required');
        }
        throw error;
      });
      return answer === null ? null : parseAnswer(transcriptSchema, answer).transcription.content.utterances;
    },
  };
}
