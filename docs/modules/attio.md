# Attio

`attioClient({ apiKey, fetch })` reads a workspace with its access token. `workspace()` is the key proof: Attio answers an
unknown token `200 { active: false }` (and one of the wrong length 400), which the client reports as `rejected`.
`records({ object, createdAfter?, cursor? })` pages an object's records oldest first by offset, 500 a page, or only those
created after a time; values stay as Attio returns them, keyed by attribute slug. Attio keeps no update time on records or
notes, so an app finds edits by reading every page again and comparing. `notes(cursor?)` pages notes 50 at a time,
`members()` lists the workspace's members. `attio/fake` exports `fakeAttio({ workspace: token => … })`.
