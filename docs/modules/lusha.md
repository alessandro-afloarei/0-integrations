# Lusha

`lushaClient({ apiKey, fetch })` reads Lusha's v3 API; v2 stops answering on 2026-11-30. `usage()` is the key proof and
returns the account's credits (5 calls a minute; Lusha lists no charge for it). `person({ email } | { linkedinUrl } |
{ firstName, lastName, companyDomain })` is Lusha's contact search: name, title, company, location and LinkedIn, no emails
or phones, charged per match as `api_search` (1 credit on Lusha's documented prices). `company(domain)` is search and
enrich without premium reveals: base firmographics, charged per match as `reveal_company` (1). Each answers
`{ match, creditsCharged }`. `match` is null when Lusha finds no one (`NOT_FOUND`) or may not say (`COMPLIANCE_RESTRICTED`);
`creditsCharged` is Lusha's own `billing.creditsCharged`, the figure to budget with, since Lusha's FAQ charges no miss
and its introduction a minimum of one credit a request. A failed enrichment is `unavailable`, detail `enrich_failed`;
running out of credits is `request_failed` 402. Lusha documents no `Retry-After`, so a 429 is waited out once after a
minute, then reported. An account without v3 access is `request_failed` with detail `v3_not_enabled` and the answer's
status (Lusha answers 403), so an app can tell it from a bad key. Lusha's legal notice bars third-party platforms from
embedding or exposing its API or data without Lusha's prior written consent. `lusha/fake` exports `fakeLusha({ account: apiKey => … })`.
