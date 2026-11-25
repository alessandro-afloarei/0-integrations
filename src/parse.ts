import { ProviderHttpError } from './errors.js';

/** What a zod schema offers, typed here so no declaration file names zod: it stays private to the library. */
type Schema<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

/** A provider's answer in the shape its client reads; any other shape broke the provider's contract. */
export function parseAnswer<T>(schema: Schema<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ProviderHttpError('invalid_response', null);
  return parsed.data;
}

/**
 * A list's entries one by one: those in shape, and the ids (null when one had none) of those that are not. `idOf` reads an
 * entry's id where the provider does not name it `id` (Fathom's `recording_id`); a numeric id is reported as a string.
 */
export function parseEntries<T>(schema: Schema<T>, entries: readonly unknown[],
  idOf: (entry: object) => unknown = entry => ('id' in entry ? entry.id : null)): { items: T[]; skipped: (string | null)[] } {
  const items: T[] = [];
  const skipped: (string | null)[] = [];
  for (const entry of entries) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) { items.push(parsed.data); continue; }
    const id = typeof entry === 'object' && entry !== null ? idOf(entry) : null;
    skipped.push(typeof id === 'string' || typeof id === 'number' ? String(id) : null);
  }
  return { items, skipped };
}
