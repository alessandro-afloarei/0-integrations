import { defineProvider } from '../catalogue.js';

/** Constant Contact V3, OAuth 2 alone. A new app is private: only the Constant Contact user who created it can grant
 * it access, other accounts once Constant Contact approves it. No retry: a 429 is the second's or the day's quota.
 * https://v3.developer.constantcontact.com/api_guide/oauth2-authorization/auth-overview
 * https://v3.developer.constantcontact.com/api_guide/getting-started/rate-limits */
const contact = { contact_id: 'string', 'email_address?': { address: 'string', 'permission_to_send?': 'string', 'confirm_status?': 'string' },
  'first_name?': 'string', 'last_name?': 'string', 'company_name?': 'string', 'created_at?': 'string', 'updated_at?': 'string' } as const;
const campaign = { campaign_id: 'string', 'name?': 'string', 'current_status?': 'string', 'type?': 'string',
  'created_at?': 'string', 'updated_at?': 'string' } as const;
const limit = { in: 'query', type: 'integer', description: 'Results a page, 1 to 500; 50 by default.' } as const;
const guide = 'https://v3.developer.constantcontact.com/api_guide';

export const constantcontact = defineProvider({
  id: 'constantcontact', name: 'Constant Contact', docs: `${guide}/oauth2-authorization/server-flow`,
  categories: ['marketing'],
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://authz.constantcontact.com/oauth2/default/v1/authorize',
    tokenUrl: 'https://authz.constantcontact.com/oauth2/default/v1/token', clientAuth: 'basic', authorizeParams: { response_type: 'code' } }],
  // `offline_access` returns the refresh token; each route's scope:
  // https://v3.developer.constantcontact.com/api_guide/user-authorization-and-api-access/scopes
  scopes: { default: ['account_read', 'contact_data', 'campaign_data', 'offline_access'] },
  // Base, paging and the error body:
  // https://v3.developer.constantcontact.com/api_guide/getting-started/v3-technical-overview
  http: { baseUrl: 'https://api.cc.email/v3' },
  // https://v3.developer.constantcontact.com/api_guide/account-services/account-get-details
  identify: { request: { path: '/account/summary' }, id: 'encoded_account_id', name: ['organization_name', 'contact_email'] },
  errors: { detail: ['0.error_key', 'error_key'] },
  paging: { next: { kind: 'nextUrl', next: '_links.next.href' } },
  operations: {
    'contactLists.list': { docs: `${guide}/contact-lists/lists-get-all`, path: '/contact_lists', paging: 'next', records: 'lists',
      result: { lists: [{ list_id: 'string', name: 'string', 'description?': 'string', 'favorite?': 'boolean',
        'created_at?': 'string', 'updated_at?': 'string' }] } },
    'contacts.list': { docs: `${guide}/contacts/contacts-get-collection`, path: '/contacts', paging: 'next', records: 'contacts',
      params: { email: { in: 'query', type: 'string', description: 'An exact email address.' },
        lists: { in: 'query', type: 'string', description: 'Comma-separated list_id values, up to 25: members of any of them.' },
        status: { in: 'query', type: 'string',
          description: 'Comma-separated: all, active, deleted, not_set, pending_confirmation, temp_hold, unsubscribed. Contacts not deleted by default.' },
        limit }, result: { contacts: [contact] } },
    'contacts.get': { docs: `${guide}/contacts/contacts-get-one`, path: '/contacts/{contact_id}', notFound: 'null',
      params: { contact_id: { in: 'path', type: 'string', required: true } }, result: contact },
    // A contact added with `create_source: 'Contact'` may be sent a list's welcome email, or a confirm opt-in email
    // when the account has Confirmed Opt-in on; one added with `'Account'` is sent neither:
    // https://v3.developer.constantcontact.com/api_guide/contacts/contacts-autoresponder
    'contacts.create': { docs: `${guide}/contacts/contacts-post-one`, method: 'POST', path: '/contacts', kind: 'write',
      params: { create_source: { in: 'body', type: 'string', enum: ['Contact', 'Account'], required: true,
        description: 'Who added the contact, which the page asks an integration to state accurately. Account sends no welcome or confirm opt-in email; Contact may send either.' },
      email_address: { in: 'body', type: { address: 'string', 'permission_to_send?': 'string' },
        description: 'permission_to_send: explicit, implicit, not_set, pending_confirmation, temp_hold or unsubscribed.' },
      first_name: { in: 'body', type: 'string' }, last_name: { in: 'body', type: 'string' }, company_name: { in: 'body', type: 'string' },
      list_memberships: { in: 'body', type: ['string'], description: 'list_id values to subscribe the contact to, up to 50.' } },
      anyOf: [['email_address'], ['first_name'], ['last_name']], result: contact },
    'emailCampaigns.list': { docs: `${guide}/email-campaigns/email-campaigns-collection`, path: '/emails', paging: 'next',
      records: 'campaigns', params: { limit }, result: { campaigns: [campaign] } },
    'emailCampaigns.get': { docs: `${guide}/email-campaigns/email-campaign-id`, path: '/emails/{campaign_id}', notFound: 'null',
      params: { campaign_id: { in: 'path', type: 'string', required: true } }, result: campaign },
  },
});
