import type { KitScenario } from '../kit.test-support.js';
import { unipileClient, type UnipileClient, type UnipileEmail, type UnipileEvent } from './unipile.js';

/** The account a recording names: `record.test.ts` puts a test account's own on the wire in its place. */
export const KIT_ACCOUNT = 'kit-account';

/** Two a page, so a small mailbox still pages. */
const PAGE = 2;
const client: KitScenario<UnipileClient, unknown>['client'] = ({ apiKey, fetch }) => unipileClient({ apiKey, fetch });

export const unipileMailScenario: KitScenario<UnipileClient, UnipileEmail> = {
  provider: 'unipile-mail',
  client,
  identify: unipile => unipile.account(KIT_ACCOUNT),
  page: (unipile, { since, cursor }) => unipile.emails(KIT_ACCOUNT, { after: since, cursor, limit: PAGE }),
  id: email => email.id,
  changedAt: email => email.date,
  since: '2026-11-05T00:00:00.000Z',
  retriesRateLimit: true,
};

/** The primary calendar's events. */
export const unipileCalendarScenario: KitScenario<UnipileClient, UnipileEvent> = {
  provider: 'unipile-calendar',
  client,
  identify: unipile => unipile.account(KIT_ACCOUNT),
  async page(unipile, { since, cursor }) {
    const primary = (await unipile.calendars(KIT_ACCOUNT)).find(calendar => calendar.is_primary);
    if (!primary) throw new Error('unipile-calendar: the account has no primary calendar');
    return unipile.events(KIT_ACCOUNT, primary.id, { updatedAfter: since, cursor, limit: PAGE });
  },
  id: event => event.id,
  changedAt: event => event.updated_at,
  since: '2026-11-05T00:00:00.000Z',
  retriesRateLimit: true,
};
