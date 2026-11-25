# Google

`googleMailbox({ token, fetch })` (`google`): Gmail and Google Calendar on a member's grant (`GOOGLE_SCOPES`:
`gmail.readonly` and `calendar.readonly`; Gmail's is restricted, so Google verifies the app, and a yearly security
assessment, before it serves more than its test users). A listing is `users.messages.list` with `after:` and
`-in:drafts` (Gmail leaves spam and trash out), then each message's metadata, five at a time; a message gone since the
listing is dropped. A thread is read whole (`format=full`): the first text/plain and text/html parts, and a body Gmail
keeps apart (`attachmentId`, for a large one) with `messages.attachments.get`, in a thread only. A file is never a body:
not a part Gmail names a file, nor one sent as an attachment, nor any part inside either. Address headers are parsed with their quoted names, RFC 2047 encoded words and
RFC 5322 comments. A person Google names no email for is dropped from the attendees; an organizer it names none for
is the calendar's owner when the calendar's id is their address. Google answers a quota limit as 403
`rateLimitExceeded` or `userRateLimitExceeded`: that reads as `rate_limited`, not `rejected`.

`microsoftConnect` and `googleConnect` are `OAuthConnect`s: start with `startConnect` (PKCE, the verifier for the app to
keep with its state) and finish with `finishConnect`. Google's account is the Gmail address. Microsoft's is the user's
immutable Graph `id`, with the address as its name and in `details.email`: a tenant's admin can set a user's `mail` to any
address, another organization's included, so the address never says who signed in (nOAuth). Microsoft rotates
the refresh token on every refresh (`accessToken` stores the successor) and has no endpoint that revokes one app's delegated
grant, so its `revoke` does nothing: the grant lapses once the app deletes its tokens. Google's consent screen lets the
member untick a scope: `googleConnect` refuses a grant short of either (`rejected`, `scope_missing`), and `finishConnect`
revokes it. Google keeps the refresh token until it is revoked; `googleConnect.revoke` revokes it, and a token already
revoked resolves. A Google project in "Testing" gets
refresh tokens that expire after 7 days, and a password change ends a grant with Gmail scopes: both refresh as
`GrantRevoked`.

`fakeMicrosoft` and `fakeGoogle` (`microsoft/fake`, `google/fake`) answer the sign-in (consent with PKCE, code exchange,
refresh, Google's revoke) and the reads from synthetic mailboxes: `signIn(state)` names who consents (null declines),
`mailboxes(address)` what they hold, and `tokens` maps fixed access tokens to an address, as the kit's `GOOD_KEY`. Each
answers as its provider does where a reader could go wrong: Graph refuses a sort its filter does not lead
(`InefficientFilter`), lists bodies as HTML, and answers an all-day event's midnight in the mailbox's own zone
(`utcOffsetMinutes`); Gmail leaves spam and trash out of a listing, answers `format=metadata` with the headers asked for
only, and keeps a body past 4 KB apart, under an attachment id; Google Calendar refuses `orderBy=startTime` without `singleEvents`.
