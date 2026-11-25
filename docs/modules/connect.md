# `connect`

`connect` supplies `startConnect(entry, options?)` and `finishConnect(entry, input)` for any catalogue entry.

- A key entry starts as a form of its `fields`. `finishConnect(entry, { secret, values?, fetch })` first checks that every
  declared field is filled (secret fields in `secret`, plain fields in `values`), so a missing one is a `TypeError`
  before anything is sent, then checks the credential and learns the account through the entry's `identify`.
- An OAuth 2 entry starts with a redirect asking for the entry's `scopes.default`, with PKCE unless the entry says
  `pkce: false`. `finishConnect(entry, { client, code, redirectUri, codeVerifier?, fetch, onRevokeFailed })` exchanges
  the code, refuses a grant short of a requested scope when the entry says `requireGranted` (`rejected`,
  `scope_missing`), and identifies the account. If that fails it revokes the new grant best-effort and throws the
  original error; `onRevokeFailed(error)` reports a failed cleanup. An entry whose `reusesGrant` says re-consent can
  return a live connection's grant skips the cleanup: only the app knows who owns it.

The result is `{ secret, values, account }`, typed from the entry: the secret to seal (the grant, or the secret fields),
the plain values to keep (the fields entered and what the entry's `save` keeps), and the account `{ id, name }`, which
is `null` only for an entry whose `identify` names no id. The app owns nonce validation, the registered redirect URI,
verifier storage and sealing the secret. **Never send `ConnectStart` to the browser:** keep `codeVerifier` on the
server and redirect with `url` alone. Blank OAuth states and missing required verifiers are refused.

The [HubSpot page](hubspot.md) shows a whole connect against the HubSpot fake.
