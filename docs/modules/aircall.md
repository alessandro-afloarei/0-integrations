# Aircall

`aircallClient({ apiId, apiToken, fetch })` reads a company's calls with its API key pair (Basic auth). `company()` is the
key proof. `calls({ from?, cursor? })` pages calls created since a Unix time, oldest first, 50 a page, each with its
contact; Aircall serves six months and at most 10,000 results a query, so an app moves `from` forward rather than paging
deep. `transcript(callId)` reads Aircall's transcription, or null while it has none. Transcripts need Aircall's AI Assist
add-on; without it the call is refused as `request_failed` 403, detail `ai_assist_required`, so an app can tell it from a
bad key. Aircall's API licence (§2.1.2) allows a third party Basic auth only with Aircall's and the account owner's
express authorization. `aircall/fake` exports `fakeAircall({ account: 'api_id:api_token' => … })`.
