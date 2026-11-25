import { expect, test } from 'vitest';
import { identifyAccount } from './account.js';
import { aircall } from './catalogue/aircall.js';
import { attio } from './catalogue/attio.js';
import { google } from './catalogue/google.js';
import { hubspot } from './catalogue/hubspot.js';
import { microsoft } from './catalogue/microsoft.js';
import { slack } from './catalogue/slack.js';
import { ProviderHttpError } from './errors.js';
import { fakeFetch } from './testing.js';

const json = (body: unknown, status = 200) => () => Response.json(body, { status });

test('HubSpot sends the account request only when the token answer has no hub_id, and refuses portal 0', async () => {
  const fake = fakeFetch([{ url: 'https://api.hubapi.com/account-info/2026-09/details', respond: json({ portalId: 42 }) }]);
  expect(await identifyAccount(hubspot, { fetch: fake.fetch, token: 't', tokenAnswer: { hub_id: 43 } }))
    .toEqual({ account: { id: '43', name: 'Portal 43' }, values: {} });
  expect(fake.calls).toHaveLength(0);
  expect((await identifyAccount(hubspot, { fetch: fake.fetch, token: 't', tokenAnswer: {} })).account).toEqual({ id: '42', name: 'Portal 42' });
  expect(fake.calls).toHaveLength(1);
  await expect(identifyAccount(hubspot, { fetch: fake.fetch, token: 't', tokenAnswer: { hub_id: 0 } }))
    .rejects.toEqual(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
});

test('Slack reads the token answer only, falls back to the id for a blank name, and saves the bot user', async () => {
  const fake = fakeFetch([]);
  expect(await identifyAccount(slack, { fetch: fake.fetch, token: 't', tokenAnswer: { team: { id: 'T1', name: '' }, bot_user_id: 'U1', authed_user: { access_token: 'x' } } }))
    .toEqual({ account: { id: 'T1', name: 'T1' }, values: { botUserId: 'U1' } });
  await expect(identifyAccount(slack, { fetch: fake.fetch, token: 't', tokenAnswer: { team: { id: '' } } }))
    .rejects.toEqual(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
});

test("Attio's 200 { active: false } and its 400 are a bad credential", async () => {
  const inactive = fakeFetch([{ url: 'https://api.attio.com/v2/self', respond: json({ active: false }) }]);
  await expect(identifyAccount(attio, { fetch: inactive.fetch, token: 't' })).rejects.toMatchObject({ code: 'rejected', status: 200, detail: 'token_inactive' });
  const short = fakeFetch([{ url: 'https://api.attio.com/v2/self', respond: json({}, 400) }]);
  await expect(identifyAccount(attio, { fetch: short.fetch, token: 't' })).rejects.toMatchObject({ code: 'rejected', status: 400, detail: null });
});

test("Aircall's id is its API ID, Google's address is lowercased", async () => {
  const company = fakeFetch([{ url: 'https://api.aircall.io/v1/company', respond: json({ company: { name: 'Lumen' } }) }]);
  expect((await identifyAccount(aircall, { fetch: company.fetch, token: 't', values: { apiId: '12' } })).account).toEqual({ id: '12', name: 'Lumen' });
  const profile = fakeFetch([{ url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', respond: json({ emailAddress: ' Ana@Lumen.TEST ' }) }]);
  expect((await identifyAccount(google, { fetch: profile.fetch, token: 't' })).account).toEqual({ id: 'ana@lumen.test', name: 'ana@lumen.test' });
});

test("Microsoft's account is the Graph id, named by the mail address, else the sign-in name", async () => {
  const url = 'https://graph.microsoft.com/v1.0/me'; // a string route matches the address without its query
  const mail = fakeFetch([{ url, respond: json({ id: '2b9db1d5-0981', mail: 'Lee@Lumen.test', userPrincipalName: 'x@lumen.test' }) }]);
  expect((await identifyAccount(microsoft, { fetch: mail.fetch, token: 't' })).account).toEqual({ id: '2b9db1d5-0981', name: 'lee@lumen.test' });
  expect(mail.calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/me?%24select=id%2Cmail%2CuserPrincipalName');
  const upn = fakeFetch([{ url, respond: json({ id: '2b9db1d5-0981', mail: null, userPrincipalName: 'Lee@Lumen.test' }) }]);
  expect((await identifyAccount(microsoft, { fetch: upn.fetch, token: 't' })).account?.name).toBe('lee@lumen.test');
});

test("a bare `id` path reads the answer (GitHub's), never the id being looked for", async () => {
  const { github } = await import('./catalogue/github.js');
  const fake = fakeFetch([{ url: 'https://api.github.com/user', respond: json({ id: 7, login: 'octocat' }) }]);
  expect((await identifyAccount(github, { fetch: fake.fetch, token: 't' })).account).toEqual({ id: '7', name: 'octocat' });
});

test('a credential check sends its request at once and returns no account', async () => {
  const { apollo } = await import('./catalogue/apollo.js');
  const fake = fakeFetch([{ url: 'https://api.apollo.io/api/v1/users/api_profile', respond: json({ id: 'u' }) }]);
  expect(await identifyAccount(apollo, { fetch: fake.fetch, token: 't' })).toEqual({ account: null, values: {} });
  expect(fake.calls).toHaveLength(1);
});
