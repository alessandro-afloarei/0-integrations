# Unipile

`exa`, `firecrawl` and `unipile` are provider modules: `exaClient`, `firecrawlClient` and `unipileClient` take the key
and the app's fetch and return typed calls, so the app never builds a provider request or reads a provider answer.
The library checks every answer with zod, which no public type names, so an app's own zod version never meets it;
an answer in the wrong shape is a `ProviderHttpError` with code `invalid_response`. `unipileClient` speaks Unipile V2, one address for every
workspace (`https://api.unipile.com/v2`, the `unipile` provider's `baseUrl`), with the workspace's V2 key.

The hosted sign-in is two calls: `client.authLink(link)` answers the sign-in URL, and `client.account(accountId, signal?)`
the account it made, `{createdAt, provider, email, scopes}`. The optional signal bounds the account lookup.
`authLink` refuses blank state; nonce validation, account ownership, accepted creation age and persistence stay with the app.

A `HostedSignIn` is a new account of one of `providers` (`linkedin`, `google`, `outlook`) or `accountId` signed in again,
with the app's single-use `state`, `redirectUri` and `expiresOn`. Unipile sends the browser back to `redirectUri` with
`account_id`, `provider` and `state`, or `error_type` when the sign-in failed: the account id reaches only the browser that
finished, which is what lets an app bind a sign-in to the browser that started it. `scopes: { google?, outlook? }` is the
whole list each OAuth provider is asked for (`gmail.readonly`, `Mail.Read`, …); Unipile refuses a scope its workspace's
OAuth settings do not hold ("Invalid OAuth scopes"), and without `scopes` it asks for those settings' own.

The same client reads a member's Gmail, Google Calendar, Outlook mail and Outlook Calendar. `account(id)` answers Unipile's
`provider` (`google`, `outlook`, `linkedin`, …), the `scopes` the account granted, and the mailbox's own address as `email`:
the primary sender, the address it signed in with (`/email-senders`, one more request for a mailbox), null for LinkedIn.
Microsoft can ask a work account's tenant admin to consent first ("Administrator approval required"); telling the person
is the app's.
`emails(accountId, { after?, cursor?, limit?, metaOnly? })` answers one `Page` of mail, newest first,
100 a page unless asked (1 to 100, Unipile's ceiling), in the mailbox shape. `role` comes from the roles of the message's
folders, read once per account (`/folders`). `thread(accountId, threadId)` reads every message of a thread in one answer;
Unipile ignores a `thread_id` on the list, so there is no other way. The client keeps five headers, lowercased:
`list-unsubscribe` (its value blanked: it is a one-click unsubscribe link for the recipient), `list-id`, `auto-submitted`,
`precedence` and `references`. Received and every other header, with the
addresses they carry, are dropped, as are bcc, reply-to and attachments. A recipient that is not an e-mail address is
dropped; a message with no sender, or one that is not an e-mail address, is skipped. `in_reply_to` is read from the
`In-Reply-To` header. `metaOnly` asks for metadata alone: bodies come back empty (headers still come), a cheap list to
choose the threads worth reading in full. Dates must be ISO times with an offset and go to Unipile as `YYYY-MM-DDTHH:MM:SS.sssZ`, the only form it takes;
anything else is `TypeError('date_invalid')` before a request. `after` is exclusive.

`calendars(accountId)` reads every calendar (Unipile's `is_default` is `is_primary`). `events(accountId, calendarId, { start?, end?, updatedAfter?, cursor?, limit? })`
pages a calendar's events, each instance of a series on its own (`master_event_id` names the series), filtered as Unipile's
reference words it: `start` keeps the events starting after it, `end` those ending before it. An all-day event's `start` and
`end` are a date alone. A time Unipile sends without an offset is read in its zone (the time's, else the event's, else
UTC), so `date_time` always carries one; a time in no zone the runtime knows makes the event unreadable: skipped. `visibility` is `private` when the event is its calendar owner's alone, `public` otherwise, as
Unipile answers it (it does not document how Google's `default` or Outlook's sensitivity labels map to the two); an event
that does not say is skipped. Unipile pages a list by cursor where the provider has one and by offset where it has not; the
client's cursor is one opaque string for both. By offset, a page asks for the next while Unipile's `total_count` says
more remain or, with no total, after any non-empty page (a provider may cap a page below `limit`); the list ends at the
total, on an offset refused as a bad request (Outlook pages by cursor and gives none on its last page), on an empty page, or where a provider answers the offset with its first page again (read off the raw entries, so a
page nothing in which parses still ends it). The same holds for `calendars` and the folders.
`deleteAccount(accountId)` removes the account, so Unipile stops reading the mailbox and billing it, and revokes the
provider's grant (Unipile's default). An account already gone resolves. A refusal's `detail` is Unipile's error type with its
thrower, the slash a dot: `provider.invalid_authorization` or `provider.insufficient_permissions` is one member's grant,
`api.missing_authorization` or `api.expired_authorization` the workspace key. Google answers a scope the account never
granted as `provider.invalid_authorization` too: the account's `scopes` tell the two apart.

`unipileMailbox(client, accountId)` (`unipile`) reads one workspace account as a [mailbox](mailbox.md) reader. A draft (a message in the drafts
folder) is left out of a listing and a thread, keeping the cursor.

## The fake

`fakeUnipile` optionally accepts `hostedConsent: {consentUrl, redirectUris, accountId}`.
Register absolute HTTP(S) URLs without userinfo or fragments. This mode replaces the `authLink` callback:
the real client's auth-link request must name one of `redirectUris`, and produces an expiring, single-use consent URL.
Fetching it through the fake's routes redirects to that address with the app-supplied `account_id`, its `provider` and the
bound `state`, as Unipile's hosted page does; browser parameters cannot override the binding.
Bindings are instance-local: a fixture adapter should obtain and consume a fresh auth link in the same request,
so restarting the dev server does not lose an earlier browser request's binding. Production hosted sign-in keeps no
library-local state. The app still provides the account fixture's `createdAt` value and enforces its nonce policy.
`hostedConsent.accountId` receives the sign-in's `{ state, providers, scopes }` and may return a Promise; the link request
must name its providers or the account it signs in again. With `apiKey`, `fakeUnipile` refuses any other key with a 401. An
account may name its `provider` (default `linkedin`), `email` (answered as its primary sender) and `scopes`.
`mailboxes: accountId => ({ emails, calendars, events }) | null` serves an account's mail newest first, filtered by `after`
(exclusive), with empty bodies under `meta_only` and a limit above 100 refused, as Unipile does; a thread by its id; the
folders its mail names (`INBOX`, `SENT`, `DRAFT`, `TRASH` and `SPAM` with their roles); its calendars; and a calendar's
events by start, filtered by `start`, `end` and `updated_after`. Every list pages by cursor, never by offset. An unknown account or calendar is a 404 in Unipile's error shape, and so is a deleted account,
everywhere in that fake instance.
