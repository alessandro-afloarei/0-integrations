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

## A provider module

- A provider is its entry, `src/catalogue/<id>.ts`: plain data the engine runs, which the catalogue test checks with
  no test code of yours. Add a module only when the provider needs real code.

Every new provider module ships three things beside its client:

- **A fake** at `<provider>/fake`: routes that answer the calls the client makes, from data the test passes.
- **A recording** beside its entry, `src/catalogue/<id>.recording.json`: the scenario's requests and the provider's
  answers. The catalogue test signs in on it with a good key and a bad one.
- **The provider kit or the lookup kit**, run once on the recording and once on the fake, so the fake answers as the
  provider does. A provider with pages uses the provider kit; one that looks up a person or a company uses the lookup
  kit. [docs/modules/testing.md](docs/modules/testing.md) describes both and how to record from a test account.

Add the module's page under `docs/modules/` and its row to the README's providers table.

## Recordings hold no one's data

Every recording must pass `src/fixtures-privacy.test.ts`, which `pnpm check` runs. It refuses any email address or
phone number that could belong to a real person: use addresses on reserved domains (`example.com`, `.test`) and the
fictional 555-0100 to 555-0199 numbers. A live recording keeps every answer whole, so read the file before you commit
it and replace each real name, address and id with a synthetic one.

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
