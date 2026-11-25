import { z } from 'zod';
import { createClient } from '../http.js';
import { paginate } from '../paginate.js';
import { parseAnswer, parseEntries } from '../parse.js';
import { slack } from '../catalogue/slack.js';

export type SlackChannel = { id: string; name: string; isPrivate: boolean };
export type SlackMessage = { channel: string; text: string; blocks?: readonly Record<string, unknown>[];
  unfurl_links?: boolean; unfurl_media?: boolean };
export type SlackClient = {
  postMessage(message: SlackMessage): Promise<{ ts: string }>;
  channels(): Promise<{ items: SlackChannel[]; skipped: (string | null)[]; channelsCut: boolean }>;
};

const postedSchema = z.object({ ts: z.string() });
const channelSchema = z.object({ id: z.string(), name: z.string(), is_private: z.boolean().optional() });
const metadataSchema = z.object({ next_cursor: z.string() });
const channelsSchema = z.looseObject({ channels: z.array(z.unknown()) });

export function slackClient(input: { token: string; fetch: typeof fetch }): SlackClient {
  const http = createClient(slack, { token: () => Promise.resolve(input.token), fetch: input.fetch });
  const posts = createClient(slack, { token: () => Promise.resolve(input.token), fetch: input.fetch,
    headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  return {
    async postMessage(message) {
      return parseAnswer(postedSchema, await posts.json('/chat.postMessage', { method: 'POST', json: message }));
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
  };
}
