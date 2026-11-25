# Apollo

`apolloClient({ apiKey, fetch })` enriches people and companies with a team's own key; a scoped key needs
`api/v1/users/api_profile`, `api/v1/people/match` and `api/v1/organizations/enrich`. `profile()` is the key proof and
spends no credit. `person({ email?, firstName?, lastName?, domain?, organizationName? })` is People Enrichment without
personal emails, phones or the waterfall (a phone costs 8 more credits, the waterfall up to 45): one credit when Apollo
returns data, none when it matches nobody. It answers the person's name, title, headline, LinkedIn, location and current
employer, which carries the firmographics `organization(domain)` reads for one credit (whether a miss is charged is not
documented). Both answer null for no match: Apollo documents no miss body, so a missing person, one without an id, or
`match_confidence: none` is null. Apollo reports no spend in its answers, so an app counts its own calls. A 429 is waited
out once, up to a minute (`retry-after`, else 60 seconds); a longer plan window is then reported. A refusal's
`detail` is Apollo's `error_details.code`: a key without the endpoint is `rejected` 403,
`AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED`. Apollo's API terms (§3) bar using a third party's credentials or integrating
the API into a product without Apollo's approval. `apollo/fake` exports `fakeApollo({ account: apiKey => … })`.
