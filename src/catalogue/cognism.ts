import { defineProvider } from '../catalogue.js';

/** Cognism: searches and enrichments spend no credits but count against the preview limit (credits × 10); only a
 * redeem spends credits (https://help.cognism.com/hc/en-gb/articles/37383428888978-API-Authentication-Credits). A 429
 * past 1,000 requests a minute; Cognism's support sets which fields each key's entitlement returns. A search pages by
 * `lastReturnedKey`, read by hand: no page says how the last page ends. */
const contact = { id: 'string', 'fullName?': 'string', 'firstName?': 'string', 'lastName?': 'string', 'jobTitle?': 'string',
  'redeemId?': 'string', 'account?': { 'id?': 'string', 'name?': 'string' } } as const;
const account = { id: 'string', 'name?': 'string' } as const;
const page = { indexSize: { in: 'query', type: 'integer', description: 'Records per call, 20 to 100.' },
  lastReturnedKey: { in: 'query', type: 'string', description: 'The previous answer\'s `lastReturnedKey`, for the next page.' } } as const;
const found = { 'lastReturnedKey?': 'string', 'totalResults?': 'integer' } as const;
const docs = 'https://developers.cognism.com/';

export const cognism = defineProvider({
  id: 'cognism', name: 'Cognism', docs: `${docs}#authentication`,
  categories: ['sales'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'Assigned by Cognism, or made in Cognism Prospector or Refresh; it lives six months, and the API cannot be used until Cognism Support has set up its entitlements. Searches and enrichments count against the account\'s preview limit, which its credits set.' }],
  auth: [{ kind: 'key' }],
  http: { baseUrl: 'https://app.cognism.com/api/search',
    retry: { defaultWaitMs: 60_000, wait: { header: 'x-rate-limit-reset', unit: 's' } } },
  errors: { detail: 'errors.0.code' },
  identify: { request: { path: '/entitlement/contactEntitlementSubscription' } },
  operations: {
    'contacts.search': { docs: `${docs}#6c453b29-38c4-4037-8c09-7ba084bb3b7f`, method: 'POST', path: '/contact/search',
      params: { ...page, fullName: { in: 'body', type: 'string' }, firstName: { in: 'body', type: 'string' },
        lastName: { in: 'body', type: 'string' }, jobTitles: { in: 'body', type: ['string'] },
        linkedinUrl: { in: 'body', type: 'string' } },
      result: { ...found, results: [contact] } },
    'contacts.get': { docs: `${docs}#157c4853-80fc-4f50-a538-8d92bda2cc57`, method: 'POST', path: '/contact/enrich',
      params: { email: { in: 'body', type: 'string', description: 'The contact\'s email.' },
        sha256: { in: 'body', type: 'string', description: 'The email\'s hash, in hexadecimal.' },
        linkedinUrl: { in: 'body', type: 'string', description: 'The contact\'s LinkedIn URL.' } },
      result: { 'matchScore?': 'number', 'results?': [contact] } },
    'accounts.search': { docs: `${docs}#daadfd7c-19ce-4bb2-84f0-ba731397e1da`, method: 'POST', path: '/account/search',
      params: { ...page, names: { in: 'body', type: ['string'] }, domains: { in: 'body', type: ['string'] } },
      result: { ...found, results: [account] } },
    'accounts.get': { docs: `${docs}#fd0486ff-1d47-4e8f-84d7-cb15a8c8a9b4`, method: 'POST', path: '/account/enrich',
      params: { website: { in: 'body', type: 'string', description: 'The account\'s website.' },
        domain: { in: 'body', type: 'string', description: 'The account\'s domain.' },
        linkedinUrl: { in: 'body', type: 'string', description: 'The account\'s LinkedIn URL.' } },
      result: { 'matchScore?': 'number', 'results?': [account] } },
  },
});
