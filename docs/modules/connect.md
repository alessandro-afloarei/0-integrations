# `connect`

`connect` supplies `startConnect(entry, options?)` and `finishConnect(entry, input)` for any catalogue entry. Both are
typed by the entry's sign-in: an OAuth 2 entry needs the start options and starts with a redirect, a key entry takes
none and starts with a form, and an entry whose kind is not known in the types (a union an app picks by id) takes either.

- A key entry starts as a form of its `fields`. `finishConnect(entry, { secret, values?, fetch })` reads only the
  declared fields, secret ones from `secret` and plain ones from `values`, and refuses one that is missing, blank or
  whitespace with `TypeError('connect_field_required: <name>')` before anything is sent; nothing else passes through.
  The entry's only secret field is the credential. Then the entry's `identify` runs: with a request it checks the credential
  and learns the account; an entry that declares none sends nothing, and its `account` is `null`.
- An OAuth 2 entry starts with a redirect asking for the entry's `scopes.default`, with PKCE unless the entry says
  `pkce: false`. `finishConnect(entry, { client, code, redirectUri, codeVerifier?, fetch, onRevokeFailed })` exchanges
  the code, refuses a grant short of a requested scope when the entry says `requireGranted` (`rejected`,
  `scope_missing`; the granted scopes are split on the entry's `scopeSeparator`), and identifies the account. If that
  fails it revokes the new grant best-effort and throws the original error; `onRevokeFailed(error)` reports a failed
  cleanup. An entry whose `reusesGrant` says re-consent can return a live connection's grant skips the cleanup: only
  the app knows who owns it.

To ask for other scopes, derive an entry: `defineProvider({ ...google, scopes: { default: [...] } })`.

The result is `{ secret, values, account }`, typed from the entry: the secret to seal (the grant, or the secret fields by
name), the plain values to keep (the plain fields by name, and what the entry's `save` keeps when the provider answers
it), and the account `{ id, name }`, which is `null` only for an entry whose `identify` names no id. The app owns nonce
validation, the registered redirect URI, verifier storage and sealing the secret. **Never send the start's
`codeVerifier` to the browser:** keep it on the server and redirect with `url` alone. Blank OAuth states and missing
required verifiers are refused.

The [HubSpot page](hubspot.md) shows a whole connect against the HubSpot fake.
