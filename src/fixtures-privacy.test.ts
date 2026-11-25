import { globSync, readFileSync } from 'node:fs'; // fs.globSync exists from Node 22
import { expect, test } from 'vitest';

const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const ALLOWED_EMAILS = ['octocat@github.com', 'holiday@group.v.calendar.google.com'];
const GOOGLE_EVENT_UID = /^[a-z0-9]{20,}@google\.com$/;
/** Country 1, an area code, then 555-0100 to 555-0199: the North American numbers reserved for fiction. */
const FICTIONAL_PHONE = /^1[2-9]\d{2}55501\d{2}$/;

function isSyntheticEmail(email: string): boolean {
  const [local = '', rawDomain = ''] = email.split('@');
  const domain = rawDomain.toLowerCase();
  const address = `${local}@${domain}`;
  return RESERVED_TLDS.some(tld => domain.endsWith(`.${tld}`))
    || RESERVED_DOMAINS.some(reserved => domain === reserved || domain.endsWith(`.${reserved}`))
    || GOOGLE_EVENT_UID.test(address) || ALLOWED_EMAILS.includes(address);
}

/** `text` with JSON string escapes (`\n`, `\u0040`) and URL percent escapes (`%40`, `%2B`) decoded, so neither hides a
 * value or bleeds into one. */
function decoded(text: string): string {
  return text.replace(/\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g, escape => JSON.parse(`"${escape}"`) as string)
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** The emails and phone numbers in `rawText` that could belong to a real person, in order of appearance. */
function findPrivateValues(rawText: string): string[] {
  const text = decoded(rawText);
  const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)]
    .filter(match => !isSyntheticEmail(match[0]));
  // A + right after a letter or digit is a URL-encoded space (`receivedDateTime+ge+1970-01-01`), never a phone's.
  const phones = [...text.matchAll(/(?<![A-Za-z0-9])\+[0-9][0-9 ().-]{6,}[0-9]/g)]
    .filter(match => !FICTIONAL_PHONE.test(match[0].replace(/\D/g, '')));
  return [...emails, ...phones].sort((a, b) => a.index - b.index).map(match => match[0]);
}

test.each([
  ['ana@lumen.test', []],
  ['m1@sub.example.com', []],
  ['5m8lnvb64dt2uuaq99k4681@google.com', []],
  ['octocat@github.com', []],
  ['From: Ana <ana.lopez@lumen.io>', ['ana.lopez@lumen.io']],
  ['?email=jane.doe%40acme.com', ['jane.doe@acme.com']],
  ['{"b":"Hi\\n+1 415 867 5309"}', ['+1 415 867 5309']], // a phone after a JSON escape
  ['{"b":"Hi\\noctocat@github.com"}', []], // the escape's n is not part of the address
  ['mailto:jane.doe@acme.com?x=1', ['jane.doe@acme.com']],
  ['+1 (415) 555-0121', []],
  ['+14155550199', []],
  ['+1 800-123-4567', ['+1 800-123-4567']],
  ['+4930123456', ['+4930123456']],
  ['1793523600000', []], // an epoch, not a phone: no leading +
  ['receivedDateTime+ge+1970-01-01T00%3A00', []], // a date after a URL-encoded space, not a phone
])('findPrivateValues(%j)', (text, found) => {
  expect(findPrivateValues(text)).toEqual(found);
});

test('every fixture holds only synthetic emails and phone numbers', () => {
  const files = globSync('src/**/fixtures/*.json');
  expect(files.length).toBeGreaterThan(10);
  const leaks = files.flatMap(file => findPrivateValues(readFileSync(file, 'utf8')).map(value => `${file}: ${value}`));
  expect(leaks).toEqual([]);
});
