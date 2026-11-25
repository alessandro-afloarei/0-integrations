# Microsoft

`graphMailbox({ token, fetch })` (`microsoft`): Outlook mail and calendar through Microsoft Graph on a member's delegated
grant (`microsoft.scopes.default`: `offline_access User.Read Mail.Read Calendars.Read`). A message's role comes from the
well-known folder it sits in (read once per reader); Graph lists bodies as HTML. An address without `@` (Graph can name
an internal or deleted sender by its Exchange X500 name) is no address. A calendar view is read without `$select`, since
Graph answers an event's created and modified times only then. Events are asked for in UTC
(`Prefer: outlook.timezone="UTC"`) and come back without an offset, so the reader writes the `Z`; a time in any other zone
makes the event unreadable (skipped) rather than misread. An all-day event comes back as its own zone's midnight in UTC
(Rome's 9 November is 23:00 on the 8th), so its date is the nearest UTC midnight: right for every zone from UTC−11 to
UTC+12, a day early east of UTC+12 (New Zealand's summer, Tonga, Kiribati). Graph names the member's own answer apart from the attendees;
the reader puts it on their attendee entry. A next page is Graph's `@odata.nextLink`, followed only on Graph.

Sign a member in with `startConnect(google, …)` or `startConnect(microsoft, …)` (the entries at
`0-integrations/catalogue/<id>`; PKCE, the verifier for the app to keep with its state) and finish with `finishConnect`.
Google's account is the Gmail address, lowercased. Microsoft's is the user's immutable Graph `id`, lowercased, named by
its address (`mail`, else `userPrincipalName`, else the id): a tenant's admin can set a user's `mail` to any address,
another organization's included, so the address never says who signed in (nOAuth). A Microsoft user with no address
signs in; the mailbox reader refuses it (`no_mailbox`) at its first read. Microsoft rotates the refresh token on every
refresh (`accessToken` stores the successor) and has no endpoint that revokes one app's delegated grant, so its entry
declares no revoke: the grant lapses once the app deletes its tokens. Google's consent screen lets the member untick a
scope: its entry's `requireGranted` refuses a grant short of either (`rejected`, `scope_missing`), and `finishConnect`
revokes it. Google keeps the refresh token until it is revoked; `revokeGrant(google, { ...grant, client, fetch })`
revokes it, and a token already revoked resolves. A Google project in "Testing" gets
refresh tokens that expire after 7 days, and a password change ends a grant with Gmail scopes: both refresh as
`GrantRevoked`.

`fakeMicrosoft` and `fakeGoogle` (`microsoft/fake`, `google/fake`) answer the sign-in (consent with PKCE, code exchange,
refresh, Google's revoke) and the reads from synthetic mailboxes: `signIn(state)` names who consents (null declines),
`mailboxes(address)` what they hold, and `tokens` maps fixed access tokens to an address, as the kit's `GOOD_KEY`. Each
answers as its provider does where a reader could go wrong: Graph refuses a sort its filter does not lead
(`InefficientFilter`), lists bodies as HTML, and answers an all-day event's midnight in the mailbox's own zone
(`utcOffsetMinutes`); Gmail leaves spam and trash out of a listing, answers `format=metadata` with the headers asked for
only, and keeps a body past 4 KB apart, under an attachment id; Google Calendar refuses `orderBy=startTime` without `singleEvents`.
