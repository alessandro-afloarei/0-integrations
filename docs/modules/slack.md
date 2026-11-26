# `slack`

`slack` exports `slackClient({ token, fetch })`. Sign in with `startConnect(slack, …)` and `finishConnect(slack, …)` (the
entry at `0-integrations/catalogue/slack`): the account is the team, read from the token answer with no request, and
`values.botUserId` is the bot user when Slack names one. The client posts once, lists up to
five pages of 200 channels (`{ items, skipped, channelsCut }`). `channelsCut` says more pages remain. Revoke a grant
with `revokeGrant(slack, { accessToken, fetch })` from `0-integrations/oauth`; an already-gone token is a successful
revoke. Token-gone responses from OAuth and the Web API are `GrantRevoked`, with the provider code in `detail`. The fake at `slack/fake` requires the registered
absolute `redirectUri`, refuses other destinations, and issues one-use codes bound to the authorization's client and
callback. Tests must authorize before exchanging a fake code.

The entry's `webhook` is the Events API's signature: `verifyWebhook(slack.webhook, request, signingSecret)` checks
`X-Slack-Signature` (`v0=` and the hex HMAC-SHA256 of `v0:{timestamp}:{body}`) and a `X-Slack-Request-Timestamp` within
five minutes, with the app's signing secret (not a token). Then `challengeAnswer(slack.webhook, request)` answers the
`url_verification` Slack sends when the Request URL is set, with its `challenge` as JSON; it is null for every event.
The order is in [webhooks](webhooks.md#receiving-a-delivery).
