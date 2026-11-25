import { attio } from '../catalogue/attio.js';
import type { Route } from '../testing.js';
import type { AttioMember, AttioNote, AttioRecord, AttioWorkspace } from './attio.js';

export type FakeAttioWorkspace = Omit<AttioWorkspace, 'scope'> & {
  records: Readonly<Record<string, readonly AttioRecord[]>>; notes: readonly AttioNote[]; members: readonly AttioMember[];
};

const BASE = attio.http.baseUrl;
const QUERY = new RegExp(`^${BASE.replaceAll('.', '\\.')}/objects/([^/]+)/records/query$`, 'u');

/**
 * Attio for one token at a time: `workspace(token)` is what it reads, null a token Attio does not know (`/self` answers
 * `{ active: false }`, every other call 401). Records answer oldest first by offset, filtered by `created_at.$gt`.
 */
export function fakeAttio(data: { workspace: (token: string) => FakeAttioWorkspace | null }): Route[] {
  const read = (request: Request) => data.workspace((request.headers.get('authorization') ?? '').replace(/^Bearer /u, ''));
  const refused = () => Response.json({ status_code: 401, type: 'auth_error', code: 'unauthorized',
    message: 'The API Key provided could not be found.' }, { status: 401 });
  const page = (items: readonly unknown[], offset: number, limit: number) => Response.json({ data: items.slice(offset, offset + limit) });
  return [
    { method: 'GET', url: `${BASE}/self`, respond(request) {
      const workspace = read(request);
      if (!workspace) return Response.json({ active: false });
      const { workspace_id, workspace_name, workspace_slug } = workspace;
      return Response.json({ active: true, scope: 'object_configuration:read record_permission:read note:read user_management:read',
        token_type: 'Bearer', token_level: 'workspace', workspace_id, workspace_name, workspace_slug });
    } },
    { method: 'POST', url: QUERY, async respond(request) {
      const workspace = read(request);
      if (!workspace) return refused();
      const object = decodeURIComponent(QUERY.exec(request.url)?.[1] ?? '');
      const records = workspace.records[object];
      if (!records) return Response.json({ status_code: 404, type: 'invalid_request_error', code: 'not_found',
        message: 'The referenced object was not found.' }, { status: 404 });
      const body = await request.json() as { filter?: { created_at?: { $gt?: string } }; limit?: number; offset?: number };
      const after = body.filter?.created_at?.$gt;
      const listed = records.filter(record => after === undefined || Date.parse(record.created_at) > Date.parse(after))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      return page(listed, body.offset ?? 0, body.limit ?? 500);
    } },
    { method: 'GET', url: `${BASE}/notes`, respond(request) {
      const workspace = read(request);
      if (!workspace) return refused();
      const query = new URL(request.url).searchParams;
      return page(workspace.notes, Number(query.get('offset') ?? '0'), Number(query.get('limit') ?? '10'));
    } },
    { method: 'GET', url: `${BASE}/workspace_members`, respond(request) {
      const workspace = read(request);
      return workspace ? Response.json({ data: workspace.members }) : refused();
    } },
  ];
}
