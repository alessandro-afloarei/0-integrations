import { z } from 'zod';

// `@internal` (stripped by the build) keeps zod out of every published declaration file.
/** @internal */
export const datetime = z.iso.datetime({ offset: true });
/** @internal A value a provider may leave out or null: read as null. */
export const orNull = <T extends z.ZodType>(schema: T) => schema.nullish().transform(value => value ?? null);
/** @internal */
export const text = orNull(z.string());

/** An ISO time in UTC; one without its offset would be read in the provider's own zone, so it is refused before a request. */
export function utc(value: string): string {
  if (!datetime.safeParse(value).success) throw new TypeError('date_invalid');
  return new Date(value).toISOString();
}

export function pageSize(limit = 100, max: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new TypeError('limit_invalid');
  return limit;
}
