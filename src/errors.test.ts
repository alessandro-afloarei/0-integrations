import { expect, test } from 'vitest';
import { GrantRevoked, ProviderHttpError, RefreshBusy, SecretUnavailable } from './errors.js';

test('a provider error says its code and nothing else', () => {
  const error = new ProviderHttpError('rate_limited', 429);
  expect([error.message, error.name, error.status, error.detail])
    .toEqual(['rate_limited', 'ProviderHttpError', 429, null]);
});

test('each error names itself', () => {
  expect([new GrantRevoked(), new SecretUnavailable(), new RefreshBusy()].map(e => [e.name, e.message]))
    .toEqual([['GrantRevoked', 'grant_revoked'], ['SecretUnavailable', 'secret_unavailable'], ['RefreshBusy', 'refresh_busy']]);
});
