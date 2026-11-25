import { expect, test } from 'vitest';
import { defineProvider } from './catalogue.js';

test('defineProvider keeps the literal', () => {
  const acme = defineProvider({ id: 'acme', name: 'Acme', auth: [{ kind: 'key' }], http: { baseUrl: 'https://api.acme.test' } });
  const id: 'acme' = acme.id;
  expect(id).toBe('acme');
  // @ts-expect-error an entry needs a base URL
  defineProvider({ id: 'bad', name: 'Bad', auth: [{ kind: 'key' }], http: {} });
  // @ts-expect-error an entry needs at least one sign-in
  defineProvider({ id: 'bad', name: 'Bad', auth: [], http: { baseUrl: 'https://x.test' } });
});
