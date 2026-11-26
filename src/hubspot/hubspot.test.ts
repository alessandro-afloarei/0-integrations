import { fakeFetch } from "../testing.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identifyAccount } from "../account.js";
import { hubspot } from "../catalogue/hubspot.js";
import { changedRecords, hubspotClient } from "./hubspot.js";
import { ProviderHttpError } from "../errors.js";
import { fakeHubSpot, type HubSpotFakeData } from "./fake.js";

type Call = { url: string; method: string; body: unknown; authorization: string | null };

/** A fetch that answers from a script, one response per call, and records what was asked. */
function scripted(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fake = fakeFetch([{ url: /^https:\/\/api\.hubapi\.com\//u, respond: async request => {
    const body = await request.text();
    calls.push({ url: request.url, method: request.method,
      body: body ? JSON.parse(body) : null, authorization: request.headers.get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("unscripted call");
    if (next instanceof Error) throw next;
    return next;
  } }]);
  return { calls, fetch: fake.fetch };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const page = (results: unknown[], after?: string) => json({ total: 3, results, ...(after ? { paging: { next: { after } } } : {}) });
const noWait = { minIntervalMs: 0 };
/** HubSpot's identity as its entry declares it, from a token answer and, without its `hub_id`, account-info. */
const identify = (tokenAnswer: Record<string, unknown>, fetch: typeof globalThis.fetch) =>
  identifyAccount(hubspot, { fetch, token: "fixture-access-secret", tokenAnswer });
const malformed = new ProviderHttpError("invalid_response", 200, "missing_fields");
const emptyPortal: HubSpotFakeData = { client: { clientId: "client", clientSecret: "fixture-client-secret" }, redirectUri: "https://app.test/api/integrations/hubspot/callback", hubId: 42, companies: [], contacts: [], deals: [], dealCompanies: {}, pipelines: [], owners: [] };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => vi.useRealTimers());

describe("the HubSpot client", () => {
  it("searches one object from a date by id, 200 a page, with the grant", async () => {
    const { calls, fetch } = scripted(page([{ id: "c1", properties: { name: "Northstar" }, updatedAt: "2026-10-01T10:00:00.000Z" }], "200"));
    const client = hubspotClient({ token: () => Promise.resolve("access-1"), fetch, ...noWait });
    const result = await client.search("companies", { since: "2026-10-01T09:00:00.000Z", properties: ["name"] });
    expect(result).toEqual({ total: 3, records: [{ id: "c1", properties: { name: "Northstar" }, updatedAt: "2026-10-01T10:00:00.000Z" }], more: true });
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/objects/2026-09/companies/search", method: "POST",
      authorization: "Bearer access-1" });
    expect(calls[0]?.body).toEqual({
      filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(Date.parse("2026-10-01T09:00:00.000Z")) }] }],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }], properties: ["name"], limit: 200 });
  });

  it("filters contacts on their own date property, sends no date from the start, and continues past an id, never an offset", async () => {
    const { calls, fetch } = scripted(page([]), page([]));
    const client = hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait });
    await client.search("contacts", { since: "2026-10-01T00:00:00.000Z", properties: ["firstname"], afterId: "4100" });
    expect(await client.search("deals", { since: null, properties: ["dealname"], afterId: "400" })).toMatchObject({ more: false });
    expect(calls[0]?.body).toMatchObject({ filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GTE" },
      { propertyName: "hs_object_id", operator: "GT", value: "4100" }] }] });
    expect(calls[1]?.body).toEqual({ filterGroups: [{ filters: [{ propertyName: "hs_object_id", operator: "GT", value: "400" }] }],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }], properties: ["dealname"], limit: 200 });
  });

  it("counts an object with one-record search", async () => {
    const { calls, fetch } = scripted(json({ total: 1234, results: [] }));
    expect(await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).total("deals")).toBe(1234);
    expect(calls[0]?.body).toMatchObject({ limit: 1 });
  });

  it("says a refused grant, a rate limit, an outage and a bad request in its own words", async () => {
    const run = async (...responses: Array<Response | Error>) => {
      const result = hubspotClient({ token: () => Promise.resolve("t"), ...scripted(...responses), ...noWait })
        .search("companies", { since: null, properties: ["name"] }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1000);
      return result;
    };
    expect(await run(json({ status: "error" }, 401), json({ status: "error" }, 401))).toMatchObject({ code: "rejected" });
    expect(await run(json({ status: "error" }, 403))).toMatchObject({ code: "rejected" });
    expect(await run(json({}, 429, { "retry-after": "1" }), json({}, 429))).toMatchObject({ code: "rate_limited" });
    // An outage outlasts the one retry a read gets.
    expect(await run(json({}, 503), json({}, 503))).toMatchObject({ code: "unavailable" });
    expect(await run(new TypeError("fetch failed"), new TypeError("fetch failed"))).toMatchObject({ code: "unavailable" });
    expect(await run(json({ status: "error", category: "VALIDATION_ERROR" }, 400))).toMatchObject({ code: "request_failed" });
    expect(await run(json({ nothing: true }))).toMatchObject({ code: "invalid_response" });
  });

  it("asks once for a token in place of the one HubSpot refused", async () => {
    const token = vi.fn<(rejected?: string) => Promise<string>>().mockResolvedValueOnce("expired").mockResolvedValueOnce("fresh");
    const { calls, fetch } = scripted(json({ status: "error" }, 401), page([]));
    await hubspotClient({ token, fetch, ...noWait }).search("companies", { since: null, properties: ["name"] });
    expect(calls.map(call => call.authorization)).toEqual(["Bearer expired", "Bearer fresh"]);
    expect(token).toHaveBeenLastCalledWith("expired");
  });

  it("retries one rate limit after HubSpot's wait, at most ten seconds", async () => {
    const { calls, fetch } = scripted(json({}, 429, { "retry-after": "60" }), page([]));
    const result = hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).search("companies", { since: null, properties: ["name"] });
    await vi.advanceTimersByTimeAsync(9999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(calls).toHaveLength(2);
  });

  it("spaces its calls under HubSpot's search limit", async () => {
    const { calls, fetch } = scripted(page([]), page([]));
    const client = hubspotClient({ token: () => Promise.resolve("t"), fetch, minIntervalMs: 250 });
    await client.search("companies", { since: null, properties: ["name"] });
    await vi.advanceTimersByTimeAsync(100);
    const result = client.search("companies", { since: null, properties: ["name"] });
    await vi.advanceTimersByTimeAsync(149);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(calls).toHaveLength(2);
  });

  it("reads each deal's company, a thousand deals a request", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `d${String(i)}`);
    const { calls, fetch } = scripted(
      json({ results: [{ from: { id: "d0" }, to: [{ toObjectId: 11 }, { toObjectId: "12" }] }, { from: { id: "d1" }, to: [] }] }),
      json({ results: [{ from: { id: "d1000" }, to: [{ toObjectId: 99 }] }] }),
    );
    const companies = await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).dealCompanies(ids);
    expect([...companies]).toEqual([["d0", "11"], ["d1000", "99"]]);
    expect(calls.map(call => call.url)).toEqual(Array(2).fill("https://api.hubapi.com/crm/associations/2026-09/deals/companies/batch/read"));
    expect((calls[0]?.body as { inputs: unknown[] }).inputs).toHaveLength(1000);
  });

  describe("chooses one company per deal, never by HubSpot's unordered answer", () => {
    const unlabeled = { category: "HUBSPOT_DEFINED", typeId: 341, label: null };
    const primary = { category: "HUBSPOT_DEFINED", typeId: 5, label: "Primary" };
    const companyOf = async (to: unknown[]) => {
      const { fetch } = scripted(json({ results: [{ from: { id: "d1" }, to }] }));
      return (await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).dealCompanies(["d1"])).get("d1");
    };

    it("the primary company, wherever it stands in the list", async () => {
      expect(await companyOf([
        { toObjectId: 3, associationTypes: [unlabeled, { category: "USER_DEFINED", typeId: 5, label: "Reseller" }] },
        { toObjectId: 12, associationTypes: [primary, unlabeled] },
      ])).toBe("12");
    });

    it("without a primary, the lowest id compared as a number", async () => {
      expect(await companyOf([{ toObjectId: 10, associationTypes: [unlabeled] }, { toObjectId: "9", associationTypes: [unlabeled] }])).toBe("9");
    });

    it("with two primaries, the lowest id among them", async () => {
      expect(await companyOf([{ toObjectId: 30, associationTypes: [primary] }, { toObjectId: 20, associationTypes: [unlabeled] },
        { toObjectId: 25, associationTypes: [primary] }])).toBe("25");
    });

    it("without association types, the lowest id", async () => {
      expect(await companyOf([{ toObjectId: 10 }, { toObjectId: 9 }])).toBe("9");
    });

    it("an association type missing or mistyping its category or id is not primary, and does not fail the read", async () => {
      expect(await companyOf([{ toObjectId: 7, associationTypes: [{ typeId: 5 }] }, { toObjectId: 8, associationTypes: [{ label: "x" }] },
        { toObjectId: 12, associationTypes: [primary] }])).toBe("12");
      expect(await companyOf([{ toObjectId: 9, associationTypes: [{ category: "HUBSPOT_DEFINED" }] }, { toObjectId: 8, associationTypes: [{}] }])).toBe("8");
      expect(await companyOf([{ toObjectId: 9, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: "5" }] },
        { toObjectId: 8, associationTypes: null }, { toObjectId: 10, associationTypes: [{ category: null, typeId: null }] }])).toBe("8");
    });

    it("a deal with no company is absent", async () => {
      expect(await companyOf([])).toBeUndefined();
    });
  });

  it("reads the newest closed deals since a date, by HubSpot's own closed flag, one page of 200", async () => {
    const { calls, fetch } = scripted(page([{ id: "d1", properties: { closedate: "2026-10-01T00:00:00.000Z" }, updatedAt: "2026-10-01T00:00:00.000Z" }]));
    const deals = await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).closedDeals(Date.parse("2024-10-13"), ["closedate"]);
    expect(deals.map(deal => deal.id)).toEqual(["d1"]);
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/objects/2026-09/deals/search", method: "POST", body: {
      filterGroups: [{ filters: [{ propertyName: "hs_is_closed", operator: "EQ", value: "true" },
        { propertyName: "closedate", operator: "GTE", value: String(Date.parse("2024-10-13")) }] }],
      sorts: [{ propertyName: "closedate", direction: "DESCENDING" }], properties: ["closedate"], limit: 200 } });
  });

  it("reads any object's properties by id, a hundred a request, and each deal's contacts, a thousand a request", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${String(i)}`);
    const { calls, fetch } = scripted(
      json({ results: [{ id: "c0", properties: { industry: "RETAIL" }, updatedAt: "2026-10-01T00:00:00.000Z" }] }),
      json({ results: [] }),
      json({ results: [{ from: { id: "d1" }, to: [{ toObjectId: 7 }, { toObjectId: 8 }] }] }),
      json({ results: [{ from: { id: "d2" }, to: [{ toObjectId: 9, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: 4, label: null }] },
        { toObjectId: 8, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: 3, label: null }] }] }] }),
    );
    const client = hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait });
    expect([...(await client.records("companies", ids, ["industry"]))]).toEqual([["c0", { industry: "RETAIL" }]]);
    expect(calls.slice(0, 2).map(call => call.url)).toEqual(Array(2).fill("https://api.hubapi.com/crm/objects/2026-09/companies/batch/read"));
    expect(calls[0]?.body).toMatchObject({ properties: ["industry"] });
    expect([...(await client.dealContacts(["d1"]))]).toEqual([["d1", ["7", "8"]]]);
    expect(calls[2]?.url).toBe("https://api.hubapi.com/crm/associations/2026-09/deals/contacts/batch/read");
    expect([...(await client.dealContacts(["d2"]))]).toEqual([["d2", ["9", "8"]]]);
  });

  it("names companies by id, a hundred a request", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => String(i));
    const { calls, fetch } = scripted(
      json({ results: [{ id: "0", properties: { name: "Northstar" }, updatedAt: "2026-10-01T00:00:00.000Z" }] }),
      json({ results: [{ id: "100", properties: { name: null }, updatedAt: "2026-10-01T00:00:00.000Z" }] }),
    );
    const names = await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).companyNames(ids);
    expect([...names]).toEqual([["0", "Northstar"]]);
    expect(calls.map(call => call.url)).toEqual(Array(2).fill("https://api.hubapi.com/crm/objects/2026-09/companies/batch/read"));
    expect(calls[0]?.body).toMatchObject({ properties: ["name"] });
    expect((calls[0]?.body as { inputs: unknown[] }).inputs).toHaveLength(100);
  });

  it("labels every deal stage of every pipeline", async () => {
    const { calls, fetch } = fakeFetch(fakeHubSpot({ ...emptyPortal, pipelines: [
      { id: "default", label: "Sales", stages: [{ id: "contractsent", label: "Contract sent" }] },
      { id: "renewals", label: "Renewals", stages: [{ id: "123", label: "Renewal due" }] },
    ] }));
    const labels = await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).stageLabels();
    expect([...labels]).toEqual([["contractsent", "Contract sent"], ["123", "Renewal due"]]);
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/pipelines/2026-09/deals", method: "GET" });
  });

  it("lists the owners who have an email, across pages, leaving out one with none and reporting a malformed one", async () => {
    const { calls, fetch } = scripted(
      json({ results: [{ email: "Alice@Acme.test", firstName: "Alice", lastName: "Reed" }, { firstName: "No", lastName: "Email" },
        { id: "8", email: null }, { id: "7", email: 42 }], paging: { next: { after: "a+b=" } } }),
      json({ results: [{ email: "bob@acme.test", firstName: "", lastName: "" }, "junk"] }),
    );
    expect(await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).owners()).toEqual({
      items: [{ email: "alice@acme.test", name: "Alice Reed" }, { email: "bob@acme.test", name: "bob@acme.test" }], skipped: ["7", null] });
    expect(calls.map(call => call.url)).toEqual(["https://api.hubapi.com/crm/owners/2026-09?limit=100",
      "https://api.hubapi.com/crm/owners/2026-09?limit=100&after=a%2Bb%3D"]);
  });

  it("encodes an owners cursor with URLSearchParams, preserving spaces and reserved characters", async () => {
    const cursor = "a+b= c&d/?#";
    const { calls, fetch } = scripted(json({ results: [], paging: { next: { after: cursor } } }), json({ results: [] }));
    expect(await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).owners()).toEqual({ items: [], skipped: [] });
    expect(calls.map(call => call.url)).toEqual(["https://api.hubapi.com/crm/owners/2026-09?limit=100",
      "https://api.hubapi.com/crm/owners/2026-09?limit=100&after=a%2Bb%3D+c%26d%2F%3F%23"]);
  });

  it.each([{ after: "" }, { after: 7 }, {}])("ends the owners at a blank or non-string cursor %j", async next => {
    const { calls, fetch } = scripted(json({ results: [], paging: { next } }));
    expect(await hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).owners()).toEqual({ items: [], skipped: [] });
    expect(calls).toHaveLength(1);
  });

  it("refuses an owners cursor that comes back", async () => {
    const { calls, fetch } = scripted(json({ results: [], paging: { next: { after: "a1" } } }), json({ results: [], paging: { next: { after: "a1" } } }));
    await expect(hubspotClient({ token: () => Promise.resolve("t"), fetch, ...noWait }).owners())
      .rejects.toMatchObject({ code: "invalid_response", detail: "cursor_repeated" });
    expect(calls).toHaveLength(2);
  });

  const invalidPortalIds = ["", 0, -1, 1.5, [], {}, true];

  it.each(invalidPortalIds.map(hub_id => ({ hub_id })))("identify refuses malformed hub_id ($hub_id) without a request", async ({ hub_id }) => {
    const stub = scripted();
    await expect(identify({ hub_id }, stub.fetch)).rejects.toEqual(malformed);
    expect(stub.calls).toHaveLength(0);
  });

  it.each([...invalidPortalIds, null].map(portalId => ({ portalId })))("identify refuses malformed account-info portalId ($portalId)", async ({ portalId }) => {
    const stub = scripted(json({ portalId }));
    await expect(identify({}, stub.fetch)).rejects.toEqual(malformed);
    expect(stub.calls.map(call => call.url)).toEqual(["https://api.hubapi.com/account-info/2026-09/details"]);
  });

  it.each([123, "123"])("identify preserves a valid numeric or digit-string identity (%s)", async id => {
    const stub = scripted(json({ portalId: id }));
    expect(await identify({ hub_id: id }, stub.fetch)).toEqual({ account: { id: String(id), name: `Portal ${String(id)}` }, values: {} });
    expect(stub.calls).toHaveLength(0);
    expect(await identify({}, stub.fetch)).toEqual({ account: { id: String(id), name: `Portal ${String(id)}` }, values: {} });
    expect(stub.calls).toHaveLength(1);
  });

  it("keeps token extras and account-info secrets out of identity errors", async () => {
    const secret = "fixture-provider-secret";
    const stub = scripted(json({ portalId: [secret], access_token: secret }));
    const fromExtras = await identify({ hub_id: { secret }, refresh_token: secret }, stub.fetch).catch((error: unknown) => error);
    expect(stub.calls).toHaveLength(0);
    const fromAccount = await identify({}, stub.fetch).catch((error: unknown) => error);
    for (const error of [fromExtras, fromAccount]) {
      expect(error).toEqual(malformed);
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it.each([123, "123"])("portalId accepts a number or a string (%s)", async portalId => {
    const client = hubspotClient({ token: () => Promise.resolve("t"), ...scripted(json({ portalId })), ...noWait });
    expect(await client.portalId()).toBe("123");
  });
  it("an answer that fails its schema throws invalid_response", async () => {
    const client = hubspotClient({ token: () => Promise.resolve("t"), ...scripted(json({ portalId: [] })), ...noWait });
    await expect(client.portalId()).rejects.toEqual(new ProviderHttpError("invalid_response", null));
  });

  const record = (id: string) => ({ id, properties: { firstname: "Alice" }, updatedAt: "2026-10-01T00:00:00.000Z" });
  const query = { object: "contacts" as const, since: null, properties: ["firstname"] };

  it("changedRecords pages by id: each request's afterId is the previous page's last id", async () => {
    const stub = scripted(page([record("10"), record("20")], "2"), page([record("30")]));
    const client = hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait });
    const pages = [];
    for await (const result of changedRecords(client, { ...query, afterId: "5" })) pages.push(result);
    expect(pages).toEqual([
      { items: [record("10"), record("20")], skipped: [], cursor: "20" },
      { items: [record("30")], skipped: [], cursor: null },
    ]);
    expect(stub.calls.map(call => call.body)).toEqual(["5", "20"].map(id => ({
      filterGroups: [{ filters: [{ propertyName: "hs_object_id", operator: "GT", value: id }] }],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }], properties: ["firstname"], limit: 200,
    })));
  });

  it.each([page([record("10")]), page([], "next")])("changedRecords ends on a page without more, and on an empty page", async response => {
    const stub = scripted(response);
    const client = hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait });
    const pages = [];
    for await (const result of changedRecords(client, query)) pages.push(result);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.cursor).toBeNull();
    expect(stub.calls).toHaveLength(1);
  });

  it("identify prefers hub_id and reads account-info without one", async () => {
    const stub = fakeFetch(fakeHubSpot(emptyPortal));
    expect(await identify({ hub_id: 12 }, stub.fetch)).toEqual({ account: { id: "12", name: "Portal 12" }, values: {} });
    expect(await identify({ hub_id: "13" }, stub.fetch)).toEqual({ account: { id: "13", name: "Portal 13" }, values: {} });
    expect(stub.calls).toHaveLength(0);
    expect(await identify({}, stub.fetch)).toEqual({ account: { id: "42", name: "Portal 42" }, values: {} });
    expect(await identify({ hub_id: null }, stub.fetch)).toEqual({ account: { id: "42", name: "Portal 42" }, values: {} });
    expect(stub.calls).toHaveLength(2);
  });
});

describe("deal stage history", () => {
  it("reads only stage revisions, sorts by instant and preserves timestamps, ties and repeated stages", async () => {
    const first = { value: "open", timestamp: "2026-10-01T10:00:00+02:00" };
    const tied = { value: "qualified", timestamp: "2026-10-01T08:00:00.000Z", sourceType: "CRM_UI" };
    const last = { value: "open", timestamp: "2026-10-01T09:00:00.000Z" };
    const stub = scripted(json({ results: [{ id: "3", propertiesWithHistory: {
      dealstage: [last, { ...first, sourceId: "private", extra: true }, tied], amount: [] }, extra: true }] }));
    const client = hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait });
    expect(await client.dealStageHistory(["3"])).toEqual(new Map([["3", [first, tied, last]]]));
    expect(stub.calls).toEqual([{ url: "https://api.hubapi.com/crm/objects/2026-09/deals/batch/read", method: "POST",
      authorization: "Bearer t", body: { inputs: [{ id: "3" }], properties: [], propertiesWithHistory: ["dealstage"] } }]);
  });

  it.each([0, 50, 51, 101])("chunks %i IDs at 50 without dropping the final chunk", async count => {
    const ids = Array.from({ length: count }, (_, i) => String(i));
    const stub = scripted(...Array.from({ length: Math.ceil(count / 50) }, (_, i) =>
      json({ results: ids.slice(i * 50, (i + 1) * 50).map(id => ({ id, propertiesWithHistory: { dealstage: [] } })) })));
    const read = await hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait }).dealStageHistory(ids);
    expect([...read.keys()]).toEqual(ids);
    expect(stub.calls.map(call => call.body)).toEqual(Array.from({ length: Math.ceil(count / 50) }, (_, i) => ({
      inputs: ids.slice(i * 50, (i + 1) * 50).map(id => ({ id })), properties: [], propertiesWithHistory: ["dealstage"],
    })));
  });

  it("distinguishes empty, absent and null histories from a missing deal", async () => {
    const stub = scripted(json({ results: [{ id: "empty", propertiesWithHistory: { dealstage: [] } },
      { id: "absent" }, { id: "null", propertiesWithHistory: null },
      { id: "null-stage", propertiesWithHistory: { dealstage: null } }, { id: "no-stage", propertiesWithHistory: {} }] }));
    const ids = ["empty", "absent", "null", "null-stage", "no-stage"];
    expect(await hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait }).dealStageHistory([...ids, "gone"]))
      .toEqual(new Map(ids.map(id => [id, []])));
  });

  it.each([[{ value: "open", timestamp: "invalid" }], [{ value: "open", timestamp: "2026-02-30T00:00:00Z" }],
    [{ value: 3, timestamp: "2026-10-01T00:00:00Z" }], [{ value: "open" }], "invalid"].map(history => ({ history })))
  ("rejects malformed history rather than silently losing revisions ($history)", async ({ history }) => {
    const stub = scripted(json({ results: [{ id: "3", propertiesWithHistory: { dealstage: history } }] }));
    await expect(hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait }).dealStageHistory(["3"]))
      .rejects.toEqual(new ProviderHttpError("invalid_response", null));
  });

  it("returns all supplied revisions without applying a local retention cap", async () => {
    const revisions = Array.from({ length: 21 }, (_, i) => ({ value: String(i),
      timestamp: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
    const stub = scripted(json({ results: [{ id: "3", propertiesWithHistory: { dealstage: revisions } }] }));
    expect(await hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait }).dealStageHistory(["3"]))
      .toEqual(new Map([["3", revisions]]));
  });

  it("propagates a later batch provider 400 without returning a partial map", async () => {
    const stub = scripted(json({ results: [{ id: "0", propertiesWithHistory: { dealstage: [] } }] }),
      json({ category: "VALIDATION_ERROR", message: "invalid input secret", context: { token: "private" } }, 400));
    const client = hubspotClient({ token: () => Promise.resolve("t"), ...stub, ...noWait });
    await expect(client.dealStageHistory(Array.from({ length: 101 }, (_, i) => String(i))))
      .rejects.toEqual(new ProviderHttpError("request_failed", 400, "VALIDATION_ERROR"));
    expect(stub.calls).toHaveLength(2);
  });
});
