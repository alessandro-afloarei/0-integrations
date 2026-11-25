import { aircall } from '../catalogue/aircall.js';
import type { Route } from '../testing.js';
import type { AircallCall, AircallUtterance } from './aircall.js';

/** A call and what its transcription answers: utterances, none yet (404), or a company without AI Assist (403). */
export type FakeAircallCall = AircallCall & { transcript: AircallUtterance[] | 'none' | 'ai_assist_required' };

const BASE = aircall.http.baseUrl;

/**
 * Aircall for one key at a time: `account('api_id:api_token')` is what it reads, null a key Aircall refuses. Calls answer
 * oldest first, from `from` (Unix seconds) on, `per_page` a page, with `meta.next_page_link` as Aircall builds it.
 */
export function fakeAircall(data: { account: (credentials: string) => { name: string; calls: readonly FakeAircallCall[] } | null }): Route[] {
  const read = (request: Request) => {
    const basic = (request.headers.get('authorization') ?? '').replace(/^Basic /u, '');
    return data.account(Buffer.from(basic, 'base64').toString('utf8'));
  };
  const refused = () => Response.json({ error: 'Unauthorized', troubleshoot: 'Check your API key' }, { status: 401 });
  return [
    { method: 'GET', url: `${BASE}/company`, respond(request) {
      const account = read(request);
      return account ? Response.json({ company: { name: account.name, users_count: 1, numbers_count: 1 } }) : refused();
    } },
    { method: 'GET', url: `${BASE}/calls`, respond(request) {
      const account = read(request);
      if (!account) return refused();
      const query = new URL(request.url).searchParams;
      const from = Number(query.get('from') ?? '0');
      const perPage = Number(query.get('per_page') ?? '20');
      const page = Number(query.get('page') ?? '1');
      const listed = account.calls.filter(call => call.started_at >= from).sort((a, b) => a.started_at - b.started_at);
      const next = page * perPage < listed.length
        ? `${BASE}/calls?order=asc&page=${String(page + 1)}&per_page=${String(perPage)}` : null;
      return Response.json({ meta: { count: Math.min(perPage, listed.length), total: listed.length, current_page: page,
        per_page: perPage, next_page_link: next, previous_page_link: null },
      calls: listed.slice((page - 1) * perPage, page * perPage).map(call => ({ ...call, transcript: undefined })) });
    } },
    { method: 'GET', url: /\/calls\/\d+\/transcription$/u, respond(request) {
      const account = read(request);
      if (!account) return refused();
      const id = Number(new URL(request.url).pathname.split('/').at(-2));
      const call = account.calls.find(item => item.id === id);
      if (call?.transcript === 'ai_assist_required') {
        return Response.json({ error: 'Forbidden', troubleshoot: 'company cannot access this feature' }, { status: 403 });
      }
      if (!call || call.transcript === 'none') return Response.json({ error: 'Not found', troubleshoot: 'Transcription not found.' }, { status: 404 });
      return Response.json({ transcription: { id, call_id: id, type: 'call', content: { language: 'en', utterances: call.transcript } } });
    } },
  ];
}
