import { defineProvider } from '../catalogue.js';

/** Clay: create a search with `POST /search/query-mode` and a Clay search query, then read it a page at a time with
 * the run below while `has_more` is true; results count against the plan's limits, 402 past them
 * (https://developers.clay.com/searches). 429 with `Retry-After` (https://developers.clay.com/public-api/rate-limits).
 * Webhooks: `sha256=` and the hex HMAC-SHA256 of the raw body (https://developers.clay.com/public-api/webhooks). */
const run = 'https://developers.clay.com/api-reference/search/run-the-query-mode-iterator-and-return-the-next-page-of-results';
const limit = { in: 'body', type: 'integer', description: 'Results to return, 1 to 500 (20 by default).' } as const;
const searchId = 'The `search_id` that POST /search/query-mode answers for a query that';
const more = { has_more: 'boolean', source_type: 'string', 'exhaustion_reason?': 'string' } as const;
const person = { clay_profile_id: 'number', 'name?': 'string', 'first_name?': 'string', 'last_name?': 'string',
  'linkedin_url?': 'string', 'location?': { 'name?': 'string', 'city?': 'string' } } as const;
const company = { clay_company_id: 'number', 'name?': 'string', 'domain?': 'string', 'industry?': 'string', 'size?': 'string',
  'country?': 'string', 'linkedin_url?': 'string', 'description?': 'string' } as const;

export const clay = defineProvider({
  id: 'clay', name: 'Clay', docs: 'https://developers.clay.com/public-api/authentication',
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Create it in Clay under API and CLI, then API keys. It acts as you in your workspace; searches count against the workspace\'s search limits.' }],
  auth: [{ kind: 'key', send: { header: 'clay-api-key' } }],
  http: { baseUrl: 'https://api.clay.com/public/v0', retry: {} },
  identify: { request: { path: '/me' }, id: 'user.id', name: ['user.name', 'user.email'] },
  webhook: { kind: 'hmac', header: 'x-clay-signature', prefix: 'sha256=' },
  operations: {
    'people.search': { docs: run, method: 'POST', path: '/search/query-mode/{search_id}/run',
      params: { search_id: { in: 'path', type: 'string', required: true, description: `${searchId} selects from people.` }, limit },
      result: { data: [person], ...more } },
    'companies.search': { docs: run, method: 'POST', path: '/search/query-mode/{search_id}/run',
      params: { search_id: { in: 'path', type: 'string', required: true, description: `${searchId} selects from companies.` }, limit },
      result: { data: [company], ...more } },
  },
});
