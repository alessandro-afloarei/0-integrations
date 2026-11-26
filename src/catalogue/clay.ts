import { defineProvider } from '../catalogue.js';

/** Clay: no request searches on its own: a search is created, then run page by page while `has_more`, with `request`
 * (https://developers.clay.com/searches/advanced); 429 with `Retry-After`. Webhooks fire only "when a routine run
 * finishes": `sha256=` and the hex HMAC-SHA256 of the raw body (https://developers.clay.com/public-api/webhooks).
 * Rate limits: https://developers.clay.com/public-api/rate-limits */
export const clay = defineProvider({
  id: 'clay', name: 'Clay', docs: 'https://developers.clay.com/public-api/authentication',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Create it in Clay under API and CLI, then API keys. It acts as you in your workspace; searches count against the workspace\'s search limits.' }],
  auth: [{ kind: 'key', send: { header: 'clay-api-key' } }],
  http: { baseUrl: 'https://api.clay.com/public/v0', retry: {} },
  identify: { request: { path: '/me' }, id: 'user.id', name: ['user.name', 'user.email'] },
  webhook: { kind: 'hmac', header: 'x-clay-signature', prefix: 'sha256=' },
});
