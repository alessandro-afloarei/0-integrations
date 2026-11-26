// pnpm new <id>: writes src/catalogue/<id>.ts, an entry skeleton whose every unknown is TODO. Never overwrites.
import { writeFileSync } from 'node:fs';

const id = process.argv[2] ?? '';
const path = `src/catalogue/${id}.ts`;
const fail = reason => { console.error(reason); process.exit(1); };
if (process.argv.length !== 3 || !/^[a-z][a-z0-9]*$/u.test(id)) {
  fail(`usage: pnpm new <id>, an id of lowercase letters and digits starting with a letter (not ${JSON.stringify(id)})`);
}

const skeleton = `import { defineProvider } from '../catalogue.js';

// Fill each TODO from the provider's own docs and state only what differs from the defaults
// (docs/modules/catalogue.md lists every field), then follow the five steps in CONTRIBUTING.md.
export const ${id} = defineProvider({
  id: '${id}', name: 'TODO', docs: 'https://TODO',
  fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://TODO' },
  identify: { request: { path: '/TODO' }, id: 'TODO', name: 'TODO' },
});
`;

try {
  writeFileSync(path, skeleton, { flag: 'wx' });
} catch (error) {
  fail(error.code === 'EEXIST' ? `${path} exists: pick another id or edit that entry`
    : `cannot write ${path}: run pnpm new from the repository's root`);
}
console.log(`${path}\nNext: fill it from the provider's docs, then pnpm check.`);
