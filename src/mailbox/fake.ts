import type { MailboxEmail, MailboxEvent, MailboxEventTime } from './mailbox.js';

/** One mailbox a provider's fake serves: its mail (drafts included, as `role: 'drafts'`), its main calendar and its events.
 *  `utcOffsetMinutes` is the owner's zone, where an all-day event's midnight falls (UTC unless named). */
export type FakeMailbox = { address: string; name: string; emails: readonly MailboxEmail[];
  calendar: { id: string; name: string }; events: readonly MailboxEvent[]; utcOffsetMinutes?: number };

/** When an event time falls, an all-day date at its UTC midnight. */
const eventInstant = (time: MailboxEventTime) => Date.parse('date' in time ? `${time.date}T00:00:00Z` : time.date_time);

/** The events a window overlaps, earliest first. */
export const eventsIn = (events: readonly MailboxEvent[], start: number, end: number) => events
  .filter(event => eventInstant(event.start) < end && eventInstant(event.end) > start)
  .sort((a, b) => eventInstant(a.start) - eventInstant(b.start));
