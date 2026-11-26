import { z } from 'zod';
import { createClient } from '../http.js';
import { nextCursor, walk } from '../paging.js';
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
const channelsSchema = z.object({ channels: z.array(z.unknown()) });

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
      for await (const body of walk(http, slack.http.baseUrl, slack.paging.cursor, '/conversations.list',
        { query: { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' } })) {
        const page = parseEntries(channelSchema, parseAnswer(channelsSchema, body).channels);
        channels.push(...page.items.map(channel => ({ id: channel.id, name: channel.name, isPrivate: channel.is_private === true })));
        skipped.push(...page.skipped);
        // Preserve the picker cap: at most five pages of 200 channels.
        if (++count === 5) {
          channelsCut = nextCursor(slack.paging.cursor, body) !== null;
          break;
        }
      }
      return { items: channels.sort((a, b) => a.name.localeCompare(b.name)), skipped, channelsCut };
    },
  };
}
