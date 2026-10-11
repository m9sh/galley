import { expect, it, vi } from 'vitest';
import { ChapterContext } from '../../core/review-context.ts';
import { chapterContext } from './chapter-context.ts';

it('keeps opening explicit, distinguishes the revision and announces that context has not been read', () => {
  const open = vi.fn();
  const select = vi.fn();
  const view = chapterContext({
    chapter: { id: 'code', paths: ['src/a.ts'] },
    revision: 'head',
    ref: 'feature/a',
    commit: 'abc12345',
    canContinue: true,
    context: new ChapterContext(),
    open,
    select,
    remove: vi.fn(),
  });
  expect(open).not.toHaveBeenCalled();
  expect(view.textContent).toContain('No project context read yet');
  expect(view.textContent).toContain('feature/a @ abc1234');
  view.querySelector<HTMLButtonElement>('[data-context-key="find"]')!.click();
  expect(open).toHaveBeenCalledWith({ chapter: 'code', revision: 'head', key: 'find', canContinue: true });
  const picker = view.querySelector('select')!;
  picker.value = 'base';
  picker.dispatchEvent(new Event('change'));
  expect(select).toHaveBeenCalledWith('base');
});

it('shows link evidence and explicit attachments separately, with safe text, section targets and removal', () => {
  const context = new ChapterContext();
  context.snapshots.set('base', {
    commit: 'abc',
    status: 'Built from 1 of 3 documents. Links from the others are not shown yet.',
    related: new Map([
      [
        'src/a.ts',
        [{ path: 'spec.md', title: '<b>Spec</b>', kind: 'Spec', flag: 'worth-checking', evidence: [{ path: 'spec.md', text: 'renderer', line: 7 }] }],
      ],
    ]),
  });
  const attachment = { chapter: 'code', revision: 'base' as const, commit: 'abc', path: 'adr.md', heading: 'choice', title: 'Decision — choice' };
  context.add(attachment);
  const open = vi.fn();
  const remove = vi.fn();
  const view = chapterContext({
    chapter: { id: 'code', paths: ['src/a.ts', 'unread.ts'] },
    revision: 'base',
    ref: 'main',
    commit: 'abc',
    canContinue: false,
    context,
    open,
    select: vi.fn(),
    remove,
  });
  expect(view.querySelector('b')).toBeNull();
  expect(view.textContent).toContain('Links to src/a.ts');
  expect(view.textContent).toContain('Added by you');
  const controls = [...view.querySelectorAll('button')];
  controls.find((button) => button.textContent === '<b>Spec</b>')!.click();
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'spec.md', revision: 'base' }));
  controls.find((button) => button.textContent!.includes('line 7'))!.click();
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ line: 7 }));
  controls.find((button) => button.textContent === attachment.title)!.click();
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'adr.md', anchor: 'choice' }));
  controls.find((button) => button.textContent === 'Remove')!.click();
  expect(remove).toHaveBeenCalledWith(attachment);
});
