import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubspot } from '../catalogue/hubspot.js';
import { finishConnect, startConnect } from '../connect.js';
import { GrantRevoked, ProviderHttpError } from '../errors.js';
import { refreshGrant, type Grant } from '../oauth.js';
import { fakeFetch, respondFrom, type Route } from '../testing.js';
import { fakeHubSpot } from './fake.js';
import * as hubspotModule from './hubspot.js';
import { hubspotConnect } from './hubspot.js';

const callback = 'https://app.test/api/integrations/hubspot/callback';
const start = { clientId: 'client', redirectUri: callback, state: 'state +&/?=' };
const client = { clientId: 'client', clientSecret: 'fixture-client-secret' };
const portal = { client, redirectUri: callback, hubId: 42, companies: [], contacts: [], deals: [], dealCompanies: {}, pipelines: [], owners: [] };
const tokenUrl = 'https://api.hubapi.com/oauth/2026-03/token';
const revokeUrl = `${tokenUrl}/revoke`;
const accountUrl = 'https://api.hubapi.com/account-info/2026-09/details';

async function authorize(http: ReturnType<typeof fakeFetch>): Promise<string> {
  const begun = await startConnect(hubspotConnect, start);
  if (begun.kind !== 'redirect') throw new Error('expected_redirect');
  const response = await http.fetch(begun.url, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const back = new URL(response.headers.get('location') ?? '');
  expect(back.origin + back.pathname).toBe(callback);
  expect(back.searchParams.get('state')).toBe(start.state);
  const code = back.searchParams.get('code');
  if (!code) throw new Error('expected_code');
  return code;
}

const finish = (http: ReturnType<typeof fakeFetch>, code: string, onRevokeFailed = vi.fn()) =>
  finishConnect(hubspotConnect, { client, code, redirectUri: callback, fetch: http.fetch, onRevokeFailed });

function withTokenAnswer(routes: Route[], change: (body: Record<string, unknown>) => void): Route[] {
  const respond = respondFrom(routes);
  return [{ url: tokenUrl, method: 'POST', async respond(request) {
    const response = await respond(request);
    if (!response) throw new Error('expected_token_route');
    const body = await response.json() as Record<string, unknown>;
    change(body);
    return Response.json(body, { status: response.status });
  } }, ...routes];
}

afterEach(() => vi.useRealTimers());

describe('HubSpot connect composition', () => {
  it('exposes the shared OAuth entry with the exact read scopes and no standalone identity helper', async () => {
    expect(hubspotConnect.kind).toBe('oauth2');
    expect(hubspotConnect.provider).toBe(hubspot);
    expect(hubspotModule).toHaveProperty('HUBSPOT_SCOPES', hubspotConnect.scopes);
    expect(hubspotConnect).toHaveProperty('reusesGrant', true);
    expect(hubspotConnect.scopes).toEqual(['oauth', 'crm.objects.companies.read', 'crm.objects.contacts.read',
      'crm.objects.deals.read', 'crm.objects.owners.read']);
    expect(hubspotModule).not.toHaveProperty('identify');
    expect(hubspotModule).not.toHaveProperty('portalOf');
    const begun = await startConnect(hubspotConnect, start);
    expect(begun).toEqual({ kind: 'redirect', url: 'https://app.hubspot.com/oauth/authorize?client_id=client&scope=oauth+crm.objects.companies.read+crm.objects.contacts.read+crm.objects.deals.read+crm.objects.owners.read&redirect_uri=https%3A%2F%2Fapp.test%2Fapi%2Fintegrations%2Fhubspot%2Fcallback&state=state+%2B%26%2F%3F%3D' });
  });

  it('starts, authorizes and finishes with the unchanged Grant and Portal label', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    let issued: Record<string, unknown> = {};
    const http = fakeFetch(withTokenAnswer(fakeHubSpot(portal), body => { issued = body; }));
    const code = await authorize(http);
    const onRevokeFailed = vi.fn();
    const result = await finish(http, code, onRevokeFailed);
    expect(issued.access_token).toMatch(/^fixture-access-/u);
    expect(issued.refresh_token).toMatch(/^fixture-refresh-/u);
    expect(result).toEqual({
      secret: { accessToken: issued.access_token, refreshToken: issued.refresh_token, expiresAt: '2026-11-01T00:30:00.000Z' },
      account: { id: '42', name: 'Portal 42' }, details: { portalId: '42' },
    });
    expect(http.calls.map(call => call.url.split('?')[0])).toEqual(['https://app.hubspot.com/oauth/authorize', tokenUrl]);
    expect(Object.fromEntries(new URLSearchParams(http.calls[1]?.body))).toEqual({ client_id: client.clientId,
      client_secret: client.clientSecret, grant_type: 'authorization_code', code, redirect_uri: callback });
    expect(onRevokeFailed).not.toHaveBeenCalled();
  });

  it.each(['number', 'string', 'fallback'] as const)('identifies the portal through %s', async source => {
    const http = fakeFetch(withTokenAnswer(fakeHubSpot(portal), body => {
      if (source === 'fallback') delete body.hub_id;
      else body.hub_id = source === 'number' ? 43 : '43';
    }));
    const result = await finish(http, await authorize(http));
    const id = source === 'fallback' ? '42' : '43';
    expect(result.account).toEqual({ id, name: `Portal ${id}` });
    expect(result.details).toEqual({ portalId: id });
    expect(http.calls.filter(call => call.url === accountUrl)).toHaveLength(source === 'fallback' ? 1 : 0);
    if (source === 'fallback') expect(http.calls.at(-1)?.headers.authorization).toBe(`Bearer ${result.secret.accessToken}`);
  });

  it.each(['extras-zero', 'account-zero', 'account-unavailable'] as const)
  ('retains the issued refresh grant when identity fails (%s)', async failure => {
    let issued: Record<string, unknown> = {};
    const http = fakeFetch(withTokenAnswer([
      ...(failure === 'account-unavailable' ? [{ url: accountUrl, respond: () => Response.json({ private: 'fixture-provider-secret' }, { status: 503 }) }] : []),
      ...fakeHubSpot({ ...portal, hubId: 0 }),
    ], body => {
      issued = body;
      if (failure !== 'extras-zero') delete body.hub_id;
    }));
    const onRevokeFailed = vi.fn();
    await expect(finish(http, await authorize(http), onRevokeFailed)).rejects.toEqual(
      new ProviderHttpError(failure === 'account-unavailable' ? 'unavailable' : 'invalid_response', failure === 'account-unavailable' ? 503 : null));
    expect(http.calls.filter(call => call.url === accountUrl)).toHaveLength(failure === 'extras-zero' ? 0 : 1);
    expect(http.calls.some(call => call.url === revokeUrl)).toBe(false);
    const refreshToken = issued.refresh_token;
    if (typeof refreshToken !== 'string') throw new Error('expected_refresh_token');
    expect(onRevokeFailed).not.toHaveBeenCalled();
    await expect(refreshGrant(hubspot, client, refreshToken, { fetch: http.fetch })).resolves.toMatchObject({ refreshToken });
  });

  it.each(['unavailable', 'network', 'rejected'] as const)
  ('keeps explicit revoke failures sanitized (%s)', async failure => {
    const http = fakeFetch([{ url: revokeUrl, method: 'POST', respond() {
      if (failure === 'network') throw new Error(`fixture-network-${client.clientSecret}`);
      return Response.json({ error: client.clientSecret }, { status: failure === 'unavailable' ? 503 : 401 });
    } }]);
    const grant: Grant = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: null };
    const error = await hubspotConnect.revoke({ grant, client, fetch: http.fetch }).catch((error: unknown) => error);
    expect(error).toEqual(new ProviderHttpError(failure === 'rejected' ? 'request_failed' : 'unavailable',
      failure === 'network' ? null : failure === 'unavailable' ? 503 : 401));
    expect(JSON.stringify(error)).not.toContain(client.clientSecret);
    expect(Object.fromEntries(new URLSearchParams(http.calls[0]?.body))).toEqual({ token: 'fixture-refresh',
      client_id: client.clientId, client_secret: client.clientSecret });
  });

  it('does nothing on revoke without a refresh token', async () => {
    const http = fakeFetch([]);
    const grant: Grant = { accessToken: 'fixture-access', refreshToken: null, expiresAt: null };
    await hubspotConnect.revoke({ grant, client, fetch: http.fetch });
    expect(http.calls).toHaveLength(0);
  });

  it('keeps a failed identity without attempting to revoke an access-only grant', async () => {
    const http = fakeFetch(withTokenAnswer(fakeHubSpot({ ...portal, hubId: 0 }), body => { delete body.refresh_token; }));
    const onRevokeFailed = vi.fn();
    await expect(finish(http, await authorize(http), onRevokeFailed)).rejects.toEqual(new ProviderHttpError('invalid_response', null));
    expect(http.calls.some(call => call.url === revokeUrl)).toBe(false);
    expect(onRevokeFailed).not.toHaveBeenCalled();
  });

  it('binds a one-use code to its client and exact callback', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const code = await authorize(http);
    const onRevokeFailed = vi.fn();
    await expect(finishConnect(hubspotConnect, { client: { ...client, clientId: 'wrong-client' },
      redirectUri: callback, code, fetch: http.fetch, onRevokeFailed }))
      .rejects.toEqual(new ProviderHttpError('request_failed', 401, 'invalid_client'));
    await expect(finishConnect(hubspotConnect, { client, redirectUri: `${callback}?changed=1`, code,
      fetch: http.fetch, onRevokeFailed })).rejects.toBeInstanceOf(GrantRevoked);
    await finish(http, code);
    await expect(finish(http, code)).rejects.toBeInstanceOf(GrantRevoked);
    expect(http.calls.some(call => call.url === revokeUrl)).toBe(false);
    expect(onRevokeFailed).not.toHaveBeenCalled();
  });

  it.each(['exchange', 'refresh', 'revoke'] as const)('authenticates %s before consuming a code or changing a grant', async endpoint => {
    const http = fakeFetch(fakeHubSpot(portal));
    const code = await authorize(http);
    const active = await finish(http, await authorize(http));
    if (!active.secret.refreshToken) throw new Error('expected_refresh_token');
    for (const field of ['client_id', 'client_secret']) {
      for (const value of [undefined, '', 'wrong']) {
        const form = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret,
          ...(endpoint === 'revoke' ? { token: active.secret.refreshToken }
            : endpoint === 'refresh' ? { grant_type: 'refresh_token', refresh_token: active.secret.refreshToken }
              : { grant_type: 'authorization_code', code, redirect_uri: callback }),
        });
        if (value === undefined) form.delete(field);
        else form.set(field, value);
        const response = await http.fetch(endpoint === 'revoke' ? revokeUrl : tokenUrl, { method: 'POST', body: form });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'invalid_client' });
      }
    }
    expect((await finish(http, code)).account.id).toBe('42');
    await expect(refreshGrant(hubspot, client, active.secret.refreshToken, { fetch: http.fetch }))
      .resolves.toMatchObject({ refreshToken: active.secret.refreshToken });
  });

  it('rejects a wrong grant type without spending an otherwise valid code', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const code = await authorize(http);
    const response = await http.fetch(tokenUrl, { method: 'POST', body: new URLSearchParams({
      grant_type: 'password', code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: callback,
    }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unsupported_grant_type' });
    expect((await finish(http, code)).account.id).toBe('42');
  });

  it('refreshes, rejects access-token revocation, and idempotently revokes only the issued refresh grant', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const first = await finish(http, await authorize(http));
    const second = await finish(http, await authorize(http));
    const refreshToken = first.secret.refreshToken;
    if (!refreshToken || !second.secret.refreshToken) throw new Error('expected_refresh_token');
    const renewed = await refreshGrant(hubspot, client, refreshToken, { fetch: http.fetch });
    expect(renewed.refreshToken).toBe(refreshToken);
    expect(renewed.accessToken).not.toBe(first.secret.accessToken);
    for (const token of [first.secret.accessToken, renewed.accessToken, 'unknown-refresh']) {
      const response = await http.fetch(revokeUrl, { method: 'POST', body: new URLSearchParams({ token, client_id: client.clientId, client_secret: client.clientSecret }) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_token' });
    }
    await hubspotConnect.revoke({ grant: first.secret, client, fetch: http.fetch });
    const repeated = await http.fetch(revokeUrl, { method: 'POST', body: new URLSearchParams({ token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }) });
    expect(repeated.status).toBe(200);
    await hubspotConnect.revoke({ grant: first.secret, client, fetch: http.fetch });
    await expect(refreshGrant(hubspot, client, refreshToken, { fetch: http.fetch })).rejects.toBeInstanceOf(GrantRevoked);
    await expect(refreshGrant(hubspot, client, second.secret.refreshToken, { fetch: http.fetch })).rejects.toBeInstanceOf(GrantRevoked);
    expect(second.secret.refreshToken).toBe(refreshToken);
    const third = await finish(http, await authorize(http));
    expect(third.secret.refreshToken).not.toBe(refreshToken);
  });

  it('reuses a resumed persisted portal grant on consent', async () => {
    const original = fakeFetch(fakeHubSpot(portal));
    const saved = await finish(original, await authorize(original));
    if (!saved.secret.refreshToken) throw new Error('expected_refresh_token');
    const http = fakeFetch(fakeHubSpot(portal));
    const resumed = await refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: http.fetch });
    const connected = await finish(http, await authorize(http));
    expect(connected.secret.refreshToken).toBe(resumed.refreshToken);
  });

  it('never promotes an issued access token to a refresh token', async () => {
    const http = fakeFetch(fakeHubSpot(portal));
    const connected = await finish(http, await authorize(http));
    await expect(refreshGrant(hubspot, client, connected.secret.accessToken, { fetch: http.fetch })).rejects.toBeInstanceOf(GrantRevoked);
    const response = await http.fetch(revokeUrl, { method: 'POST', body: new URLSearchParams({ token: connected.secret.accessToken, client_id: client.clientId, client_secret: client.clientSecret }) });
    expect(response.status).toBe(400);
  });

  it.each(['old', 'new'] as const)('shares a portal grant when authorization precedes resume after restart: revoke %s', async revoked => {
    const original = fakeFetch(fakeHubSpot(portal));
    const saved = await finish(original, await authorize(original));
    const restarted = fakeFetch(fakeHubSpot(portal));
    const connected = await finish(restarted, await authorize(restarted));
    if (!saved.secret.refreshToken || !connected.secret.refreshToken) throw new Error('expected_refresh_token');
    const resumed = await refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: restarted.fetch });
    const discarded = revoked === 'old' ? resumed : connected.secret;
    const retainedToken = revoked === 'old' ? connected.secret.refreshToken : saved.secret.refreshToken;
    await hubspotConnect.revoke({ grant: discarded, client, fetch: restarted.fetch });
    await expect(refreshGrant(hubspot, client, retainedToken, { fetch: restarted.fetch }))
      .rejects.toBeInstanceOf(GrantRevoked);
    if (!discarded.refreshToken) throw new Error('expected_refresh_token');
    await expect(refreshGrant(hubspot, client, discarded.refreshToken, { fetch: restarted.fetch })).rejects.toBeInstanceOf(GrantRevoked);
    expect(connected.secret.refreshToken).toBe(saved.secret.refreshToken);
    expect(connected.secret.accessToken).not.toBe(saved.secret.accessToken);
  });

  describe.each(['base', 'replacement', 'legacy'] as const)('persisted %s shared grant', savedKind => {
    it.each([
      ['consent-first', 'saved'], ['consent-first', 'new'],
      ['resume-first', 'saved'], ['resume-first', 'new'],
    ] as const)('%s, revoke %s holder and repeat after replacement', async (ordering, revoked) => {
      const original = fakeFetch(fakeHubSpot(portal));
      let saved: Grant;
      if (savedKind === 'legacy') saved = await refreshGrant(hubspot, client, 'fixture-refresh', { fetch: original.fetch });
      else {
        saved = (await finish(original, await authorize(original))).secret;
        if (savedKind === 'replacement') {
          await hubspotConnect.revoke({ grant: saved, client, fetch: original.fetch });
          saved = (await finish(original, await authorize(original))).secret;
        }
      }
      if (!saved.refreshToken) throw new Error('expected_refresh_token');
      const http = fakeFetch(fakeHubSpot(portal));
      let connected: Awaited<ReturnType<typeof finish>>;
      let resumed: Grant;
      if (ordering === 'consent-first') {
        connected = await finish(http, await authorize(http));
        resumed = await refreshGrant(hubspot, client, saved.refreshToken, { fetch: http.fetch });
      } else {
        resumed = await refreshGrant(hubspot, client, saved.refreshToken, { fetch: http.fetch });
        expect(resumed.refreshToken).toBe(saved.refreshToken);
        connected = await finish(http, await authorize(http));
      }
      const nextConsent = await finish(http, await authorize(http));
      expect(nextConsent.secret.refreshToken).toBe(connected.secret.refreshToken);
      expect(resumed.refreshToken).toBe(connected.secret.refreshToken);
      const discarded = revoked === 'saved' ? saved : connected.secret;
      await hubspotConnect.revoke({ grant: discarded, client, fetch: http.fetch });
      const holders = new Set([saved.refreshToken, connected.secret.refreshToken, resumed.refreshToken]);
      for (const token of holders) {
        if (!token) throw new Error('expected_refresh_token');
        await expect(refreshGrant(hubspot, client, token, { fetch: http.fetch })).rejects.toBeInstanceOf(GrantRevoked);
      }
      const replacement = await finish(http, await authorize(http));
      expect(holders.has(replacement.secret.refreshToken)).toBe(false);
      // Repeating revoke for any old alias must not end the new grant or revive an old holder.
      for (const token of holders) {
        if (!token) throw new Error('expected_refresh_token');
        await hubspotConnect.revoke({ grant: { ...saved, refreshToken: token }, client, fetch: http.fetch });
        await expect(refreshGrant(hubspot, client, token, { fetch: http.fetch })).rejects.toBeInstanceOf(GrantRevoked);
      }
      if (!replacement.secret.refreshToken) throw new Error('expected_refresh_token');
      await expect(refreshGrant(hubspot, client, replacement.secret.refreshToken, { fetch: http.fetch }))
        .resolves.toMatchObject({ refreshToken: replacement.secret.refreshToken });
      expect((await finish(http, await authorize(http))).secret.refreshToken).toBe(replacement.secret.refreshToken);
    });
  });

  it('keeps an unresumed persisted grant live after a new identity fails on the restarted fake', async () => {
    const original = fakeFetch(fakeHubSpot(portal));
    const saved = await finish(original, await authorize(original));
    let failedRefreshToken: unknown;
    const restarted = fakeFetch(withTokenAnswer(fakeHubSpot(portal), body => { failedRefreshToken = body.refresh_token; body.hub_id = 0; }));
    const onRevokeFailed = vi.fn();
    await expect(finish(restarted, await authorize(restarted), onRevokeFailed)).rejects.toEqual(new ProviderHttpError('invalid_response', null));
    if (typeof failedRefreshToken !== 'string' || !saved.secret.refreshToken) throw new Error('expected_refresh_token');
    const failedToken = failedRefreshToken;
    expect(restarted.calls.some(call => call.url === revokeUrl)).toBe(false);
    expect(onRevokeFailed).not.toHaveBeenCalled();
    await expect(refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: restarted.fetch }))
      .resolves.toMatchObject({ refreshToken: saved.secret.refreshToken });
    await expect(refreshGrant(hubspot, client, failedToken, { fetch: restarted.fetch })).resolves.toMatchObject({ refreshToken: failedToken });
    expect(failedToken).toBe(saved.secret.refreshToken);
  });

  it('retains the live shared grant when absent hub_id fallback is unavailable', async () => {
    const routes = fakeHubSpot(portal);
    const original = fakeFetch(routes);
    const saved = await finish(original, await authorize(original));
    const http = fakeFetch(withTokenAnswer([
      { url: accountUrl, respond: () => Response.json({}, { status: 503 }) }, ...routes,
    ], body => { delete body.hub_id; }));
    await expect(finish(http, await authorize(http))).rejects.toEqual(new ProviderHttpError('unavailable', 503));
    expect(http.calls.some(call => call.url === revokeUrl)).toBe(false);
    if (!saved.secret.refreshToken) throw new Error('expected_refresh_token');
    await expect(refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: original.fetch }))
      .resolves.toMatchObject({ refreshToken: saved.secret.refreshToken });
  });

  it('refuses a code from the old instance after the restarted fake issues its own code', async () => {
    const original = fakeFetch(fakeHubSpot(portal));
    const oldCode = await authorize(original);
    const restarted = fakeFetch(fakeHubSpot(portal));
    const newCode = await authorize(restarted);
    await expect(finish(restarted, oldCode)).rejects.toBeInstanceOf(GrantRevoked);
    expect((await finish(restarted, newCode)).account).toEqual({ id: '42', name: 'Portal 42' });
    await expect(finish(restarted, newCode)).rejects.toBeInstanceOf(GrantRevoked);
    expect(newCode).not.toBe(oldCode);
  });

  it('requires resume before revocation on a restarted fake and forgets revocation on another restart', async () => {
    const original = fakeFetch(fakeHubSpot(portal));
    const saved = await finish(original, await authorize(original));
    if (!saved.secret.refreshToken) throw new Error('expected_refresh_token');
    const restarted = fakeFetch(fakeHubSpot(portal));
    await expect(hubspotConnect.revoke({ grant: saved.secret, client, fetch: restarted.fetch }))
      .rejects.toEqual(new ProviderHttpError('request_failed', 400, 'invalid_token'));
    const resumed = await refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: restarted.fetch });
    expect(resumed.refreshToken).toBe(saved.secret.refreshToken);
    await hubspotConnect.revoke({ grant: resumed, client, fetch: restarted.fetch });
    await expect(refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: restarted.fetch })).rejects.toBeInstanceOf(GrantRevoked);
    const anotherRestart = fakeFetch(fakeHubSpot(portal));
    await expect(refreshGrant(hubspot, client, saved.secret.refreshToken, { fetch: anotherRestart.fetch }))
      .resolves.toMatchObject({ refreshToken: saved.secret.refreshToken });
  });

});
