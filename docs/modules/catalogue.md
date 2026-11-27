# `catalogue`

A provider is an entry: plain data that says how to sign in, how to learn the account, how the credential travels, how
errors read, and which calls the provider offers. `0-integrations/catalogue/<id>` exports one entry under the name
`<id>`, so an id is the export's name: lowercase letters and digits, starting with a letter.
`0-integrations/catalogue.json` holds every entry, each with its `tier`. `0-integrations/catalogue` exports
`defineProvider`, `signInWith` and the entry types.

```ts
import { defineProvider } from '0-integrations/catalogue';

export const attio = defineProvider({
  id: 'attio', name: 'Attio', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [
    { kind: 'oauth2', authorizeUrl: 'https://app.attio.com/authorize', tokenUrl: 'https://app.attio.com/oauth/token',
      authorizeParams: { response_type: 'code' } },
    { kind: 'key' },
  ],
  scopes: { default: [] },
  revoke: { url: 'https://app.attio.com/oauth/revoke', token: ['access'] },
  http: { baseUrl: 'https://api.attio.com/v2', retry: { maxWaitMs: 10_000 } },
  identify: { request: { path: '/self' }, id: 'workspace_id', name: 'workspace_name',
    rejectWhen: [{ path: 'active', equals: false, detail: 'token_inactive' }, { status: 400 }] },
});
```

That is a whole provider: OAuth 2 and a key, the connect form, the credential check, the account, retry and raw calls.
Only `id`, `name`, `auth` and `http.baseUrl` are required, and an entry states only what differs from the defaults.

| Field | What it declares |
|---|---|
| `docs` | The provider's own page that states what the entry declares, https. Every entry in the library has one. |
| `categories` | What the provider is for: one or two of a closed list (`tasks`, `docs`, `chat`, `code`, `crm`, `mail`, `calendar`, `meetings`, …), the first the main one. Every entry in the library has them; the [design](../design/entries-and-engine.md#fields-of-an-entry) lists them all. |
| `fields` | What a person enters to connect: `{ name, title, secret?, default?, help?, choices? }`. A key or token entry has exactly one secret field: the credential. A plain field left blank takes its `default`; `choices` lists every value it accepts; `help` is a line a connect screen shows under it. |
| `auth` | The sign-in alternatives, the first the default (Linear and ClickUp: OAuth 2, then a key); `signInWith(entry, kind)` narrows an entry to one, and every call takes the narrowed entry ([connect](connect.md#an-entry-with-two-sign-ins)). Each is `{ kind: 'key' }`, a key the person enters; `{ kind: 'oauth2', … }`, a grant from the provider's consent screen; or `{ kind: 'token', request }`, one request that turns the fields into a short-lived token (Zoom, PayPal, Metabase). A sign-in after the first may declare its own `fields`, `http: { baseUrl, host? }` and `identify`, which `signInWith` puts in place of the entry's (Outline's key, on the host the person types). [oauth](oauth.md) holds the OAuth 2 and token contracts; `send`, how the credential travels (`{ header, value }` fills a template as every credential template is: Discord's `'Bot {token}'`), is in the [design](../design/entries-and-engine.md#auth). |
| `scopes` | `{ default, requireGranted? }`: the scopes the OAuth 2 sign-in asks for, and whether a grant short of one is refused. |
| `identify` | The request that checks the credential and the paths of the account's `id` and `name`; `rejectWhen` names answers that mean a bad credential whatever their status. A request (identify's, or a request revoke's) may name one of `http.bases` as its `base`; a name the entry lacks is `base_unknown`, and a base with a placeholder `base_templated`, before anything is sent. Jira's identify asks `bases.api` for the sites its grant reaches: the account is the first site, and its cloud id is saved as `cloudId`. |
| `save` | Values kept on the connection after sign-in, read from the token answer, the identify answer or the plain fields. A saved value never replaces an entered field of the same name. One read from the token answer may be the base's host (Wrike's data centre), checked against `http.host` ([connect](connect.md#oauth-2-on-the-host-its-token-answer-names)). |
| `revoke` | An RFC 7009 revoke (`{ url, token }`) or a request (`{ request }`), with `goneErrors`. |
| `http` | `baseUrl`, `host`, `bases` (named extra bases), `headers`, `timeoutMs` (30 s by default), `minIntervalMs`, `retry`, `rateLimit`. A base may hold a plain field in its host (Intercom's `'https://{apiHost}'`): it is filled on the first request, a value that is no host name (ASCII letters, digits, `-` and dots; no port) is `base_value_invalid`, and the filled host must match `host` (`'*.intercom.io'`; a list of such patterns when the hosts are on several domains, Smartsheet's four; or `'*'` alone for any), else `base_host_refused`, both before the token is read. `'*'` is a host the person types (GitLab's `'https://{host}/api/v4'`): only on a base whose whole host is one placeholder, reached through the address guard ([client](client.md#the-address-guard)). A placeholder in the base's path is one encoded segment from a plain or saved value (Jira's `'https://api.atlassian.com/ex/jira/{cloudId}'`, `a/b` sent as `a%2Fb`; `.` and `..` are `base_value_invalid`), and needs no `host`. |
| `errors` | Where the provider's own error code is (`detail`), which codes mean a revoked grant, and rules that map answers to error codes. |
| `webhook` | The signature scheme, `kind` `hmac` (with `hash` and `part`), `ed25519`, `token` or `standard`, plus `deliveryId` and `challenge`. The rules are in [webhooks](webhooks.md). |
| `paging` | Named paging shapes: `cursor` (a next cursor sent back in the query or the body), `page` (a page number in the query or the body: none first, then 2, 3, or with `zeroBased` 1, 2; it stops on a falsy `more` or an empty `list`, a `list` that is missing or no list is `invalid_response`, and a page that repeats the one before is `page_repeated`; an operation on it names the same `list` as its `records`), `offset` (a record offset in the query or the body: none first, then the offset sent, 0 for the first page, plus the entries in the page's `list`, a skipped record included; it stops and fails as `page` does), `linkHeader` (the `Link` header's `rel="next"` link) and `nextUrl` (a next link in the body). A next link is a full URL or a path on the base's origin (Shortcut's search), and must stay under the base's path and `pathPrefix`, else it is `next_link_foreign`. |
| `operations` | Named reads and writes, with typed parameters and results, called through [`client`](client.md). Each one's `docs` is the provider's https page that states its method, path, parameters and answer; every operation in the library has one. `anyOf` lists sets of arguments (`[['email'], ['phone', 'last_name']]`) of which a call gives one whole, else `client()` refuses it with `param_group_missing: <id>` before anything is sent. |

A path is dotted (`data.user.id`), and at each level the whole rest is tried as one key first, so `@odata.nextLink` reads
the key of that name. A template is a string with `{name}` placeholders, such as `'{apiId}'` in a Basic credential or
`'{connection.apiId}'` in Aircall's `identify`. The [design](../design/entries-and-engine.md) gives every field and rule
in full.

An app may write its own entry, or derive one from a published entry
([connect](connect.md) shows other scopes). `defineProvider` keeps the literal's type, so the client's types are
inferred from it. It does not refuse a misspelled key: [connect](connect.md) says why and what checks it.

An entry's tier is what it has proven. `declared` passes the schema and the table test. `recorded` has a real recording
beside it, captured from a real account. `verified` will mean a nightly live check passes. Every entry is `declared`
today: the recordings in the repository are synthetic.
