import { z } from 'zod';
import type { OAuthConnect } from '../connect.js';
import { GrantRevoked, ProviderHttpError } from '../errors.js';
import { createClient } from '../http.js';
import { paginate } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { slack } from '../catalogue/slack.js';
import { slack as slackDefinition } from '../providers.js';

export type SlackChannel = { id: string; name: string; isPrivate: boolean };
export type SlackMessage = { channel: string; text: string; blocks?: readonly Record<string, unknown>[];
  unfurl_links?: boolean; unfurl_media?: boolean };
export type SlackClient = {
  postMessage(message: SlackMessage): Promise<{ ts: string }>;
  channels(): Promise<{ items: SlackChannel[]; skipped: (string | null)[]; channelsCut: boolean }>;
  revoke(): Promise<void>;
};

// `ok` must be Slack's `true`: the entry marks only `ok: false` as failed.
const postedSchema = z.object({ ok: z.literal(true), ts: z.string() });
const channelSchema = z.object({ id: z.string(), name: z.string(), is_private: z.boolean().optional() });
const metadataSchema = z.object({ next_cursor: z.string() });
const channelsSchema = z.looseObject({ channels: z.array(z.unknown()) });
const teamSchema = z.object({ id: z.string().min(1) });

export const SLACK_SCOPES = slack.scopes.default;
export const slackConnect: OAuthConnect<{ botUserId: string | null }> = {
  kind: 'oauth2', provider: slackDefinition, scopes: SLACK_SCOPES, identify: input => Promise.resolve(identify(input)),
  revoke: input => slackClient({ token: input.grant.accessToken, fetch: input.fetch }).revoke(),
};

/** Slack supplies identity with the grant; no user token or webhook URL leaves this module. */
export function identify(input: { extras: Record<string, unknown> }): {
  account: { id: string; name: string }; details: { botUserId: string | null };
} {
  const team = teamSchema.safeParse(input.extras.team).data;
  if (!team) throw new ProviderHttpError('invalid_response', 200, 'missing_fields');
  const name = z.object({ name: z.string() }).safeParse(input.extras.team).data?.name;
  return { account: { id: team.id, name: name || team.id },
    details: { botUserId: typeof input.extras.bot_user_id === 'string' ? input.extras.bot_user_id : null } };
}

export function slackClient(input: { token: string; fetch: typeof fetch }): SlackClient {
  const http = createClient(slack, { token: () => Promise.resolve(input.token), fetch: input.fetch });
  const posts = createClient(slack, { token: () => Promise.resolve(input.token), fetch: input.fetch,
    headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  return {
    async postMessage(message) {
      const { ts } = parseAnswer(postedSchema, await posts.json('/chat.postMessage', { method: 'POST', json: message }));
      return { ts };
    },
    async channels() {
      const channels: SlackChannel[] = [];
      const skipped: (string | null)[] = [];
      let channelsCut = false;
      let count = 0;
      for await (const page of paginate(async cursor => {
        const body = parseAnswer(channelsSchema, await http.json('/conversations.list', { query: { types: 'public_channel,private_channel',
          exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) } }));
        const parsed = parseEntries(channelSchema, body.channels);
        return { items: parsed.items.map(channel => ({ id: channel.id, name: channel.name, isPrivate: channel.is_private === true })),
          skipped: parsed.skipped, cursor: metadataSchema.safeParse(body.response_metadata).data?.next_cursor || null };
      })) {
        channels.push(...page.items);
        skipped.push(...page.skipped);
        // Preserve the picker cap: at most five pages of 200 channels.
        if (++count === 5) {
          channelsCut = page.cursor !== null;
          break;
        }
      }
      return { items: channels.sort((a, b) => a.name.localeCompare(b.name)), skipped, channelsCut };
    },
    async revoke() {
      try { await http.json('/auth.revoke'); }
      catch (error) { if (!(error instanceof GrantRevoked)) throw error; }
    },
  };
}
