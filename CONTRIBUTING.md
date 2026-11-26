# Contributing to 0-integrations

Thank you for helping. This page covers setup, the one check, and what a change must carry.

## Setup and the check

```sh
pnpm install
pnpm check
```

`pnpm check` is the one command: typecheck, ESLint with zero warnings, knip and Vitest. It must pass before you open a
pull request, and CI runs the same command. Library tests use fake providers and in-memory stores, so they need no
server, database or provider account. Run `pnpm build` for ESM and declarations, or `pnpm pack` for a local install.

## A provider

A provider is one file, its entry: `src/catalogue/<id>.ts`, exporting `defineProvider({ id: '<id>', … })` under the
name `<id>`: the id is the export's name, lowercase letters and digits starting with a letter. Write it from the provider's own documentation and state only what differs from the defaults
([catalogue](docs/modules/catalogue.md)); the [design](docs/design/entries-and-engine.md) gives every field. Nothing
else needs an edit: the `./catalogue/*` export publishes it, the build adds it to `catalogue.json`, and `pnpm check`
tests it.

`src/catalogue/catalogue.test.ts` runs over every file in the folder, with no test code of yours. It checks that the
entry:

- matches the entry types with no unknown key (the compiler accepts a misspelled one; this test does not), holds no
  function, prints to JSON unchanged, and has an id that is unique and equals its file name;
- cites in `docs` the https page of the provider that states what the entry declares;
- names in each template only what that place allows;
- is one the engine can run: a key or token entry has exactly one secret field, a key entry reads no token answer, and
  neither declares scopes or an RFC 7009 revoke; an OAuth entry declares scopes; no `identify` or `save` value reads
  the token itself from `tokenAnswer.*`; a value read from identify's answer has a request to read it from; no `save`
  key is a field's name; each placeholder in the base names a plain field or a `save` key, either in its host, with
  `http.host` declared (`'*'` only when the whole host is one placeholder), or as one segment of its path; `http.bases`
  hold no placeholder, and a call's `base` names one of them; a token request names only the entry's fields (a plain
  one in its `url`, whose host placeholder needs `http.host`), sends the secret field in its body or Basic, and its
  `send` names no secret field; a field's `choices` are a non-empty list of unique values holding its `default`, each
  of them and the `default` fills the base to a host `http.host` takes, and a secret field has neither;
- declares a webhook the engine can trust: `{body}` is signed (by default, or in `signed`), and `{timestamp}` exactly
  when a timestamp is declared, read apart from the signature (another `part` or header); a `part` name holds no `,`, `=` or whitespace, and no `prefix` sits beside it; every header name is one
  lowercase HTTP token; a `challenge` compares a body `path` (`equals` or `in`) and echoes a top-level key; a send's
  `value` names the secret, holds no control character and never spells out a default (`'{token}'`, or
  `authorization: Bearer {token}`);
- declares operations a client can call: each `{name}` in a path is a required path parameter, every parameter has a
  place in the request (a GET has no body), a paged operation names a declared shape and no `notFound`, a records path
  leads to a list, and no id is a client call or a dotted prefix of another.

A recording beside the entry, `src/catalogue/<id>.recording.json` (or `<id>.<part>.recording.json`), adds a replay:
the test signs in once with a good key and once with a bad one, each sending a `token` entry's token request and
identify once (a bad key stops at the token request). The bad key must be `rejected`, and the account id must appear in
the recorded answers. A recording is `{ provider, synthetic, source, recordedAt, exchanges }`, each exchange
`{ key: 'good' | 'bad', method, url, body?, status, headers?, response }` (a form body is kept as its text); the replay
matches the method, the whole URL and the body, and fills a plain field with its kit value (its `default`, else its first
choice, else `kit-<name>`).

To record an entry from a test account, run `RECORD_PROVIDER=<id> RECORD_KEY=<secret>
RECORD_VALUES='{"<plain field>":"…"}' pnpm vitest run src/record.test.ts`
([testing](docs/modules/testing.md#recording-an-entry-with-no-module)). The recorder swaps the key, the plain values, the
tokens issued and the account's id and name for the kit's stand-ins, and writes nothing it cannot scrub. Only such a
capture (`synthetic: false`) makes the entry `recorded`. A recording written by hand from the provider's documented
examples is marked `synthetic: true`: it tests the entry and leaves its tier `declared`. Every recording must sit beside
an entry.

Add a module, `src/<id>/<id>.ts`, only when the provider needs real code: answers with meaning, incremental reads,
parsed webhooks, a sign-in the provider hosts. It builds on its entry with `client(entry, …)`, so its errors, retry and
paging are the entry's, and ships with:

- a fake at `src/<id>/fake.ts`: routes that answer the calls the module makes, from data the test passes;
- the provider kit or the lookup kit, run once on the recording and once on the fake, so the fake answers as the
  provider does. A provider with pages uses the provider kit, its scenario in `src/<id>/scenario.test-support.ts`
  where the recorder finds it; one that looks up a person or a company uses the lookup kit
  ([testing](docs/modules/testing.md));
- its page under `docs/modules/`, its row in the README's providers table, and its two `exports` lines (`./<id>` and
  `./<id>/fake`), which `src/exports.test.ts` compares with the source tree.

## Recordings hold no one's data

Every recording must pass `src/fixtures-privacy.test.ts`, which `pnpm check` runs. It refuses any email address or
phone number that could belong to a real person: use addresses on reserved domains (`example.com`, `.test`) and the
fictional 555-0100 to 555-0199 numbers. A live recording keeps every answer whole, so read the file before you commit
it and replace each real name, address and id with a synthetic one. An entry's recording has the account's id and name
swapped for `kit-account` and `kit-name` already; anything else the answers hold is yours to replace.

## Code you did not write

- Write each provider module from the provider's own documentation. Provider facts (URLs, scopes, header names,
  signature schemes) are fine to use.
- Never copy code from Nango, Airbyte, n8n, Twenty or Midday, nor from the `ee/` folders of Onyx or Mastra. Their
  licenses are not compatible with Apache 2.0, or impose terms this project cannot pass on, so their code is not
  accepted. You may read them for ideas.
- Code copied from an Apache 2.0 or MIT source is welcome. Add the source and its license to `NOTICE`, and put a header
  comment on the copied file or block naming the source and its license.
- Code under any other license is not accepted.

## Changelog and releases

A pull request that makes a change users can see adds its line to `CHANGELOG.md` under an `Unreleased` heading at the
top. The release pull request bumps the version in `package.json` and moves those lines under the new version's
heading. A breaking change lists the migration beside it.

Release tags must match the package version. After review and merge, the maintainer pushes a `v*` tag; CI repeats the
gates and publishes to npm. Apps pin exact versions.

## Security issues

Do not open an issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
