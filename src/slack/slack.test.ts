import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrantRevoked, ProviderHttpError } from '../errors.js';
import { fakeFetch } from '../testing.js';
import { fakeSlack } from './fake.js';
import { identify, slackClient } from './slack.js';

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
    await expect(client.revoke()).resolves.toBeUndefined();
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

  it.each([{}, { ok: true }, { ok: true, ts: 1 }, { ok: 'true', ts: '1' }])('rejects malformed post success %j', async body => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json(body) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' }))
      .rejects.toMatchObject({ code: 'invalid_response' });
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

  it('identifies only the team and bot user', () => {
    expect(identify({ extras: { team: { id: 'T1', name: 'Acme' }, bot_user_id: 'U1', authed_user: { access_token: 'discard' } } }))
      .toEqual({ account: { id: 'T1', name: 'Acme' }, details: { botUserId: 'U1' } });
    expect(identify({ extras: { team: { id: 'T1', name: '' } } }))
      .toEqual({ account: { id: 'T1', name: 'T1' }, details: { botUserId: null } });
  });

  it.each([{}, { team: null }, { team: { name: 'Acme' } }, { team: { id: '' } }])('refuses missing team identity %j', extras => {
    expect(() => identify({ extras })).toThrow(new ProviderHttpError('invalid_response', 200, 'missing_fields'));
  });
});


describe('Slack review regressions', () => {
  it.each(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'])('token-gone %s is GrantRevoked with its saved code', async error => {
    const http = fakeFetch([{ url: 'https://slack.com/api/chat.postMessage', respond: () => Response.json({ ok: false, error }) }]);
    const result = slackClient({ token: 'xoxb-1', fetch: http.fetch }).postMessage({ channel: 'C1', text: 'hi' });
    await expect(result).rejects.toBeInstanceOf(GrantRevoked);
    await expect(result).rejects.toMatchObject({ detail: error });
  });

  it.each(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'])('revoking an already-gone token %s succeeds', async error => {
    const http = fakeFetch([{ url: 'https://slack.com/api/auth.revoke', respond: () => Response.json({ ok: false, error }) }]);
    await expect(slackClient({ token: 'xoxb-1', fetch: http.fetch }).revoke()).resolves.toBeUndefined();
  });

  it('sends no JSON Content-Type on GETs', async () => {
    const http = fakeFetch(fakeSlack(data));
    const client = slackClient({ token: 'xoxb-1', fetch: http.fetch });
    await client.channels();
    await client.revoke();
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
