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
name `<id>`: the id is the export's name, lowercase letters and digits starting with a letter. No other code needs an
edit: the `./catalogue/*` export publishes it, the build adds it to `catalogue.json`, and `pnpm check` tests it. Adding
one takes five steps:

1. `pnpm new <id>` writes the entry's skeleton, a key entry whose every unknown is `TODO`. It never overwrites a file.
2. Fill it from the provider's own documentation, and put the page that states what the entry declares in `docs`.
   State only what differs from the defaults: [catalogue](docs/modules/catalogue.md) lists every field, and the
   design's [`auth` section](docs/design/entries-and-engine.md#auth) gives every sign-in rule. Start from the entry
   of the same sign-in kind: a key, `src/catalogue/serpapi.ts`; an OAuth 2 grant, `src/catalogue/figma.ts` (drop the
   skeleton's secret field: the grant is the secret); a token request, `src/catalogue/zoom.ts`. Write every header name
   in lowercase (`x-api-key`).
3. `pnpm check`. The table test below says what to fix, a `TODO` left included, and signs the entry in on the fake
   derived from it (`fakeProvider`, from `0-integrations/testing`) with a good key and a bad one, whenever the entry
   has an identify request or a token request.
4. Optional: record it from a test account (below), read the file, and commit it. An entry the recorder can record (one
   with no module that sends a request when it signs in) becomes `recorded`.
5. Add one line to `CHANGELOG.md` under `Unreleased`, then open a pull request.

`src/catalogue/catalogue.test.ts` runs over every file in the folder, with no test code of yours. It checks that the
entry:

- matches the entry types with no unknown key (the compiler accepts a misspelled one; this test does not), holds no
  function and no `TODO`, prints to JSON unchanged, and has an id that is unique and equals its file name;
- cites in `docs` the https page of the provider that states what the entry declares;
- fills `auth.send`'s templates, when it has any, with the secret (`{token}`, or a key entry's secret field) and only
  the entry's fields; a send's `value` holds no control character and never spells out a default (`'{token}'`, or
  `authorization: Bearer {token}`), and no field is named `token`;
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
  when a timestamp is declared, read apart from the signature (another `part` or header); a `part` name holds no `,`,
  `=` or whitespace, and no `prefix` sits beside it; every header name (a webhook's, a send's, `http.headers` keys) is
  one lowercase HTTP token; a `challenge` compares a body `path` (`equals` or `in`) and echoes a top-level key;
- declares operations a client can call: each `{name}` in a path is a required path parameter, every parameter has a
  place in the request (a GET has no body), a paged operation names a declared shape and no `notFound`, a records path
  leads to a list, and no id is a client call or a dotted prefix of another.

A recording beside the entry, `src/catalogue/<id>.recording.json` (or `<id>.<part>.recording.json`), adds a replay:
the test signs in once with a good key and once with a bad one, sending no request twice (a `token` entry's token
request, then identify's when a value reads it; a bad key stops at its first request). The bad key must be `rejected`.
A recording the recorder wrote from an account replays to the account the entry's own rule gives over the kit's
stand-ins at the paths the recording holds; in one written by hand, the account id must appear in the recorded answers.
The recorder runs this same check before it writes. A recording is `{ provider, synthetic, source, recordedAt,
exchanges }`, each exchange `{ key: 'good' | 'bad', method, url, body?, status, headers?, response }` (a form body is
kept as its text); the replay matches the method, the whole URL and the body, and fills a plain field with its kit
value (its `default`, else its first choice, else `kit-<name>`).

To record an entry with no module from a test account, read the key at a prompt (bash and zsh) and run the recorder:
`printf 'Key: ' && read -rs RECORD_KEY && RECORD_KEY=$RECORD_KEY RECORD_PROVIDER=<id> RECORD_VALUES='{"<plain field>":"…"}' pnpm vitest run src/record.test.ts`.
For an OAuth entry, `RECORD_KEY` is an access token from signing in to a test account with your app's own OAuth client.
The recorder refuses a provider with a module but no kit scenario of that name, and an entry that sends no request
when it signs in. Otherwise it signs in with the key and with a bad key, and writes
`src/catalogue/<id>.recording.json`, replacing any recording of that name. Each exchange keeps its method, URL, request
body, status and `retry-after` (no other header), and from the answer only the paths the entry reads; at an error or
condition path, only a provider code, a number or a boolean. It swaps the key, the plain values, the tokens issued, the
account's id and name and the saved values for the kit's stand-ins. It refuses to write when a sign-in was redirected,
when a value is too short to swap or a real value is still in an exchange, and when the file, replayed before it is
written, fails the table test's own replay check
([testing](docs/modules/testing.md#recording-an-entry-with-no-module) says exactly what is written, swapped and
refused). Only such a capture from a real test account (`synthetic: false`)
makes the entry `recorded`; never copy a file from a `.record-test-*` folder, which the recorder's own tests write on a
fake. A recording written by hand from the provider's documented examples is marked `synthetic: true`: it tests the
entry and leaves its tier `declared`. Every recording must sit beside an entry.

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

Every recording must pass `src/fixtures-privacy.test.ts`, which `pnpm check` runs. It refuses any email address off
the reserved domains (`example.com`, `.test`) and any phone number written with a leading `+` outside the fictional
555-0100 to 555-0199 range. It does not catch names, street addresses, ids or numbers in other formats, so read every
recording before you commit it and replace each real one with a synthetic one. A recording of an entry keeps only the
paths the entry reads, with the account's id and name and the saved values already swapped for kit values; a module
scenario's recording keeps each answer whole.

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
