import { z } from "zod";
import { createClient } from "../http.js";
import { hubspot } from "../catalogue/hubspot.js";
import { parseAnswer } from "../parse.js";
import { paginate, type Page } from "../paginate.js";
import { walk } from "../paging.js";
import { datetime } from "../shapes.js";

export type HubSpotObject = "companies" | "contacts" | "deals";
const hubspotRecordSchema = z.object({ id: z.string(), properties: z.record(z.string(), z.string().nullable()),
  updatedAt: z.string() });
export type HubSpotRecord = { id: string; properties: Record<string, string | null>; updatedAt: string };
export type HubSpotStageRevision = { value: string; timestamp: string; sourceType?: string };
export type HubSpotOwner = { email: string; name: string };
export type HubSpotClient = ReturnType<typeof hubspotClient>;

/** Contacts keep the older name for their last-modified date. */
const DATE_PROPERTY: Record<HubSpotObject, string> = {
  companies: "hs_lastmodifieddate", contacts: "lastmodifieddate", deals: "hs_lastmodifieddate",
};
const PAGE_SIZE = 200;
const ASSOCIATION_BATCH = 1_000;
const READ_BATCH = 100;
const HISTORY_BATCH = 50;

const searchSchema = z.object({ total: z.number(), results: z.array(hubspotRecordSchema),
  paging: z.object({ next: z.object({ after: z.string() }).optional() }).optional() });
const batchReadSchema = z.object({ results: z.array(hubspotRecordSchema) });
const stageHistorySchema = z.object({ results: z.array(z.object({ id: z.string(),
  propertiesWithHistory: z.object({ dealstage: z.array(z.object({ value: z.string(),
    timestamp: datetime, sourceType: z.string().optional() })).nullish() }).nullish(),
})) });
const associationSchema = z.object({ toObjectId: z.union([z.number(), z.string()]),
  associationTypes: z.array(z.object({ category: z.unknown().optional(), typeId: z.unknown().optional() })).nullish() });
const associationsSchema = z.object({ results: z.array(z.object({ from: z.object({ id: z.string() }), to: z.array(associationSchema) })) });
/** HubSpot's own "Primary" deal-to-company type: https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide */
const PRIMARY_COMPANY_TYPE = 5;
const portalIdSchema = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/u)]);
const accountSchema = z.object({ portalId: portalIdSchema });
const pipelinesSchema = z.object({ results: z.array(z.object({ stages: z.array(z.object({ id: z.string(), label: z.string() })) })) });
const ownersSchema = z.object({ results: z.array(z.object({ email: z.string().optional(), firstName: z.string().optional(),
  lastName: z.string().optional() })) });

export function hubspotClient(input: {
  /** The run's access token; asked again once, naming the token HubSpot answered 401 to, so a refresh replaces it. */
  token: (rejected?: string) => Promise<string>;
  /** `connectorFetch()` in the app: its fixture router and production guard must not be bypassed. */
  fetch: typeof fetch;
  minIntervalMs?: number;
}) {
  const http = createClient(hubspot, { token: input.token, fetch: input.fetch, ...(input.minIntervalMs === undefined ? {} : { minIntervalMs: input.minIntervalMs }) });

  const call = async <T>(path: string, schema: z.ZodType<T>, body?: unknown, query: Record<string, string> = {}): Promise<T> => {
    return parseAnswer(schema, await http.json(path, { query, ...(body === undefined ? {} : { method: "POST", json: body, idempotent: true }) }));
  };

  const search = (object: HubSpotObject, since: string | null, properties: readonly string[], limit: number, afterId?: string) => {
    const filters = [
      ...(since === null ? [] : [{ propertyName: DATE_PROPERTY[object], operator: "GTE", value: String(Date.parse(since)) }]),
      ...(afterId === undefined ? [] : [{ propertyName: "hs_object_id", operator: "GT", value: afterId }]),
    ];
    return call(`/crm/objects/2026-09/${object}/search`, searchSchema, {
      ...(filters.length ? { filterGroups: [{ filters }] } : {}),
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }], properties: [...properties], limit,
    });
  };

  /** Records' properties by id, a hundred a request; a record gone is absent. */
  const records = async (object: HubSpotObject, ids: readonly string[], properties: readonly string[]) => {
    const read = new Map<string, HubSpotRecord["properties"]>();
    for (let start = 0; start < ids.length; start += READ_BATCH) {
      const answer = await call(`/crm/objects/2026-09/${object}/batch/read`, batchReadSchema,
        { inputs: ids.slice(start, start + READ_BATCH).map(id => ({ id })), properties: [...properties] });
      for (const record of answer.results) read.set(record.id, record.properties);
    }
    return read;
  };
  /** Each deal's associations of one kind, in HubSpot's order; a deal with none is absent. */
  const dealAssociations = async (to: "companies" | "contacts", dealIds: readonly string[]) => {
    const associated = new Map<string, z.infer<typeof associationSchema>[]>();
    for (let start = 0; start < dealIds.length; start += ASSOCIATION_BATCH) {
      const answer = await call(`/crm/associations/2026-09/deals/${to}/batch/read`, associationsSchema,
        { inputs: dealIds.slice(start, start + ASSOCIATION_BATCH).map(id => ({ id })) });
      for (const result of answer.results) associated.set(result.from.id, result.to);
    }
    return associated;
  };

  return {
    /**
     * One page of an object's records changed since a date (all of them from `null`), by id past `afterId`. The id never
     * moves: a record edited while the scan reads neither repeats nor pushes another out, and no query pages past
     * HubSpot's 10,000-result cap.
     */
    async search(object: HubSpotObject, { since, properties, afterId }: { since: string | null; properties: readonly string[]; afterId?: string }) {
      const page = await search(object, since, properties, PAGE_SIZE, afterId);
      return { total: page.total, records: page.results, more: page.paging?.next !== undefined };
    },
    async total(object: HubSpotObject): Promise<number> {
      return (await search(object, null, [], 1)).total;
    },
    /** The newest closed deals since a date (HubSpot's own `hs_is_closed`), one page of 200. */
    async closedDeals(sinceMs: number, properties: readonly string[]): Promise<HubSpotRecord[]> {
      const page = await call("/crm/objects/2026-09/deals/search", searchSchema, {
        filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "true" },
          { propertyName: "closedate", operator: "GTE", value: String(sinceMs) }] }],
        sorts: [{ propertyName: "closedate", direction: "DESCENDING" }], properties: [...properties], limit: PAGE_SIZE,
      });
      return page.results;
    },
    records,
    /** Retained stage revisions, oldest first; a missing deal is absent and a deal without history has an empty list. */
    async dealStageHistory(ids: readonly string[]): Promise<Map<string, HubSpotStageRevision[]>> {
      const read = new Map<string, HubSpotStageRevision[]>();
      for (let start = 0; start < ids.length; start += HISTORY_BATCH) {
        const answer = await call("/crm/objects/2026-09/deals/batch/read", stageHistorySchema,
          { inputs: ids.slice(start, start + HISTORY_BATCH).map(id => ({ id })), properties: [], propertiesWithHistory: ["dealstage"] });
        for (const record of answer.results) {
          const revisions = (record.propertiesWithHistory?.dealstage ?? [])
            .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
            .map(({ value, timestamp, sourceType }) => ({ value, timestamp, ...(sourceType === undefined ? {} : { sourceType }) }));
          read.set(record.id, revisions);
        }
      }
      return read;
    },
    /** Each deal's contacts; a deal with none is absent. */
    async dealContacts(dealIds: readonly string[]): Promise<Map<string, string[]>> {
      return new Map([...await dealAssociations("contacts", dealIds)].map(([deal, to]) => [deal, to.map(item => String(item.toObjectId))]));
    },
    /**
     * Each deal's primary company, else its lowest company id, since HubSpot does not order associations; a deal with
     * none is absent.
     */
    async dealCompanies(dealIds: readonly string[]): Promise<Map<string, string>> {
      return new Map([...await dealAssociations("companies", dealIds)].flatMap(([deal, to]) => {
        const primary = to.filter(item => item.associationTypes?.some(type => type.category === "HUBSPOT_DEFINED" && type.typeId === PRIMARY_COMPANY_TYPE));
        const [company] = (primary.length ? primary : to).map(item => String(item.toObjectId)).sort((a, b) => Number(a) - Number(b));
        return company === undefined ? [] : [[deal, company] as const];
      }));
    },
    /** Companies' names by id; a company with no name, or gone, is absent. */
    async companyNames(ids: readonly string[]): Promise<Map<string, string>> {
      return new Map([...await records("companies", ids, ["name"])].flatMap(([id, properties]) => (properties.name ? [[id, properties.name] as const] : [])));
    },
    /** The portal the token opens. */
    async portalId(): Promise<string> {
      return String((await call("/account-info/2026-09/details", accountSchema)).portalId);
    },
    /** Every deal stage's label, across every deal pipeline. */
    async stageLabels(): Promise<Map<string, string>> {
      const answer = await call("/crm/pipelines/2026-09/deals", pipelinesSchema);
      return new Map(answer.results.flatMap(pipeline => pipeline.stages.map(stage => [stage.id, stage.label] as const)));
    },
    /** The portal's owners who have an email, lower-cased; a name falls back to the email. */
    async owners(): Promise<HubSpotOwner[]> {
      const owners: HubSpotOwner[] = [];
      for await (const body of walk(http, hubspot.http.baseUrl, hubspot.paging.after, "/crm/owners/2026-09", { query: { limit: "100" } })) {
        for (const owner of parseAnswer(ownersSchema, body).results) {
          if (!owner.email) continue;
          const email = owner.email.toLowerCase();
          owners.push({ email, name: [owner.firstName, owner.lastName].filter(Boolean).join(" ") || email });
        }
      }
      return owners;
    },
  };
}

/** Records changed since a date, continuing by object id rather than HubSpot's capped search offset. */
export function changedRecords(client: HubSpotClient, query: { object: HubSpotObject; since: string | null;
  properties: readonly string[]; afterId?: string }): AsyncGenerator<Page<HubSpotRecord>> {
  return paginate(async cursor => {
    const afterId = cursor ?? query.afterId;
    const page = await client.search(query.object, { since: query.since, properties: query.properties,
      ...(afterId === undefined ? {} : { afterId }) });
    return { items: page.records, skipped: [], cursor: page.more ? page.records.at(-1)?.id ?? null : null };
  });
}
