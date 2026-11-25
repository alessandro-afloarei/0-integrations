# `connect`

`connect` supplies `startConnect(provider, options)` and `finishConnect(provider, input)`. Starts return a redirect,
a secret-field form or a hosted URL. OAuth completion exchanges the code, identifies the account, and revokes the new
grant best-effort if identity fails; the required `onRevokeFailed(error)` input reports failed cleanup. Each OAuth module
supplies its revocation callback; providers returning the same live token on re-consent need an adapter before using this flow.
The app owns nonce validation,
the registered redirect URI, verifier storage and sealing the returned secret. **Never send `ConnectStart` to the browser:**
keep `codeVerifier` on the server and redirect with `url` alone. Blank OAuth states and missing required verifiers are refused.

The [HubSpot page](hubspot.md) shows a whole connect against the HubSpot fake.
