import { z } from 'zod';
import { ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import type { Page } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { signInWith } from '../catalogue.js';
import { attio } from '../catalogue/attio.js';
import { datetime } from '../shapes.js';

// Attio's own field names: an app stores records and notes and reads them back with its own schema.
export type AttioWorkspace = { workspace_id: string; workspace_name: string; workspace_slug: string; scope: string };
/** One value of an attribute: its type names the fields beside it (`value`, `status`, `target_record_id`, …). */
export type AttioValue = { attribute_type: string; active_until: string | null } & Record<string, unknown>;
export type AttioRecord = { id: { record_id: string }; created_at: string; web_url: string;
  /** Keyed by attribute slug; Attio answers the current values. */
  values: Record<string, AttioValue[]> };
export type AttioNote = { id: { note_id: string }; parent_object: string; parent_record_id: string; title: string;
  content_plaintext: string; created_at: string };
export type AttioMember = { id: { workspace_member_id: string }; first_name: string; last_name: string; email_address: string };
export type AttioClient = {
  /** The token's workspace; a token Attio does not know is `rejected`. */
  workspace(): Promise<AttioWorkspace>;
  /** One page of an object's records, oldest first, or those created after a time. Attio keeps no update time, so an
   * app finds edits by reading every page again. */
  records(input: { object: string; createdAfter?: string | undefined; cursor?: string | undefined }): Promise<Page<AttioRecord>>;
  notes(cursor?: string): Promise<Page<AttioNote>>;
  members(): Promise<AttioMember[]>;
};

const id = z.string().min(1).max(200);
const workspaceSchema = z.object({ active: z.literal(true), workspace_id: id, workspace_name: z.string(),
  workspace_slug: z.string(), scope: z.string() });
const valueSchema = z.looseObject({ attribute_type: z.string(), active_until: z.string().nullable() });
const recordSchema = z.object({ id: z.object({ record_id: id }), created_at: datetime, web_url: z.string(),
  values: z.record(z.string(), z.array(valueSchema)) });
const noteSchema = z.object({ id: z.object({ note_id: id }), parent_object: z.string(), parent_record_id: id, title: z.string(),
  content_plaintext: z.string(), created_at: datetime });
const memberSchema = z.object({ id: z.object({ workspace_member_id: id }), first_name: z.string(), last_name: z.string(),
  email_address: z.string() });
const listSchema = z.object({ data: z.array(z.unknown()) });
/** An entry's own id, the last of Attio's id object (`{ workspace_id, …, record_id }`). */
const entryId = (entry: object): unknown => {
  const ids = 'id' in entry ? entry.id : null;
  return typeof ids === 'object' && ids !== null ? Object.values(ids).at(-1) : null;
};

/** `pageSize` is for tests: Attio's limits are 500 records and 50 notes a page. */
export function attioClient(input: { apiKey: string; fetch: typeof fetch; minIntervalMs?: number; pageSize?: number }): AttioClient {
  const http = createClient(signInWith(attio, 'key'), { token: () => Promise.resolve(input.apiKey), fetch: input.fetch,
    ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });
  /** Attio pages by offset: a short page is the last. */
  function paged<T>(schema: z.ZodType<T>, data: unknown[], offset: number, limit: number): Page<T> {
    return { ...parseEntries(schema, data, entryId), cursor: data.length < limit ? null : String(offset + limit) };
  }
  const offsetOf = (cursor: string | undefined) => {
    const offset = Number(cursor ?? '0');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('cursor_invalid');
    return offset;
  };
  return {
    async workspace() {
      const answer = await http.json('/self').catch((error: unknown) => {
        // A token of the wrong length is a 400 here, not the documented `{ active: false }`.
        if (error instanceof ProviderHttpError && error.status === 400) throw new ProviderHttpError('rejected', 400);
        throw error;
      });
      if (typeof answer === 'object' && answer !== null && 'active' in answer && answer.active === false) {
        throw new ProviderHttpError('rejected', null, 'token_inactive');
      }
      const { workspace_id, workspace_name, workspace_slug, scope } = parseAnswer(workspaceSchema, answer);
      return { workspace_id, workspace_name, workspace_slug, scope };
    },
    async records({ object, createdAfter, cursor }) {
      const offset = offsetOf(cursor);
      const limit = input.pageSize ?? 500;
      const answer = await http.json(`/objects/${encodeURIComponent(object)}/records/query`, { method: 'POST', idempotent: true,
        json: { ...(createdAfter ? { filter: { created_at: { $gt: createdAfter } } } : {}),
          // `record_id` breaks ties: records imported together share a `created_at`, and offset pages need one fixed order.
          sorts: [{ direction: 'asc', attribute: 'created_at' }, { direction: 'asc', attribute: 'record_id' }],
          limit, offset } });
      return paged(recordSchema, parseAnswer(listSchema, answer).data, offset, limit);
    },
    async notes(cursor) {
      const offset = offsetOf(cursor);
      const limit = Math.min(input.pageSize ?? 50, 50);
      const answer = await http.json('/notes', { query: { limit: String(limit), offset: String(offset) } });
      return paged(noteSchema, parseAnswer(listSchema, answer).data, offset, limit);
    },
    async members() {
      return parseEntries(memberSchema, parseAnswer(listSchema, await http.json('/workspace_members')).data).items;
    },
  };
}
