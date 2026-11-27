# Changelog

## Unreleased

Nothing here is released yet.

- New entries: 25 support providers (atlas, chatwoot, crisp, customerly, devrev, dixa, edesk, freshchat, freshdesk,
  freshservice, gist, groove, happyfox, helpcrunch, helpwise, hiver, liveagent, plain, pylon, reamaze, thena, trengo,
  unthread, zammad, zendesk), each with its category's operations (Plain its reads only). Every entry is `declared`.
- Front, Help Scout, Missive and Intercom list `support` again, with its operations: Front and Help Scout list it first
  (their home pages lead with support), Missive second (its leads with email). Front gains `conversations.update`,
  `messages.list`, `replies.create`, `comments.create` and `contacts.list`; Help Scout `conversations.update`,
  `threads.list`, `threads.create`, `notes.create` and `customers.list`; Missive `conversations.update`,
  `messages.list` and `contacts.list`; Intercom `conversations.list`, `.search`, `.get`, `.update`, `replies.create`
  and `contacts.list`. A reply (`replies.create`, `threads.create`, Intercom's with `message_type: 'comment'`) reaches
  the customer.
- Breaking: Intercom's requests carry `Intercom-Version: 2.18`, the version its declared operations are read from; it
  overrides the version selected on the app. It is the entry's default: a client built with its own `intercom-version`
  in `headers` sends that one on typed and raw calls alike, and a raw call's own header wins over both.
- Breaking: Help Scout's base is `https://api.helpscout.net`, each path naming its version (`customers.list` is
  `/v3/customers`); its operations send the same URLs as before. An app's raw `json`, `request` and `paginate` paths
  name the version now (`api.json('/v2/users/me')`, where `/users/me` was), and `baseUrl` lost its `/v2`. No sign-in,
  field or host changed, so a stored connection keeps working.
- Breaking: Acuity Scheduling, Bitbucket, Capsule, ClickUp, Close, Gist, Help Scout, HubSpot, Intercom, Jira, Outreach,
  Salesloft, SavvyCal, Teamleader Focus, Todoist and Wrike now send PKCE (S256), as every other OAuth 2 entry does: an
  app hands `finishConnect` the `codeVerifier` `startConnect` returned, and on `0-integrations/oauth` a `pkcePair()`'s
  `challenge` goes to `authorizeUrl` as `codeChallenge` and its `verifier` to `exchangeCode` as `codeVerifier`; without
  them `authorizeUrl` throws `code_challenge_required` and the exchange `code_verifier_required`, nothing sent.
  Refresh and revoke did not change, so a stored connection keeps working. Slack alone keeps `pkce: false`: its page
  states the refusal (`pkce_not_allowed`).

- New: `clientAuth: 'none'`, a public client: the code exchange, the refresh and an RFC 7009 revoke send its
  `client_id` in the body and no secret, even one an untyped caller passes; PKCE is required (an app's entry that
  declares `'none'` beside `pkce: false` throws `pkce_required: <entry id>` before anything is sent); and
  `OAuthClient<typeof entry>` then has no `clientSecret`.
- Firecrawl lists OAuth 2 first, a public client that revokes the whole connection with its refresh token; its API key
  is `signInWith(firecrawl, 'key')`. Breaking: `startConnect(firecrawl)` and `finishConnect(firecrawl, { secret })` on
  the whole entry now connect by OAuth 2 and throw `oauth_options_required` without its options, nothing sent; an app
  connects a key with `signInWith(firecrawl, 'key')`. A stored key's calls send the same `Authorization: Bearer`, and
  its disconnect is `revokeGrant(signInWith(firecrawl, 'key'), …)` (done, nothing sent): on the whole entry it now
  throws `oauth_client_required`, nothing sent. The OAuth 2 sign-in's account is the team its token answer names
  (`team_id`); the key's sign-in still names none.
- New entry: Brevo (`mail`), `emails.list`, `emails.get`, `domains.list` and `emails.create`: OAuth 2 first, a public
  client whose app Brevo reviews before other accounts authorize it, and its API key second, for your own Brevo
  account, `signInWith(brevo, 'key')`. `declared`. A send takes an HTML or a plain-text body, one of them; the list
  takes `startDate` and `endDate`; the domains list returns its `count`, `current_page` and `total_pages`.
- An OAuth 2 error detail never echoes the client's Basic value, also from a request that sent the client in the body.
  The client's secret, the code and the verifier are each read once, so a getter cannot send one value and redact
  another. A public client beside `pkce: false` is also refused before a revoke sent as a request.
- An entry's `authorizeParams` no longer replace a parameter the engine sends (`client_id`, `scope`, `redirect_uri`,
  `state`, `code_challenge`, `code_challenge_method`): an app's own entry that named one sent its value in place of the
  engine's, and now sends the engine's. No catalogue entry names one, and the table refuses it.
- Breaking: a refused code exchange (a bad, expired or replayed code, a wrong `redirect_uri` or code verifier) throws
  `ProviderHttpError` `rejected` with the RFC 6749 code as its detail, no longer `GrantRevoked`.
- Webhooks:
  - New: a webhook timestamp may be epoch milliseconds or an ISO 8601 instant (`timestamp.unit`); Zendesk verifies its
    webhooks.
  - New: a challenge may be read from a request header (`echo: { header }`, text only); Front verifies its webhooks and
    answers its validation request. A value read from a query or a header is never answered inside JSON, even by an
    app's own declaration that leaves out `text`.
  - Breaking: a signed webhook (`hmac`, `ed25519`) dedupes on a body path only; Breakcold reads `eventId`, PagerDuty
    `event.id` and TidyCal `id` from the signed body, and Linear, Sentry, RocketReach and Todoist declare no
    `deliveryId` (no page documents a signed per-delivery id), so `deliveryId()` answers null and an app dedupes them on
    its own key.
  - Breaking: `challengeAnswer(webhook, request, secret)` verifies the request itself unless the entry marks its
    challenge `unsigned`; call it before `verifyWebhook`. Slack's `url_verification` and Discord's PING are answered
    only under a valid signature: with a wrong secret they were answered, and are now null. A value is answered only as
    1 to 512 printable ASCII characters with no space, `<` or `>` (or a finite number as JSON). `Webhook.challenge`'s
    type changed: `echo` may be `{ query }`, and `when` is optional for it.
  - New: a challenge may be answered as text (`text/plain`, `nosniff`, its `content-length`), and read from a query,
    then answered only as text and only on a request with an empty body. Nylas declares its `GET ?challenge=` and
    Fellow its URL verification, both unsigned.
  - New: `basic` webhooks, checked by HTTP Basic credentials (`authorization: Basic <base64 of user:password>`, the
    secret `user:password`; one with no `:` or an empty password accepts nothing). Mailjet, Pipedrive and Postmark
    declare theirs: the app sets the user and password on the webhook (in the URL it registers; Pipedrive's
    `http_auth_user` and `http_auth_password`). Pipedrive dedupes on the body's `meta.version` and `meta.id` (webhooks
    v2; a v1 delivery, whose `meta.id` is the object's, has none), Postmark on `X-PM-Webhook-Trace-Id`.
  - New: a `standard` request with no `webhook-signature` is read under Svix's names, `svix-id`, `svix-timestamp` and
    `svix-signature` (it was `false`); an entry that dedupes on a header reads only that header's set. AgentMail,
    Resend and Fellow declare theirs (AgentMail deduped on the body's `event_id`, Resend and Fellow on `svix-id`), and
    Recall.ai's older accounts' Svix webhooks verify with each endpoint's own secret. Breaking: a `standard` entry
    whose `deliveryId` header is neither `webhook-id` nor `svix-id` accepts nothing (no catalogue entry has one).
  - Krisp declares its webhook as `token` on `authorization`: the person adds an `Authorization` request header
    holding the app's secret in Krisp's webhook settings, and the app passes that value as the secret.
- Requests and paging:
  - An operation that declares no `result` answers `null` for any 2xx with an empty body (whitespace only; a 202 or a
    201 as well as a 204); a body that is not JSON is still `invalid_response`, and so is an empty 2xx to an operation
    with a `result`. SendGrid sends mail (`emails.create`, its 202) and Missive creates drafts (`drafts.create`, its
    201), which never send: `send` and `send_at` are not declared, and a key inside `drafts` the entry does not declare
    is dropped.
  - New: `last` paging reads the next value at `next` in the last record of a page's list, to an empty list (or a falsy
    `more`); `client()` refuses an operation on it whose `records` is not the shape's `list`. Render's `deploys.list`
    and `services.list` walk by `cursor`, Resend's `emails.list` and `domains.list` by `after` while `has_more`,
    Daily's `rooms.list` and `recordings.list` by `starting_after`, and Agile CRM's `deals.list` by the last deal's
    `cursor`.
  - A cursor may be a whole number, sent as a string of its digits in the query or a JSON body: a numeric cursor no
    longer ends a walk after its first page, or throws `cursor_missing` beside a truthy `more`; a negative or
    fractional one is still blank. Vercel's `deployments.list` walks by `pagination.next`, a timestamp, sent as `until`.
  - Breaking: Render's `deploys.list` and `services.list`, Resend's `emails.list` and `domains.list`, Daily's
    `rooms.list` and `recordings.list`, Agile CRM's `deals.list` and Vercel's `deployments.list` return an async
    iterator of records, not one page (`for await (const room of api.rooms.list())`). Their cursor arguments are gone
    (Render's `cursor`, Resend's `after` and `before`, Daily's `starting_after` and `ending_before`, Agile CRM's
    `cursor`, Vercel's `until`): an app that paged by hand drops its loop, reads backward with a one-page `json` call,
    and resumes from a stored cursor with `api.paginate(<shape>, <path>, { query: { <param>: <cursor> } })`.
  - New: `in: 'header'` parameters, sent as a request header over the entry's and the app's, never the credential; a
    value outside printable ASCII is `param_invalid`. `RequestOptions` takes `headers`, and the derived fake hands an
    operation's function the request's `headers` and routes by a required header the request carries. PagerDuty
    creates and updates incidents (`incidents.create`, `incidents.update`) with the `From` header its page requires;
    Cal.com lists event types and bookings (`eventTypes.list`, `bookings.list`, the bookings paged by its cursor), each
    taking the one `cal-api-version` its page fixes as a required argument, sent in place of the entry's; Resend's
    `emails.create` takes an optional `idempotency-key`.
  - Breaking: PagerDuty's OAuth 2 sign-in asks `write` in place of `read`, which the writes need. An app registered for
    Classic User OAuth with `Read` access is set to `Read/Write` (else PagerDuty grants only `openid` and the connect
    fails), and its connections are made again. Its key's help asks for an account API token with full access.
  - New: a wait may be an ISO 8601 time (`unit: 'iso8601'`: `2021-06-15T10:51:23.035+0100`, its zone required), waited
    until that instant. Teamleader waits until its `x-ratelimit-reset`, where it waited a minute. People Data Labs waits
    a read's 429 until its `x-ratelimit-reset` when that is within a minute, and reports a longer one (a day's limit)
    with that wait; a 429 that states no wait is still not retried. A Jira 429 carries its `X-RateLimit-Reset` as its
    wait, or its `Retry-After` when that is later; a read is still retried only after a `Retry-After`, and never before
    the reset (a reset past a minute is reported).
  - A read whose answer a `rateLimit` rule marks is retried as a 429 is (a header `retry.wait` counts on it as on a
    429), never past `maxWaitMs`: Google's 403 `rateLimitExceeded` and `userRateLimitExceeded` after a second, GitHub's
    secondary-limit 403 after its `retry-after`. Notion's 529 `service_overload` is a rate limit: `rate_limited` where
    it was `unavailable`, and a read is retried after its `Retry-After`, else a second.
  - An answer's wait, for the retry and its error alike, is the later of its stated wait (`Retry-After`, else
    `retry.wait`) and the matching `rateLimit` rule's own `wait`. GitHub's primary limit (a 403 or a 429 with
    `x-ratelimit-remaining: 0`) is never sent again before its reset: with a reset past a minute it is reported,
    carrying the reset, where a shorter `Retry-After` was retried and carried. `onlyStated` still asks for a
    `Retry-After` (or `retry.wait`); a rule's own wait alone is carried, not retried. An answer a rule of the entry may
    hold for (Google's, GitHub's, Jira's) has its body read; one whose body does not arrive within `timeoutMs` is not
    retried, and is classified by its status and headers (a 429 `rate_limited` with its `Retry-After`, as before).
  - Google's 403 `quotaExceeded` (Calendar's usage limits, which last hours) is still `rate_limited` but never retried,
    and its error carries only a wait the answer states (it carried a minute no page states).
  - For contributors: a recording keeps a declared wait header holding an ISO 8601 instant the engine reads, as it
    keeps one holding a number; a header holding any other text is still dropped.
- New entries: 24 mail, calendar and meetings providers (acuity, agentmail, avoma, calcom, calendly, circleback, daily,
  fellow, front, gotomeeting, helpscout, krisp, mailjet, meetgeek, missive, nylas, postmark, recallai, resend, savvycal,
  sendgrid, tidycal, webex, whereby), each with its category's operations. Every entry is `declared`.
- New: `errors.detail` reads a numeric code as its digits (a non-negative whole number: `allow`, `revoked` and
  `failed` compare `'2001'`, and a rule's `detail: true` now holds for it); PagerDuty, Smartsheet and Cognism report
  theirs. A path that holds the HTTP status as a number now reads as the code and hides a later path: an app's own
  entry leaves it out, as Google's no longer lists `error.code`.
- New: `in: 'form'` parameters, sent as a form body; Chatwork and Zulip post messages, Agile CRM lists companies. A
  form's `content-type` wins over the entry's and the app's, on a raw `request`, `json` or `paginate` call too. A call
  holds one body: a `json` beside a `form` is refused by the types, and at run time as `request_failed` before it is
  sent, as is a raw `paginate` of a form on a body cursor; a form operation paged by a body cursor is refused
  (`param_paged`). The derived fake hands such an
  operation's function its form body as its fields, each a string.
- Chatwork's OAuth 2 sign-in asks `rooms.messages:write` as well: a client registered with the earlier scopes is
  registered again with the declared ones, or its authorize fails with 5003. A connection made before this change has
  no `rooms.messages:write`: `messages.create` gets `rejected` until the person connects again.
- New: `webhook.secret` decodes a base64 or hex secret before it keys the HMAC; Airtable, Chatwork and Close declare
  their webhooks. The decoding is strict (base64's `=` padding optional), and a key of only zero bytes keys nothing.
- Breaking: a `standard` secret goes through the same decoding. A secret it accepted and now refuses (`false`): one
  holding whitespace (a space or a trailing newline), the URL-safe alphabet (`-`, `_`) or another character outside
  base64, a last character with unused bits set (`YR==`), or one that decodes to only zero bytes, as is now a plain
  `hmac` secret of NUL characters. An unpadded secret is still accepted.
- Intercom lists OAuth 2 first, on its US hosts (authorize on app.intercom.com, the token and every call on
  api.intercom.io, which attempts to route a call to the workspace's region), with no revoke; its access token, on the
  region the person picks, is `signInWith(intercom, 'key')`, sent only to the three regional API hosts. Breaking: a key
  connection that still calls the whole entry with its `apiHost` (`client(intercom, { token, values: { apiHost } })`)
  is now refused (`value_undeclared: intercom apiHost`), nothing sent; an app narrows it with
  `signInWith(intercom, 'key')` for every call.
- Azure DevOps also takes a personal access token, `signInWith(azuredevops, 'key')`: Basic with an empty user, its own
  fields (the organization and the token) and its own credential check (the organization's project list, with no
  account id), since the Profiles API the Entra sign-in identifies with refuses a personal access token. Its help says
  it is for your own scripts and tools. Existing connections change nothing: the entry used whole is its Entra OAuth 2.
- Trello lists OAuth 2.0 (3LO) first, on auth.atlassian.com (PKCE, `prompt=consent`, a JSON token request, scopes
  `read:member:trello offline_access`), its token Bearer on `api.trello.com/1`; its API key and token are
  `signInWith(trello, 'key')`. Breaking: a key connection that still calls the whole entry with its `apiKey`
  (`client(trello, { token, values: { apiKey } })`) is now refused (`value_undeclared: trello apiKey`), nothing sent;
  an app narrows it with `signInWith(trello, 'key')` for every call.
- Freshsales checks the bundle alias host against `*.myfreshworks.com` and `*.freshworks.com`: any other host, a
  Freshsales Classic `<domain>.freshsales.io` included, is refused with `base_host_refused` and nothing is sent, where
  any public host was accepted before, so the entry no longer goes through the address guard by default.
- Honeybadger and PayPal send the credential only to the two API hosts each names (`app.honeybadger.io` and
  `eu-app.honeybadger.io`; `api-m.paypal.com` and `api-m.sandbox.paypal.com`), never another host of their domain: a
  stored `apiHost` outside them is refused with `base_host_refused` before a credential is read, and nothing is sent.
- Slack signs in on commercial Slack or GovSlack: a plain field `domain` (`slack.com`, the default, or `slack-gov.com`)
  gives every Slack URL its host, and `startConnect` and `finishConnect` return it in `values`. Breaking: a Slack
  connection stored before this change passes `values: { domain: 'slack.com' }` (beside `botUserId`) to `client`,
  `refreshGrant` and `revokeGrant`, and to `authorizeUrl` and `exchangeCode` when it calls them itself; without it they
  throw `template_missing: slack {domain}` and send nothing. `slackClient` keeps calling slack.com.
- New entry: Pipedrive (`crm`), OAuth 2 alone (PKCE, Basic client authentication), its calls on the `api_domain` its
  token answer names: persons (list, search, get, create, update), organizations and deals. `declared`.
- For contributors: the recorder refuses, before any request, an entry whose base's host holds a value
  `RECORD_VALUES` does not give as the host alone (never an `https://` origin): a field's, even one with a default or
  choices, or a host the token answer names.
- New: a sign-in after the first may declare its own `fields`, base and host (`http: { baseUrl, host }`, nothing else
  of `http`) and `identify`; `signInWith` puts them in place of the entry's. The engine refuses an app's entry whose
  first sign-in declares one, before anything is sent (`sign_in_own_first: <entry id>`), and `startConnect` now runs
  the host checks for a form too.
- Breaking: a key in `values` that is neither a field of the entry's sign-in nor a `save` key is refused
  (`TypeError('value_undeclared: <entry id> <key>')`) by `client()`, every connect and OAuth 2 step, a refresh, a
  revoke and `tokenSource`, before a credential is read or anything is sent; it was ignored. An app that passes extra
  keys in `values` drops them; the `values` a connection was returned are always accepted.
- Outline lists OAuth 2 first, on app.getoutline.com, and its OAuth 2 revokes the refresh token; its API key, on the
  host the person types, is `signInWith(outline, 'key')`. Breaking: a key connection that still calls the whole entry
  with its `host` (`client(outline, { token, values: { host } })`) is now refused (`value_undeclared: outline host`),
  never sent to app.getoutline.com; an app narrows it with `signInWith(outline, 'key')` for every call.
- A key or token `finishConnect` checks its typed host before it reads a secret from its input, whether or not identify
  sends a request: a host outside `http.host`, or an IPv4 literal under `'*'` in a range the address guard blocks
  (`address_blocked`), or any IPv6 literal (`base_value_invalid`), is refused and nothing is returned to store; before,
  a connection whose identify sent nothing kept the host unchecked.
- New: `http.host` may list several patterns; the filled host must match one. `'*'` stays alone.
- Smartsheet takes its product's host in `apiHost` (`api.smartsheet.com` by default; `api.smartsheetgov.com`,
  `api.smartsheet.eu`, `api.smartsheet.au`). Breaking: a client never applies the default, so an existing connection
  passes `values: { apiHost: 'api.smartsheet.com' }`; without it, its calls are `template_missing`.
- New: an OAuth 2 entry's base may be the host its token answer names, kept by `save` and checked against a declared
  domain at connect (whether or not identify sends a request), before every call and before a refresh whose URL names
  it. The host may come as an https origin (`https://x.example.com`, read as its host); a token answer without one is
  `invalid_response` (`missing_fields`), and one outside the domain is refused; either way the engine attempts to revoke
  the fresh grant (not for an entry marked `reusesGrant`), which reaches the provider only through a revoke URL on a
  fixed host (a revoke sent as a request on the base cannot reach a refused host), reports a failed attempt to
  `onRevokeFailed` and throws the original refusal. Such a host beside one the person types is `host_split`, and with
  `http.host: '*'`, none, or a list with no domain (`[]`, `['*']`), it is refused (`base_host_refused`) before anything
  is sent.
- The refresh URL is filled and checked only when a refresh is sent (the consent URL, the exchange and a revoke no
  longer fill it), and it alone of the OAuth 2 URLs may name a host the token answer names.
- New entry: Wrike (tasks; OAuth 2, on the data centre its token answer names). Every entry is `declared`.
- Every entry's `retry` was read against its provider's rate-limit page: an entry whose pages state no limit status
  declares none, and a number no page states is gone. A positive `Retry-After` still wins wherever one is sent. The
  engine retries an operation of `kind: 'read'` (or a GET with no `kind`), a raw GET or a raw call marked idempotent,
  and identify's request when it is a GET (a POST or GraphQL identify is sent once); a call given the caller's own
  `signal` is never retried. A read below is one of these, and a 5xx one the engine retries, a 500, 502, 503 or 504
  (a 501 or a 505 is reported at once). A rate-limited read now:
  - Affinity: waits its `x-ratelimit-limit-user-reset` header, not one second.
  - Attio: waits a `Retry-After` up to the engine's 60-second cap, no longer 10 seconds.
  - Azure DevOps: waits its `X-RateLimit-Reset` header, not one second.
  - Bitbucket: is retried after its `Retry-After`, else one second, and a 408, a 5xx or a dropped connection on a read
    is now retried once; it was not retried.
  - Breakcold: waits a minute when it names no wait; it retried at once.
  - Capsule: is retried only when its answer states a wait, and waits its `X-RateLimit-Reset` header; it was not
    retried.
  - Chatwork: waits its `x-ratelimit-reset` header, not one second.
  - ClickUp: waits its `X-RateLimit-Reset` header, not one second.
  - Cognism: identify and a raw read wait its `x-rate-limit-reset` header, else a minute, not one second; its four
    typed operations are POSTs, never retried.
  - Discord: is retried only when its answer states a wait, and waits its `retry_after` body field when no
    `Retry-After` is sent; it was not retried.
  - Exa: is retried once, after its `Retry-After` or one second, no longer three times 30 seconds apart, and a 5xx or a
    dropped connection once, not three times; `exaClient`'s search too.
  - Fathom: waits its 60-second window when it names no wait (was five seconds); `fathomClient` too.
  - Figma: is retried after its `Retry-After`, else one second, and a 408, a 5xx or a dropped connection on a read is
    now retried once; it was not retried.
  - Fireflies: is retried only when its answer states a wait, in `Retry-After` or the error's `retryAfter`; it was
    never retried. Only `user()` is such a read, `firefliesClient`'s too when called without a `signal`; every other
    Fireflies call is a GraphQL POST, never retried. The body wait drives a retry on a 429 (or a 408 or a 5xx); a
    GraphQL error that arrives with HTTP 200 is reported at once, its wait carried on the error.
  - Firecrawl: waits a minute when it names no wait (was 30 seconds), and a 429, a 5xx or a dropped connection is
    retried once, not three times; `firecrawlClient`'s map and plain scrape too.
  - Freshsales: waits a minute when it names no wait, not one second.
  - GitBook: waits its `X-RateLimit-Reset` header, not one second.
  - GitHub: is retried only on a 408, 429, 500, 502, 503 or 504, or a secondary-limit 403, that names a positive
    `Retry-After` of at most 60 seconds, and never before a primary limit's reset: such a read is waited and tried once
    more, `githubClient`'s reads too; it was not retried. Every other error status (another 403, a 505) is reported at
    once, with its wait where it names one, and so are a primary limit with no `Retry-After` and a longer wait.
  - GitLab: is retried after its `Retry-After`, else one second, and a 408, a 5xx or a dropped connection on a read is
    now retried once; it was not retried.
  - Google: is retried once, after its `Retry-After` or one second, up to the engine's 60-second cap, and a 5xx or a
    dropped connection once, not twice: no page states the two retries, the 30-second cap or the 5-second wait.
    `googleMailbox`'s Gmail and Calendar reads too.
  - HubSpot: waits its 10-second window when it names no wait (was one second), and waits a stated `Retry-After` up to
    the engine's minute (was reported past 10 seconds); `hubspotClient` too.
  - Instantly: waits a minute when it names no wait, not one second.
  - Intercom: waits its `X-RateLimit-Reset` header, else its 10-second window.
  - LeadIQ: waits a minute when it names no wait, not one second; only a raw GET or a raw call marked idempotent is
    retried (every typed call is a POST).
  - Microsoft: is retried once, after its `Retry-After` (up to the engine's 60-second cap) or one second, and a 5xx or
    a dropped connection once, not twice: no page states the two retries, the 30-second cap or the 5-second wait.
    `graphMailbox`'s reads too.
  - monday.com: is retried only when its answer states a wait, in `Retry-After` or the error's `retry_in_seconds`;
    it was retried after one second without one, and a 5xx that names no wait is no longer retried. The body wait
    drives a retry on a 429 (or a 408 or a 5xx); a GraphQL error that arrives with HTTP 200 is reported at once, its
    wait carried on the error.
  - PayPal: is retried only when its answer names `Retry-After`; it was not retried.
  - People Data Labs: identify and a raw read are retried only when the answer states a wait (a `Retry-After`, or its
    429's ISO 8601 reset), not after one second, and a 5xx that names no wait is no longer retried.
    Its typed operations are writes (searches by POST, enrichments that spend credits), never retried.
  - Render: waits a minute when it names no wait, not one second.
  - Rollbar: waits its `X-Rate-Limit-Remaining-Seconds` header, not one second.
  - Salesloft: waits a minute when it names no wait, and a 408, a 5xx or a dropped connection on a read is now retried
    once; it was not retried.
  - SerpApi: is retried once, after its `Retry-After` or one second (its page names no wait), and a 408, a 5xx or a
    dropped connection on a read is now retried once; it was not retried.
  - Shortcut: waits a minute when it names no wait, not one second.
  - Superhuman Docs: waits its 6-second window when it names no wait, not one second.
  - Teamleader Focus: waits a minute when it names no wait, not one second.
  - Trello: is retried after its 10-second window, and a 408, a 5xx or a dropped connection on a read is now retried
    once; it was not retried.
  - Unipile: is retried only when its answer states a wait: Unipile's own 429 waits its `retry-after` once; a
    provider's 429 with no stated wait is no longer retried (its page: going past a provider's limit "may temporarily
    block the account"), nor is a 5xx that names none (was three retries 30 seconds apart, or a backoff).
    `unipileClient` and `unipileMailbox` too; `deleteAccount()`, an idempotent DELETE, is sent once on a 503 that
    names no wait (it was sent four times, with backoff), and still retried after a short `Retry-After`.
  - Vercel: waits a minute when it names no wait, not one second.
  - Zoom: is retried once, after its `Retry-After` or one second (its page names no wait), and a 408, a 5xx or a
    dropped connection on a read is now retried once; it was not retried.
- New: an operation may declare `anyOf`, sets of arguments of which a call must give one whole. `client()` refuses a
  call that gives none (`param_group_missing: <id>`) before anything is sent, and an `anyOf` path that names no declared
  argument, or an empty set, when the client is built (`param_group_unknown: <id> <path>`). Freshsales, Hunter,
  lemlist, People Data Labs, Reply.io and Salesloft declare their groups.
- Cognism's, LeadIQ's and RocketReach's parameter descriptions no longer say to give at least one input, which no page
  of theirs states; `catalogue.json` carries those descriptions to an app.
- A retry never comes before the provider's stated wait, its `Retry-After` or the entry's `retry.wait`: an answer whose
  stated wait is longer than the entry's `maxWaitMs` is not retried, whatever its status, and its error carries that
  wait. Breaking: such an answer was retried at the cap (HubSpot's hour-long `Retry-After` after 10 seconds); an app
  now gets `rate_limited` with `retryAfterMs` and waits it itself. Every error's `retryAfterMs` is that stated wait: a
  `Retry-After` of 0 no longer hides Breakcold's or Fireflies' body wait.
- New: `retry.wait` reads a wait from a header (seconds, milliseconds or an epoch time; of several headers, the longest
  present; counted on a 429, or an answer a `rateLimit` rule marks) or a body field (on any answer that holds it), and `retry.onlyStated` retries only an
  answer that states its wait, and no network failure. A wait already past, or 0, counts as none (Breakcold's body 0
  now waits its default minute).
- Breaking: `retry.waitFromBody` and a rate-limit rule's `resetAt` are gone. An app's own entry writes
  `retry: { wait: { path, unit } }` and the rule's `wait: { header, unit }`.
- Buildkite and PagerDuty wait their reset headers (PagerDuty a minute when a 429 comes without one); Todoist waits its
  error body's `retry_after`; Jira now retries a read whose answer names `Retry-After`, and no other.
- An authorize URL carries no `scope` when the entry asks for none (Attio, Bitbucket, ClickUp, GitHub, Mattermost,
  Teamleader); it sent an empty `scope=`.
- `authorizeUrl`, `exchangeCode`, `refreshGrant`, `revokeGrant` and `tokenSource` type `values` by the entry, as
  `startConnect` and `finishConnect` do. Breaking for types: for an entry with a plain field (Mattermost's `host`) an
  app must pass `values`, and an undeclared key does not compile; a connection's own `values` may be passed back for
  every entry, and an entry read as a wide `Entry` takes them as optional. The value types (`Plain`, `Kept`, `Entered`,
  `Secrets`, `ValuesOption`, `Wait`) are exported from `0-integrations/catalogue`.
- `fakeProvider` answers an OAuth 2 entry's token, refresh and revoke URLs (with `client` and `code` options) and a
  revoke sent as a request, and of two operations that share a route, the one whose required parameters the request
  carries. A token answer holds the value `values` gives a `save` key that reads it.
- The 28 entries written before every value had to be cited from the provider's documentation are checked against
  their providers' pages.
- Exa's and Firecrawl's `docs` links point to their current pages.
- Attio lists OAuth 2 first; its API key is `signInWith(attio, 'key')`.
- GitHub lists OAuth 2 first; its personal access token is `signInWith(github, 'key')`.
- GitLab lists OAuth 2 first, on the host the person types; its personal access token is `signInWith(gitlab, 'key')`.
  `client(gitlab, …)` on the whole entry now sends `Authorization: Bearer`; it sent `private-token`, as the key still
  does.
- HubSpot lists a key second, the static auth access token of an app installed in your own account:
  `signInWith(hubspot, 'key')`.
- Figma adds a personal access token second, sent in `X-Figma-Token`: `signInWith(figma, 'key')`.
- Figma's connect identifies with `GET /v1/me` (`id`), no longer the token answer's `user_id_string`, which a key has
  not; Figma does not state the two are equal, so an app that keyed Figma connections by account id should check one.
  Its default scope is `current_user:read` alone: for more, an app derives an entry,
  `defineProvider({ ...figma, scopes: { default: ['current_user:read', …] } })`.
- Aircall, Apollo, Fathom, Firecrawl, Intercom, Notion and Stripe's key fields gain a `help` naming which credential to
  paste.
- Notion sends `Content-Type: application/json` on every request, beside `Notion-Version`, as its authorization guide
  asks.
- Discord's calls send `Content-Type: application/json` and `User-Agent: DiscordBot
  (https://www.npmjs.com/package/0-integrations, 0.13.0)`, which Discord asks of every client; a release updates the
  version.
- Intercom's calls send `Accept: application/json`, without which Intercom may answer 404 or 406.
- PayPal sends `Accept: application/json` on every call and on its token request.
- Slack identifies an org-level install by its organization (`enterprise.id`); it failed with `missing_fields`.
- Aircall, Apollo, Attio, Fathom, GitHub, Granola, HubSpot, Lusha and Notion no longer declare `minIntervalMs`: each
  limit depends on the plan or is shared by the account, workspace or the person's other keys and tokens (their
  modules still take one).
- Granola, Intercom, Slack and Stripe declare a retry. An idempotent call (a GET unless the caller marks it otherwise,
  or a call marked idempotent) made without the caller's own abort signal is sent once more after a 429, a 408, 500,
  502, 503 or 504, or a network failure. It waits the answer's `Retry-After` when it gives a valid, positive delay;
  else, after a 429, the entry's own wait (Granola 5 seconds, Intercom its `X-RateLimit-Reset`, else 10 seconds,
  Slack and Stripe 1 second), and after any other, at most one second; never more than 60 seconds.
- `finishConnect` over a union of key or token entries takes each member's own secret fields; it asked for every
  member's at once (HubSpot's `accessToken` beside Attio's `apiKey`). An OAuth 2 member adds no form input.
- `FirefliesUser`'s `email` and `name` are `string | null` (they were `string`): a Fireflies user without one no longer
  fails `user()` with `invalid_response`. The entry's `client(fireflies).user()` leaves out a null `email` or `name`.
- For contributors: a key sign-in may name a `tokenAnswer.*` path in an identify `id` or `name` list ending on a path
  of identify's requested answer, beside an OAuth 2 or token sign-in (HubSpot's `['tokenAnswer.hub_id', 'portalId']`);
  any other `tokenAnswer.*` on a key sign-in is still refused.
- New: an entry may list several sign-ins (OAuth 2, then a key); `signInWith(entry, kind)` from
  `0-integrations/catalogue` narrows it to one, and every call takes the narrowed entry. First used by Linear and
  ClickUp.
- New: an OAuth 2 sign-in may read the entry's plain fields: `startConnect` takes and returns `values`, and
  `authorizeUrl`, `exchangeCode`, `finishConnect`, `refreshGrant` and `revokeGrant` take them; `Connected['values']`
  holds the plain fields for every sign-in kind. Every OAuth 2 URL is filled and checked as a base is. On a typed host,
  a credential goes only to that host: an entry whose base, `http.bases` and OAuth 2 URLs do not share one host when
  any of them is typed is refused with `host_split` before anything is built or sent, for every sign-in. First
  used by Mattermost, which now lists OAuth 2 first; its personal access token is `signInWith(mattermost, 'key')`.
- `exchangeCode`, `refreshGrant` and `revokeGrant` take `fetch` as an option, by default `guardedFetch` for an entry
  whose host is typed.
- A named base (`http.bases`) with a placeholder is refused where a call chooses it (`base_templated`); it was sent
  to a host spelt with braces.
- A URL template that is not well formed (`https://`, then letters, digits, `.`, `-` and `{name}`s with an optional
  literal port, then `/` or the end) refuses its entry, `base_host_refused`, before anything is sent on any path:
  `https:///{x}` sent a typed value to the host with no `http.host` check.
- A `token` sign-in is under the host rule: a token request whose URL does not share the typed base's host is refused,
  `host_split`, before it is sent; the token it gave went to the host typed.
- `client()`'s `baseUrl` on an entry whose host is typed must keep the filled base's origin, else `base_host_refused`
  before anything is sent; it was used as given, so a grant from the host typed could go to another origin.
- New entry: Azure DevOps (code; Microsoft Entra OAuth 2). Every entry is `declared`.
- New entries: 23 CRM and sales providers (affinity, agilecrm, capsule, clay, close, cognism, folk, freshsales, hunter,
  insightly, instantly, leadfeeder (formerly Dealfront), leadiq, lemlist, nutshell, outreach, peopledatalabs, replyio,
  rocketreach, salesflare, salesloft, teamleader, zoominfo), each with the operations of its category's template the
  engine can say, Clay with none (a search or an enrichment there takes more than one request); what waits is in the
  waiting list. Every entry is `declared`.
- An OAuth 2 token answer that states no `token_type` is read as Bearer; it was `invalid_response`. One that states
  another type is still refused unless the entry lists it in `tokenTypes`. First used by ClickUp.
- New entries: Buildkite (code), ClickUp (tasks; OAuth 2 and a key), Linear (tasks; OAuth 2 and a key), Rollbar
  (monitoring), Shortcut (tasks). Every entry is `declared`.
- An operation that declares body parameters sends a JSON object, `{}` when called with no body argument; it sent no body.
- New entries: 23 developer tools and productivity providers (airtable, asana, betterstack, bitbucket, chatwork,
  circleci, coda, gitbook, guru, honeybadger, incidentio, line, mattermost, monday, outline, pagerduty, render, sentry,
  slite, smartsheet, todoist, vercel, zulip), each with the operations of its category's template the engine can say;
  what waits is in the waiting list. Every entry is `declared`.
- A paged operation whose `result` is a list and that names no `records` yields the list's elements (an answer that is
  a list), a bad one skipped and reported; it yielded each page whole. First used by Buildkite.
- New: `linkHeader` paging, first used by Buildkite; a next link may be a path on the provider's origin, first used by
  Shortcut.
- New: `page` paging (a page number in the query or the body, 1-based or `zeroBased`), first used by Rollbar and ClickUp.
  An empty list ends it; a list that is missing or no list is `invalid_response`, as in a typed paged operation.
- New: `offset` paging (a record offset in the query or the body, the next one counted from the records received),
  first used by Outline and PagerDuty, whose lists now page to their end. PagerDuty's page up to its 10,000-record
  cap; past it PagerDuty answers 400 and the walk fails there, so narrow a larger result set with a filter.
- `client()` refuses an operation on a `page`, `offset` or `last` shape whose `records` is not the shape's `list`
  (`records_unpaged`), as the table test already did for this library's entries.
- `client()` refuses an operation with a parameter in the place its paging shape's `send` writes (`param_paged`), as the
  table test already did for this library's entries; a call sent the caller's value first, then the walk's. A
  literal query in the operation's path that names the key the walk writes (`/items?offset=2`) is refused the same way.
- New: `docs/providers.md`, every entry with its categories, sign-ins, operations, webhook and tier, generated by
  `pnpm providers`; `docs/waiting-list.md`, what providers need that the engine cannot say yet.
- New: `categories` on an entry (a closed list) and `docs` on an operation; every library entry and operation has them.
- New: an entry can send its key in the query string (`send: { query }`), first used by SerpApi.
- A blank plain value (Aircall's `apiId: ''`) is refused with `template_missing` before anything is sent; it was sent as
  `Basic :<token>`.
- Every entry has a `docs` link.
- New: a field may offer `choices` and a `default`, with `help`; a base may hold a host part from a plain value, checked
  against `http.host`. First used by Intercom's region. Only `startConnect` and `finishConnect` apply a default: a
  client needs the connection's `values`.
- New: `guardedFetch` (from `0-integrations/client`) refuses private, loopback, link-local, unique-local and metadata
  addresses; an entry whose host is typed (`http.host: '*'`, first GitLab) uses it unless the app passes its own `fetch`.
- `finishConnect`'s `fetch` is optional.
- `guardedFetch` asks for no compression (`accept-encoding: identity`, replacing a caller's), and decodes none.
- An entry with `retry` now also retries 408, 500, 502, 503 and 504 answers and network failures on reads, with
  full-jitter backoff from one second: the n-th retry waits a random share of at most 1, 2, 4 seconds and so on, capped
  by `maxWaitMs`, or a positive `Retry-After` (Microsoft, Google, Attio, HubSpot, Notion, Aircall, Breakcold and the
  other entries that declare `retry`). A timeout is not retried. An entry with `retry.onlyStated` (Capsule, Discord,
  Fireflies, GitHub, Jira, monday.com, PayPal, People Data Labs, Unipile) retries only an answer that states its wait,
  and no network failure.
- A Firecrawl scrape that runs a script (`actions`) skips the automatic retries: a 5xx or a dropped connection goes
  straight to the plain read, and a 429 fails with the wait Firecrawl names (before, its 429 was retried). A plain
  scrape and a map are retried as reads.
- New: `oauth2.json` (the token endpoint takes JSON), first used by Jira, and `oauth2.refreshUrl`, first used by Figma's
  refresh endpoint.
- New: a declared call may name one of `http.bases` (`Call.base`); a base may take a path segment from a plain or saved
  value. First used by Jira (Atlassian 3LO).
- New: the `token` sign-in kind, one declared request for client credentials or a session sign-in, and
  `tokenSource(entry, { secret, values })` for `client()`. First used by Zoom Server-to-Server OAuth.
- `startConnect` and `finishConnect` run a `token` entry (Metabase, PayPal, Zoom); a token URL may take its host from a
  field, and a typed host is address-guarded.
- `tokenAnswer.*` never holds the token's own key (`access_token`, `refresh_token`, or a `token` entry's `token` path):
  an entry naming one reads nothing. `save` keeps only a string, a number or a boolean: an object or a list
  (`tokenAnswer.authed_user`) is not kept.
- An app's own `baseUrl` must be https, as every URL the library sends to: one that is not, or that does not parse or
  holds a username or password, is `base_host_refused`.
- New: webhook `hash: 'sha1'` (Intercom) and `part` for headers such as Stripe's `t=…,v1=…`. A signature header over
  8 KiB is refused before it is parsed.
- New: `send: { header, value }` (Discord's `Bot {token}`, Trello's `OAuth …` header) and `ed25519` webhooks.
- New: `token` webhooks (Google Calendar push's channel token) and `standard` (Standard Webhooks, GitLab's signing token;
  a `webhook-id` holding a `.` is refused, as the specification asks).
- An HMAC webhook checked with an empty secret is `false`: anyone can sign with an empty key.
- New: `challengeAnswer(entry.webhook, request)` answers Slack's `url_verification` and Discord's PING; Slack's entry
  declares its signature.
- A provider code equal to any value a credential template took (Aircall's `apiId` in its Basic pair, Trello's key in
  its header) is no error's detail; before, only the token and the header's value were withheld.
- New: `fakeProvider(entry, { key, values?, account?, operations? })` in `0-integrations/testing`: routes derived from
  any entry, so a provider with no module is testable.
- New for contributors: `pnpm new <id>` writes an entry skeleton.

## 0.13.0

Every line below breaks 0.12 unless it says otherwise.

### Entries

- New: `0-integrations/catalogue` (`defineProvider` and the entry types), one entry per provider at
  `0-integrations/catalogue/<id>`, and `0-integrations/catalogue.json`, all 17 providers as plain data.
- `0-integrations/providers` is gone: import a provider's entry from `0-integrations/catalogue/<id>`
  (`import { hubspot } from '0-integrations/catalogue/hubspot'`).
- The types of `0-integrations/providers` have their counterparts in `0-integrations/catalogue`: `ProviderDefinition`
  is `Entry`, `OAuth2Definition` is the `oauth2` member of `Auth`, `RetryPolicy` is `Retry`, `HmacScheme` is `Webhook`.
- An app that wrote its own `ProviderDefinition` or `HmacScheme` writes an entry instead (`defineProvider`, its scheme
  as `webhook`); `docs/modules/catalogue.md` describes the fields.
- A definition's fields are read from the entry: `def.baseUrl` is `entry.http.baseUrl`, `def.oauth2.authUrl` is
  `entry.auth[0].authorizeUrl`, `def.oauth2.revokeUrl` is `entry.revoke.url`, `def.oauth2.revokedErrors` is
  `entry.errors.revoked`, and `GOOGLE_CALENDAR_BASE` is `google.http.bases.calendar`.
- `GOOGLE_SCOPES`, `MICROSOFT_SCOPES`, `HUBSPOT_SCOPES` and `SLACK_SCOPES` are gone: read `<entry>.scopes.default`.

### Connect

- `startConnect(entry, options?)` and `finishConnect(entry, input)` run any catalogue entry. The connect objects
  `googleConnect`, `microsoftConnect`, `hubspotConnect` and `slackConnect` are gone: pass the entry
  (`startConnect(hubspot, …)`). `startConnect` requires an OAuth entry's options.
- `OAuthConnect`, `DirectConnect`, `ConnectIdentity`, `ConnectResult` and `ConnectField` give way to `Entry`,
  `Connected<E>` and `Field`. An app's own form keeps its own type and calls its own identify; or it declares an entry
  and calls `startConnect(entry)` and `finishConnect(entry, { secret, values, fetch })`.
- An app that wrapped a connect object's `identify` (a spread `hubspotConnect`) calls `finishConnect(entry, …)` and maps
  the result, or its error, itself.
- `ConnectStart` has no `hosted` kind, and a form's fields are the entry's (`title`, not `label`; `secret` is `true` or
  absent).
- `finishConnect` returns `{ secret, values, account }`, typed from the entry: `values` replaces `details`. HubSpot's
  `portalId` is `account.id`, Slack's `botUserId` is `values.botUserId` (absent, not `null`, when Slack names none), and
  Google's and Microsoft's address is `account.name`.
- A key entry's secret is its secret fields by name (`{ apiKey }`) and its values its plain fields: only declared
  fields are kept, and each must be given, not blank, before anything is sent (`connect_field_required: <name>`). A key
  entry that declares no secret field is refused first (`connect_secret_field_missing: <entry id>`).
- An id that is only whitespace is `invalid_response` (`missing_fields`) for every provider; only a lowercased one was.
- A provider may answer an account id as a positive integer, read as its decimal string, for every provider (Slack,
  Google and Microsoft required a string).
- A malformed identity is `invalid_response` with detail `missing_fields` and the answer's status for every provider
  (HubSpot's carried status and detail `null`).

### Calls

- New: `0-integrations/client`: `client(entry, options)` returns the entry's declared operations, typed from it, and
  `.json`, `.request` and `.paginate` for raw calls.
- `0-integrations/http` is gone. An app that called `createClient({ provider, token, fetch, … })` calls
  `client(entry, { token, fetch, … })` from `0-integrations/client`, whose `.json` and `.request` answer as before; `token`
  may also be a plain string, and `fetch` is the global one by default. `HttpClient` is `Client<E>`, and `RequestOptions`
  and `ProviderResponse` come from `0-integrations/client`. An entry always has a base URL (`base_url_required` is gone),
  and Aircall's credential is built from `values: { apiId }` and the API token.
- New: the first declared operations: notion `pages.markdown`, fireflies `user`, aircall `calls.transcript`, called as
  `client(entry, …).pages.markdown(…)` and so on.
- A missing or blank token is refused with `TypeError('token_missing')` when a request needs it, before anything is
  sent: a token function that answers one, at first or on renewal, and a missing or blank string token, in every module
  and client (each was sent as an empty credential).
- A request path that starts with neither `/` nor `?` (and is not empty) is refused with
  `TypeError('url_path_relative')` before anything is sent: `json('users')` reached `/v1users`.
- A base URL with a trailing slash (`https://x.test/v1/`) is read without it: a request went to `/v1//a`, and a next
  link under it was read wrongly.
- A request whose URL leaves its base's origin (`https://api.x.test` + `@evil.test/y`) is refused with
  `TypeError('url_outside_origin')` before the token is read or anything is sent.
- A GET sent with `idempotent: false` is no longer retried after a 429 (0.12 retried every GET).
- A fractional `Retry-After` is now carried in an error's `retryAfterMs`, and an HTTP-date `Retry-After` is now honoured
  by the retry wait. The retry wait no longer accepts forms such as `2e3`, `+2`, `0x10` or `Infinity`: they fall back to
  the body's wait or the default.
- One sanitiser reads the detail of HTTP and OAuth errors, and a `/` in a provider's code becomes `.` in `detail` for
  every provider. An OAuth refusal's detail now follows the HTTP rule: 1 to 64 characters of letters, digits, `_`, `.`
  or `-`, in any position. A code holding the credential its request sent, before or after that `.`, is no detail; for
  OAuth Basic client authentication that includes the encoded `Authorization` value.
- Every provider that reads an error code or a wait from the body skips an empty-string code and reads the next path,
  and a path also reads an own dotted key (`{ "error.code": … }`, `{ "error.retryAfterMs": … }`) and an object keyed
  `0` (`{ "errors": { "0": … } }`): apollo, breakcold, fireflies, google and microsoft read such bodies differently than
  before.

### OAuth and credentials

- `authorizeUrl`, `exchangeCode`, `refreshGrant` and `accessToken({ provider })` take a catalogue entry; a token answer
  is refused inside a 200 when the entry's `auth.failed` holds, with the code `errors.detail` reads (Slack's as before).
- `revokeGrant(entry, { accessToken?, refreshToken?, client?, fetch })` is the one revoke, by RFC 7009 or by the entry's
  request, and replaces `revokeGrant(definition, client, token, …)`. An entry without `revoke` is done (it threw
  `revoke_unsupported`), and only an RFC 7009 revoke needs `client` (`oauth_client_required` without it).
- A connect object's `revoke` is `revokeGrant(entry, …)`: HubSpot's and Google's `revokeGrant(entry, { refreshToken,
  client, fetch })` (or `{ ...grant, client, fetch }`), Slack's `revokeGrant(slack, { accessToken, fetch })`.
- `exchangeCode`'s `extras` are the token answer's top-level keys that the entry's `identify` and `save` read
  (`tokenAnswer.<key>`), and `scope` under `scopes.requireGranted`; a 0.12 definition listed them in `oauth2.extras`. An
  app's own entry gets a key into `extras` by naming its path in `identify` or `save`.
- `accessToken` always refreshes 15 minutes before expiry: a provider definition's `refreshMarginMs` is gone.
- google: a token answer without `scope` passes `requireGranted`, since it granted the scopes requested (RFC 6749
  §5.1); it was refused as `scope_missing`.

### Webhooks

- `verifyWebhook` takes `entry.webhook`.
- New: `deliveryId(entry.webhook, request)` reads the delivery id an entry declares.
- New: `deliveryId(fireflies.webhook, request)` replaces an app's own Fireflies delivery id (`event:meeting_id`).
- breakcold: `parseWebhook` is gone: read `deliveryId(breakcold.webhook, request)`.

### Paging

- New: an entry may declare `paging`, named `cursor` and `nextUrl` shapes.
- fathom and google: a blank `next_cursor` or `nextPageToken` ends the list (it was returned as the cursor `''`).
- granola: a notes or transcript page whose `hasMore` holds with no cursor is `invalid_response` (`cursor_missing`); the
  list ended silently (a blank transcript cursor read the first page again).
- hubspot: in `owners()`, a blank `after` ends the list (it was sent again), and so does a `paging` or `paging.next`
  that is not an object, or a `paging.next` whose `after` is missing or not a string (each was `invalid_response`). An
  `after` that comes back is `invalid_response` (`cursor_repeated`).

### Modules

- fireflies: `identify(client)` is gone: call `client.user()`.
- fireflies: a 2xx that is no JSON is `invalid_response` with the answer's status (it was `null`) and its `Retry-After`
  in `retryAfterMs`. A non-2xx whose first GraphQL code is an empty string and that has no `extensions.code` is
  `unavailable` (it was `request_failed`).
- hubspot: a portal id is any non-empty string or positive integer (a string had to match `^[1-9]\d*$`), and a `null`
  `hub_id` reads account-info (it was refused).
- hubspot: `owners()` answers `{ items, skipped }`: a malformed owner is skipped and its id reported (it failed the
  whole list), and an owner whose email is null is left out of both, as one with no email was (a null email failed
  the list).
- lusha: an account without v3 access carries the answer's status (it was always 403) and its `Retry-After` in
  `retryAfterMs` (it was always `null`).
- microsoft: the account id is Graph's `id` lowercased (Graph ids are lowercase GUIDs). A user with no address (neither
  `mail` nor `userPrincipalName`, or one without `@`) now signs in, named by its address if any, else its id; the
  mailbox reader still refuses it as `no_mailbox` at its first read.
- microsoft: a Graph mailbox read no longer refuses a `/me` answer that has no `id`.
- notion: `text(pageId)` refuses an empty, `.` or `..` page id with `TypeError('param_invalid: pageId')` before anything
  is sent (it sent `/pages//markdown`, or a path the URL resolved away).
- aircall: `transcript(callId)` refuses a call id that is not a safe integer with `TypeError('param_invalid: callId')`
  (it sent `/calls/1.5/transcription`).
- slack: `slackClient(…).revoke()` is gone: call `revokeGrant(slack, { accessToken, fetch })`.
- slack: `identify` is gone; the entry's `identify` and `save` read the token answer, and `botUserId` is saved as Slack
  answers it (it was kept only when a string, else `null`).
- slack: an answer is refused when its `ok` is false; a 200 that carries no `ok` is read by its data.
- slack: a code outside 2xx is read too: a 401 `invalid_auth` (or another revoked code) is `GrantRevoked`, and a 429
  carries Slack's `error` (`ratelimited`) as its detail.
- unipile: `unipileConnect` is gone: call `client.authLink(link)` for the sign-in URL and
  `client.account(accountId, signal)` for the account.
- unipile: its entry declares its `apiKey` field, so `startConnect(unipile)` returns a form that asks for it (it was empty).
- unipile: any refusal `type` that passes the sanitiser is carried as the detail, `/` read as `.`; before, only `api/…`
  and `provider/…` types were, so `errors/…` types are now carried too.

## 0.12.0

- The package is now `0-integrations`, on npm and at github.com/alessandro-afloarei/0-integrations.
  `@alessandro-afloarei/integrations` stops receiving releases; 0.11.1 is its last.
  - It stays ESM only, Node 22 or later, with the same subpaths, so an app moving from the old name changes only its
    import specifier (`@alessandro-afloarei/integrations/hubspot` becomes `0-integrations/hubspot`), or keeps it
    through a package-manager alias: `"@alessandro-afloarei/integrations": "npm:0-integrations@0.12.0"`.
- The library is licensed under Apache 2.0 (`LICENSE`, and `NOTICE` in the package).
- A test checks every recorded fixture holds only synthetic emails and phone numbers (reserved domains, the fictional
  555-01xx numbers), after decoding JSON and URL escapes; the fixtures that held real ones are rewritten.
- The docs are split: a shorter README, a page per module under `docs/modules/`, and `ROADMAP.md`, `CONTRIBUTING.md`,
  `SECURITY.md` with issue and pull request templates.
- CI runs on GitHub-hosted runners only, since a public repository must not run forked code on self-hosted ones;
  releases are staged on npm with provenance.
- GitHub calls send `User-Agent: 0-integrations`.
- No API changes.

## 0.11.1

- unipile: a next page sends its cursor alone, with the page size. Unipile V2's `next_cursor` holds the first page's
  filters and refuses any sent beside it with a 400 (`api/invalid_parameters`, live on 2026-11-24), so every events or
  mail listing longer than one page failed on its second page. The offset path keeps its filters.
  - `unipile/fake` refuses a cursor sent beside anything but `limit`, and its cursor resumes the first page's filters.

## 0.11.0

- unipile: the client speaks Unipile V2 only (`https://api.unipile.com/v2`, now the `unipile` provider's `baseUrl`), the workspace's V2 key in
  `X-API-KEY`. Breaking:
  - `unipileClient({ apiKey, fetch })`: no `dsn`; `unipileOrigin` is gone with it.
  - `HostedSignIn` is `{ state, redirectUri, expiresOn, scopes? }` with `providers` (lowercase: `linkedin`, `google`,
    `outlook`) for a new account or `accountId` to sign one in again. Unipile sends the browser back to `redirectUri` with
    `account_id`, `provider` and `state`; there is no notify, success or failure address any more. `scopes` is the whole
    list each OAuth provider is asked for.
  - `parseAccountNotification` and `AccountNotification` are gone: nothing is made from a notice.
  - `account()` answers `{ createdAt, provider, email, scopes }`: `provider` replaces `type`, `email` is the mailbox's
    primary sender (one more request, for a mailbox), `scopes` what the account granted.
  - `emails()` takes no `threadId` (Unipile V2 ignores it on the list) and a `limit` of 1 to 100; `thread(accountId,
    threadId)` reads a thread whole. A message's `role` is read from its folders' roles; `id` and `provider_id` are both
    Unipile V2's id (the provider's own); `in_reply_to` comes from the `In-Reply-To` header.
  - `events()` takes a `limit` of 1 to 100. A time without an offset is read in its zone rather than skipped.
  - A refusal's `detail` is Unipile's type with its thrower (`provider.insufficient_permissions`).
  - A list without a cursor stops at `total_count`, and ends where an offset is refused as a bad request: Outlook pages by
    cursor and gives none on its last page.
  - `unipile/fake` answers V2: `fakeUnipile` takes no `dsn`; `hostedConsent` is `{ consentUrl, redirectUris, accountId }`; an
    account names `provider`, `email` and `scopes`.
- The Unipile mail and calendar recordings are synthetic V2 answers, their key sets checked against live V2 on 2026-11-23.

- mailbox: `MailboxEmail`, `MailboxCalendar`, `MailboxEvent` and `MailboxReader`, one member's mailbox and calendar read
  the same way over every transport; the `Unipile*` mail types are now aliases of them, and `unipileMailbox` reads a
  workspace account as a reader.
- microsoft: `graphMailbox` reads Outlook mail and calendar through Microsoft Graph on a member's delegated grant, and
  `microsoftConnect` signs a member in (PKCE; `MICROSOFT_SCOPES`). `microsoft/fake`: `fakeMicrosoft`, the sign-in and Graph
  on synthetic mailboxes.
- google: `googleMailbox` reads Gmail and Google Calendar on a member's grant, and `googleConnect` signs a member in and
  revokes (PKCE; `GOOGLE_SCOPES`). `google/fake`: `fakeGoogle`. `providers` gains `microsoft`, `google` and
  `GOOGLE_CALENDAR_BASE`; Google's 403 quota refusals read as `rate_limited`.
- The provider kit runs `graph-mail`, `graph-calendar`, `google-mail` and `google-calendar` on synthetic recordings and the
  fakes; `record.test.ts` records them from a test mailbox's access token.
- mailbox: `MailboxEvent.visibility`, `public` or `private`, on every transport, so an app can leave out what a member marked
  private. Unipile answers it as it is (as in 0.10.1); Google's `private` and `confidential` are private; Outlook's every
  sensitivity label but `normal` is, `personal` included. An event from Unipile or Graph that does not say is skipped. The
  fakes answer it as each provider does.

## 0.10.1

- unipile: an event carries Unipile's `visibility`, `public` or `private`, so an app can leave out what a member marked
  private. An event that does not say is skipped. Compatibility: `UnipileEvent` gains the required field, so an app that
  builds events (a fixture for `unipile/fake`) must add it.

## 0.10.0

- unipile: `emails`, `calendars`, `events` and `deleteAccount` read a member's Gmail, Google Calendar, Outlook mail and
  Outlook Calendar, signed in through the hosted link, which now takes `providers` (`GOOGLE`, `OUTLOOK`; `LINKEDIN` when
  omitted, so its wire is unchanged). Mail keeps the five headers an app filters on and drops the rest; `metaOnly` lists the
  metadata alone; `list-unsubscribe` is kept with its value blanked. Dates must be ISO times with an offset, and an event
  whose time comes without one is skipped rather than read in the host's time zone. Events and
  calendars page by Unipile's cursor or offset behind one cursor, each instance of a series on its own; by offset a list
  ends on an empty page or a repeated page. A Unipile refusal's `detail` is its error type (`disconnected_account`).
  `account` also answers the account's `type` and mailbox `email`, and they are `unipileConnect`'s details. unipile/fake:
  `apiKey`, an account's `type` and `email`, `mailboxes`, account deletion, and a `hostedConsent.accountId` given
  `{ state, providers }`, which may be async. Compatibility: `UnipileClient` gains the four methods, so a structural
  implementation must add them; an account answer must carry Unipile's `type`; the legacy `authLink` callback also
  receives `providers`.

## 0.9.0

- fathom: `fathomClient` lists a member's meetings (ten a page, filtered by creation time and recorder) and reads a
  recording's transcript; `fathom/fake` serves both. The provider paces calls a second apart and waits out one 429.
- attio: `attioClient` names a token's workspace (an unknown token is `rejected`), pages an object's records oldest first
  (or those created after a time; the record id breaks ties), and lists notes and workspace members; `attio/fake` serves them.
- aircall: `aircallClient` names the key's company, pages calls oldest first with their contact (past the 10,000 calls one
  listing serves, from a second before the last call read), and reads a call's transcript (null while it has none; a
  company without AI Assist is `request_failed` 403 `ai_assist_required`); `aircall/fake` serves them.
- notion: `notionClient` names a connection's bot and workspace, pages the pages shared with it, most recently edited
  first (an incremental read ends where older ones begin, to the minute Notion rounds edit times to), and reads a page as
  Markdown with a `cut` flag; `notion/fake` serves them. The provider paces calls 350 ms apart and waits out one 429.
- github: `githubClient` names a token's person, pages the repositories it reads and a repository's issues and pull
  requests in creation order, updated since a time, by GitHub's `Link` header; `github/fake` serves them. GitHub's 403
  rate limit is `rate_limited` with the wait GitHub asks for, never `rejected`, and neither a rate limit nor a 401 is retried.
- providers: a definition's `rateLimit(status, headers, body)` names a rate limit its status may not (GitHub's 403), and the
  wait it asks for when no `Retry-After` does (GitHub's `x-ratelimit-reset`, or a minute for a secondary limit).
- `parseEntries` reports a skipped entry's numeric id as a string, and takes the id's reader where a provider does not call it
  `id` (Fathom's `recording_id`).
- A provider kit for every new provider's tests: sign in, a bad key, the first page, paging to the end, an incremental
  read and a 429, on a recording (synthetic until recorded from a test account) and on the fake.
- apollo: `apolloClient` proves a key at no credit (`profile`), enriches a person without personal emails, phones or the
  waterfall (at most one credit; the person's details travel in the body, never the URL) and an organization by domain (one
  credit); no match is null, and a refusal's detail is Apollo's `error_details.code`. `apollo/fake` serves them.
- lusha: `lushaClient` on v3 reads the key's credits (`usage`), a person by email, LinkedIn URL or name and company domain
  (contact search: no emails or phones) and a company by domain (no premium reveals), each as `{ match, creditsCharged }`
  with null for no match. An account without v3 access is `request_failed` 403 `v3_not_enabled`. `lusha/fake` serves them.
- A lookup kit for providers without pages: the key proof, a bad key, a person found and one not, a company and a 429.

## 0.8.1

- hubspot: `dealCompanies` picks the primary company, else the lowest id; was the first association in HubSpot's
  answer, which HubSpot does not order. Primary is HubSpot's own deal-to-company association type
  (category `HUBSPOT_DEFINED`, typeId `5`, per the [associations v4 guide](https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide)).
  Ids compare as numbers; two primaries (malformed) resolve to the lowest of them; an answer without
  `associationTypes` falls back to the lowest id. The return type is unchanged. `dealContacts` is unchanged.
- hubspot/fake: `dealCompanies` (and the cohort's) also accept a deal's companies as `{ id, primary? }[]`, served
  with association types. The existing one-company string form answers byte for byte as before.

## 0.8.0

- hubspot: `dealStageHistory(ids)` reads retained dealstage revisions in batches of 50, returning a map of
  deal IDs to `{ value, timestamp, sourceType? }` revisions ordered oldest first. Provider timestamps are preserved;
  no history is synthesized. HubSpot documents up to 20 retained revisions per deal property, not lifetime history.
- hubspot/fake: accept a data callback so one fake can serve changing portal data without resetting OAuth state.
  Optional `dealStageHistory` and sync `dealContacts` maps support history and associations for sync deals as well
  as the existing cohort. Existing static fake data and ordinary record responses are unchanged.
- Compatibility: `HubSpotClient` gains the required `dealStageHistory` method. Structural implementations and
  typed wrappers must add it when upgrading.
- History batches use the 50-input limit observed in [Pipedream's HubSpot error report](https://github.com/PipedreamHQ/pipedream/pull/8462),
  consistent with the [Deals OpenAPI warning](https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json)
  that requesting history lowers the request maximum. The fake refuses history requests above 50 inputs with 400;
  plain reads retain their 100-input batch size.

## 0.7.0

- breakcold/fake: optional readable-only notes and meetings support direct reads without changing ingestion lists;
  normal listed records win duplicate ids and missing items remain 404.
- unipile: add `unipileConnect` for the shared hosted start/finish contract; account ids remain app-owned secrets.
- unipile/fake: optionally bind hosted consent to registered destinations, expiring single-use tickets and the
  app-supplied notification callback; reject parameter overrides and never follow notification redirects.
- errors: optional `ProviderHttpError.retryAfterMs` preserves the final response's valid retry hint, including
  Fireflies GraphQL and Slack HTTP-200 refusals. Missing/invalid hints are null; existing retry policy is unchanged.
- hubspot: retain admitted `MISSING_SCOPES` and `VALIDATION_ERROR` categories in error detail without changing
  rejection classification or exposing messages, context, credentials or unknown categories.

## 0.6.0

- hubspot: a typed client for object searches, batch reads, associations, portal identity, stages and owners. `changedRecords` resumes an id-paged scan and
  `hubspotConnect` composes with the shared OAuth start/finish flow, identifies the portal with its existing `Portal <id>` label,
  and preserves potentially shared refresh grants after identity failures (`reusesGrant: true`). Portal IDs reject zero and leading zeros in token extras and account-info.
- hubspot/fake: requires a registered OAuth client and HTTP(S) redirect URI, serves the real authorize URL, and binds one-use codes to
  the client and callback. Token and revoke requests require matching client credentials; authorization requires the read scopes. Token requests validate their grant type; revocation accepts only issued refresh tokens,
  is idempotent, and prevents further refreshes. Fixture callers must authorize before exchanging a code.
- hubspot: export `HUBSPOT_SCOPES`; shared OAuth completion supports additive `reusesGrant?: true` to skip unsafe cleanup.
- hubspot/fake: reuse one refresh token per client/portal across consents, issuing a new one after revoke. Allowlist
  portal fixture refresh shapes plus the legacy seed; isolate codes per instance. Document per-process revocation.

## 0.5.0

- Connect: one start/finish contract for OAuth, API-key forms and hosted flows, with Slack OAuth as its first consumer.

- Slack provider module: typed posting, bounded channel listing with skipped ids, cursor checks and `channelsCut`, idempotent revocation and identity, with a fake that binds authorization codes to the registered callback and client.
- OAuth completion revokes unowned grants after identity failures and reports failed cleanup through required `onRevokeFailed`; shared OAuth functions refuse blank state and missing PKCE verifiers. `GrantRevoked.detail` preserves the provider token-gone code on both OAuth and Web API paths.

## 0.4.0

- fireflies: search requests all declared list fields; resumable cursors are bound to their query and caller
  inputs are validated before requests. Codeless GraphQL errors are failures, and the fake refuses unknown users.

- fireflies, breakcold: parse verified webhook payloads / delivery headers without taking ownership of signature
  verification, routing, deduplication or the original stored bytes.

- fireflies: typed GraphQL client, identity lookup, offset sync at 50 records per page, and the provider fake.
  GraphQL failure codes take precedence over HTTP status. Transcript normalization preserves sentence attribution
  and decimal start times; apps keep their stored-payload validation and page budgets.

## 0.3.0

- granola, breakcold: provider modules for the two API-key sources. Each client returns typed values under the
  provider's own field names, since an app stores them; the schemas drop every key they do not name, so Granola's
  summary and an owner's private notes never leave the client. A list answers one `Page` at a time with the ids of the
  entries the client could not read, so the app decides what an unreadable entry means. Granola reads a transcript too
  large to inline page by page, up to 50 pages, and says when that cap cut it (`transcriptCut`); Breakcold refuses a
  page that claims more with no cursor (`cursor_missing`).
  `granola/fake` and `breakcold/fake` answer the calls their clients make.
- paginate: `paginate(load)` yields every page until the last and refuses a cursor it has seen (`cursor_repeated`);
  the caller stops whenever its own budget says so. Broken paging carries no status, so an app tells the library's
  `cursor_*` tokens from a provider's own code.
- http: `createClient` takes `beforeRequest(url)`, run once per call before anything is sent (an app's metering);
  what it throws reaches the caller unchanged. `ProviderHttpError.detail` carries the provider's own code for a refusal
  where the catalogue reads one: Breakcold's `usage_limit` and `organization_moved`.

## 0.2.0

- exa, firecrawl, unipile: the first provider modules. Each holds the provider's typed client and answer parsing, so
  an app no longer builds the provider's requests or reads its answers. Firecrawl sends no browser actions to a
  document and reads a page once more as it loads when its render fails. Unipile parses the hosted sign-in's account
  notification; `unipileOrigin`, in `providers` so a boot check loads no client, reads the workspace's address as its
  dashboard shows it, https only.
- testing: `respondFrom` answers a request from routes, or null, so a provider's fake serves an app's fixture mode as
  well as `fakeFetch`. `exa/fake`, `firecrawl/fake` and `unipile/fake` export `fakeExa`, `fakeFirecrawl` and
  `fakeUnipile`, which answer the calls their clients make; each client's own tests pin its exact requests.
- zod 4 validates provider answers inside the library. It is a dependency, never part of the public types: an answer
  in the wrong shape is a `ProviderHttpError` with code `invalid_response`.

## 0.1.1

- http: follow a redirect that stays on the same origin and keeps the request (307/308, or 301–303 for a GET), at
  most five hops; a redirect to another host is still never followed. Breakcold's universal endpoint redirects a
  signed-in request to its region, which 0.1.0 refused.

## 0.1.0

- errors: shared, coded failures without secret-bearing causes.
- providers: eight provider definitions with existing timing and retry values.
- vault: AES-256-GCM envelope encryption, legacy reads, AAD, key cache and KEK rewrapping.
- oauth: authorization URLs, PKCE, exchange, refresh and revocation through oauth4webapi.
- credentials: locked refresh, version-fenced saves and a 5-second window for a concurrent winner.
- http: ky client with token reuse, timeouts, pacing and capped 429 retries.
- webhooks: data-driven HMAC verification and bounded raw-body reads.
- testing: fetch scripts, memory stores and locks, and a real-store contract check.
