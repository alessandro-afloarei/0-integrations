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
  the value used: `finishConnect(signInWith(intercom, 'key'), { secret: { accessToken }, fetch })` connects to
  Intercom's US host and answers `values.apiHost === 'api.intercom.io'`.
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
  `pkce: false`. It reads the entry's plain fields from `values` as a key entry does (defaults, choices), fills and
  checks every OAuth 2 URL but the refresh URL (filled when a refresh is sent), and the base, with them before the URL
  is returned (the base only when it needs no value the exchange saves, such as Jira's cloud id), and returns them in
  `values`
  ([on the person's own server](#oauth-2-on-the-persons-own-server)).
  `finishConnect(entry, { client, code, redirectUri, codeVerifier?, values?, fetch?, onRevokeFailed })` reads `values`
  again (`client` is typed by the entry: a public client's, `clientAuth: 'none'`, is `{ clientId }` alone, and
  [oauth](oauth.md) sends it no secret), exchanges the code, refuses a grant short of a requested scope when the entry
  says `requireGranted` (`rejected`, `scope_missing`; the granted scopes are split on the entry's `scopeSeparator`), and
  identifies the account. An exchange the server refuses is classified as a `token` sign-in's first request is, never
  `GrantRevoked` (no grant existed): a 400, 401 or 403 (a bad, expired or replayed code, a wrong `redirect_uri`,
  verifier or client) and a 200 the entry's `failed` marks (Slack's `ok: false`) are `ProviderHttpError` `rejected`,
  the detail the answer's `error` only when that is one of RFC 6749's codes (`invalid_grant`, `invalid_client`), else
  null; a 404 is `not_found`, a 429 `rate_limited` with its wait, a 408 or 5xx `unavailable`. If the scope check or
  identify fails it revokes the new grant best-effort and throws the original error;
  `onRevokeFailed(error)` reports a failed
  cleanup (an entry whose revoke is a request on the base cannot revoke a grant whose host was refused, so that is
  reported too). An entry whose `reusesGrant` says re-consent can return a live connection's grant skips the cleanup: only
  the app knows who owns it. Should a provider's server refuse PKCE before the catalogue says so, derive an entry
  whose sign-in says `pkce: false` and pass it to `startConnect` and `finishConnect` (not for a public client, which
  needs PKCE).

To ask for other scopes, derive an entry: `defineProvider({ ...google, scopes: { default: [...] } })`. `defineProvider`
does not refuse a misspelled key at compile time (the catalogue test does, for the entries in this repository), so check
the key's name.

`fetch` is optional in both, and in `exchangeCode`, `refreshGrant` and `revokeGrant`: by default the global one, or `guardedFetch` for an entry whose host the person types
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

Linear and ClickUp offer OAuth 2 and a key. Used whole, such an entry is its first sign-in, OAuth 2: the sign-in an app
that connects other people's accounts uses, as both providers ask. To connect with a person's own key instead, narrow
it with `signInWith(entry, 'key')` from `0-integrations/catalogue`: the narrowed entry has that sign-in alone, keeps
the key's field, and has no `scopes` or `revoke`, which belong to OAuth 2. Keep the kind with the connection and narrow
again for every later `client`, `refreshGrant` or `revokeGrant`. `signInWith` refuses a kind the entry does not
declare: `TypeError('sign_in_unknown: <entry id> <kind>')`.

```ts
import { signInWith } from '0-integrations/catalogue';
import { linear } from '0-integrations/catalogue/linear';
import { client } from '0-integrations/client';
import { finishConnect, startConnect } from '0-integrations/connect';

// Send the browser to `url`; keep `state` and `codeVerifier` on the server.
const { url, codeVerifier } = await startConnect(linear, { clientId: oauthClient.clientId, redirectUri, state });

// In the callback, once the state matches:
const { secret, account } = await finishConnect(linear, { client: oauthClient, code, redirectUri, codeVerifier,
  onRevokeFailed: report });
// secret: the grant to seal, with `kind: 'oauth2'` kept beside it; account: the Linear user

const api = client(linear, { token: secret.accessToken });
const issues = await api.issues.list({ teamId, first: 50 }); // one page: nodes and pageInfo

// A person's own key instead: a form, then one call.
const key = signInWith(linear, 'key');
const own = await finishConnect(key, { secret: { apiKey } }); // own.secret: { apiKey }, with `kind: 'key'` kept beside it

// Every later call narrows again with the kind kept (`'oauth2' | 'key'`): a union of the two narrowings.
const later = client(signInWith(linear, kept.kind), { token: kept.token });
```

Narrowed with a stored kind, the entry is a union: TypeScript gives `scopes` only once it knows the kind (`'scopes' in
entry`, or a branch on the kind kept). Either sign-in's `values` hold its plain fields and what `save` keeps.

A later sign-in may have its own fields and base. Outline's OAuth 2 is on app.getoutline.com; its key,
`signInWith(outline, 'key')`, asks for the host of the person's own server and goes there. Keep the kind with the
connection, beside the sealed secret, and narrow with that same kind for every later call: the library cannot tell an
OAuth 2 token from a key, so a cloud token used with the key's narrowing would go to the host the values name. A value
the entry's sign-in does not declare is refused (`value_undeclared`), so a connection kept from another sign-in never
reaches the wrong host: a key connection's `host` given to the whole entry, or to its OAuth 2 narrowing, sends nothing.

Linear's lists answer one page each: pass `pageInfo.endCursor` as `after` for the next, until `hasNextPage` is false.
The engine cannot send a GraphQL cursor yet ([waiting list](../waiting-list.md)). A Linear grant lasts 24 hours and
refreshes with `refreshGrant(linear, …)`, through [credentials](credentials.md).

## OAuth 2 on the person's own server

Mattermost runs on each person's own server, and each server is its own OAuth 2 provider: its authorize and token URLs
sit on the host the person types (`https://{host}/oauth/authorize`). An OAuth 2 sign-in asks the person for the entry's
fields that are not `secret`: Mattermost's `host`, never the key sign-in's `accessToken`. Pass the host to
`startConnect` as `values`, keep the `values` it returns on the server with `state` and `codeVerifier`, and pass them
to `finishConnect`, `refreshGrant`, `revokeGrant` and `client`. Never read a value from the callback's query: the
callback is the person's browser, which can carry anything. Every OAuth 2 URL is filled and checked as a base is (a
host name with no port, never a blocked address), and the exchange, refresh, revoke and calls all go to the host the
`values` name.
The values and the grant are one record. At connect the engine reads the host from the person's entry (or, for a
named host, from the issuer's token answer); afterwards the app gives it the connection's kept `values`, and a kept
host is checked against the entry's declared pattern again whenever a request's destination uses it (every call on
the base, and a refresh or revoke whose URL names it; one whose URL is fixed goes to its literal host). It does not, and cannot, verify
that a kept value is the one that connection was issued with (the library keeps no state): store a connection's
values with its tokens and pass them back unchanged.

```ts
import { mattermost } from '0-integrations/catalogue/mattermost';
import { client } from '0-integrations/client';
import { finishConnect, startConnect } from '0-integrations/connect';
import { refreshGrant, revokeGrant } from '0-integrations/oauth';

// The app's client for the server the person typed: one per server, never another's.
const registered = clients.get(host);
if (registered === undefined) throw new Error('not_registered_on_this_server');
const start = await startConnect(mattermost, { clientId: registered.clientId, redirectUri, state, values: { host } });
pending.set(state, { codeVerifier: start.codeVerifier, values: start.values }); // on the server; send the browser to `start.url`

// In the callback: what was kept, found by `state`, and that server's client.
const kept = pending.get(state);
const own = kept && clients.get(kept.values.host);
if (kept === undefined || own === undefined) throw new Error('unknown_state');
const { secret, values } = await finishConnect(mattermost, { client: own, code, redirectUri, codeVerifier: kept.codeVerifier,
  values: kept.values, onRevokeFailed: report });
// secret: the grant to seal; values: { host } to keep with it

const api = client(mattermost, { token: secret.accessToken, values });
const renewed = await refreshGrant(mattermost, own, refreshToken, { values }); // through the address guard

// When the person disconnects, with the same values:
await revokeGrant(mattermost, { ...secret, client: own, values });
```

The client belongs to its server: the server's administrator (or the person) registers the app there, after a System
Admin enables the OAuth 2.0 service provider. Key the app's clients by the host value and never send one server's
client to another: an app that looks its client up by the stored host also finds none for a host it never registered
on.

## OAuth 2 on the host its token answer names

Wrike keeps each account in one of its data centres, and its token answer names the host. `startConnect(wrike, …)`
asks for nothing and fills nothing on it; `finishConnect(wrike, …)` reads it from the token answer before identify,
which goes there, and returns it in `values` (`{ host: 'app-eu.wrike.com' }`). Keep those `values` with the sealed
grant and pass them to `client`, `refreshGrant` and `revokeGrant`, as for a host the person types. The host is checked
against the hosts the entry declares (Wrike's four data centres) before identify, before every call and before every
refresh, never read from the callback or from the `values` an app passes to `finishConnect`. A token answer naming
another host is refused (`base_host_refused`, or `base_value_invalid` for one that is no host name) and one naming
none is `invalid_response` (`missing_fields`); either way the fresh grant is revoked when the entry declares a revoke
URL on a fixed host (Wrike declares no revoke: a person revokes the token by hand), and an entry whose revoke is a
request on the base cannot revoke it (`onRevokeFailed` reports it). A refresh answer's host is not
read: an account that moves to another data centre connects again.

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
