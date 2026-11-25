// Writes dist/catalogue.json: every compiled entry as plain data, with its tier.
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const recordings = globSync('src/catalogue/*.recording.json');
const entries = [];
for (const file of globSync('dist/catalogue/*.js').sort()) {
  const id = basename(file, '.js');
  const entry = Object.values(await import(pathToFileURL(file).href)).find(value => value?.id === id);
  if (entry === undefined) throw new Error(`${file} exports no entry whose id is '${id}'`);
  const recorded = recordings.some(recording => basename(recording).startsWith(`${id}.`)
    && JSON.parse(readFileSync(recording, 'utf8')).synthetic === false);
  entries.push({ ...entry, tier: recorded ? 'recorded' : 'declared' });
}
writeFileSync('dist/catalogue.json', JSON.stringify(entries, null, 1));
