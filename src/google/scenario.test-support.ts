import { GOOD_KEY, type KitScenario } from '../kit.test-support.js';
import { eventEnd, KIT_MAILBOX, KIT_WINDOW, kitMailbox } from '../mailbox/kit.test-support.js';
import type { MailboxEmail, MailboxEvent, MailboxReader } from '../mailbox/mailbox.js';
import { fakeGoogle } from './fake.js';
import { googleMailbox } from './google.js';

export const KIT_CLIENT = { clientId: 'kit-client.apps.googleusercontent.com', clientSecret: 'kit-secret' };
export const KIT_REDIRECT = 'https://app.lumen.test/api/integrations/google/callback';

/** Google's consent, Gmail and Calendar on the kit's mailbox: `GOOD_KEY` reads it, and the consent page signs it in. */
export const kitGoogle = () => fakeGoogle({ client: KIT_CLIENT, redirectUri: KIT_REDIRECT, signIn: () => KIT_MAILBOX,
  mailboxes: address => (address === KIT_MAILBOX ? kitMailbox : null), tokens: { [GOOD_KEY]: KIT_MAILBOX } });

/** Two a page, so a small mailbox still pages. */
const PAGE = 2;
const client: KitScenario<MailboxReader, unknown>['client'] = ({ apiKey, fetch }) =>
  googleMailbox({ token: () => Promise.resolve(apiKey), fetch });

export const googleMailScenario: KitScenario<MailboxReader, MailboxEmail> = {
  provider: 'google.mail',
  standIn: KIT_MAILBOX,
  client,
  identify: reader => reader.identify(),
  page: (reader, { since, cursor }) => reader.messages({ after: since, cursor, limit: PAGE }),
  id: email => email.id,
  changedAt: email => email.date,
  since: '2026-11-05T00:00:00.000Z',
  retriesRateLimit: true,
};

/** The main calendar's events. `since` starts the window, and Google lists every event the window overlaps: one counts as
 *  read since that time by its end. */
export const googleCalendarScenario: KitScenario<MailboxReader, MailboxEvent> = {
  provider: 'google.calendar',
  standIn: KIT_MAILBOX,
  client,
  identify: reader => reader.identify(),
  async page(reader, { since, cursor }) {
    const calendar = await reader.primaryCalendar();
    if (!calendar) throw new Error('google.calendar: the account has no calendar');
    return reader.events(calendar.id, { start: since ?? KIT_WINDOW.start, end: KIT_WINDOW.end, cursor, limit: PAGE });
  },
  id: event => event.id,
  changedAt: eventEnd,
  since: '2026-11-05T00:00:00.000Z',
  retriesRateLimit: true,
};
