import type { MailboxEmail, MailboxEvent } from './mailbox.js';
import type { FakeMailbox } from './fake.js';

/** The kit's test mailbox: what a recording names, and what the fake serves to `GOOD_KEY`. */
export const KIT_MAILBOX = 'lee@lumen.test';

const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
const rui = { display_name: 'Rui Costa', identifier: 'rui@northstar.test' };
const lee = { display_name: 'Lee Park', identifier: KIT_MAILBOX };
const kitEmail = (n: number, overrides: Partial<MailboxEmail> = {}): MailboxEmail => ({ id: `msg-${String(n)}`,
  account_id: '', thread_id: `conv-${String(n)}`, message_id: `<m${String(n)}@northstar.test>`, provider_id: `msg-${String(n)}`,
  date: `${day(n)}T09:00:00.000Z`, role: 'inbox', folders: ['INBOX'], subject: `Northstar ${String(n)}`, body_plain: '',
  body: `<p>Message ${String(n)}</p>`, from_attendee: rui, to_attendees: [lee], cc_attendees: [], in_reply_to: null,
  headers: [], ...overrides });
const kitEvent = (n: number, overrides: Partial<MailboxEvent> = {}): MailboxEvent => ({ id: `event-${String(n)}`,
  ical_uid: `uid-${String(n)}@northstar.test`, master_event_id: null, calendar_id: 'calendar-lee', created_at: `${day(1)}T08:00:00.000Z`,
  updated_at: `${day(n)}T08:00:00.000Z`, title: `Call ${String(n)}`, body: '<p>Agenda</p>', location: '', is_cancelled: false,
  is_all_day: false, start: { date_time: `${day(n)}T10:00:00.000Z`, time_zone: 'UTC' },
  end: { date_time: `${day(n)}T10:30:00.000Z`, time_zone: 'UTC' },
  attendees: [{ email: KIT_MAILBOX, display_name: 'Lee Park', is_organizer: true, is_resource: false, response_status: 'yes' },
    { email: rui.identifier, display_name: 'Rui Costa', is_organizer: false, is_resource: false, response_status: 'yes' }],
  organizer: { email: KIT_MAILBOX, display_name: 'Lee Park' }, conference: null, event_type: 'singleInstance', transparency: 'opaque',
  visibility: 'public', ...overrides });
const six = [1, 2, 3, 4, 5, 6];
export const kitMailbox: FakeMailbox = { address: KIT_MAILBOX, name: 'Lee Park',
  // Mail in every place a message can sit; the draft is never listed.
  emails: [...six.map(n => kitEmail(n)), kitEmail(7, { role: 'sent', from_attendee: lee, to_attendees: [rui] }),
    kitEmail(8, { role: 'spam' }), kitEmail(9, { role: 'trash' }), kitEmail(10, { role: 'drafts' }),
    // Gmail's Promotions tab, early enough to stay out of a listing since the 5th.
    kitEmail(11, { date: '2026-11-02T10:00:00.000Z', folders: ['INBOX', 'CATEGORY_PROMOTIONS'] })],
  calendar: { id: 'calendar-lee', name: 'Calendar' }, events: six.map(n => kitEvent(n)) };

/** The calendar window the kit reads when it reads the whole calendar. */
export const KIT_WINDOW = { start: '2026-10-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' };
/** When an event ends: a provider lists every event its window overlaps, so one counts as read since the window's start by its end. */
export const eventEnd = (event: MailboxEvent) => ('date' in event.end ? `${event.end.date}T00:00:00.000Z` : event.end.date_time);
