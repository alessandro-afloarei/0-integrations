import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { aircallScenario } from './aircall/scenario.test-support.js';
import { attioScenario } from './attio/scenario.test-support.js';
import { fathomScenario } from './fathom/scenario.test-support.js';
import { githubScenario } from './github/scenario.test-support.js';
import { googleCalendarScenario, googleMailScenario } from './google/scenario.test-support.js';
import { KIT_MAILBOX } from './mailbox/kit.test-support.js';
import { graphCalendarScenario, graphMailScenario } from './microsoft/scenario.test-support.js';
import { BAD_KEY, playScenario, recorder, type KitScenario, type Recording } from './kit.test-support.js';
import { notionScenario } from './notion/scenario.test-support.js';
import { KIT_ACCOUNT, unipileCalendarScenario, unipileMailScenario } from './unipile/scenario.test-support.js';

/**
 * Records a provider's kit scenario from a test account, replacing its synthetic recording:
 * `RECORD_PROVIDER=fathom RECORD_KEY=… pnpm vitest run src/record.test.ts` (Aircall's key is `api_id:api_token`). Unipile
 * also takes a test `RECORD_ACCOUNT`. Graph and Google take a test mailbox's access token as the
 * key and its address as `RECORD_ACCOUNT`. Read the file before committing it: it holds the test account's data as the provider answered.
 */
const scenarios: Record<string, KitScenario<unknown, unknown>> = {
  fathom: fathomScenario,
  attio: attioScenario,
  aircall: aircallScenario,
  notion: notionScenario,
  github: githubScenario,
  'unipile-mail': unipileMailScenario,
  'unipile-calendar': unipileCalendarScenario,
  'graph-mail': graphMailScenario,
  'graph-calendar': graphCalendarScenario,
  'google-mail': googleMailScenario,
  'google-calendar': googleCalendarScenario,
};
const files: Record<string, string> = { 'unipile-mail': 'unipile/fixtures/mail-recording.json',
  'unipile-calendar': 'unipile/fixtures/calendar-recording.json', 'graph-mail': 'microsoft/fixtures/mail-recording.json',
  'graph-calendar': 'microsoft/fixtures/calendar-recording.json', 'google-mail': 'google/fixtures/mail-recording.json',
  'google-calendar': 'google/fixtures/calendar-recording.json' };
const provider = process.env.RECORD_PROVIDER ?? '';
const key = process.env.RECORD_KEY ?? '';
/** What the scenario names by the kit's stand-ins, and the test account's own: swapped on the wire, so a recording replays
 * without them. */
const standIns: [kit: string, real: string][] = provider.startsWith('unipile-') ? [[KIT_ACCOUNT, process.env.RECORD_ACCOUNT ?? '']]
  : provider.startsWith('graph-') || provider.startsWith('google-') ? [[KIT_MAILBOX, process.env.RECORD_ACCOUNT ?? '']] : [];

function swapping(real: typeof fetch): typeof fetch {
  const swap = (text: string, toReal: boolean) => standIns.reduce((out, [kit, actual]) =>
    (toReal ? out.replaceAll(kit, actual) : out.replaceAll(actual, kit)), text);
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await real(new Request(swap(request.url, true), request));
    return new Response(swap(await response.text(), false), { status: response.status, headers: response.headers });
  };
}

test.runIf(provider !== '' && key !== '')(`records ${provider}'s scenario from a test account`, async () => {
  const scenario = scenarios[provider];
  if (!scenario) throw new Error(`no kit scenario for ${provider}`);
  if (standIns.some(([, actual]) => actual === '')) throw new Error(`${provider} needs RECORD_ACCOUNT`);
  const real = standIns.length === 0 ? fetch : swapping(fetch);
  const good = recorder(real, key, 'good');
  const bad = recorder(real, BAD_KEY, 'bad');
  await playScenario(scenario, side => (side === 'good' ? good.fetch : bad.fetch), { good: key, bad: BAD_KEY });
  const recording: Recording = { provider, synthetic: false, source: 'Recorded from a test account by src/record.test.ts.',
    recordedAt: new Date().toISOString().slice(0, 10), exchanges: [...good.exchanges, ...bad.exchanges] };
  writeFileSync(new URL(`./${files[provider] ?? `${provider}/fixtures/recording.json`}`, import.meta.url),
    `${JSON.stringify(recording, null, 1)}\n`);
}, 120_000);
