# Google

`googleMailbox({ token, fetch })` (`google`): Gmail and Google Calendar on a member's grant (`google.scopes.default`:
`gmail.readonly` and `calendar.readonly`; Gmail's is restricted, so Google verifies the app, and a yearly security
assessment, before it serves more than its test users). A listing is `users.messages.list` with `after:` and
`-in:drafts` (Gmail leaves spam and trash out), then each message's metadata, five at a time; a message gone since the
listing is dropped. A thread is read whole (`format=full`): the first text/plain and text/html parts, and a body Gmail
keeps apart (`attachmentId`, for a large one) with `messages.attachments.get`, in a thread only. A file is never a body:
not a part Gmail names a file, nor one sent as an attachment, nor any part inside either. Address headers are parsed with their quoted names, RFC 2047 encoded words and
RFC 5322 comments. A person Google names no email for is dropped from the attendees; an organizer it names none for
is the calendar's owner when the calendar's id is their address. Google answers a quota limit as 403
`rateLimitExceeded` or `userRateLimitExceeded`: that reads as `rate_limited`, not `rejected`, and a read is tried
once more after a second, as after a 429. A 403 `quotaExceeded` (Calendar's usage limits, which last hours) is
`rate_limited` too, and never tried again.

Signing a member in, each account's id and revoking a grant: [connect › Google and Microsoft](connect.md#google-and-microsoft).

The entry's `webhook` is Calendar push: `verifyWebhook(google.webhook, request, channelToken)` checks the
`x-goog-channel-token` header against the channel's token.

`google/fake` exports `fakeGoogle`: the sign-in and the reads on synthetic mailboxes, described with `fakeMicrosoft` on
the [Microsoft page](microsoft.md).
