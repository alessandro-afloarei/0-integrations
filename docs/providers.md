# Providers

Generated from `src/catalogue/` by `pnpm providers`: do not edit. 81 providers: 81 declared, 0 recorded;
252 typed operations; webhooks: ed25519 1, hmac 20, standard 3, token 2. What waits is in the [waiting list](waiting-list.md).

| Provider | Categories | Sign-in | Operations | Webhook | Tier |
|---|---|---|---|---|---|
| [Affinity](https://developer.affinity.co/pages/external-api-v2/authentication) | crm | key | persons.list, persons.get, persons.create, persons.update, companies.list, opportunities.list | — | declared |
| [Agile CRM](https://github.com/agilecrm/rest-api#authentication-) | crm | key | contacts.list, contacts.search, contacts.get, contacts.create, contacts.update, deals.list | — | declared |
| [Aircall](https://developers.aircall.io/api-references) | phone | key | calls.transcript | — | declared |
| [Airtable](https://airtable.com/developers/web/api/authentication.md) | tasks | OAuth 2, key | records.list, records.get, records.create, records.update, bases.list | — | declared |
| [Apollo](https://docs.apollo.io/reference/authentication) | sales | key | — | — | declared |
| [Asana](https://developers.asana.com/docs/oauth) | tasks | OAuth 2, key | tasks.list, tasks.get, tasks.create, tasks.update, projects.list | — | declared |
| [Attio](https://docs.attio.com/rest-api/guides/authentication) | crm | OAuth 2, key | — | — | declared |
| [Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops) | code | OAuth 2 | repositories.list, repositories.get, pullRequests.list, pullRequests.get, pullRequests.create, projects.list | — | declared |
| [Better Stack](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/) | monitoring | key | incidents.list, incidents.get, incidents.create, incidents.update, monitors.list | — | declared |
| [Bitbucket](https://developer.atlassian.com/cloud/bitbucket/rest/intro/#authentication) | code | OAuth 2, key | repositories.list, repositories.get, pullRequests.list, pullRequests.get, pullRequests.create | hmac | declared |
| [Breakcold](https://docs.breakcold.com/api/authentication) | crm | key | — | hmac | declared |
| [Buildkite](https://buildkite.com/docs/apis/rest-api#authentication) | code | key | builds.list, builds.get, builds.create, pipelines.list | hmac | declared |
| [Capsule](https://developer.capsulecrm.com/v2/overview/authentication) | crm | OAuth 2, key | parties.list, parties.get, parties.create, parties.update, parties.search, opportunities.list | — | declared |
| [Chatwork](https://developer.chatwork.com/docs/endpoints) | chat | OAuth 2, key | rooms.list, messages.list, contacts.list | — | declared |
| [CircleCI](https://circleci.com/docs/api/v3/conventions.md) | code | key | runs.list, runs.get, runs.create, projects.list | hmac | declared |
| [Clay](https://developers.clay.com/public-api/authentication) | sales | key | — | hmac | declared |
| [ClickUp](https://developer.clickup.com/docs/authentication) | tasks | OAuth 2, key | tasks.list, tasks.get, tasks.create, tasks.update, lists.list | hmac | declared |
| [Close](https://developer.close.com/api/overview/oauth-authentication) | crm | OAuth 2, key | contacts.list, contacts.get, contacts.create, contacts.update, contacts.search, leads.list, opportunities.list | — | declared |
| [Superhuman Docs (formerly Coda)](https://docs.superhuman.com/developers/apis/v1#operation/whoami) | docs | key | pages.list, pages.get, pages.create, pages.update, docs.list | — | declared |
| [Cognism](https://developers.cognism.com/#authentication) | sales | key | contacts.search, contacts.get, accounts.search, accounts.get | — | declared |
| [Discord](https://docs.discord.com/developers/reference) | chat | key | — | ed25519 | declared |
| [Exa](https://exa.ai/docs/reference/search) | search | key | — | — | declared |
| [Fathom](https://developers.fathom.ai/quickstart) | meetings | key | — | — | declared |
| [Figma](https://developers.figma.com/docs/rest-api/oauth-apps/) | design | OAuth 2, key | — | — | declared |
| [Firecrawl](https://docs.firecrawl.dev/api-reference/v2-introduction) | search | key | — | — | declared |
| [Fireflies](https://docs.fireflies.ai/fundamentals/authorization) | meetings | key | user | hmac | declared |
| [folk](https://developer.folk.app/api-reference/authentication) | crm | key | people.list, people.search, people.get, people.create, people.update, companies.list, deals.list | standard | declared |
| [Freshsales](https://developers.freshworks.com/crm/api/#authentication) | crm | key | contacts.list, contacts.search, contacts.get, contacts.create, contacts.update, accounts.list, deals.list | — | declared |
| [GitBook](https://gitbook.com/docs/developers/gitbook-api/authentication) | docs | key | pages.list, pages.get, spaces.list | — | declared |
| [GitHub](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api) | code | OAuth 2, key | — | — | declared |
| [GitLab](https://docs.gitlab.com/api/rest/authentication/) | code | OAuth 2, key | — | standard | declared |
| [Google](https://developers.google.com/identity/protocols/oauth2/web-server) | mail, calendar | OAuth 2 | — | token | declared |
| [Granola](https://docs.granola.ai/introduction) | meetings | key | — | — | declared |
| [Guru](https://developer.getguru.com/docs/getting-started) | docs | key | cards.search, cards.get, cards.create, cards.update, collections.list | — | declared |
| [Honeybadger](https://docs.honeybadger.io/api/v3/authentication/) | monitoring | key | faults.list, faults.get, faults.update, projects.list | token | declared |
| [HubSpot](https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/migration-guide) | crm | OAuth 2, key | — | — | declared |
| [Hunter](https://hunter.io/api-documentation/v2#authentication) | sales | key | people.search, people.get, companies.search, companies.get | — | declared |
| [incident.io](https://docs.incident.io/api-reference/introduction) | monitoring | key | incidents.list, incidents.get, incidents.create, incidents.update, severities.list | — | declared |
| [Insightly](https://api.insightly.com/v3.1/Help) | crm | key | contacts.list, contacts.search, contacts.get, contacts.create, contacts.update, organisations.list, opportunities.list | — | declared |
| [Instantly](https://developer.instantly.ai/getting-started/authorization) | sales | key | campaigns.list, leads.list, leads.get, leads.create, leads.update | — | declared |
| [Intercom](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/identifyadmin) | support | OAuth 2, key | — | hmac | declared |
| [Jira](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) | tasks | OAuth 2 | — | — | declared |
| [Leadfeeder (formerly Dealfront)](https://docs.leadfeeder.com/api/public/authentication-354547m0) | sales | key | contacts.search, contacts.get, companies.search, companies.get | — | declared |
| [LeadIQ](https://leadiqhelp.zendesk.com/hc/en-us/articles/29375289152795-LeadIQ-Public-API-Guide) | sales | key | people.search, people.get, companies.search, companies.get | — | declared |
| [lemlist](https://developer.lemlist.com/api-reference/getting-started/authentication) | sales | key | campaigns.list, contacts.list, contacts.get, contacts.create, contacts.update, leads.create | — | declared |
| [LINE](https://developers.line.biz/en/reference/messaging-api/#get-bot-info) | chat | key | messages.create, followers.list | hmac | declared |
| [Linear](https://linear.app/developers/graphql#authentication) | tasks | OAuth 2, key | issues.list, issues.get, issues.create, issues.update, teams.list | hmac | declared |
| [Lusha](https://docs.lusha.com/authentication) | sales | key | — | — | declared |
| [Mattermost](https://docs.mattermost.com/api/reference/mattermost-api) | chat | OAuth 2, key | channels.list, posts.list, posts.create, users.list | — | declared |
| [Metabase](https://www.metabase.com/articles/set-up-metabase-from-code-with-the-api) | analytics | token | — | — | declared |
| [Microsoft](https://learn.microsoft.com/en-us/graph/auth-v2-user) | mail, calendar | OAuth 2 | — | — | declared |
| [monday.com](https://developer.monday.com/api-reference/docs/authentication) | tasks | OAuth 2, key | items.list, items.get, items.create, items.update, boards.list | — | declared |
| [Notion](https://developers.notion.com/reference/authentication) | docs | key | pages.markdown | — | declared |
| [Nutshell](https://developers.nutshell.com/docs/api-authentication) | crm | key | contacts.list, contacts.get, contacts.create, accounts.list, leads.list | — | declared |
| [Outline](https://www.getoutline.com/developers#description/oauth-20) | docs | OAuth 2, key | documents.list, documents.get, documents.create, documents.update, collections.list | — | declared |
| [Outreach](https://developers.outreach.io/api/getting-started) | sales | OAuth 2 | sequences.list, prospects.list, prospects.get, prospects.create, prospects.update, sequenceStates.create | hmac | declared |
| [PagerDuty](https://docs.pagerduty.com/developer/authentication) | monitoring | OAuth 2, key | incidents.list, incidents.get, services.list | hmac | declared |
| [PayPal](https://developer.paypal.com/api/rest/authentication/) | finance | token | — | — | declared |
| [People Data Labs](https://docs.peopledatalabs.com/docs/authentication) | sales | key | people.search, people.get, companies.search, companies.get | — | declared |
| [Render](https://api-docs.render.com/reference/authentication) | code | key | deploys.list, deploys.get, deploys.create, services.list | standard | declared |
| [Reply.io](https://docs.reply.io/api-reference/authentication) | sales | key | sequences.list, contacts.list, contacts.get, contacts.create, contacts.update, contactLinks.create | — | declared |
| [RocketReach](https://docs.rocketreach.co/reference/rocketreach-api-account) | sales | key | people.search, people.get, companies.search, companies.get | hmac | declared |
| [Rollbar](https://docs.rollbar.com/reference/getting-started-1) | monitoring | key | items.list, items.get, items.update | — | declared |
| [Salesflare](https://api.salesflare.com/docs) | crm | key | contacts.list, contacts.get, contacts.create, contacts.update, accounts.list, opportunities.list | — | declared |
| [Salesloft](https://developers.salesloft.com/docs/platform/api-basics/oauth-authentication/) | sales | OAuth 2, key | cadences.list, people.list, people.get, people.create, people.update | hmac | declared |
| [Sentry](https://docs.sentry.io/api/auth/) | monitoring | key | issues.list, issues.get, issues.update, projects.list | hmac | declared |
| [SerpApi](https://serpapi.com/account-api) | search | key | — | — | declared |
| [Shortcut](https://developer.shortcut.com/api/rest/v3#Authentication) | tasks | key | stories.search, stories.get, stories.create, stories.update, workflows.list | hmac | declared |
| [Slack](https://docs.slack.dev/authentication/installing-with-oauth) | chat | OAuth 2 | — | hmac | declared |
| [Slite](https://developers.slite.com/docs/getting-started) | docs | key | notes.list, notes.get, notes.create, notes.update | — | declared |
| [Smartsheet](https://developers.smartsheet.com/api/smartsheet/guides/basics/authentication.md) | tasks | key | rows.list, rows.get, rows.create, rows.update, sheets.list | — | declared |
| [Stripe](https://docs.stripe.com/api/authentication) | finance | key | — | hmac | declared |
| [Teamleader Focus](https://developer.focus.teamleader.eu/docs/authentication) | crm | OAuth 2 | contacts.list, contacts.get, contacts.create, contacts.update, companies.list, deals.list | — | declared |
| [Todoist](https://developer.todoist.com/api/v1/authorization.md) | tasks | OAuth 2, key | tasks.list, tasks.get, tasks.create, tasks.update, projects.list | hmac | declared |
| [Trello](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/) | tasks | key | — | — | declared |
| [Unipile](https://developer.unipile.com/v2.0/docs/api-keys) | mail, calendar | key | — | — | declared |
| [Vercel](https://vercel.com/docs/rest-api#authentication) | code | key | deployments.list, deployments.get, deployments.create, projects.list | hmac | declared |
| [Wrike](https://developers.wrike.com/docs/oauth-20-authorization) | tasks | OAuth 2 | tasks.list, tasks.get, tasks.create, tasks.update, folders.list | — | declared |
| [Zoom](https://developers.zoom.us/docs/internal-apps/s2s-oauth/) | meetings | token | — | — | declared |
| [ZoomInfo](https://docs.gtm.ai/docs/client-credentials-flow) | sales | token | contacts.search, contacts.get, companies.search, companies.get | — | declared |
| [Zulip](https://zulip.com/api/http-headers) | chat | key | channels.list, messages.list, users.list | — | declared |
