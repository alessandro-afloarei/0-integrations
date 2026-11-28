# `paginate`

The provider modules' clients answer a list one `Page` at a time: `{ items, skipped, cursor }`, where `skipped`
holds the ids of entries the client could not read and `cursor` is null on the last page. `paginate(load)` walks the
pages and refuses a repeated cursor; the app stops when its own budget says so. Broken paging is `invalid_response` with
no status and the library's own `detail` (`cursor_repeated`, `cursor_missing`), so it never reads as a provider's code.

A client built from an entry pages by the entry's declared shapes instead: [client](client.md). There a page-number
list may also stop at the count its answers name (`total`), as Smartsheet's do, and a GraphQL list pages through its
query's variables (`send: { variables }`), as Linear's do; a value sent in the body may sit at a path inside it
(`send: { body: 'pagination.cursor' }`), as Fellow's does.
