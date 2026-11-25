import { expect, test } from 'vitest';
import { paginate, type Page } from './paginate.js';

const pages: Record<string, Page<number>> = {
  start: { items: [1, 2], skipped: [], cursor: 'c1' },
  c1: { items: [3], skipped: ['bad'], cursor: 'c2' },
  c2: { items: [4], skipped: [], cursor: null },
};
const loader = (answers: Record<string, Page<number>>) => {
  const asked: (string | undefined)[] = [];
  return { asked, load: (cursor: string | undefined) => {
    asked.push(cursor);
    const page = answers[cursor ?? 'start'];
    return page ? Promise.resolve(page) : Promise.reject(new Error(`no page ${String(cursor)}`));
  } };
};

test('yields each page until a null cursor', async () => {
  const { asked, load } = loader(pages);
  const read: Page<number>[] = [];
  for await (const page of paginate(load)) read.push(page);
  expect(read).toEqual([pages.start, pages.c1, pages.c2]);
  expect(asked).toEqual([undefined, 'c1', 'c2']);
});

test('stops when the caller breaks', async () => {
  const { asked, load } = loader(pages);
  for await (const page of paginate(load)) if (page.items.length) break;
  expect(asked).toEqual([undefined]);
});

test('refuses a cursor it has seen, so a provider repeating itself never loops', async () => {
  const { asked, load } = loader({ ...pages, c2: { items: [4], skipped: [], cursor: 'c1' } });
  const read: Page<number>[] = [];
  const pending = (async () => { for await (const page of paginate(load)) read.push(page); })();
  await expect(pending).rejects.toMatchObject({ code: 'invalid_response', detail: 'cursor_repeated' });
  expect(asked).toEqual([undefined, 'c1', 'c2']);
  expect(read).toHaveLength(3);
});
