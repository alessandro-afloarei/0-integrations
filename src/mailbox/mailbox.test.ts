import { expect, test } from 'vitest';
import { decodeWords, headerValue, keptHeaders, parseAddressList } from './mailbox.js';

test('reads an address header: quoted names with commas, bare addresses, groups, and a part with no address dropped', () => {
  expect(parseAddressList('"Costa, Rui" <rui@northstar.test>, ana@lumen.test, Team: lee@lumen.test, "Q \\"Bo\\"" <bo@x.test>; nobody'))
    .toEqual([{ display_name: 'Costa, Rui', identifier: 'rui@northstar.test' }, { display_name: '', identifier: 'ana@lumen.test' },
      { display_name: '', identifier: 'lee@lumen.test' }, { display_name: 'Q "Bo"', identifier: 'bo@x.test' }]);
  expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
  // RFC 5322 comments are no part of an address, nested or escaped, in a bare address or after an angled one.
  expect(parseAddressList('alice@example.com (Alice Smith), Bob <bob@example.com> (sender (via list) \\) end)'))
    .toEqual([{ display_name: '', identifier: 'alice@example.com' }, { display_name: 'Bob', identifier: 'bob@example.com' }]);
  expect(parseAddressList('"Ana (Sales)" <ana@lumen.test>')).toEqual([{ display_name: 'Ana (Sales)', identifier: 'ana@lumen.test' }]);
  expect(parseAddressList('')).toEqual([]);
});

test('decodes encoded words in UTF-8 and Latin-1, and leaves a charset it cannot read as written', () => {
  expect(decodeWords('=?UTF-8?B?Sm/Do28=?= =?UTF-8?Q?_Silva?=')).toBe('João Silva');
  expect(decodeWords('=?ISO-8859-1?Q?Caf=E9?= menu')).toBe('Café menu');
  expect(decodeWords('=?X-UNKNOWN?Q?abc?=')).toBe('=?X-UNKNOWN?Q?abc?=');
  expect(decodeWords('plain text')).toBe('plain text');
});

test('keeps only the headers an app filters on, lowercased, the unsubscribe link blanked', () => {
  const headers = [{ name: 'List-Unsubscribe', value: '<https://x.test/u/lee>' }, { name: 'Received', value: 'from a' },
    { name: 'Precedence', value: 'bulk' }, { name: 'Auto-Submitted', value: 'auto-generated' }];
  expect(keptHeaders(headers)).toEqual([{ name: 'list-unsubscribe', value: '' }, { name: 'precedence', value: 'bulk' },
    { name: 'auto-submitted', value: 'auto-generated' }]);
  expect(headerValue(headers, 'received')).toBe('from a');
  expect(headerValue(headers, 'list-id')).toBeNull();
});
