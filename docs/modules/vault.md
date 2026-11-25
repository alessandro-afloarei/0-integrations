# `vault`

`vault` seals arbitrary JSON with `createVault({ tenantKeys, keys })`. Call `seal` and `open` with the tenant and
connection IDs. It opens format 1 and writes the key source's chosen format; format 2 adds AAD.
Use `rewrapTenantKey` to move a tenant's data key to the current KEK or format without rewriting its secrets.
