import { ProviderHttpError } from './errors.js';

/** One page of a list: what the client read, the ids of entries it could not read (null when one had none), and the
 * cursor of the next page, null on the last. */
export type Page<T> = { items: T[]; skipped: (string | null)[]; cursor: string | null };

/** Every page, in order, until the last; the caller stops whenever its own budget says so. */
export async function* paginate<T>(load: (cursor: string | undefined) => Promise<Page<T>>): AsyncGenerator<Page<T>> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await load(cursor);
    yield page;
    if (page.cursor === null) return;
    if (seen.has(page.cursor)) throw new ProviderHttpError('invalid_response', null, 'cursor_repeated');
    seen.add(page.cursor);
    cursor = page.cursor;
  }
}
