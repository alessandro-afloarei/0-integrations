import { expect, expectTypeOf, test } from 'vitest';
import { defineProvider, signInWith, type Entry } from './catalogue.js';
import { aircall } from './catalogue/aircall.js';
import { attio } from './catalogue/attio.js';
import { intercom } from './catalogue/intercom.js';
import { metabase } from './catalogue/metabase.js';
import { paypal } from './catalogue/paypal.js';
import { zoom } from './catalogue/zoom.js';
import { client, type Client, type ProviderResponse, type RequestOptions } from './client.js';
import { finishConnect } from './connect.js';

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
    // The records path reads `a.b` as one key before it reads `a` then `b`.
    'events.list': { path: '/events', paging: 'cursor', records: 'a.b',
      result: { 'a.b': [{ whole: 'string' }], a: { b: [{ split: 'string' }] } } },
    // Without `records`, a paged operation yields each page whole, as its `result` says.
    'pages.all': { path: '/pages', paging: 'cursor', result: { n: 'integer', 'next?': 'string' } },
    // A list at the answer's top level is the records themselves.
    'builds.list': { path: '/builds', paging: 'cursor', result: [{ id: 'string', 'number?': 'integer' }] },
    user: { path: '/user' },
    viewer: {
      kind: 'read', graphql: 'query Viewer($first: Int) { viewer { id name teams(first: $first) { nodes { id } } } }',
      params: { first: { in: 'variables', type: 'integer' } },
      result: { viewer: { id: 'string', name: 'string', teams: { nodes: [{ id: 'string' }] } } },
    },
  },
});

type Issue = { id: string; title: string; labels?: string[] };
type Yielded<G> = G extends AsyncGenerator<infer I, unknown> ? I : never;
declare const api: Client<typeof acme>;

// Never called: the types are the test. `branded` compares a shape's two halves (required and optional keys) as one type.
function typed() {
  expectTypeOf<Yielded<ReturnType<typeof api.issues.list>>>().branded.toEqualTypeOf<Issue>();
  expectTypeOf(api.issues.list({ teamId: 'T1' })).toEqualTypeOf<AsyncGenerator<Yielded<ReturnType<typeof api.issues.list>>, void, undefined>>();
  expectTypeOf<Yielded<ReturnType<typeof api.events.list>>>().branded.toEqualTypeOf<{ whole: string }>();
  expectTypeOf<Yielded<ReturnType<typeof api.pages.all>>>().branded.toEqualTypeOf<{ n: number; next?: string }>();
  expectTypeOf<Yielded<ReturnType<typeof api.builds.list>>>().branded.toEqualTypeOf<{ id: string; number?: number }>();
  expectTypeOf<Awaited<ReturnType<typeof api.issues.get>>>().branded.toEqualTypeOf<{ id: string; assignee?: string; raw: unknown } | null>();
  expectTypeOf<Awaited<ReturnType<typeof api.issues.create>>>().branded.toEqualTypeOf<{ id: string; url: string }>();
  expectTypeOf<Awaited<ReturnType<typeof api.viewer>>>()
    .branded.toEqualTypeOf<{ viewer: { id: string; name: string; teams: { nodes: { id: string }[] } } }>();
  // `branded` compares about two levels down, so the deeper part is compared again from where it starts.
  expectTypeOf<Awaited<ReturnType<typeof api.viewer>>['viewer']['teams']>().branded.toEqualTypeOf<{ nodes: { id: string }[] }>();
  expectTypeOf(api.user()).toEqualTypeOf<Promise<unknown>>();
  expectTypeOf(api.json('/self')).toEqualTypeOf<Promise<unknown>>();
  // The raw calls' option and answer types come from `./client`, as `client` itself does.
  expectTypeOf<Parameters<typeof api.request>[1]>().toEqualTypeOf<RequestOptions | undefined>();
  expectTypeOf(api.request('/self')).toEqualTypeOf<Promise<ProviderResponse>>();
  expectTypeOf<Parameters<typeof api.paginate>[0]>().toEqualTypeOf<'cursor'>();
  expectTypeOf<Parameters<Client<Entry>['paginate']>[0]>().toEqualTypeOf<string>();
  // The README's example: an environment variable is a token as it is (a missing one is refused when a call needs it).
  expectTypeOf(client(attio, { token: process.env.ATTIO_KEY }).json('/self')).toEqualTypeOf<Promise<unknown>>();

  // No required parameter, no argument needed; an empty one, options and a nullable argument still work.
  void api.user({});
  void api.viewer();
  void api.issues.get({ id: 'I1' }, { signal: AbortSignal.timeout(1000) });
  // A paged operation reports each page's skipped records; an operation that pages nothing takes no such option.
  void api.issues.list({ teamId: 'T1' }, { onSkipped: (ids: (string | null)[]) => ids });
  // @ts-expect-error onSkipped is a paged operation's option
  void api.issues.get({ id: 'I1' }, { onSkipped: () => undefined });
  void api.issues.create({ title: 'Ship', estimate: { points: 3 }, parent: null });
  // @ts-expect-error id is a required path parameter, so the argument is too
  void api.issues.get();
  // @ts-expect-error teamId is a required path parameter
  void api.issues.list({ state: 'open' });
  // @ts-expect-error state is an enum
  void api.issues.list({ teamId: 'T1', state: 'merged' });
  // @ts-expect-error limit is an integer, not a string
  void api.issues.list({ teamId: 'T1', limit: '10' });
  // @ts-expect-error title is a required body parameter
  void api.issues.create({ labels: ['a'] });
  // @ts-expect-error estimate.points is required inside the nested body
  void api.issues.create({ title: 'x', estimate: { unit: 'h' } });
  // @ts-expect-error title is not nullable
  void api.issues.create({ title: null });
  // @ts-expect-error first is an integer variable
  void api.viewer({ first: 'five' });
  // An operation or a result field that is not declared is not there (asserted, since a read of it lints as unsafe).
  expectTypeOf(api.issues).not.toHaveProperty('delete');
  expectTypeOf<Awaited<ReturnType<typeof api.issues.create>>>().not.toHaveProperty('number');
  // @ts-expect-error a paging shape the entry does not declare
  void api.paginate('offset', '/issues');

  const base = { name: 'Bad', auth: [{ kind: 'key' }], http: { baseUrl: 'https://bad.test' } } as const;
  defineProvider({ ...base, id: 'bad', paging: { cursor: { kind: 'cursor', next: 'next', send: { query: 'cursor' } } }, operations: {
    // @ts-expect-error {id} is in the path but not declared as a path parameter
    get: { path: '/things/{id}', params: { other: { in: 'query', type: 'string' } } },
    // @ts-expect-error {id} is a path parameter, but not a required one
    find: { path: '/things/{id}', params: { id: { in: 'path', type: 'string' } } },
    // @ts-expect-error the entry declares no paging shape `offset`
    list: { path: '/things', paging: 'offset' },
    all: { path: '/things', paging: 'cursor' },
  } });
  // The client's own calls cannot be an operation's first segment; a prefix can.
  defineProvider({ ...base, id: 'reserved', operations: {
    // @ts-expect-error json is the client's own call
    json: { path: '/json' },
    // @ts-expect-error request is the client's own call
    'request.create': { method: 'POST', path: '/requests' },
    // @ts-expect-error paginate is the client's own call
    'paginate.all': { path: '/all' },
    // @ts-expect-error an object with a `then` is a thenable: `await client(...)` would call it
    then: { path: '/then' },
  } });
  defineProvider({ ...base, id: 'prefixed', operations: {
    'requests.create': { method: 'POST', path: '/requests' }, 'pages.markdown': { path: '/pages' }, jsonish: { path: '/jsonish' },
    'then.later': { path: '/later' },
  } });
}

// A plain field with a default may be left out of `values`; the result still holds it, as a string.
async function defaults(accessToken: string) {
  const { values } = await finishConnect(signInWith(intercom, 'key'), { secret: { accessToken }, fetch });
  expectTypeOf(values.apiHost).toEqualTypeOf<string>();
  await finishConnect(signInWith(intercom, 'key'), { secret: { accessToken }, values: { apiHost: 'api.eu.intercom.io' }, fetch });
  // @ts-expect-error a plain field without a default (Aircall's apiId) still requires `values`
  await finishConnect(aircall, { secret: { apiToken: accessToken }, fetch });
  // @ts-expect-error a misspelt field is no plain field of Intercom
  await finishConnect(signInWith(intercom, 'key'), { secret: { accessToken }, values: { apiHots: 'x' }, fetch });
}

// A token entry's finish is a form's: its secret fields, its plain fields unless each has a default, `fetch` optional.
async function tokenFinish(clientSecret: string, password: string, host: string, username: string) {
  // @ts-expect-error Zoom's account and client ids have no default, so `values` is required
  await finishConnect(zoom, { secret: { clientSecret }, fetch });
  const { secret } = await finishConnect(zoom, { secret: { clientSecret }, values: { accountId: 'a', clientId: 'c' }, fetch });
  expectTypeOf(secret).toEqualTypeOf<Readonly<Record<'clientSecret', string>>>();
  await finishConnect(metabase, { secret: { password }, values: { host, username } });
  await finishConnect(paypal, { secret: { clientSecret }, values: { clientId: 'c' } });
}

test('defineProvider keeps an entry with operations', () => {
  expect(defaults).toBeTypeOf('function');
  expect(tokenFinish).toBeTypeOf('function');
  expect(acme.id).toBe('acme');
  expect(typed).toBeTypeOf('function');
});
