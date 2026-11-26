# `catalogue`

A provider is an entry: plain data that says how to sign in, how to learn the account, how the credential travels, how
errors read, and which calls the provider offers. `0-integrations/catalogue/<id>` exports one entry under the name
`<id>`, so an id is the export's name: lowercase letters and digits, starting with a letter.
`0-integrations/catalogue.json` holds every entry, each with its `tier`. `0-integrations/catalogue` exports
`defineProvider` and the entry types.

```ts
import { defineProvider } from '0-integrations/catalogue';

export const attio = defineProvider({
  id: 'attio', name: 'Attio', fields: [{ name: 'apiKey', title: 'API key', secret: true }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://api.attio.com/v2', minIntervalMs: 100, retry: { maxWaitMs: 10_000 } },
  identify: { request: { path: '/self' }, id: 'workspace_id', name: 'workspace_name',
    rejectWhen: [{ path: 'active', equals: false, detail: 'token_inactive' }, { status: 400 }] },
});
```

That is a whole provider: the connect form, the credential check, the account, pacing, retry and raw calls. Only `id`,
`name`, `auth` and `http.baseUrl` are required, and an entry states only what differs from the defaults.

| Field | What it declares |
|---|---|
| `fields` | What a person enters to connect: `{ name, title, secret? }`. A key entry has exactly one secret field: the credential. |
| `auth` | One sign-in: `{ kind: 'key' }` or `{ kind: 'oauth2', authorizeUrl, tokenUrl, … }`. `send` says how a key travels: Bearer by default, `{ header }` for a bare token, `{ basic: ['{apiId}', '{apiToken}'] }`. |
| `scopes` | `{ default, requireGranted? }`: the scopes asked for, and whether a grant short of one is refused. |
| `identify` | The request that checks the credential and the paths of the account's `id` and `name`; `rejectWhen` names answers that mean a bad credential whatever their status. |
| `save` | Values kept on the connection after sign-in, read from the token answer, the identify answer or the plain fields. |
| `revoke` | An RFC 7009 revoke (`{ url, token }`) or a request (`{ request }`), with `goneErrors`. |
| `http` | `baseUrl`, `bases` (named extra bases), `headers`, `timeoutMs` (30 s by default), `minIntervalMs`, `retry`, `rateLimit`. |
| `errors` | Where the provider's own error code is (`detail`), which codes mean a revoked grant, and rules that map answers to error codes. |
| `webhook` | The HMAC scheme: the header, what is signed, a prefix, an encoding, a timestamp tolerance and a `deliveryId`. |
| `paging` | Named paging shapes: `cursor` (a next cursor sent back in the query or the body) and `nextUrl` (a next link in the body). |
| `operations` | Named reads and writes, with typed parameters and results, called through [`client`](client.md). |

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
