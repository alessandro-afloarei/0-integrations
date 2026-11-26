import { expect, test } from 'vitest';
import { orNull, pageSize, text, utc } from './shapes.js';
import { z } from 'zod';

test('utc refuses a time without its offset and writes the rest in UTC', () => {
  expect(utc('2026-11-01T10:00:00+01:00')).toBe('2026-11-01T09:00:00.000Z');
  expect(() => utc('2026-11-01T10:00:00')).toThrow('date_invalid');
});

test('pageSize keeps 1 to max, 100 by default', () => {
  expect(pageSize(undefined, 500)).toBe(100);
  expect(pageSize(500, 500)).toBe(500);
  for (const bad of [0, 501, 1.5]) expect(() => pageSize(bad, 500)).toThrow('limit_invalid');
});

test('orNull reads a missing or null value as null', () => {
  expect(text.parse(undefined)).toBeNull();
  expect(orNull(z.number()).parse(null)).toBeNull();
});
