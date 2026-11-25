# `slack`

`slack` exports `slackConnect`, `SLACK_SCOPES` and `slackClient({ token, fetch })`. The client posts once, lists up to
five pages of 200 channels (`{ items, skipped, channelsCut }`). `channelsCut` says more pages remain. Revoke a grant
with `revokeGrant(slack, { accessToken, fetch })` from `0-integrations/oauth`; an already-gone token is a successful
revoke. Token-gone responses from OAuth and the Web API are `GrantRevoked`, with the provider code in `detail`. The fake at `slack/fake` requires the registered
absolute `redirectUri`, refuses other destinations, and issues one-use codes bound to the authorization's client and
callback. Tests must authorize before exchanging a fake code.
