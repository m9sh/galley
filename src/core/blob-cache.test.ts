import { expect, it } from 'vitest';
import { BlobCache } from './blob-cache.ts';

it('gives back the text of a document with the same content hash, wherever it was read', () => {
  const cache = new BlobCache();
  expect(cache.text('a1')).toBeUndefined();
  cache.put('a1', '# One');
  cache.put('a1', 'ignored: a hash names one text');
  expect(cache.text('a1')).toBe('# One');
  expect(cache.size).toBe(1);
  cache.put('empty', '');
  expect(cache.text('empty')).toBe('');
});

it('lets go of the document read longest ago once it holds more than its limit, and never keeps one larger than the limit', () => {
  const cache = new BlobCache(10);
  cache.put('a', '1234');
  cache.put('b', '1234');
  // Reading `a` again makes `b` the oldest.
  cache.text('a');
  cache.put('c', '1234');
  expect([cache.text('a'), cache.text('b'), cache.text('c')]).toStrictEqual(['1234', undefined, '1234']);
  cache.put('huge', '12345678901');
  expect(cache.text('huge')).toBeUndefined();
  expect(cache.size).toBe(2);
});

it('reuses what the map learned from a document while its hash, path and text are the same, and reads it again otherwise', () => {
  const cache = new BlobCache();
  const text = '# Title\n\nSee [guide](guide.md).';
  cache.put('a1', text);
  const first = cache.indexed('a1', 'docs/a.md', text);
  expect(first).toMatchObject({ path: 'docs/a.md', title: 'Title', links: [{ path: 'docs/guide.md' }] });
  expect(cache.indexed('a1', 'docs/a.md', text)).toBe(first);
  // Links are resolved from the path, so the same text somewhere else is read again.
  const moved = cache.indexed('a1', 'b.md', text);
  expect(moved).not.toBe(first);
  expect(moved.links[0].path).toBe('guide.md');
  expect(cache.indexed('a1', 'b.md', text)).toBe(moved);
  // A hash that was never kept, no hash, or other text under the hash are read without being kept.
  expect(cache.indexed('unknown', 'a.md', text)).toMatchObject({ title: 'Title' });
  expect(cache.indexed(undefined, 'a.md', text)).toMatchObject({ title: 'Title' });
  const other = cache.indexed('a1', 'b.md', '# Other');
  expect(other.title).toBe('Other');
  expect(cache.indexed('a1', 'b.md', text)).toBe(moved);
});

it('forgets everything when cleared', () => {
  const cache = new BlobCache(10);
  cache.put('a', '12345678');
  cache.clear();
  expect(cache.size).toBe(0);
  cache.put('b', '12345678');
  expect(cache.text('b')).toBe('12345678');
});
