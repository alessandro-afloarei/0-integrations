import { expect, expectTypeOf, test } from 'vitest';
import { defineProvider } from './catalogue.js';
import type { Client } from './client.js';

// A fake provider, pure data: its client's types are inferred from this literal.
const acme = defineProvider({
  id: 'acme', name: 'Acme Tasks', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test/v1' },
  paging: { cursor: { kind: 'cursor', next: 'meta.next', send: { query: 'cursor' } } },
  operations: {
    'issues.list': {
      method: 'GET', path: '/teams/{teamId}/issues', paging: 'cursor', records: 'data.items',
      params: {
        teamId: { in: 'path', type: 'string', required: true },
        state: { in: 'query', type: 'string', enum: ['open', 'closed'] },
        limit: { in: 'query', type: 'integer' },
      },
      result: { data: { items: [{ id: 'string', title: 'string', 'labels?': ['string'] }] }, meta: { 'next?': 'string' } },
    },
    'issues.get': {
      path: '/issues/{id}', notFound: 'null', params: { id: { in: 'path', type: 'string', required: true } },
      result: { id: 'string', 'assignee?': 'string', raw: 'unknown' },
    },
    'issues.create': {
      method: 'POST', path: '/issues',
      params: {
        title: { in: 'body', type: 'string', required: true },
        labels: { in: 'body', type: ['string'] },
        estimate: { in: 'body', type: { points: 'integer', 'unit?': 'string' } },
        parent: { in: 'body', type: 'string', nullable: true },
      },
      result: { id: 'string', url: 'string' },
    },
    viewer: {
      kind: 'read', graphql: 'query Viewer($first: Int) { viewer { id name teams(first: $first) { nodes { id } } } }',
      params: { first: { in: 'variables', type: 'integer' } },
      result: { viewer: { id: 'string', name: 'string', teams: { nodes: [{ id: 'string' }] } } },
    },
  },
});

type Issue = { id: string; title: string; labels?: string[] };
declare const api: Client<typeof acme>;

// Never called: the types are the test.
function typed() {
  // `branded` compares a declared object's two halves (required and optional keys) as one type.
  expectTypeOf(api.issues.list({ teamId: 'T1', state: 'open' })).branded.toEqualTypeOf<AsyncGenerator<Issue, (string | null)[]>>();
  expectTypeOf(api.issues.get({ id: 'I1' }, { signal: AbortSignal.timeout(1000) }))
    .branded.toEqualTypeOf<Promise<{ id: string; assignee?: string; raw: unknown } | null>>();
  expectTypeOf(api.issues.create({ title: 'Ship', estimate: { points: 3 }, parent: null }))
    .branded.toEqualTypeOf<Promise<{ id: string; url: string }>>();
  expectTypeOf(api.viewer({ first: 5 })).branded.toEqualTypeOf<Promise<{ viewer: { id: string; name: string; teams: { nodes: { id: string }[] } } }>>();
  expectTypeOf(api.json('/self')).toEqualTypeOf<Promise<unknown>>();
  expectTypeOf<Parameters<typeof api.paginate>[0]>().toEqualTypeOf<'cursor'>();

  // @ts-expect-error teamId is a required path parameter
  void api.issues.list({ state: 'open' });
  // @ts-expect-error state is an enum
  void api.issues.list({ teamId: 'T1', state: 'merged' });
  // @ts-expect-error limit is an integer, not a string
  void api.issues.list({ teamId: 'T1', limit: '10' });
  // @ts-expect-error estimate.points is required inside the nested body
  void api.issues.create({ title: 'x', estimate: { unit: 'h' } });
  // @ts-expect-error title is not nullable
  void api.issues.create({ title: null });
  // An operation or a result field that is not declared is not there (asserted, since a read of it lints as unsafe).
  expectTypeOf(api.issues).not.toHaveProperty('delete');
  expectTypeOf<Awaited<ReturnType<typeof api.issues.create>>>().not.toHaveProperty('number');
  // @ts-expect-error a paging shape the entry does not declare
  void api.paginate('offset', '/issues');

  const base = { name: 'Bad', auth: [{ kind: 'key' }], http: { baseUrl: 'https://bad.test' } } as const;
  defineProvider({ ...base, id: 'bad', operations: {
    // @ts-expect-error {id} is in the path but not declared as a path parameter
    get: { path: '/things/{id}', params: { other: { in: 'query', type: 'string' } } },
  } });
  // The client's own calls cannot be an operation's first segment; a prefix can.
  defineProvider({ ...base, id: 'reserved', operations: {
    // @ts-expect-error json is the client's own call
    json: { path: '/json' },
    // @ts-expect-error request is the client's own call
    'request.create': { method: 'POST', path: '/requests' },
    // @ts-expect-error paginate is the client's own call
    'paginate.all': { path: '/all' },
  } });
  defineProvider({ ...base, id: 'prefixed', operations: {
    'requests.create': { method: 'POST', path: '/requests' }, 'pages.markdown': { path: '/pages' }, jsonish: { path: '/jsonish' },
  } });
}

test('defineProvider keeps an entry with operations', () => {
  expect(acme.id).toBe('acme');
  expect(typed).toBeTypeOf('function');
});
