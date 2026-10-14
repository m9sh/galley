import { expect, it, vi } from 'vitest';
import { ChapterContext } from '../../core/review-context.ts';
import { chapterContext } from './chapter-context.ts';

const words = (el: Element) =>
  [...el.querySelectorAll('.mr-sheet-section-title, .mr-sheet-count, .mr-sheet-row-title, .mr-sheet-row-meta, .mr-sheet-note, button.mr-sheet-link')].map(
    (part) => part.textContent,
  );

it('says nothing has been read yet and offers the way to read, and reads nothing itself', () => {
  const open = vi.fn();
  const status = document.createElement('div');
  status.className = 'mr-docs-status';
  const [docs, ...rest] = chapterContext({
    chapter: { id: 'code', paths: ['src/a.ts'] },
    canContinue: true,
    context: new ChapterContext(),
    status,
    open,
    remove: vi.fn(),
  });
  expect(rest).toStrictEqual([]);
  expect(open).not.toHaveBeenCalled();
  expect(docs.getAttribute('aria-label')).toBe('Docs that link here');
  expect(words(docs)).toStrictEqual(['Docs that link here']);
  expect(docs.contains(status)).toBe(true);
  // Read, and nothing links here: it says so, without claiming more than was read; everything read, no status.
  const empty = new ChapterContext();
  empty.snapshot = { commit: 'abc', status: 'Built from all 3 documents at abc.', related: new Map() };
  const [none] = chapterContext({ chapter: { id: 'code', paths: ['src/a.ts'] }, canContinue: true, context: empty, status: null, open, remove: vi.fn() });
  expect(words(none)).toStrictEqual(['Docs that link here', 'No document read so far links to these files.']);
});

it('lists each document once, opening on top, and what the reader added, which can be removed', () => {
  const context = new ChapterContext();
  const spec = {
    path: 'spec.md',
    title: '<b>Spec</b>',
    kind: 'Spec',
    flag: 'worth-checking' as const,
    evidence: [{ path: 'spec.md', text: 'renderer', line: 7 }],
  };
  context.snapshot = {
    commit: 'abc',
    status: 'Built from 1 of 3 documents. Links from the others are not shown yet.',
    related: new Map([
      ['src/a.ts', [spec, { path: 'notes.md', title: 'Notes', kind: null, flag: 'changed', evidence: [] }]],
      ['src/b.ts', [spec]],
    ]),
  };
  const attachment = { chapter: 'code', commit: 'abc1234', path: 'adr.md', heading: 'choice', title: 'Decision — choice' };
  context.add(attachment);
  const open = vi.fn();
  const remove = vi.fn();
  const [docs, added] = chapterContext({ chapter: { id: 'code', paths: ['src/a.ts', 'src/b.ts'] }, canContinue: false, context, status: null, open, remove });
  expect(docs.querySelector('b')).toBe(null);
  // A chapter with more than one file says which of them each document links to.
  expect(words(docs)).toStrictEqual([
    'Docs that link here',
    '2',
    '<b>Spec</b>',
    'Spec · Worth checking · links to 2 of these files',
    'Notes',
    'Changed in this review · links to a.ts',
  ]);
  docs.querySelector<HTMLElement>('[data-context-key="doc:spec.md"]')!.click();
  expect(open).toHaveBeenLastCalledWith({ chapter: 'code', path: 'spec.md', anchor: undefined, key: 'doc:spec.md', canContinue: false });
  expect(words(added)).toStrictEqual(['Added by you', '1', 'Decision — choice', 'Added by you · abc1234', 'Remove']);
  added.querySelector<HTMLElement>('[data-context-key="attached:adr.md:choice"]')!.click();
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'adr.md', anchor: 'choice' }));
  const button = added.querySelector<HTMLElement>('.mr-sheet-link')!;
  expect(button.getAttribute('aria-label')).toBe('Remove Decision — choice from this chapter');
  button.click();
  expect(remove).toHaveBeenCalledWith(attachment);
  // One file: saying which is noise.
  const [single] = chapterContext({ chapter: { id: 'code', paths: ['src/b.ts'] }, canContinue: true, context, status: null, open, remove });
  expect(words(single)).toStrictEqual(['Docs that link here', '1', '<b>Spec</b>', 'Spec · Worth checking']);
});
