import { defineProvider } from '../catalogue.js';

/** Mailchimp on the root its pages state (https://mailchimp.com/developer/marketing/docs/fundamentals/); a token never
 * expires. Over the limits "can result in your API access being disabled", so no retry: the members and campaigns
 * lists, whose record lists are optional, answer one page.
 * https://mailchimp.com/developer/marketing/api-concepts/rate-limits-and-timeouts/ */
const list = { id: 'string', 'name?': 'string', 'date_created?': 'string', 'double_optin?': 'boolean', 'has_welcome?': 'boolean',
  'subscribe_url_short?': 'string' } as const;
const member = { id: 'string', 'email_address?': 'string', 'status?': 'string', 'list_id?': 'string', 'contact_id?': 'string',
  'timestamp_signup?': 'string', 'last_changed?': 'string', 'merge_fields?': 'unknown' } as const;
const campaign = { id: 'string', 'type?': 'string', 'status?': 'string', 'create_time?': 'string', 'send_time?': 'string',
  'archive_url?': 'string', 'settings?': { 'subject_line?': 'string', 'title?': 'string' }, 'recipients?': { 'list_id?': 'string' } } as const;
const listId = { list_id: { in: 'path', type: 'string', required: true } } as const;
const subscriberHash = { subscriber_hash: { in: 'path', type: 'string', required: true,
  description: 'The MD5 hash of the lowercase email address; the page also accepts the email address itself or the contact_id.' } } as const;
const count = { count: { in: 'query', type: 'integer', description: '10 by default, at most 1000.' } } as const;
const page = { ...count, offset: { in: 'query', type: 'integer', description: 'The number of records to skip, 0 by default.' } } as const;
const written = { merge_fields: { in: 'body', type: 'unknown', description: 'Merge field values keyed by their merge tags.' },
  language: { in: 'body', type: 'string' }, vip: { in: 'body', type: 'boolean' } } as const;
const ref = 'https://mailchimp.com/developer/marketing/api';

export const mailchimp = defineProvider({
  id: 'mailchimp', name: 'Mailchimp', docs: 'https://mailchimp.com/developer/marketing/api-concepts/authentication/',
  categories: ['marketing'],
  fields: [{ name: 'apiKey', title: 'API key', secret: true,
    help: 'For your own Mailchimp account: Mailchimp strongly discourages asking people to paste their API key, and an app for someone else\'s account connects with the OAuth 2 sign-in. A key has full access to the account that created it. Make it as an admin user: the user\'s role and the account\'s plan bound what it can do.' }],
  // A developer registers an app alone, on the Registered Apps page:
  // https://mailchimp.com/developer/marketing/build/start-developing/set-up-an-oauth-app/
  auth: [{ kind: 'oauth2', authorizeUrl: 'https://login.mailchimp.com/oauth2/authorize', tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    authorizeParams: { response_type: 'code' } }, { kind: 'key' }],
  scopes: { default: [] },
  http: { baseUrl: 'https://api.mailchimp.com/3.0' },
  identify: { request: { path: '/' }, id: 'account_id', name: ['account_name', 'email'] },
  // `signing_secret` keys a hex HMAC-SHA256 of `{timestamp}.{raw_body}` (`t=…,v1=…`); no delivery id is named:
  // https://mailchimp.com/developer/marketing/api-concepts/webhooks/
  webhook: { kind: 'hmac', header: 'x-mailchimp-signature', part: 'v1', timestamp: { part: 't' }, signed: '{timestamp}.{body}' },
  paging: { lists: { kind: 'offset', send: { query: 'offset' }, list: 'lists' } },
  operations: {
    'lists.list': { docs: `${ref}/lists/list`, path: '/lists', paging: 'lists', records: 'lists', params: count,
      result: { lists: [list] } },
    'members.list': { docs: `${ref}/lists/members/list-members`, path: '/lists/{list_id}/members',
      params: { ...listId, ...page, status: { in: 'query', type: 'string',
        enum: ['subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional', 'archived'] } },
      result: { 'members?': [member], 'total_items?': 'integer' } },
    'members.get': { docs: `${ref}/lists/members/get-member`, path: '/lists/{list_id}/members/{subscriber_hash}', notFound: 'null',
      params: { ...listId, ...subscriberHash }, result: member },
    // Adds a member: on a double opt-in audience `pending` sends Mailchimp's confirmation email, which no parameter
    // stops; an audience with a welcome automation connected (`has_welcome`) emails the person who joins:
    // https://mailchimp.com/developer/marketing/build/quickstarts/import-and-export-contacts/
    'members.create': { docs: `${ref}/lists/members/create-member`, method: 'POST', path: '/lists/{list_id}/members', kind: 'write',
      params: { ...listId, email_address: { in: 'body', type: 'string', required: true },
        status: { in: 'body', type: 'string', required: true, enum: ['subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional'],
          description: 'On a double opt-in audience, pending sends the confirmation email; subscribed skips it.' },
        tags: { in: 'body', type: ['string'] }, ...written }, result: member },
    'members.update': { docs: `${ref}/lists/members/update-member`, method: 'PATCH', path: '/lists/{list_id}/members/{subscriber_hash}',
      params: { ...listId, ...subscriberHash, email_address: { in: 'body', type: 'string' },
        status: { in: 'body', type: 'string', enum: ['subscribed', 'unsubscribed', 'cleaned', 'transactional'],
          description: 'pending, which can send the confirmation email, is not offered; no page says whether subscribed re-subscribes a person who unsubscribed.' }, ...written }, result: member },
    'campaigns.list': { docs: `${ref}/campaigns/list`, path: '/campaigns',
      params: { ...page, list_id: { in: 'query', type: 'string' },
        status: { in: 'query', type: 'string', enum: ['save', 'paused', 'schedule', 'sending', 'sent'] } },
      result: { 'campaigns?': [campaign], 'total_items?': 'integer' } },
    'campaigns.get': { docs: `${ref}/campaigns/get`, path: '/campaigns/{campaign_id}', notFound: 'null',
      params: { campaign_id: { in: 'path', type: 'string', required: true } }, result: campaign },
    // Creates a campaign and sends nothing: sending is the separate send or schedule action, not declared.
    'campaigns.create': { docs: `${ref}/campaigns/create`, method: 'POST', path: '/campaigns',
      params: { type: { in: 'body', type: 'string', required: true, enum: ['regular', 'plaintext'],
        description: 'An RSS campaign, which sends on its feed\'s schedule, is not offered.' },
      recipients: { in: 'body', type: { list_id: 'string' } },
      settings: { in: 'body', type: { 'subject_line?': 'string', 'title?': 'string', 'from_name?': 'string', 'reply_to?': 'string',
        'preview_text?': 'string' } } }, result: campaign },
  },
});
