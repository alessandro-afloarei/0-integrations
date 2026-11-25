import { createClient } from '../http.js';
import { hubspot } from '../providers.js';
import { ProviderHttpError } from '../errors.js';
import { describe, expect, it } from 'vitest';
import { fakeFetch, respondFrom } from '../testing.js';
import { fakeHubSpot, type HubSpotFakeData } from './fake.js';
import { changedRecords, hubspotClient, type HubSpotRecord } from './hubspot.js';

const date = '2026-10-01T00:00:00.000Z';
const record = (id: string, properties: Record<string, string | null> = {}): HubSpotRecord => ({ id, properties, updatedAt: date });
const credentials = { client_id: 'client', client_secret: 'fixture-client-secret' };
const portal: HubSpotFakeData = {
  client: { clientId: credentials.client_id, clientSecret: credentials.client_secret },
  redirectUri: 'https://app.test/api/integrations/hubspot/callback', hubId: 42,
  companies: [record('1', { name: 'Northstar' })],
  contacts: [record('2', { firstname: 'Alice' })],
  deals: [record('3', { dealname: 'Annual' })],
  dealCompanies: { '3': '1' },
  pipelines: [{ id: 'default', label: 'Sales', stages: [{ id: 'won', label: 'Closed won' }] }],
  owners: [{ email: 'ALICE@example.test', firstName: 'Alice', lastName: 'Reed' }],
  cohort: { deals: [record('30', { closedate: date })], companies: [record('10', { name: 'Cohort' })],
    contacts: [record('20', { jobtitle: 'CTO' })], dealCompanies: { '30': '10' }, dealContacts: { '30': ['20'] } },
};
const clientFor = (data: HubSpotFakeData) => hubspotClient({ token: () => Promise.resolve('fixture'),
  fetch: fakeFetch(fakeHubSpot(data)).fetch, minIntervalMs: 0 });

describe('fakeHubSpot', () => {
  it('every client call answers from the fake', async () => {
    const client = clientFor(portal);
    expect(await client.search('contacts', { since: null, properties: ['firstname'] }))
      .toEqual({ total: 1, records: portal.contacts, more: false });
    expect(await client.total('companies')).toBe(1);
    expect(await client.closedDeals(0, ['closedate'])).toEqual(portal.cohort?.deals);
    expect(await client.records('contacts', ['2', '20', 'missing'], ['firstname', 'jobtitle']))
      .toEqual(new Map([['2', { firstname: 'Alice' }], ['20', { jobtitle: 'CTO' }]]));
    expect(await client.dealContacts(['3', '30'])).toEqual(new Map([['30', ['20']]]));
    expect(await client.dealCompanies(['3', '30'])).toEqual(new Map([['3', '1'], ['30', '10']]));
    expect(await client.companyNames(['1', '10'])).toEqual(new Map([['1', 'Northstar'], ['10', 'Cohort']]));
    expect(await client.portalId()).toBe('42');
    expect(await client.stageLabels()).toEqual(new Map([['won', 'Closed won']]));
    expect(await client.owners()).toEqual([{ email: 'alice@example.test', name: 'Alice Reed' }]);
  });

  it('search honours the date filter, the id filter, the sort and the limit, and pages past 200', async () => {
    const contacts = Array.from({ length: 405 }, (_, i) => record(String(i + 1))).reverse();
    contacts.push({ ...record('406'), updatedAt: '2026-09-01T00:00:00.000Z' });
    const client = clientFor({ ...portal, contacts });
    const pages = [];
    for await (const page of changedRecords(client, { object: 'contacts', since: date, properties: [], afterId: '2' })) pages.push(page);
    expect(pages.map(page => page.items.length)).toEqual([200, 200, 3]);
    expect(pages.map(page => page.cursor)).toEqual(['202', '402', null]);
    expect(pages.flatMap(page => page.items.map(item => item.id)))
      .toEqual(Array.from({ length: 403 }, (_, i) => String(i + 3)));
  });

  it('the closed-deals search answers the cohort only', async () => {
    const client = clientFor(portal);
    expect(await client.closedDeals(Date.parse(date), [])).toEqual(portal.cohort?.deals);
    expect(await client.closedDeals(Date.parse(date) + 1, [])).toEqual([]);
    expect((await client.search('deals', { since: null, properties: [] })).records).toEqual(portal.deals);
    const withoutCohort = { ...portal };
    delete withoutCohort.cohort;
    expect(await clientFor(withoutCohort).closedDeals(0, [])).toEqual([]);
  });

  it('a request the client never sends answers null', async () => {
    const respond = respondFrom(fakeHubSpot(portal));
    expect(await respond(new Request('https://other.test/crm/owners/2026-09'))).toBeNull();
    expect(await respond(new Request('https://api.hubapi.com/not-a-route'))).toBeNull();
    expect(await respond(new Request('https://api.hubapi.com/crm/owners/2026-09', { method: 'DELETE' }))).toBeNull();
  });

  it.each(['/relative', 'not-an-address', 'javascript:secret', 'ftp://app.test/callback',
    'https://user:fixture-secret@app.test/callback', 'https://app.test/callback#fragment', 'https://app.test/callback#'])
  ('refuses an invalid registered redirect without exposing it (%s)', redirectUri => {
    let failure: unknown;
    try { fakeHubSpot({ ...portal, redirectUri }); } catch (error) { failure = error; }
    expect(failure).toEqual(new TypeError('fake_redirect_uri_invalid'));
    expect(JSON.stringify(failure)).not.toContain(redirectUri);
  });

  it.each(['https://app.test/callback', 'http://localhost:3000/callback?flow=hubspot'])
  ('authorizes at the provider URL and preserves the registered callback and state (%s)', async redirectUri => {
    const http = fakeFetch(fakeHubSpot({ ...portal, redirectUri }));
    const url = new URL('https://app.hubspot.com/oauth/authorize');
    url.search = new URLSearchParams({ client_id: 'client', redirect_uri: redirectUri, scope: 'oauth crm.objects.companies.read crm.objects.contacts.read crm.objects.deals.read crm.objects.owners.read', state: 'state +&/?=' }).toString();
    const response = await http.fetch(url, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const back = new URL(response.headers.get('location') ?? '');
    const expected = new URL(redirectUri);
    expect(back.origin + back.pathname).toBe(expected.origin + expected.pathname);
    expect(back.searchParams.get('flow')).toBe(expected.searchParams.get('flow'));
    expect(back.searchParams.get('state')).toBe('state +&/?=');
    expect(back.searchParams.get('code')).toMatch(/^fixture-code-/u);
  });

  it.each([
    ['redirect_uri', null], ['redirect_uri', '/relative'], ['redirect_uri', 'https://other.test/callback'],
    ['redirect_uri', `${portal.redirectUri}?changed=1`], ['client_id', null], ['client_id', ''], ['client_id', '  '],
    ['client_id', 'wrong'], ['scope', null], ['scope', 'oauth'], ['state', null], ['state', ''], ['state', '  '],
  ])('refuses authorization with %s=%s', async (key, value) => {
    const respond = respondFrom(fakeHubSpot(portal));
    const url = new URL('https://app.hubspot.com/oauth/authorize');
    url.search = new URLSearchParams({ client_id: 'client', redirect_uri: portal.redirectUri, scope: 'oauth crm.objects.companies.read crm.objects.contacts.read crm.objects.deals.read crm.objects.owners.read', state: 'state' }).toString();
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    const response = await respond(new Request(url));
    expect(response?.status).toBe(400);
    expect(response?.headers.get('location')).toBeNull();
  });

  it.each([undefined, '', 'password', 'client_credentials', 'AUTHORIZATION_CODE'])
  ('refuses an unsupported grant type (%s) even with a code', async grantType => {
    const http = fakeFetch(fakeHubSpot(portal));
    const response = await http.fetch('https://api.hubapi.com/oauth/2026-03/token', { method: 'POST',
      body: new URLSearchParams({ ...credentials, code: 'fixture-code', client_id: 'client', redirect_uri: portal.redirectUri,
        ...(grantType === undefined ? {} : { grant_type: grantType }) }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unsupported_grant_type' });
  });

  it.each([{}, { code: 'unissued' }, { code: 'fixture-denied' }])('refuses missing or unissued authorization codes (%j)', async fields => {
    const http = fakeFetch(fakeHubSpot(portal));
    const response = await http.fetch('https://api.hubapi.com/oauth/2026-03/token', { method: 'POST',
      body: new URLSearchParams({ ...credentials, grant_type: 'authorization_code', client_id: 'client', redirect_uri: portal.redirectUri, ...fields }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant', status: 'BAD_REFRESH_TOKEN' });
  });

  it.each([undefined, '', '  ', 'fixture-revoked', 'null', 'undefined', 'arbitrary', 'na1-real-looking', 'fixture-code-made-up', 'fixture-access-made-up', 'fixture-refresh-2', 'fixture-refresh-other'])('refuses a missing or revoked refresh token (%s)', async token => {
    const http = fakeFetch(fakeHubSpot(portal));
    const response = await http.fetch('https://api.hubapi.com/oauth/2026-03/token', { method: 'POST',
      body: new URLSearchParams({ ...credentials, grant_type: 'refresh_token', ...(token === undefined ? {} : { refresh_token: token }) }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant', status: 'BAD_REFRESH_TOKEN' });
  });

  it('refreshes a persisted fixture grant after the fake restarts', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const response = await http.fetch('https://api.hubapi.com/oauth/2026-03/token', { method: 'POST',
      body: new URLSearchParams({ ...credentials, grant_type: 'refresh_token', refresh_token: 'fixture-refresh' }) });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ hub_id: 42, refresh_token: 'fixture-refresh' });
    expect(body.access_token).toMatch(/^fixture-access-/u);
  });

  it.each([undefined, '', 'fixture-access-1', 'unknown-refresh'])('refuses revocation of an unissued refresh token (%s)', async token => {
    const http = fakeFetch(fakeHubSpot(portal));
    const response = await http.fetch('https://api.hubapi.com/oauth/2026-03/token/revoke', { method: 'POST',
      body: new URLSearchParams({ ...credentials, ...(token === undefined ? {} : { token }) }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_token' });
  });
});

describe('fakeHubSpot history and changing data', () => {
  const revision = { value: 'open', timestamp: date };

  it('serves history for known sync and cohort deals, and preserves ordinary response bytes', async () => {
    const data = { ...portal, dealStageHistory: { '3': [revision], '30': [revision], unknown: [revision] } };
    const client = clientFor(data);
    expect(await client.dealStageHistory(['3', '30', 'unknown']))
      .toEqual(new Map([['3', [revision]], ['30', [revision]]]));
    expect(await clientFor(portal).dealStageHistory(['3', '30']))
      .toEqual(new Map([['3', []], ['30', []]]));
    const http = fakeFetch(fakeHubSpot(data));
    const batch = await http.fetch('https://api.hubapi.com/crm/objects/2026-09/deals/batch/read', {
      method: 'POST', body: JSON.stringify({ inputs: [{ id: '3' }, { id: '30' }], properties: ['dealname'] }),
    });
    expect(await batch.text()).toBe(JSON.stringify({ results: [...portal.deals, ...portal.cohort?.deals ?? []] }));
    const search = await http.fetch('https://api.hubapi.com/crm/objects/2026-09/deals/search', {
      method: 'POST', body: JSON.stringify({ limit: 200 }),
    });
    expect(await search.text()).toBe(JSON.stringify({ total: 1, results: portal.deals }));
  });

  it('serves sync contacts, falls back to the cohort, and respects an explicitly empty sync association', async () => {
    expect(await clientFor({ ...portal, dealContacts: { '3': ['2'] } }).dealContacts(['3', '30']))
      .toEqual(new Map([['3', ['2']], ['30', ['20']]]));
    expect(await clientFor({ ...portal, dealContacts: { '30': [] } }).dealContacts(['3', '30']))
      .toEqual(new Map());
  });

  it('serves association types for a deal listed with several companies, one marked primary', async () => {
    const client = clientFor({ ...portal, dealCompanies: { '3': [{ id: '1' }, { id: '10', primary: true }], '4': [{ id: '10' }, { id: '9' }], '5': [] } });
    expect(await client.dealCompanies(['3', '4', '5'])).toEqual(new Map([['3', '10'], ['4', '9']]));
    const http = fakeFetch(fakeHubSpot({ ...portal, dealCompanies: { '3': [{ id: '1' }, { id: '10', primary: true }] } }));
    const answer = await http.fetch('https://api.hubapi.com/crm/associations/2026-09/deals/companies/batch/read', {
      method: 'POST', body: JSON.stringify({ inputs: [{ id: '3' }] }),
    });
    const unlabeled = { category: 'HUBSPOT_DEFINED', typeId: 341, label: null };
    expect(await answer.json()).toEqual({ results: [{ from: { id: '3' }, to: [{ toObjectId: 1, associationTypes: [unlabeled] },
      { toObjectId: 10, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 5, label: 'Primary' }, unlabeled] }] }] });
  });

  it('keeps the one-company association answer byte for byte', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const answer = await http.fetch('https://api.hubapi.com/crm/associations/2026-09/deals/companies/batch/read', {
      method: 'POST', body: JSON.stringify({ inputs: [{ id: '3' }, { id: '30' }] }),
    });
    expect(await answer.text()).toBe('{"results":[{"from":{"id":"3"},"to":[{"toObjectId":1}]},{"from":{"id":"30"},"to":[{"toObjectId":10}]}]}');
  });

  it('one fake sees two portal states without resetting its grant or rewriting earlier history', async () => {
    let data: HubSpotFakeData = { ...portal, dealStageHistory: { '3': [revision] }, dealContacts: { '3': ['2'] } };
    let reads = 0;
    const http = fakeFetch(fakeHubSpot(() => { reads += 1; return data; }));
    expect(reads).toBe(1);
    const client = hubspotClient({ token: () => Promise.resolve('fixture'), fetch: http.fetch, minIntervalMs: 0 });
    const refresh = () => http.fetch('https://api.hubapi.com/oauth/2026-03/token', { method: 'POST',
      body: new URLSearchParams({ ...credentials, grant_type: 'refresh_token', refresh_token: 'fixture-refresh' }) });
    expect((await refresh()).status).toBe(200);
    expect(await client.dealStageHistory(['3'])).toEqual(new Map([['3', [revision]]]));
    expect(await client.dealContacts(['3'])).toEqual(new Map([['3', ['2']]]));
    expect(await client.records('deals', ['3'], ['dealname'])).toEqual(new Map([['3', { dealname: 'Annual' }]]));
    const closed = { value: 'won', timestamp: '2026-10-02T00:00:00.000Z' };
    data = { ...data, deals: [record('3', { dealstage: 'won' })], dealStageHistory: { '3': [closed, revision] },
      dealContacts: { '3': ['2', '20'] } };
    const before = reads;
    expect(await client.dealStageHistory(['3'])).toEqual(new Map([['3', [revision, closed]]]));
    expect(reads - before).toBe(1);
    expect(await client.dealContacts(['3'])).toEqual(new Map([['3', ['2', '20']]]));
    expect(await client.records('deals', ['3'], ['dealstage'])).toEqual(new Map([['3', { dealstage: 'won' }]]));
    const revoked = await http.fetch('https://api.hubapi.com/oauth/2026-03/token/revoke', { method: 'POST',
      body: new URLSearchParams({ ...credentials, token: 'fixture-refresh' }) });
    expect(revoked.status).toBe(200);
    expect((await refresh()).status).toBe(400);
  });
});


describe('fakeHubSpot history batch limit', () => {
  it.each([0, 50, 51, 101])('the real client reads %i deals through the enforcing fake', async count => {
    const deals = Array.from({ length: count }, (_, i) => record(String(i)));
    const read = await clientFor({ ...portal, deals }).dealStageHistory(deals.map(deal => deal.id));
    expect(read).toEqual(new Map(deals.map(deal => [deal.id, []])));
  });

  it('refuses an over-limit history request with 400 and the HTTP client sanitizes it', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const body = { inputs: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })),
      properties: [], propertiesWithHistory: ['dealstage'] };
    const response = await http.fetch('https://api.hubapi.com/crm/objects/2026-09/deals/batch/read', {
      method: 'POST', body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'error', category: 'VALIDATION_ERROR',
      message: 'The maximum number of inputs supported in a batch request for property histories is 50. Please reduce the number of items and try again.' });
    const client = createClient({ provider: hubspot, token: () => Promise.resolve('fixture'), fetch: http.fetch, minIntervalMs: 0 });
    const failure: unknown = await client.json('/crm/objects/2026-09/deals/batch/read', { method: 'POST', json: body })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderHttpError);
    expect(failure).toMatchObject({ code: 'request_failed', status: 400, detail: 'VALIDATION_ERROR', message: 'request_failed' });
    expect(JSON.stringify(failure)).not.toContain('maximum number');
  });

  it('keeps plain reads at 100, including an empty history selection', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    for (const history of [undefined, []]) {
      const response = await http.fetch('https://api.hubapi.com/crm/objects/2026-09/deals/batch/read', { method: 'POST',
        body: JSON.stringify({ inputs: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })),
          ...(history === undefined ? {} : { propertiesWithHistory: history }) }),
      });
      expect(response.status).toBe(200);
    }
  });
});
