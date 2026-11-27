# HubSpot

`hubspot` provides `hubspotClient` for object searches, batch reads, deal associations, portal identity, stages and
owners. `changedRecords` walks changed records in ascending object-id order, resuming from `afterId` instead of a
search offset, so no query pages past HubSpot's 10,000-result cap. The app supplies the access-token function and
fetch, and can stop when its scan budget is spent.

Sign in with `startConnect(hubspot, …)` and `finishConnect(hubspot, …)`, with the entry from
`0-integrations/catalogue/hubspot`, asking for OAuth and read access to companies, contacts, deals and owners
(`hubspot.scopes.default`). Identity uses the token answer's `hub_id` first, otherwise account-info, and returns
`account: { id: portalId, name: "Portal <portalId>" }`, `values: {}`, and `secret: grant`. A portal id is a non-empty
string or a positive integer; anything else is `invalid_response` (`missing_fields`), and a malformed `hub_id` fails
without falling back. The secret keeps the shared `Grant` shape. HubSpot can return the portal's existing refresh token
on re-consent, so the entry's `reusesGrant: true` skips failed-identity cleanup. An orphan grant is returned on the
next consent; revoking it could end a live connection. The app must check ownership before discarding a grant.
`revokeGrant(hubspot, { ...grant, client, fetch })` revokes the refresh token; access-only grants expire naturally.

`fakeHubSpot({ client: { clientId, clientSecret }, redirectUri, ...portalData })` from `hubspot/fake` requires the
registered client and an absolute HTTP(S) callback without userinfo or a fragment. Register the exact callback
used in both `startConnect` and `finishConnect`. Feed the real authorize URL to the fake, then extract its redirect's
one-use `code`; static fixture codes are refused. Authorization requires the registered client ID and every
scope of `hubspot.scopes.default`. Exchange, refresh and revoke require matching `client_id` and `client_secret`; invalid
credentials return 401 `invalid_client` without spending a valid code. Exchange binds codes to the exact callback
and accepts only `authorization_code` or `refresh_token` grant types.

One registered client/portal shares one refresh token across consents. Its initial shape is
`fixture-refresh-<sha256(JSON.stringify([clientId, hubId]))>`; after revocation the next consent adds a UUID suffix
and issues a new token. When a persisted replacement or legacy token resumes before any consent, it becomes the
canonical token. If a live grant already exists, refresh associates the persisted token as a holder of that grant
and returns the current canonical token; subsequent consents keep returning it. Revoking either the canonical token
or any accepted alias revokes all holders of that grant. Known revoked holders remain refused, and repeating their
revocation cannot end a later fresh grant. This alias canonicalization is a synthetic fixture behavior; the shared
production `Grant` contract is unchanged. Real HubSpot behavior after revocation has not been probed; new-token
issuance is a fixture ruling. Codes and access tokens keep per-instance UUID namespaces, so stale codes cannot cross instances.
Refresh accepts only that client/portal's fixture token shapes and the legacy `fixture-refresh` seed, including
persisted valid tokens after restart. Codes, access tokens, arbitrary strings and real tokens cannot refresh.

Keep **one fake instance per process** across authorize, exchange, refresh and revoke. Revocation accepts only
refresh tokens issued or resumed in that instance, succeeds repeatedly, and prevents further refresh there.
Unknown-token revoke remains 400 `invalid_token`; real HubSpot's response is unprobed. Revocation history is
**process-local**: other processes do not see it, and a restart forgets it. A persisted token must first resume
or be returned by consent before that instance can revoke it. These are synthetic fixture limitations, not
production revocation guarantees. The app still consumes and validates callback state before finishing.

```ts
import { hubspot } from '0-integrations/catalogue/hubspot';
import { startConnect, finishConnect } from '0-integrations/connect';
import { fakeHubSpot } from '0-integrations/hubspot/fake';
import { fakeFetch } from '0-integrations/testing';

const redirectUri = 'https://app.test/api/integrations/hubspot/callback';
const http = fakeFetch(fakeHubSpot({ ...portalData, client, redirectUri }));
const { url, codeVerifier } = await startConnect(hubspot, { clientId: client.clientId, redirectUri, state });
const consent = await http.fetch(url, { redirect: 'manual' });
const back = new URL(consent.headers.get('location') ?? '');
if (back.searchParams.get('state') !== state) throw new Error('state_mismatch');
const code = back.searchParams.get('code');
if (!code) throw new Error('missing_code');
const connected = await finishConnect(hubspot, {
  client, code, redirectUri, codeVerifier, fetch: http.fetch, onRevokeFailed,
});
```

The example uses app-owned `portalData`, OAuth `client`, a fresh stored `state` with the start's `codeVerifier`, and an
`onRevokeFailed` observer.
In the app, consume and validate that state once; keep the returned secret on the server.

## Stage history

`hubspotClient(...).dealStageHistory(ids)` returns a `Map<string, HubSpotStageRevision[]>`, with each revision
shaped as `{ value: stageId, timestamp, sourceType? }`, ordered oldest first. Timestamps are preserved exactly;
equal timestamps retain provider order. A returned deal without history maps to `[]`; a missing deal is absent.
The method reads all supplied IDs in sequential batches using a separate 50-ID history limit (plain reads remain at 100). A failed batch rejects
the call with the usual sanitized provider error, including a provider's batch-limit 400; it never returns a partial map.

History means **every revision HubSpot still retains**. HubSpot documents
[up to 20 revisions per deal property](https://knowledge.hubspot.com/properties/export-property-history?product=marketing),
with no calendar retention window or documented dealstage exception. The library returns everything supplied and
never synthesizes missing revisions. History reads use a 50-input cap, based on the provider's batch-history 400
reported in [PipedreamHQ/pipedream#8462](https://github.com/PipedreamHQ/pipedream/pull/8462). That report is for
contacts; we apply the same property-history cap to deals. HubSpot's
[Deals OpenAPI](https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json)
warns that requesting history lowers the per-request maximum, without naming the number.
The [Deals guide](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide) documents
`propertiesWithHistory: ["dealstage"]`. There is no documented history cursor to recover pruned revisions.
The [official OpenAPI schema](https://raw.githubusercontent.com/HubSpot/HubSpot-public-api-spec-collection/main/PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json)
describes timestamps as property update times, but provides no explicit guarantee of their immutability across reads.
The limit comes from that observed provider error alongside official documentation; we did not run a real-portal probe.

`fakeHubSpot(data)` also accepts `fakeHubSpot(() => data)`. The callback runs once at construction and must return
valid data then. It supplies current portal content once per
request that reads it; OAuth registration (client, redirect URI, hubId) is taken at construction, and grant state
survives content changes. Optional `dealStageHistory` maps deal IDs to revision arrays for known sync and cohort deals.
Optional `dealContacts` maps sync deal IDs to contact ID arrays, falling back to the cohort map when absent;
an explicit empty array overrides the cohort. Omitting these fields preserves existing behavior.
`dealCompanies` maps a deal to one company ID, or to `{ id, primary? }[]` served with HubSpot's association types.

`dealCompanies(ids)` returns each deal's primary company (HubSpot's `HUBSPOT_DEFINED` type 5), else its lowest
company ID by number, because HubSpot does not order a deal's associations.

The fake returns a 400 for history batches above 50 inputs, so fixture-backed consumers exercise the same limit.
