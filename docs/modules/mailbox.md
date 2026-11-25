# `mailbox`

`mailbox` holds the shapes every mail transport answers (`MailboxEmail`, `MailboxCalendar`, `MailboxEvent`, with the field
names of [Unipile's mail](unipile.md); the `Unipile*` names are aliases of them) and `MailboxReader`, one member's mailbox and calendar:

- `identify()` answers the mailbox's own address (lowercased): the call that proves a grant;
- `messages({ after?, cursor?, limit? })` lists mail after a time, newest first, without bodies, drafts left out;
- `thread(threadId, { cursor?, limit? })` reads a thread's messages with their bodies and the five kept headers, drafts left out;
- `primaryCalendar()` answers the member's main calendar;
- `events(calendarId, { start, end, cursor?, limit? })` pages the events a window overlaps, each instance of a series on its own.
  An event's `visibility` is `private` when its owner marked it so: Google's `private` and `confidential`, Outlook's every
  sensitivity label but `normal` (`personal` too: a member who labels an event says it is not ordinary business).

`role` is where a message sits in Unipile's words (`inbox`, `sent`, `drafts`, `trash`, `spam`), whatever the provider calls
it; `folders` keeps the provider's own names (Gmail's labels, `CATEGORY_PROMOTIONS` among them). Dates must be ISO times
with an offset; anything else is `TypeError('date_invalid')` before a request. Three transports implement it:

- [`graphMailbox`](microsoft.md) (`microsoft`): Outlook mail and calendar through Microsoft Graph;
- [`googleMailbox`](google.md) (`google`): Gmail and Google Calendar;
- [`unipileMailbox`](unipile.md) (`unipile`): one Unipile workspace account.
