import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '../catalogue.js';
import { slack } from '../catalogue/slack.js';
import { GrantRevoked } from '../errors.js';
import { startConnect } from '../connect.js';
import { revokeGrant } from '../oauth.js';
import { fakeFetch } from '../testing.js';
import { fakeSlack } from './fake.js';
import { slackClient } from './slack.js';

const data = { redirectUri: 'https://app.test/api/integrations/slack/callback', team: { id: 'T1', name: 'Acme' }, botUserId: 'U1', channels: [
  { id: 'C1', name: 'general', isPrivate: false }, { id: 'G1', name: 'deals', isPrivate: true },
], deniedChannels: ['C0GONE'] };
afterEach(() => vi.useRealTimers());

describe('Slack client', () => {
  it('round-trips every method through its fake', async () => {
    const http = fakeFetch(fakeSlack(data));
    const client = slackClient({ token: 'xoxb-fixture', fetch: http.fetch });
    expect(await client.channels()).toEqual({ items: [data.channels[1], data.channels[0]], skipped: [], channelsCut: false });
    expect((await client.postMessage({ channel: 'C1', text: 'hi' })).ts).toMatch(/^\d+\.000100$/u);
    await expect(revokeGrant(slack, { accessToken: 'xoxb-fixture', fetch: http.fetch, values: { domain: 'slack.com' } })).resolves.toBeUndefined();
    await expect(client.postMessage({ channel: 'C0GONE', text: 'hi' }))
      .rejects.toMatchObject({ code: 'request_failed', status: 200, detail: 'channel_not_found' });
  });

  it('posts JSON once with the bot token and without a retry', async () => {
    const http = fakeFetch([{ method: 'POST', url: 'https://slack.com/api/chat.postMessage',
      respond: () => Response.json({ ok: true, ts: '1.2' }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi',
      unfurl_links: false, unfurl_media: false })).resolves.toEqual({ ts: '1.2' });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer xoxb-1',
      'content-type': 'application/json; charset=utf-8' } });
    expect(JSON.parse(http.calls[0]?.body ?? '')).toEqual({ channel: 'C1', text: 'hi', unfurl_links: false, unfurl_media: false });
  });

  it.each(['channel_not_found', 'token_expired', 'internal_error'])('keeps Slack HTTP-200 error %s', async error => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json({ ok: false, error }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' }))
      .rejects.toMatchObject({ detail: error, status: 200 });
    expect(http.calls).toHaveLength(1);
  });

  it('a 429 returns at once', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const http = fakeFetch([{ url: /^https:\/\/slack\.com\/api\//u,
      respond: () => new Response('limited', { status: 429, headers: { 'Retry-After': '30' } }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' }))
      .rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(http.calls).toHaveLength(1);
    expect(Date.now()).toBe(started);
  });

  it.each([{}, { ok: true }, { ok: true, ts: 1 }])('rejects malformed post success %j', async body => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json(body) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reads a 200 whose ok is not the boolean false by its data', async () => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json({ ok: 'true', ts: '1' }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' })).resolves.toEqual({ ts: '1' });
  });

  it.each(['a secret-bearing body', 'xoxb_token', 'x'.repeat(65)])('never exposes unsafe error detail %s', async error => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json({ ok: false, error }) }]);
    await expect(slackClient({ token: 'xoxb_token', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' }))
      .rejects.toMatchObject({ detail: null });
  });

  it.each([false, true])('lists five pages and reports whether more remain: %s', async more => {
    let page = 0;
    const http = fakeFetch([{ url: 'https://slack.com/api/conversations.list', respond: () => {
      page++;
      return Response.json({ ok: true, channels: [{ id: `C${String(page)}`, name: `name${String(6 - page)}` }],
        response_metadata: { next_cursor: page === 5 && !more ? '' : `c${String(page)}` } });
    } }]);
    const channels = await slackClient({ token: 'xoxb-1', fetch: http.fetch }).channels();
    expect(channels.items.map(channel => channel.name)).toEqual(['name1', 'name2', 'name3', 'name4', 'name5']);
    expect(channels.channelsCut).toBe(more);
    expect(http.calls).toHaveLength(5);
    expect(http.calls[0]?.url).toBe('https://slack.com/api/conversations.list?types=public_channel%2Cprivate_channel&exclude_archived=true&limit=200');
    expect(new URL(http.calls[1]?.url ?? '').searchParams.get('cursor')).toBe('c1');
  });

  it('skips malformed channel entries and stops at missing metadata', async () => {
    const http = fakeFetch([{ url: 'https://slack.com/api/conversations.list', respond: () => Response.json({ ok: true,
      channels: [{ id: 'C1', name: 'general' }, { id: 'bad' }, { id: 'G1', name: 'private', is_private: true }] }) }]);
    expect(await slackClient({ token: 'xoxb-1', fetch: http.fetch }).channels()).toEqual({ items: [
      { id: 'C1', name: 'general', isPrivate: false }, { id: 'G1', name: 'private', isPrivate: true },
    ], skipped: ['bad'], channelsCut: false });
    expect(http.calls).toHaveLength(1);
  });
});


describe('Slack review regressions', () => {
  it.each(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'])('token-gone %s is GrantRevoked with its saved code', async error => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json({ ok: false, error }) }]);
    const result = slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' });
    await expect(result).rejects.toBeInstanceOf(GrantRevoked);
    await expect(result).rejects.toMatchObject({ detail: error });
  });

  it('reads a refusal outside 2xx too: a 401 invalid_auth is GrantRevoked', async () => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage',
      respond: () => Response.json({ ok: false, error: 'invalid_auth' }, { status: 401 }) }]);
    const result = slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' });
    await expect(result).rejects.toBeInstanceOf(GrantRevoked);
    await expect(result).rejects.toMatchObject({ detail: 'invalid_auth' });
    expect(http.calls).toHaveLength(1);
  });

  it('sends no JSON Content-Type on GETs', async () => {
    const http = fakeFetch(fakeSlack(data));
    const client = slackClient({ token: 'xoxb-1', fetch: http.fetch });
    await client.channels();
    await revokeGrant(slack, { accessToken: 'xoxb-1', fetch: http.fetch, values: { domain: 'slack.com' } });
    expect(http.calls.map(call => call.headers['content-type'])).toEqual([undefined, undefined]);
  });

  it('refuses a repeated channel cursor', async () => {
    const http = fakeFetch([{ url: 'https://slack.com/api/conversations.list', respond: () => Response.json({ ok: true,
      channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: 'repeat' } }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).channels())
      .rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_repeated' });
    expect(http.calls).toHaveLength(2);
  });

  it.each([undefined, null, {}])('refuses a missing or malformed channel list %j', async channels => {
    const http = fakeFetch([{ url: 'https://slack.com/api/conversations.list', respond: () => Response.json({ ok: true, channels }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).channels()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('Slack instance', () => {
  const start = { clientId: 'id', redirectUri: data.redirectUri, state: 's' };
  it.each([[undefined, 'https://slack.com/oauth/v2/authorize'], ['slack-gov.com', 'https://slack-gov.com/oauth/v2/authorize']])(
    'signs in on %s: slack.com when no domain is given, kept in the values', async (domain, authorize) => {
      const started = await startConnect(slack, domain === undefined ? start : { ...start, values: { domain } });
      expect([started.url.split('?')[0], started.values]).toEqual([authorize, { domain: domain ?? 'slack.com' }]);
    });

  it('sends a GovSlack connection to slack-gov.com, and a kept connection with no domain nowhere', async () => {
    const http = fakeFetch([{ url: 'https://slack-gov.com/api/auth.revoke', respond: () => Response.json({ ok: true }) }]);
    await revokeGrant(slack, { accessToken: 'a', fetch: http.fetch, values: { domain: 'slack-gov.com' } });
    const kept: Entry = slack; // a connection stored before the domain
    await expect(revokeGrant(kept, { accessToken: 'a', fetch: http.fetch })).rejects.toThrow('template_missing: slack {domain}');
    await expect(startConnect(slack, { ...start, values: { domain: 'evil.test' } })).rejects.toThrow(TypeError);
    expect(http.calls.map(call => call.url)).toEqual(['https://slack-gov.com/api/auth.revoke']);
  });
});
