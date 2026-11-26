import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { defineProvider, type Auth, type Entry } from './catalogue.js';
import { catalogueEntries, catalogueRecordings } from './kit.test-support.js';
import { tierOf } from './tier.js';

/**
 * `docs/providers.md`, rendered from the entries alone: `pnpm providers` (this test with `UPDATE_PROVIDERS` set) writes
 * it, and without it this test fails until the committed page is the one the entries give.
 */
const PAGE = fileURLToPath(new URL('../docs/providers.md', import.meta.url));

type Recorded = readonly { file: string; synthetic: boolean }[];
const SIGN_IN: Record<Auth['kind'], string> = { key: 'key', oauth2: 'OAuth 2', token: 'token' };
const listed = (items: readonly string[]) => (items.length > 0 ? items.join(', ') : '—');

/** One table row: the entry's link, categories, every sign-in, operation ids in declared order, webhook and tier. */
function row(entry: Entry, recordings: Recorded): string {
  return `| ${entry.docs === undefined ? entry.name : `[${entry.name}](${entry.docs})`} | ${listed(entry.categories ?? [])} | ${
    listed(entry.auth.map(auth => SIGN_IN[auth.kind]))} | ${listed(Object.keys(entry.operations ?? {}))} | ${
    entry.webhook?.kind ?? '—'} | ${tierOf(entry.id, recordings)} |`;
}

/** The whole page, entries sorted by id; no date or path, so the same entries always give the same page. */
function providersPage(entries: readonly Entry[], recordings: Recorded): string {
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
  const recorded = sorted.filter(entry => tierOf(entry.id, recordings) === 'recorded').length;
  const operations = sorted.reduce((sum, entry) => sum + Object.keys(entry.operations ?? {}).length, 0);
  const kinds = new Map<string, number>();
  for (const { webhook } of sorted) if (webhook) kinds.set(webhook.kind, (kinds.get(webhook.kind) ?? 0) + 1);
  const webhooks = listed([...kinds].sort(([a], [b]) => (a < b ? -1 : 1)).map(([kind, count]) => `${kind} ${String(count)}`));
  return ['# Providers', '',
    `Generated from \`src/catalogue/\` by \`pnpm providers\`: do not edit. ${String(sorted.length)} providers: ${
      String(sorted.length - recorded)} declared, ${String(recorded)} recorded;`,
    `${String(operations)} typed operations; webhooks: ${webhooks}. What waits is in the [waiting list](waiting-list.md).`, '',
    '| Provider | Categories | Sign-in | Operations | Webhook | Tier |', '|---|---|---|---|---|---|',
    ...sorted.map(entry => row(entry, recordings)), ''].join('\n');
}

test('docs/providers.md is the page the entries give', async () => {
  const page = providersPage((await catalogueEntries()).map(([, entry]) => entry), catalogueRecordings());
  if (process.env.UPDATE_PROVIDERS !== undefined) writeFileSync(PAGE, page);
  expect(existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '', 'docs/providers.md is out of date: run pnpm providers').toBe(page);
});

const zeta = defineProvider({ id: 'zeta', name: 'Zeta', docs: 'https://zeta.test/docs', categories: ['chat'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://zeta.test/authorize', tokenUrl: 'https://zeta.test/token' }], scopes: { default: [] },
  http: { baseUrl: 'https://api.zeta.test' }, webhook: { kind: 'hmac', header: 'x-signature' },
  operations: { 'channels.list': { docs: 'https://zeta.test/docs/channels', path: '/channels' } } });
const acme = defineProvider({ id: 'acme', name: 'Acme', docs: 'https://acme.test/docs', categories: ['tasks', 'docs'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true }], auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' },
  operations: { 'tasks.list': { docs: 'https://acme.test/docs/tasks', path: '/tasks' },
    'tasks.get': { docs: 'https://acme.test/docs/task', path: '/tasks/{id}', params: { id: { in: 'path', type: 'string', required: true } } } } });

test('a key entry and an OAuth entry with a webhook render to these rows, sorted by id; only a real recording makes one recorded', () => {
  expect(providersPage([zeta, acme], [{ file: 'zeta.recording.json', synthetic: false }, { file: 'acme.recording.json', synthetic: true }]))
    .toBe(`# Providers

Generated from \`src/catalogue/\` by \`pnpm providers\`: do not edit. 2 providers: 1 declared, 1 recorded;
3 typed operations; webhooks: hmac 1. What waits is in the [waiting list](waiting-list.md).

| Provider | Categories | Sign-in | Operations | Webhook | Tier |
|---|---|---|---|---|---|
| [Acme](https://acme.test/docs) | tasks, docs | key | tasks.list, tasks.get | — | declared |
| [Zeta](https://zeta.test/docs) | chat | OAuth 2 | channels.list | hmac | recorded |
`);
});

test('an entry that declares a key and OAuth 2 shows both sign-ins', () => {
  expect(row({ ...acme, auth: [acme.auth[0], zeta.auth[0]] }, [])).toContain('| key, OAuth 2 |');
});
