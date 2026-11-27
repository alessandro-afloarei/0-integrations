# `slack`

`slack` exports `slackClient({ token, fetch })`, on slack.com. Sign in with `startConnect(slack, …)` and
`finishConnect(slack, …)` (the entry at `0-integrations/catalogue/slack`): on slack.com by default, or on GovSlack
with `values: { domain: 'slack-gov.com' }` (an app registered on api.slack-gov.com). The account is the team (an
org-level install's organization), read from the token answer with no request; `values.domain` is the instance, and
`values.botUserId` is the bot user when Slack names one. The client posts once, lists up to
five pages of 200 channels (`{ items, skipped, channelsCut }`) with a workspace-level token (an org-wide token must send
`team_id`, which the list does not). `channelsCut` says more pages remain. Revoke a grant
with `revokeGrant(slack, { accessToken, fetch, values: { domain: 'slack.com' } })` (the connection's `values`) from
`0-integrations/oauth`; an already-gone token is a successful
revoke. Token-gone responses from OAuth and the Web API are `GrantRevoked`, with the provider code in `detail`. The fake at `slack/fake` requires the registered
absolute `redirectUri`, refuses other destinations, and issues one-use codes bound to the authorization's client and
callback. Tests must authorize before exchanging a fake code.

The entry's `webhook` is the Events API's signature: `verifyWebhook(slack.webhook, request, signingSecret)` checks
`X-Slack-Signature` (`v0=` and the hex HMAC-SHA256 of `v0:{timestamp}:{body}`) and an `X-Slack-Request-Timestamp` within
five minutes, with the app's signing secret (not a token). `challengeAnswer(slack.webhook, request, signingSecret)`, called
first, answers the `url_verification` Slack sends when the Request URL is set, with its `challenge` as JSON, once its
signature is checked; it is null for every event and every unsigned request. The order is in
[webhooks](webhooks.md#receiving-a-delivery).
