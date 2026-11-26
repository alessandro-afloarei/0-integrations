import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

/** `pnpm new <id>`, run in a fresh folder holding an empty `src/catalogue/`, the recorder's way: beside the repository. */
const script = fileURLToPath(new URL('../scripts/new.mjs', import.meta.url));
let folder = '';
beforeEach(() => {
  folder = mkdtempSync(fileURLToPath(new URL('../.scaffold-test-', import.meta.url)));
  mkdirSync(join(folder, 'src/catalogue'), { recursive: true });
});
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: folder, encoding: 'utf8' });
const files = () => readdirSync(folder, { recursive: true, encoding: 'utf8' }).sort();

test('writes src/catalogue/<id>.ts, a key entry whose every unknown is TODO, and nothing else', () => {
  const { status, stdout } = run('acme');
  expect(status).toBe(0);
  expect(stdout).toContain('src/catalogue/acme.ts');
  const entry = readFileSync(join(folder, 'src/catalogue/acme.ts'), 'utf8');
  expect(entry).toContain("export const acme = defineProvider({");
  expect(entry).toContain("id: 'acme'");
  expect(entry).toContain("docs: 'https://TODO'");
  expect(files()).toEqual(['src', 'src/catalogue', 'src/catalogue/acme.ts']);
});

test('never overwrites an entry', () => {
  run('acme');
  const before = readFileSync(join(folder, 'src/catalogue/acme.ts'), 'utf8');
  const { status, stderr } = run('acme');
  expect(status).toBe(1);
  expect(stderr).toContain('exists');
  expect(stderr.trim().split('\n')).toHaveLength(1);
  expect(readFileSync(join(folder, 'src/catalogue/acme.ts'), 'utf8')).toBe(before);
});

test.each([['Acme'], ['ac-me'], ['1acme'], [''], []])('refuses the id %j, writing nothing', (...args: string[]) => {
  const { status, stderr } = run(...args);
  expect(status).toBe(1);
  expect(stderr.trim().split('\n')).toHaveLength(1);
  expect(files()).toEqual(['src', 'src/catalogue']);
});

test.each(['new', 'class', 'default', 'await', 'let'])('refuses %s, a word JavaScript reserves, in one line, writing nothing', id => {
  const { status, stderr } = run(id);
  expect(status).toBe(1);
  expect(stderr.trim()).toBe(`${id} is a word JavaScript reserves, so it cannot name the entry's export: pick another id`);
  expect(files()).toEqual(['src', 'src/catalogue']);
});

test('creates no folder: outside a checkout it writes nothing', () => {
  rmSync(join(folder, 'src'), { recursive: true });
  expect(run('acme').status).toBe(1);
  expect(files()).toEqual([]);
});
