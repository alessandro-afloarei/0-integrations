import { globSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test } from 'vitest';
import { BAD_KEY, playScenario, recorder, type KitScenario, type Recording } from './kit.test-support.js';

/**
 * Records a kit scenario from a test account, replacing its synthetic recording:
 * `RECORD_PROVIDER=<scenario's provider> RECORD_KEY=… pnpm vitest run src/record.test.ts`. A scenario that names a
 * stand-in also takes the test account's own as `RECORD_ACCOUNT`. Read the file before committing it: it holds the test
 * account's data as the provider answered.
 */
const provider = process.env.RECORD_PROVIDER ?? '';
const key = process.env.RECORD_KEY ?? '';

/** The kit scenario named `name`, found among every `src/<id>/scenario.test-support.ts` export by its shape. */
async function findScenario(name: string): Promise<KitScenario<unknown, unknown> | undefined> {
  const modules = await Promise.all(globSync('src/*/scenario.test-support.ts')
    .map(file => import(pathToFileURL(file).href) as Promise<Record<string, unknown>>));
  return modules.flatMap(module => Object.values(module)).find((value): value is KitScenario<unknown, unknown> =>
    typeof value === 'object' && value !== null && 'provider' in value && value.provider === name
      && 'page' in value && typeof value.page === 'function');
}

/** Swaps what the scenario names by its stand-in for the test account's own on the wire, and back in the answers, so a
 * recording replays without them. */
function swapping(real: typeof fetch, standIns: readonly [kit: string, real: string][]): typeof fetch {
  const swap = (text: string, toReal: boolean) => standIns.reduce((out, [kit, actual]) =>
    (toReal ? out.replaceAll(kit, actual) : out.replaceAll(actual, kit)), text);
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await real(new Request(swap(request.url, true), request));
    return new Response(swap(await response.text(), false), { status: response.status, headers: response.headers });
  };
}

test.runIf(provider !== '' && key !== '')(`records ${provider}'s scenario from a test account`, async () => {
  const scenario = await findScenario(provider);
  if (!scenario) throw new Error(`no kit scenario for ${provider}`);
  const standIns: [string, string][] = scenario.standIn === undefined ? [] : [[scenario.standIn, process.env.RECORD_ACCOUNT ?? '']];
  if (standIns.some(([, actual]) => actual === '')) throw new Error(`${provider} needs RECORD_ACCOUNT`);
  const real = standIns.length === 0 ? fetch : swapping(fetch, standIns);
  const good = recorder(real, key, 'good');
  const bad = recorder(real, BAD_KEY, 'bad');
  await playScenario(scenario, side => (side === 'good' ? good.fetch : bad.fetch), { good: key, bad: BAD_KEY });
  const recording: Recording = { provider, synthetic: false, source: 'Recorded from a test account by src/record.test.ts.',
    recordedAt: new Date().toISOString().slice(0, 10), exchanges: [...good.exchanges, ...bad.exchanges] };
  writeFileSync(new URL(`./catalogue/${provider}.recording.json`, import.meta.url), `${JSON.stringify(recording, null, 1)}\n`);
}, 120_000);
