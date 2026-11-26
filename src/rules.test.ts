import { expect, test } from 'vitest';
import { fill, holds, placeholders, readPath } from './rules.js';

test('readPath tries the whole rest as one key first, then descends', () => {
  expect(readPath({ '@odata.nextLink': 'x' }, '@odata.nextLink')).toBe('x');
  expect(readPath({ errors: [{ code: 'a' }] }, 'errors.0.code')).toBe('a');
  expect(readPath({ error: 'usage_limit' }, 'error.code')).toBeUndefined();
  expect(readPath({}, '__proto__')).toBeUndefined();
  expect(readPath(null, 'a')).toBeUndefined();
  expect(readPath({ a: {} }, 'a.constructor')).toBeUndefined();
  expect(readPath(JSON.parse('{"__proto__":"own"}'), '__proto__')).toBe('own');
});

test('placeholders lists the names fill replaces, in order', () => {
  expect(placeholders('{apiId}:{apiToken}')).toEqual(['apiId', 'apiToken']);
  expect(placeholders('Portal {tokenAnswer.hub_id} {}{a{b}')).toEqual(['tokenAnswer.hub_id', 'b']);
  expect(placeholders('none')).toEqual([]);
});

test('fill takes strings and numbers and names a missing key', () => {
  expect(fill('Portal {id}', name => (name === 'id' ? 42 : undefined), 'hubspot')).toBe('Portal 42');
  expect(() => fill('{apiId}:{apiToken}', () => undefined, 'aircall')).toThrow('template_missing: aircall {apiId}');
  expect(() => fill('{x}', () => ({}), 'e')).toThrow('template_missing: e {x}');
  expect(() => fill('{x}', () => true, 'e')).toThrow('template_missing: e {x}');
  expect(() => fill('{x}', () => Number.NaN, 'e')).toThrow('template_missing: e {x}');
  expect(fill('{a}|{b}', name => (name === 'a' ? '$&' : '{a}'), 'e')).toBe('$&|{a}');
});

const answer = (status: number, body: unknown, headers: Record<string, string> = {}, code?: string) =>
  ({ status, headers: new Headers(headers), body, code });

test('holds reads every stated part', () => {
  expect(holds({ status: 403, header: 'x-ratelimit-remaining', equals: '0' }, answer(403, {}, { 'x-ratelimit-remaining': '0' }))).toBe(true);
  expect(holds({ status: 403, header: 'retry-after' }, answer(403, {}))).toBe(false);
  expect(holds({ status: 403, path: 'message', contains: 'rate limit' }, answer(403, { message: 'API Rate Limit exceeded' }))).toBe(true);
  expect(holds({ path: 'message', contains: 'x' }, answer(403, { message: 7 }))).toBe(false);
  expect(holds({ status: 'error' }, answer(503, {}))).toBe(true);
  expect(holds({ status: 'error' }, answer(204, {}))).toBe(false);
  expect(holds({ path: 'errors.0' }, answer(200, { errors: [null] }))).toBe(true);
  expect(holds({ path: 'errors.0' }, answer(200, { errors: [] }))).toBe(false);
  expect(holds({ path: 'ok', equals: false }, answer(200, { ok: false }))).toBe(true);
  expect(holds({ detail: true }, answer(500, {}, {}, 'auth_failed'))).toBe(true);
  expect(holds({ detail: 'auth_failed' }, answer(500, {}))).toBe(false);
  expect(holds({ detail: 'auth_failed' }, answer(500, {}, {}, 'auth_failed'))).toBe(true);
  expect(holds({ detail: true }, answer(500, {}))).toBe(false);
  expect(holds({ status: 403 }, answer(401, {}))).toBe(false);
  expect(holds({ path: 'error.errors.0.reason', in: ['quotaExceeded'] }, answer(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }))).toBe(true);
  expect(holds({ path: 'message', startsWith: 'V3 API access' }, answer(403, { message: 'V3 API access is not enabled' }))).toBe(true);
});
