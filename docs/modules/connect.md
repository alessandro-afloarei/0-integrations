# `connect`

`connect` supplies `startConnect(entry, options?)` and `finishConnect(entry, input)` for any catalogue entry. Both are
typed by the entry's sign-in, its first ([an entry with two sign-ins](#an-entry-with-two-sign-ins) picks another): an OAuth 2 entry needs the start options and starts with a redirect, a key entry takes
none and starts with a form, and an entry whose kind is not known in the types (a union an app picks by id) takes either.

- A key entry starts as a form of its `fields`. `finishConnect(entry, { secret, values?, fetch? })` reads only the
  declared fields, secret ones from `secret` and plain ones from `values`, and refuses one that is missing, blank or
  whitespace with `TypeError('connect_field_required: <name>')` before anything is sent; nothing else passes through.
  A plain field with a `default` may be left out or blank, and takes the default; a value that is not a string (`5`,
  `null`) never does, and is `TypeError('connect_field_invalid: <name>')`. One with `choices` refuses any other value
  with the same error, also before anything is sent. The result's `values` hold
  the value used: `finishConnect(intercom, { secret: { accessToken }, fetch })` connects to Intercom's US host and
  answers `values.apiHost === 'api.intercom.io'`.
  The entry's only secret field is the credential: an entry that declares none is refused first, as the entry's fault,
  with `TypeError('connect_secret_field_missing: <entry id>')`. Then the entry's `identify` runs: with a request it
  checks the credential and learns the account; an entry that declares none sends nothing, and its `account` is `null`.
- A token entry (Zoom, PayPal, Metabase) also starts as a form of its `fields`, and `finishConnect(entry, { secret,
  values?, fetch? })` reads them as a key entry does (defaults, choices). It then requests a token with them, once and
  never retried: that request is the credential check, and a refused one is `rejected`. Its URL may take its host from
  a field (PayPal's `'https://{apiHost}/v1/oauth2/token'`), filled and checked as a base's is. Identify runs with the
  token and reads only the token answer's keys the entry names (`tokenAnswer.*`, PayPal's `app_id`). The result's
  `secret` is the secret fields; the token is never returned.
- An OAuth 2 entry starts with a redirect asking for the entry's `scopes.default`, with PKCE unless the entry says
  `pkce: false`. `finishConnect(entry, { client, code, redirectUri, codeVerifier?, fetch?, onRevokeFailed })` exchanges
  the code, refuses a grant short of a requested scope when the entry says `requireGranted` (`rejected`,
  `scope_missing`; the granted scopes are split on the entry's `scopeSeparator`), and identifies the account. If that
  fails it revokes the new grant best-effort and throws the original error; `onRevokeFailed(error)` reports a failed
  cleanup. An entry whose `reusesGrant` says re-consent can return a live connection's grant skips the cleanup: only
  the app knows who owns it.

To ask for other scopes, derive an entry: `defineProvider({ ...google, scopes: { default: [...] } })`. `defineProvider`
does not refuse a misspelled key at compile time (the catalogue test does, for the entries in this repository), so check
the key's name.

`fetch` is optional in both: by default the global one, or `guardedFetch` for an entry whose host the person types
(`http.host: '*'`, GitLab and Metabase), which refuses private and metadata addresses
([client](client.md#the-address-guard)); with an app's own `fetch`, a host that is a blocked address literal is refused
before anything is sent, a token entry's password included. An account id of a provider whose host is typed is local to
that host (user 1 on gitlab.com is not user 1 on a company's GitLab, and a Metabase email names a person on one
Metabase), so an app keys such a connection by host and account id.

The result is `{ secret, values, account }`, typed from the entry: the secret to seal (the grant, or the secret fields by
name), the plain values to keep (the plain fields by name, and what the entry's `save` keeps when the provider answers
it), and the account `{ id, name }`, which is `null` only for an entry whose `identify` names no id. The app owns nonce
validation, the registered redirect URI, verifier storage and sealing the secret. **Never send the start's
`codeVerifier` to the browser:** keep it on the server and redirect with `url` alone. Blank OAuth states and missing
required verifiers are refused.

A key provider's connect is a form, then one call:

```ts
import { aircall } from '0-integrations/catalogue/aircall';
import { finishConnect, startConnect } from '0-integrations/connect';

const { fields } = await startConnect(aircall); // API ID, and API token (secret)
const { secret, values, account } = await finishConnect(aircall, { secret: { apiToken }, values: { apiId }, fetch });
// secret: { apiToken } to seal; values: { apiId } to keep; account: { id: apiId, name: the company's name }
```

A token provider's connect is the same form; its calls take a [`tokenSource`](oauth.md#a-token-entry-tokensource) built
from the connection. Pass it, and `client`, the connection's `values`: the defaults `finishConnect` applied are in them,
and neither applies one.

```ts
import { metabase } from '0-integrations/catalogue/metabase';
import { client } from '0-integrations/client';
import { finishConnect } from '0-integrations/connect';
import { tokenSource } from '0-integrations/oauth';

// Once, at sign-in:
const { secret, values, account } = await finishConnect(metabase, { secret: { password }, values: { host, username } });
// secret: { password } to seal; values: { host, username } to keep; account: { id: username, name: username }

// Outside any request handler, once per connection:
const api = client(metabase, { token: tokenSource(metabase, { secret, values }), values });

export async function handler() {
  return api.json('/user/current');
}
```

Build one source per connection and keep it for the process's life: a new source requests a new token (for Metabase,
a new session; each process signs in its own).

The [HubSpot page](hubspot.md) shows a whole OAuth connect against the HubSpot fake.

## An entry with two sign-ins

Linear and ClickUp offer a key and OAuth 2. Used whole, such an entry is its first sign-in, the key: a form, as above.
To connect with OAuth 2, narrow it with `signInWith(entry, 'oauth2')` from `0-integrations/catalogue`. The narrowed
entry has that sign-in alone, with the entry's `scopes` and `revoke`, and no secret field: the grant is the secret.
Keep the kind with the connection and narrow again for every later `client`, `refreshGrant` or `revokeGrant`.
`signInWith` refuses a kind the entry does not declare: `TypeError('sign_in_unknown: <entry id> <kind>')`.

```ts
import { signInWith } from '0-integrations/catalogue';
import { linear } from '0-integrations/catalogue/linear';
import { client } from '0-integrations/client';
import { finishConnect, startConnect } from '0-integrations/connect';

const oauth = signInWith(linear, 'oauth2');
// Send the browser to `url`; keep `state` and `codeVerifier` on the server.
const { url, codeVerifier } = await startConnect(oauth, { clientId: oauthClient.clientId, redirectUri, state });

// In the callback, once the state matches:
const { secret, account } = await finishConnect(oauth, { client: oauthClient, code, redirectUri, codeVerifier,
  onRevokeFailed: report });
// secret: the grant to seal, with `kind: 'oauth2'` kept beside it; account: the Linear user

const api = client(oauth, { token: secret.accessToken });
const issues = await api.issues.list({ teamId, first: 50 }); // one page: nodes and pageInfo
```

Linear's lists answer one page each: pass `pageInfo.endCursor` as `after` for the next, until `hasNextPage` is false.
The engine cannot send a GraphQL cursor yet ([waiting list](../waiting-list.md)). A Linear grant lasts 24 hours and
refreshes with `refreshGrant(signInWith(linear, 'oauth2'), …)`, through [credentials](credentials.md).

## Google and Microsoft

Sign a member in with `startConnect(google, …)` or `startConnect(microsoft, …)` (the entries at
`0-integrations/catalogue/<id>`; PKCE, the verifier for the app to keep with its state) and finish with `finishConnect`.
Google's account is the Gmail address, lowercased. Microsoft's is the user's immutable Graph `id`, lowercased, named by
`mail` when Graph answers one (else `userPrincipalName`), lowercased, and by the id when that name is blank: a
tenant's admin can set a user's `mail` to any address, another organization's included, so the address never says who
signed in (nOAuth). A Microsoft user with no address
signs in; the mailbox reader refuses it (`no_mailbox`) at its first read. Microsoft rotates the refresh token on every
refresh (`accessToken` stores the successor) and has no endpoint that revokes one app's delegated grant, so its entry
declares no revoke: the grant lapses once the app deletes its tokens. Google's consent screen lets the member untick a
scope: its entry's `requireGranted` refuses a grant short of either (`rejected`, `scope_missing`), and `finishConnect`
revokes it. Google keeps the refresh token until it is revoked; `revokeGrant(google, { ...grant, client, fetch })`
revokes it, and a token already revoked resolves. A Google project in "Testing" gets
refresh tokens that expire after 7 days, and a password change ends a grant with Gmail scopes: both refresh as
`GrantRevoked`.
