import { z } from 'zod';
import { slack } from '../providers.js';
import type { Route } from '../testing.js';
import type { SlackChannel } from './slack.js';

const messageSchema = z.object({ channel: z.string(), text: z.string() });

export function fakeSlack(data: { redirectUri: string; team: { id: string; name: string }; botUserId: string | null;
  channels: readonly SlackChannel[]; deniedChannels?: readonly string[] }): Route[] {
  const registered = new URL(data.redirectUri);
  if (!['https:', 'http:'].includes(registered.protocol) || registered.username || registered.password || registered.hash) {
    throw new TypeError('fake_redirect_uri_invalid');
  }
  const codes = new Map<string, string>();
  let nextCode = 0;
  return [
    { method: 'GET', url: 'https://slack.com/oauth/v2/authorize', respond(request) {
      const params = new URL(request.url).searchParams;
      const clientId = params.get('client_id');
      if (params.get('redirect_uri') !== data.redirectUri || !clientId || !params.get('state')?.trim()) {
        return new Response(null, { status: 400 });
      }
      const code = `fixture-code-${String(++nextCode)}`;
      codes.set(code, clientId);
      const back = new URL(data.redirectUri);
      back.searchParams.set('state', params.get('state') ?? '');
      back.searchParams.set('code', code);
      return Response.redirect(back, 302);
    } },
    { method: 'POST', url: `${slack.baseUrl ?? ''}/oauth.v2.access`, async respond(request) {
      const params = new URLSearchParams(await request.text());
      // Refresh grants stay unbound so fixture connections survive a dev-server restart.
      if (params.get('grant_type') !== 'refresh_token') {
        if (params.get('redirect_uri') !== data.redirectUri) return Response.json({ ok: false, error: 'bad_redirect_uri' });
        const code = params.get('code') ?? '';
        const clientId = codes.get(code);
        if (!clientId) return Response.json({ ok: false, error: 'invalid_code' });
        if (params.get('client_id') !== clientId) return Response.json({ ok: false, error: 'invalid_client_id' });
        codes.delete(code);
      }
      return Response.json({ ok: true, token_type: 'bot', access_token: `xoxe.xoxb-fixture-${String(Date.now())}`,
        refresh_token: `xoxe-1-fixture-${String(Date.now())}`, expires_in: 43_200, team: data.team, bot_user_id: data.botUserId });
    } },
    { method: 'GET', url: `${slack.baseUrl ?? ''}/conversations.list`, respond(request) {
      const params = new URL(request.url).searchParams;
      const offset = Number(params.get('cursor') ?? 0);
      const limit = Number(params.get('limit') ?? 200);
      const items = data.channels.slice(offset, offset + limit);
      return Response.json({ ok: true, channels: items.map(channel => ({ id: channel.id, name: channel.name,
        is_private: channel.isPrivate })), response_metadata: { next_cursor: offset + limit < data.channels.length ? String(offset + limit) : '' } });
    } },
    { method: 'POST', url: `${slack.baseUrl ?? ''}/chat.postMessage`, async respond(request) {
      const { channel } = messageSchema.parse(await request.json());
      return data.deniedChannels?.includes(channel)
        ? Response.json({ ok: false, error: 'channel_not_found' })
        : Response.json({ ok: true, channel, ts: `${String(Math.floor(Date.now() / 1000))}.000100` });
    } },
    { method: 'GET', url: `${slack.baseUrl ?? ''}/auth.revoke`, respond: () => Response.json({ ok: true, revoked: true }) },
  ];
}
