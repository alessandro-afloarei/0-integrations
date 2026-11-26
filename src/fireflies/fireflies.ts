import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { client } from '../client.js';
import { fireflies } from '../catalogue/fireflies.js';
import { paginate, type Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { pageSize } from '../shapes.js';
import { normalizeTranscript, UNTITLED, type FirefliesTranscript } from './transcript.js';

const LIVE_LIST_QUERY = `query FirefliesCallList($userId: String, $fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int) {
  transcripts(user_id: $userId, fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
    id title date duration meeting_link calendar_id cal_id is_live
    meeting_info { summary_status }
  }
}`;
const LIVE_GET_QUERY = `query FirefliesCall($id: String!) {
  transcript(id: $id) {
    id title date duration participants meeting_link calendar_id cal_id is_live
    meeting_info { summary_status }
    speakers { id name }
    sentences { speaker_id speaker_name text start_time }
  }
}`;
const LIVE_SEARCH_QUERY = `query FirefliesKeywordSearch($keyword: String!, $userId: String!, $limit: Int!) {
  transcripts(keyword: $keyword, scope: "all", user_id: $userId, limit: $limit) {
    id title date duration meeting_link calendar_id cal_id is_live
    meeting_info { summary_status }
  }
}`;

const PAGE_SIZE = 50;
const liveListItemSchema = z.object({
  id: z.string().min(1), title: z.string().nullable().transform(title => title?.trim() || UNTITLED),
  date: z.number(),
  duration: z.number().nullable().optional(), meeting_link: z.string().nullable().optional(),
  calendar_id: z.string().nullable().optional(), cal_id: z.string().nullable().optional(),
  is_live: z.boolean().nullable().optional(),
  meeting_info: z.object({ summary_status: z.string().nullable().optional() }).nullable().optional(),
});
export type FirefliesListItem = {
  id: string; title: string; date: number; duration?: number | null | undefined;
  meeting_link?: string | null | undefined; calendar_id?: string | null | undefined; cal_id?: string | null | undefined;
  is_live?: boolean | null | undefined; meeting_info?: { summary_status?: string | null | undefined } | null | undefined;
};

export type FirefliesUser = { userId: string; email: string; name: string };
type TranscriptQuery = { userId: string; fromDate: number; toDate: number; cursor?: string | undefined };
export type FirefliesClient = {
  user(): Promise<FirefliesUser>;
  transcripts(query: TranscriptQuery): Promise<Page<FirefliesListItem>>;
  transcript(id: string): Promise<FirefliesTranscript | null>;
  search(query: { userId: string; keyword: string; limit: number }): Promise<{ items: FirefliesListItem[]; skipped: (string | null)[] }>;
};
const listSchema = z.object({ data: z.object({ transcripts: z.array(z.unknown()) }) });
const detailSchema = z.object({ data: z.object({ transcript: z.record(z.string(), z.unknown()).nullable() }) });
const cursorSchema = z.object({
  userId: z.string(), fromDate: z.number(), toDate: z.number(), limit: z.literal(PAGE_SIZE),
  skip: z.string().regex(/^(0|[1-9][0-9]{0,15})$/u),
}).strict();

function pageOffset(query: TranscriptQuery): number {
  if (query.cursor === undefined) return 0;
  let value: unknown;
  try { value = JSON.parse(query.cursor); }
  catch { throw new TypeError('cursor_invalid'); }
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success || parsed.data.userId !== query.userId
    || parsed.data.fromDate !== query.fromDate || parsed.data.toDate !== query.toDate) {
    throw new TypeError('cursor_invalid');
  }
  const skip = Number(parsed.data.skip);
  if (!Number.isSafeInteger(skip) || skip > Number.MAX_SAFE_INTEGER - PAGE_SIZE) throw new TypeError('cursor_invalid');
  return skip;
}

export function firefliesClient(input: { apiKey: string; fetch: typeof fetch; signal?: AbortSignal }): FirefliesClient {
  const api = client(fireflies, { token: input.apiKey, fetch: input.fetch });
  const signal = input.signal ? { signal: input.signal } : {};
  const request = (query: string, variables: Record<string, unknown>): Promise<unknown> =>
    api.json('', { method: 'POST', json: { query, variables }, ...signal });
  const list = (body: unknown, limit: number) => {
    const entries = parseAnswer(listSchema, body).data.transcripts;
    if (entries.length > limit) throw new ProviderHttpError('invalid_response', null);
    return { ...parseEntries(liveListItemSchema, entries), count: entries.length };
  };
  return {
    async user() {
      const { user } = (await api.user({}, signal)).data;
      return { userId: user.user_id, email: user.email, name: user.name };
    },
    async transcripts(query) {
      if (![query.fromDate, query.toDate].every(date => Number.isFinite(date) && Number.isFinite(new Date(date).getTime()))) {
        throw new TypeError('date_invalid');
      }
      const skip = pageOffset(query);
      const page = list(await request(LIVE_LIST_QUERY, { userId: query.userId,
        fromDate: new Date(query.fromDate).toISOString(), toDate: new Date(query.toDate).toISOString(), limit: PAGE_SIZE, skip }), PAGE_SIZE);
      const cursor = page.count === PAGE_SIZE ? JSON.stringify({ userId: query.userId,
        fromDate: query.fromDate, toDate: query.toDate, limit: PAGE_SIZE, skip: String(skip + PAGE_SIZE) }) : null;
      return { items: page.items, skipped: page.skipped, cursor };
    },
    async transcript(id) {
      let body: unknown;
      try { body = await request(LIVE_GET_QUERY, { id }); }
      catch (error) {
        if (error instanceof ProviderHttpError && error.code === 'not_found') return null;
        throw error;
      }
      const raw = parseAnswer(detailSchema, body).data.transcript;
      return raw === null ? null : normalizeTranscript(raw);
    },
    async search(query) {
      pageSize(query.limit, PAGE_SIZE);
      const { items, skipped } = list(await request(LIVE_SEARCH_QUERY, query), query.limit);
      return { items, skipped };
    },
  };
}

/** Pages by creation date, with no order guarantee. Edits are not re-yielded outside the window; overlap windows
 * (for example three days), deduplicate in the app and resume a cursor only with its original query. */
export function changedTranscripts(client: FirefliesClient, query: TranscriptQuery): AsyncGenerator<Page<FirefliesListItem>> {
  return paginate(cursor => client.transcripts({ ...query, cursor: cursor ?? query.cursor }));
}

const webhookSchema = z.object({
  meeting_id: z.string().min(1), event: z.string().min(1), timestamp: z.union([z.string(), z.number()]),
});

/** Parses a V2 notification after the caller has verified its signature over the original body. */
export function parseWebhook(body: unknown): { meeting_id: string; event: string; timestamp: string | number } | null {
  const parsed = webhookSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
