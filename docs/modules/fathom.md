# Fathom

`fathomClient({ apiKey, fetch })` reads a member's meetings with their personal key (Fathom has no team key).
`meetings({ createdAfter?, recordedBy?, cursor? })` answers one `Page` of ten meetings, Fathom's fixed size, without
transcripts, so a list stays a light call; `transcript(recordingId)` reads one, which Fathom counts as heavy (30 a minute,
which Fathom may lower to 5). The client waits out one 429. Fathom filters only on
creation time and has no "who am I" call: `recordedBy` keeps the meetings one email recorded, which is how an app keeps a
member's own calls from the teammates' shared ones. The client drops Fathom's summary, action items and CRM matches, and
reads a schedule and a call link as nullable. `fathom/fake` exports `fakeFathom({ meetings: apiKey => … })`.
