import type { Page } from '../paginate.js';

// A mailbox read the same way whoever serves it: Microsoft Graph, Gmail with Google Calendar, or Unipile. The field names
// are Unipile's, the first transport: an app stores these values and reads them back with its own schema.

/** Only e-mail addresses: a recipient of another kind is dropped. */
export type MailboxEmailAddress = { display_name: string; identifier: string };
/**
 * `role` is where the message sits, in Unipile's words: `inbox`, `sent`, `drafts`, `trash` or `spam`. `folders` are the
 * provider's own names for it (Gmail's labels, `CATEGORY_PROMOTIONS` among them).
 */
export type MailboxEmail = {
  id: string; account_id: string; thread_id: string | null; message_id: string; provider_id: string;
  date: string; role: string; folders: string[]; subject: string; body_plain: string; body: string;
  from_attendee: MailboxEmailAddress; to_attendees: MailboxEmailAddress[]; cc_attendees: MailboxEmailAddress[];
  in_reply_to: { message_id: string } | null;
  /** Only the headers an app filters on, names lowercased: list-unsubscribe (its value blanked: a one-click unsubscribe
   *  link), list-id, auto-submitted, precedence, references. Every other header (Received, with its addresses, included) is dropped. */
  headers: { name: string; value: string }[];
};
export type MailboxCalendar = { id: string; name: string; is_primary: boolean; is_owned_by_user: boolean };
/** `date_time` always carries its offset; `time_zone` names the zone the event was set in. */
export type MailboxEventTime = { date_time: string; time_zone: string } | { date: string };
export type MailboxEvent = {
  id: string; ical_uid: string | null; master_event_id: string | null; calendar_id: string;
  created_at: string; updated_at: string; title: string; body: string; location: string;
  is_cancelled: boolean; is_all_day: boolean; start: MailboxEventTime; end: MailboxEventTime;
  attendees: { email: string; display_name: string | null; is_organizer: boolean; is_resource: boolean;
    response_status: 'yes' | 'no' | 'maybe' | 'noreply' }[];
  organizer: { email: string; display_name: string | null };
  conference: { provider: string; url: string | null } | null;
  event_type: string; transparency: string;
  /**
   * `private` when the event is the calendar owner's alone. Unipile answers it as it is. Google's `private` and
   * `confidential` are private; its `default` and `public` are not. Outlook's every sensitivity label but `normal` is
   * private: `personal` and `confidential` too, since a member who labels an event says it is not ordinary business.
   */
  visibility: 'public' | 'private';
};

/** One member's mailbox and calendar, read on their grant. */
export type MailboxReader = {
  /** The mailbox's own address: what proves the grant works. */
  identify(): Promise<{ email: string }>;
  /** Mail after `after` (an ISO time with its offset), newest first, without bodies: what a sync plans from. Drafts are
   *  left out; a transport that cannot read headers in a listing leaves them empty. */
  messages(query: { after?: string | undefined; cursor?: string | undefined; limit?: number | undefined }): Promise<Page<MailboxEmail>>;
  /** One thread's messages with their bodies and kept headers, a page at a time; drafts are left out. */
  thread(threadId: string, query: { cursor?: string | undefined; limit?: number | undefined }): Promise<Page<MailboxEmail>>;
  /** The member's own main calendar, null when there is none. */
  primaryCalendar(): Promise<MailboxCalendar | null>;
  /** The events in a window, each instance of a series on its own. */
  events(calendarId: string, query: { start: string; end: string; cursor?: string | undefined; limit?: number | undefined }):
    Promise<Page<MailboxEvent>>;
};

const KEPT_HEADERS = new Set(['list-unsubscribe', 'list-id', 'auto-submitted', 'precedence', 'references']);

/** The headers an app filters on, names lowercased; list-unsubscribe's value is a link for this recipient, so it is blanked. */
export function keptHeaders(headers: readonly { name: string; value: string }[]): { name: string; value: string }[] {
  return headers.map(header => ({ name: header.name.toLowerCase(), value: header.value }))
    .filter(header => KEPT_HEADERS.has(header.name))
    .map(header => (header.name === 'list-unsubscribe' ? { ...header, value: '' } : header));
}

/** A header's value, by a name in any case; null when the message has none. */
export function headerValue(headers: readonly { name: string; value: string }[], name: string): string | null {
  const wanted = name.toLowerCase();
  return headers.find(header => header.name.toLowerCase() === wanted)?.value ?? null;
}

/** RFC 2047 encoded words (`=?UTF-8?B?…?=`, `=?ISO-8859-1?Q?…?=`) decoded; a charset this runtime cannot read stays as written. */
export function decodeWords(value: string): string {
  return value.replace(/=\?([\w-]{1,40})\?([BQbq])\?([^?\s]{0,1000})\?=(?:\s+(?==\?))?/gu, (word, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/gu, ' ').replace(/=([0-9A-Fa-f]{2})/gu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), 'latin1');
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch {
      return word;
    }
  });
}

/**
 * An address header (`From`, `To`, `Cc`) as its addresses: `Name <a@b>`, `"Last, First" <a@b>`, a bare `a@b`, and groups
 * (`team: a@b, c@d;`). RFC 5322 comments (`a@b (Alice)`, nested or escaped) are no part of an address. A part with no
 * address in it is dropped.
 */
export function parseAddressList(value: string): MailboxEmailAddress[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = false;
  let comment = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value.charAt(index);
    if (comment > 0) {
      if (char === '\\') index++;
      else if (char === '(') comment++;
      else if (char === ')') comment--;
      continue;
    }
    if (char === '(' && !quoted) { comment = 1; continue; }
    if (char === '\\' && quoted) { current += char + value.charAt(++index); continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '<') angle = true;
    else if (!quoted && char === '>') angle = false;
    if (!quoted && !angle && (char === ',' || char === ';')) { parts.push(current); current = ''; continue; }
    // A group's name ends at its colon; its addresses follow.
    if (!quoted && !angle && char === ':') { current = ''; continue; }
    current += char;
  }
  parts.push(current);
  return parts.flatMap(part => {
    const angled = /^(.*)<([^<>\s]+@[^<>\s]+)>\s*$/su.exec(part.trim());
    const display = (angled?.[1] ?? '').trim().replace(/^"(.*)"$/su, '$1').replace(/\\(.)/gu, '$1');
    const address = angled?.[2] ?? (/^[^\s<>",;:]+@[^\s<>",;:]+$/u.test(part.trim()) ? part.trim() : null);
    return address === null ? [] : [{ display_name: decodeWords(display).trim(), identifier: address }];
  });
}
