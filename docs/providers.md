# Providers

Generated from `src/catalogue/` by `pnpm providers`: do not edit. 56 providers: 56 declared, 0 recorded;
121 typed operations; webhooks: ed25519 1, hmac 16, standard 2, token 2. What waits is in the [waiting list](waiting-list.md).

| Provider | Categories | Sign-in | Operations | Webhook | Tier |
|---|---|---|---|---|---|
| [Aircall](https://developers.aircall.io/api-references) | phone | key | calls.transcript | — | declared |
| [Airtable](https://airtable.com/developers/web/api/authentication.md) | tasks | OAuth 2, key | records.list, records.get, records.create, records.update, bases.list | — | declared |
| [Apollo](https://docs.apollo.io/reference/authentication) | sales | key | — | — | declared |
| [Asana](https://developers.asana.com/docs/oauth) | tasks | OAuth 2, key | tasks.list, tasks.get, tasks.create, tasks.update, projects.list | — | declared |
| [Attio](https://docs.attio.com/rest-api/guides/authentication) | crm | key | — | — | declared |
| [Better Stack](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/) | monitoring | key | incidents.list, incidents.get, incidents.create, incidents.update, monitors.list | — | declared |
| [Bitbucket](https://developer.atlassian.com/cloud/bitbucket/rest/intro/#authentication) | code | OAuth 2, key | repositories.list, repositories.get, pullRequests.list, pullRequests.get, pullRequests.create | hmac | declared |
| [Breakcold](https://docs.breakcold.com/api/authentication) | crm | key | — | hmac | declared |
| [Buildkite](https://buildkite.com/docs/apis/rest-api#authentication) | code | key | builds.list, builds.get, builds.create, pipelines.list | hmac | declared |
| [Chatwork](https://developer.chatwork.com/docs/endpoints) | chat | OAuth 2, key | rooms.list, messages.list, contacts.list | — | declared |
| [CircleCI](https://circleci.com/docs/api/v3/conventions.md) | code | key | runs.list, runs.get, runs.create, projects.list | hmac | declared |
| [ClickUp](https://developer.clickup.com/docs/authentication) | tasks | OAuth 2, key | tasks.list, tasks.get, tasks.create, tasks.update, lists.list | hmac | declared |
| [Superhuman Docs (formerly Coda)](https://docs.superhuman.com/developers/apis/v1#operation/whoami) | docs | key | pages.list, pages.get, pages.create, pages.update, docs.list | — | declared |
| [Discord](https://docs.discord.com/developers/reference) | chat | key | — | ed25519 | declared |
| [Exa](https://docs.exa.ai/reference/search) | search | key | — | — | declared |
| [Fathom](https://developers.fathom.ai/quickstart) | meetings | key | — | — | declared |
| [Figma](https://developers.figma.com/docs/rest-api/oauth-apps/) | design | OAuth 2 | — | — | declared |
| [Firecrawl](https://docs.firecrawl.dev/api-reference/introduction) | search | key | — | — | declared |
| [Fireflies](https://docs.fireflies.ai/fundamentals/authorization) | meetings | key | user | hmac | declared |
| [GitBook](https://gitbook.com/docs/developers/gitbook-api/authentication) | docs | key | pages.list, pages.get, spaces.list | — | declared |
| [GitHub](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api) | code | key | — | — | declared |
| [GitLab](https://docs.gitlab.com/api/rest/authentication/) | code | key | — | standard | declared |
| [Google](https://developers.google.com/identity/protocols/oauth2/web-server) | mail, calendar | OAuth 2 | — | token | declared |
| [Granola](https://docs.granola.ai/introduction) | meetings | key | — | — | declared |
| [Guru](https://developer.getguru.com/docs/getting-started) | docs | key | cards.search, cards.get, cards.create, cards.update, collections.list | — | declared |
| [Honeybadger](https://docs.honeybadger.io/api/v3/authentication/) | monitoring | key | faults.list, faults.get, faults.update, projects.list | token | declared |
| [HubSpot](https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/migration-guide) | crm | OAuth 2 | — | — | declared |
| [incident.io](https://docs.incident.io/api-reference/introduction) | monitoring | key | incidents.list, incidents.get, incidents.create, incidents.update, severities.list | — | declared |
| [Intercom](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/identifyadmin) | support | key | — | hmac | declared |
| [Jira](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) | tasks | OAuth 2 | — | — | declared |
| [LINE](https://developers.line.biz/en/reference/messaging-api/#get-bot-info) | chat | key | messages.create, followers.list | hmac | declared |
| [Linear](https://linear.app/developers/graphql#authentication) | tasks | OAuth 2, key | issues.list, issues.get, issues.create, issues.update, teams.list | hmac | declared |
| [Lusha](https://docs.lusha.com/authentication) | sales | key | — | — | declared |
| [Mattermost](https://docs.mattermost.com/api/reference/mattermost-api) | chat | key | channels.list, posts.list, posts.create, users.list | — | declared |
| [Metabase](https://www.metabase.com/articles/set-up-metabase-from-code-with-the-api) | analytics | token | — | — | declared |
| [Microsoft](https://learn.microsoft.com/en-us/graph/auth-v2-user) | mail, calendar | OAuth 2 | — | — | declared |
| [monday.com](https://developer.monday.com/api-reference/docs/authentication) | tasks | OAuth 2, key | items.list, items.get, items.create, items.update, boards.list | — | declared |
| [Notion](https://developers.notion.com/reference/authentication) | docs | key | pages.markdown | — | declared |
| [Outline](https://www.getoutline.com/developers#description/api-key) | docs | key | documents.list, documents.get, documents.create, documents.update, collections.list | — | declared |
| [PagerDuty](https://docs.pagerduty.com/developer/authentication) | monitoring | OAuth 2, key | incidents.list, incidents.get, services.list | hmac | declared |
| [PayPal](https://developer.paypal.com/api/rest/authentication/) | finance | token | — | — | declared |
| [Render](https://api-docs.render.com/reference/authentication) | code | key | deploys.list, deploys.get, deploys.create, services.list | standard | declared |
| [Rollbar](https://docs.rollbar.com/reference/getting-started-1) | monitoring | key | items.list, items.get, items.update | — | declared |
| [Sentry](https://docs.sentry.io/api/auth/) | monitoring | key | issues.list, issues.get, issues.update, projects.list | hmac | declared |
| [SerpApi](https://serpapi.com/account-api) | search | key | — | — | declared |
| [Shortcut](https://developer.shortcut.com/api/rest/v3#Authentication) | tasks | key | stories.search, stories.get, stories.create, stories.update, workflows.list | hmac | declared |
| [Slack](https://docs.slack.dev/authentication/installing-with-oauth) | chat | OAuth 2 | — | hmac | declared |
| [Slite](https://developers.slite.com/docs/getting-started) | docs | key | notes.list, notes.get, notes.create, notes.update | — | declared |
| [Smartsheet](https://developers.smartsheet.com/api/smartsheet/guides/basics/authentication.md) | tasks | key | rows.get, rows.create, rows.update, sheets.list | — | declared |
| [Stripe](https://docs.stripe.com/api/authentication) | finance | key | — | hmac | declared |
| [Todoist](https://developer.todoist.com/api/v1/authorization.md) | tasks | OAuth 2, key | tasks.list, tasks.get, tasks.create, tasks.update, projects.list | hmac | declared |
| [Trello](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/) | tasks | key | — | — | declared |
| [Unipile](https://developer.unipile.com/v2.0/docs/api-keys) | mail, calendar | key | — | — | declared |
| [Vercel](https://vercel.com/docs/rest-api#authentication) | code | key | deployments.list, deployments.get, deployments.create, projects.list | hmac | declared |
| [Zoom](https://developers.zoom.us/docs/internal-apps/s2s-oauth/) | meetings | token | — | — | declared |
| [Zulip](https://zulip.com/api/http-headers) | chat | key | channels.list, messages.list, users.list | — | declared |
