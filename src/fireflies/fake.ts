import { z } from 'zod';
import { fireflies } from '../providers.js';
import type { Route } from '../testing.js';
import type { FirefliesUser } from './fireflies.js';

const requestSchema = z.object({ query: z.string(), variables: z.record(z.string(), z.unknown()) });

/** Each key sees one account's recordings; the fake speaks the same GraphQL operations as the client. */
export function fakeFireflies(data: {
  account: (apiKey: string) => { user: FirefliesUser; transcripts: readonly Record<string, unknown>[] } | null;
}): Route[] {
  return [{ method: 'POST', url: fireflies.baseUrl ?? '', async respond(request) {
    const account = data.account((request.headers.get('authorization') ?? '').replace(/^Bearer /u, ''));
    if (account === null) return Response.json({ errors: [{ code: 'auth_failed' }] }, { status: 500 });
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ errors: [{ code: 'invalid_arguments' }] }, { status: 400 });
    const { query, variables: v } = parsed.data;
    if (/\bFirefliesUser\b/u.test(query)) return Response.json({ data: { user: {
      user_id: account.user.userId, email: account.user.email, name: account.user.name,
    } } });
    if (/\bFirefliesCall\b/u.test(query)) return Response.json({ data: {
      transcript: account.transcripts.find(t => t.id === v.id) ?? null,
    } });
    if (/\bFirefliesCallList\b|\bFirefliesKeywordSearch\b/u.test(query)) {
      if (v.userId !== account.user.userId) return Response.json({ errors: [{ code: 'not_in_team' }] }, { status: 403 });
      const keyword = typeof v.keyword === 'string' ? v.keyword.toLowerCase() : null;
      const matching = account.transcripts.filter(t => {
        if (typeof v.fromDate === 'string' && !(Number(t.date) >= Date.parse(v.fromDate))) return false;
        if (typeof v.toDate === 'string' && !(Number(t.date) <= Date.parse(v.toDate))) return false;
        const lines = z.array(z.object({ text: z.string() })).safeParse(t.sentences);
        return keyword === null || [t.title, ...(lines.success ? lines.data.map(line => line.text) : [])]
          .some(text => typeof text === 'string' && text.toLowerCase().includes(keyword));
      });
      const skip = typeof v.skip === 'number' ? v.skip : 0;
      const limit = typeof v.limit === 'number' ? v.limit : 50;
      return Response.json({ data: { transcripts: matching.slice(skip, skip + limit).map(t => ({
        id: t.id, title: t.title, date: t.date, duration: t.duration, meeting_link: t.meeting_link,
        calendar_id: t.calendar_id, cal_id: t.cal_id, is_live: t.is_live, meeting_info: t.meeting_info,
      })) } });
    }
    return Response.json({ errors: [{ code: 'unknown_operation' }] }, { status: 400 });
  } }];
}
