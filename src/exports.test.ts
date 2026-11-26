import { globSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

/** Source files that are no subpath. A new file must be exported or named here: the choice is never silent. */
const INTERNAL = new Set(['http-response', 'retry-after', 'parse', 'shapes', 'rules', 'account',
  'fireflies/transcript', 'mailbox/fake']);
const target = (path: string) => ({ types: `./dist/${path}.d.ts`, default: `./dist/${path}.js` });

test('package exports name every public source file and nothing else', () => {
  const paths = globSync('src/**/*.ts').map(file => file.slice('src/'.length, -'.ts'.length))
    .filter(path => !/\.test(-support)?$/u.test(path) && !path.startsWith('catalogue/') && !INTERNAL.has(path));
  const expected: Record<string, unknown> = Object.fromEntries(paths.map(path => {
    const [dir = '', file] = path.split('/');
    return [`./${file === dir ? dir : path}`, target(path)];
  }));
  expected['./catalogue/*'] = target('catalogue/*');
  expected['./catalogue.json'] = './dist/catalogue.json';
  const { exports } = JSON.parse(readFileSync('package.json', 'utf8')) as { exports: unknown };
  expect(exports).toEqual(expected);
});
