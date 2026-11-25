import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hubspot } from '../catalogue/hubspot.js';
import type { Route } from '../testing.js';
import type { HubSpotObject, HubSpotRecord, HubSpotStageRevision } from './hubspot.js';

/** A deal's one company, or its companies in HubSpot's answer order; listed links carry association types. */
type DealCompanies = Readonly<Record<string, string | readonly { id: string; primary?: boolean }[]>>;

export type HubSpotFakeData = {
  client: { clientId: string; clientSecret: string };
  redirectUri: string;
  hubId: number;
  companies: readonly HubSpotRecord[];
  contacts: readonly HubSpotRecord[];
  deals: readonly HubSpotRecord[];
  dealCompanies: DealCompanies;
  dealContacts?: Readonly<Record<string, readonly string[]>>;
  dealStageHistory?: Readonly<Record<string, readonly HubSpotStageRevision[]>>;
  pipelines: readonly { id: string; label: string; stages: readonly { id: string; label: string }[] }[];
  owners: readonly { email: string; firstName: string; lastName: string }[];
  cohort?: { deals: readonly HubSpotRecord[]; companies: readonly HubSpotRecord[]; contacts: readonly HubSpotRecord[];
    dealCompanies: DealCompanies; dealContacts: Readonly<Record<string, readonly string[]>> };
};

const filterSchema = z.object({ propertyName: z.string(), operator: z.string(), value: z.string() });
const searchBodySchema = z.object({ filterGroups: z.array(z.object({ filters: z.array(filterSchema) })).optional(),
  limit: z.number(), after: z.string().optional() });
const batchSchema = z.object({ inputs: z.array(z.object({ id: z.string() })), propertiesWithHistory: z.array(z.string()).optional() });
const OBJECTS: readonly HubSpotObject[] = ['companies', 'contacts', 'deals'];

/** HubSpot's requests answered from a synthetic portal. The optional closed-deals cohort never enters a sync search. */
export function fakeHubSpot(input: HubSpotFakeData | (() => HubSpotFakeData)): Route[] {
  const readData = () => typeof input === 'function' ? input() : input;
  // OAuth registration stays fixed while the callback changes the portal's records between requests.
  const data = readData();
  const redirectUri = data.redirectUri;
  if (!URL.canParse(redirectUri)) throw new TypeError('fake_redirect_uri_invalid');
  const registered = new URL(redirectUri);
  if (!['https:', 'http:'].includes(registered.protocol) || registered.username || registered.password || redirectUri.includes('#')) {
    throw new TypeError('fake_redirect_uri_invalid');
  }
  const codes = new Set<string>();
  type FixtureGrant = { token: string; revoked: boolean };
  const refreshTokens = new Map<string, FixtureGrant>();
  // Re-consent reuses the client/portal grant; only codes and access tokens are instance-local.
  const refreshBase = `fixture-refresh-${createHash('sha256').update(JSON.stringify([data.client.clientId, data.hubId])).digest('hex')}`;
  let portalGrant: FixtureGrant | undefined;
  const fixtureRefresh = (token: string) => token === 'fixture-refresh' || token === refreshBase
    || (token.startsWith(`${refreshBase}-`) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(token.slice(refreshBase.length + 1)));
  const validClient = (form: URLSearchParams) => form.get('client_id') === data.client.clientId
    && form.get('client_secret') === data.client.clientSecret;
  const invalidClient = () => Response.json({ error: 'invalid_client' }, { status: 401 });
  const namespace = randomUUID();
  let nextCode = 0;
  let issued = 0;
  const route = (method: string, path: string, respond: Route['respond']): Route => ({
    method, url: `${hubspot.http.baseUrl}${path}`, respond,
  });
  const results = (items: readonly unknown[]) => Response.json({ results: items });
  const idsIn = async (request: Request) => batchSchema.parse(await request.json()).inputs.map(input => input.id);
  return [
    { method: 'GET', url: 'https://app.hubspot.com/oauth/authorize', respond(request) {
      const params = new URL(request.url).searchParams;
      const clientId = params.get('client_id');
      const state = params.get('state');
      const scopes = new Set((params.get('scope') ?? '').split(/\s+/u));
      if (params.get('redirect_uri') !== redirectUri || clientId !== data.client.clientId || !state?.trim()
        || !hubspot.scopes.default.every(scope => scopes.has(scope))) {
        return new Response(null, { status: 400 });
      }
      const code = `fixture-code-${namespace}-${String(++nextCode)}`;
      codes.add(code);
      const back = new URL(redirectUri);
      back.searchParams.set('state', state);
      back.searchParams.set('code', code);
      return Response.redirect(back, 302);
    } },
    route('POST', '/oauth/2026-03/token', async request => {
      const form = new URLSearchParams(await request.text());
      if (!validClient(form)) return invalidClient();
      const grantType = form.get('grant_type');
      if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
        return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
      }
      const invalidGrant = () => Response.json({ error: 'invalid_grant', status: 'BAD_REFRESH_TOKEN' }, { status: 400 });
      const refreshToken = form.get('refresh_token');
      if (grantType === 'authorization_code') {
        const code = form.get('code') ?? '';
        if (!codes.has(code) || form.get('redirect_uri') !== redirectUri) return invalidGrant();
        codes.delete(code);
        if (!portalGrant || portalGrant.revoked) {
          portalGrant = { token: portalGrant ? `${refreshBase}-${randomUUID()}` : refreshBase, revoked: false };
        }
      } else {
        // Only this registered portal's fixture shapes (and the legacy seed) survive a process restart.
        if (!refreshToken || !fixtureRefresh(refreshToken) || refreshTokens.get(refreshToken)?.revoked) return invalidGrant();
        if (!portalGrant || portalGrant.revoked) portalGrant = { token: refreshToken, revoked: false };
        // Persisted holders join the current live grant without changing its consent identity.
        refreshTokens.set(refreshToken, portalGrant);
      }
      issued += 1;
      refreshTokens.set(portalGrant.token, portalGrant);
      return Response.json({ token_type: 'bearer', access_token: `fixture-access-${namespace}-${String(issued)}`, expires_in: 1800,
        refresh_token: portalGrant.token, hub_id: data.hubId });
    }),
    route('POST', '/oauth/2026-03/token/revoke', async request => {
      const form = new URLSearchParams(await request.text());
      if (!validClient(form)) return invalidClient();
      const token = form.get('token') ?? '';
      const grant = refreshTokens.get(token);
      if (!grant) return Response.json({ error: 'invalid_token' }, { status: 400 });
      grant.revoked = true;
      return new Response(null, { status: 200 });
    }),
    route('GET', '/account-info/2026-09/details', () => Response.json({ portalId: data.hubId })),
    ...OBJECTS.map(object => route('POST', `/crm/objects/2026-09/${object}/search`, async request => {
      const data = readData();
      const search = searchBodySchema.parse(await request.json());
      const filters = search.filterGroups?.[0]?.filters ?? [];
      if (object === 'deals' && filters.some(filter => filter.propertyName === 'hs_is_closed')) {
        const since = Number(filters.find(filter => filter.propertyName === 'closedate')?.value ?? 0);
        const closed = (data.cohort?.deals ?? []).filter(deal => Date.parse(deal.properties.closedate ?? '') >= since)
          .sort((a, b) => Date.parse(b.properties.closedate ?? '') - Date.parse(a.properties.closedate ?? ''));
        return Response.json({ total: closed.length, results: closed.slice(0, search.limit) });
      }
      const matching = data[object].filter(record => filters.every(filter => filter.propertyName === 'hs_object_id'
        ? Number(record.id) > Number(filter.value) : Date.parse(record.updatedAt) >= Number(filter.value)))
        .sort((a, b) => Number(a.id) - Number(b.id));
      const offset = Number(search.after ?? 0);
      const end = offset + search.limit;
      // HubSpot refuses offset paging past the 10,000th result; id paging starts a fresh query.
      if (end > 10_000) return Response.json({ status: 'error', category: 'VALIDATION_ERROR' }, { status: 400 });
      return Response.json({ total: matching.length, results: matching.slice(offset, end),
        ...(end < matching.length ? { paging: { next: { after: String(end) } } } : {}) });
    })),
    route('POST', '/crm/associations/2026-09/deals/companies/batch/read', async request => {
      const data = readData();
      return results((await idsIn(request)).flatMap(id => {
        const companies = data.dealCompanies[id] ?? data.cohort?.dealCompanies[id] ?? [];
        if (typeof companies === 'string') return [{ from: { id }, to: [{ toObjectId: Number(companies) }] }];
        const unlabeled = { category: 'HUBSPOT_DEFINED', typeId: 341, label: null };
        return companies.length === 0 ? [] : [{ from: { id }, to: companies.map(company => ({ toObjectId: Number(company.id),
          associationTypes: company.primary ? [{ category: 'HUBSPOT_DEFINED', typeId: 5, label: 'Primary' }, unlabeled] : [unlabeled] })) }];
      }));
    }),
    route('POST', '/crm/associations/2026-09/deals/contacts/batch/read', async request => {
      const data = readData();
      return results((await idsIn(request)).flatMap(id => {
        const contacts = data.dealContacts?.[id] ?? data.cohort?.dealContacts[id] ?? [];
        return contacts.length === 0 ? [] : [{ from: { id }, to: contacts.map(contact => ({ toObjectId: Number(contact) })) }];
      }));
    }),
    ...OBJECTS.map(object => route('POST', `/crm/objects/2026-09/${object}/batch/read`, async request => {
      const data = readData();
      const body = batchSchema.parse(await request.json());
      if (body.propertiesWithHistory?.length && body.inputs.length > 50) {
        return Response.json({ status: 'error', category: 'VALIDATION_ERROR',
          message: 'The maximum number of inputs supported in a batch request for property histories is 50. Please reduce the number of items and try again.' }, { status: 400 });
      }
      const ids = new Set(body.inputs.map(input => input.id));
      const records = [...data[object], ...data.cohort?.[object] ?? []].filter(record => ids.has(record.id));
      if (object !== 'deals' || !body.propertiesWithHistory?.includes('dealstage')) return results(records);
      return results(records.map(record => ({ ...record,
        propertiesWithHistory: { dealstage: data.dealStageHistory?.[record.id] ?? [] } })));
    })),
    route('GET', '/crm/pipelines/2026-09/deals', () => results(readData().pipelines)),
    route('GET', '/crm/owners/2026-09', () => results(readData().owners)),
  ];
}
