# Notion

`notionClient({ apiKey, fetch })` reads the pages shared with an internal connection, with its token. It sends
`Notion-Version: 2026-03-11`, the latest, where a trashed page is `in_trash` (`archived` is gone). `bot()` is the key proof:
the connection's bot, with its workspace's id and name (null when Notion leaves one out). `pages({ editedAfter?, cursor? })`
searches the shared pages, 100 a page, most recently edited first, as `{ id, url, created_time, last_edited_time, in_trash,
title }`: the title is the title property's plain text, empty on an untitled page, and the other properties are dropped.
Search filters on no time, so with `editedAfter` the read ends at the first page edited before it, and an hourly read costs a
page or two; a page edited exactly then is kept. Notion's index lags, a newly shared old page keeps its old edit time and an
unshared one just disappears, so an app reads back from its last time minus a few minutes and walks every page now and then.
`text(pageId)` reads a page as Notion-flavored Markdown (`markdown_version=v2`); `cut` says Notion left part out, past about
20,000 blocks or where child content is not shared with the connection. A child page is a link, read on its own, and a
meeting note's transcript stays out. The client paces calls 350 ms apart (Notion allows a connection 180 a minute, within a
budget the workspace's connections share) and waits out one 429. A 401 is a bad token, a 403 a connection without the Read content
capability. `notion/fake` exports `fakeNotion({ workspace: token => … })`.
