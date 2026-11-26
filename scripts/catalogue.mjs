// Writes dist/catalogue.json: every compiled entry as plain data, with its tier.
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tierOf } from '../dist/tier.js';

const recordings = globSync('src/catalogue/*.recording.json').map(path =>
  ({ file: basename(path), synthetic: JSON.parse(readFileSync(path, 'utf8')).synthetic !== false }));
const entries = [];
for (const file of globSync('dist/catalogue/*.js').sort()) {
  const id = basename(file, '.js');
  const entry = Object.values(await import(pathToFileURL(file).href)).find(value => value?.id === id);
  if (entry === undefined) throw new Error(`${file} exports no entry whose id is '${id}'`);
  entries.push({ ...entry, tier: tierOf(id, recordings) });
}
writeFileSync('dist/catalogue.json', JSON.stringify(entries, null, 1));
