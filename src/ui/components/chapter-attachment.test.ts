import { expect, it, vi } from 'vitest';
import { chapterAttachment } from './chapter-attachment.ts';

it('adds a document or a real heading to the chosen chapter, for the session only, without interpreting markup', () => {
  const add = vi.fn();
  const view = chapterAttachment({
    chapters: [
      { id: 'one', title: 'First' },
      { id: 'two', title: '<b>Second</b>' },
    ],
    headings: [{ id: 'goals', text: 'Goals', level: 2, line: 3 }],
    add,
  });
  expect(view.querySelector('b')).toBeNull();
  const form = view.querySelector('form')!;
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  expect(add).toHaveBeenCalledWith('one', '', 'Whole document');
  const picker = view.querySelectorAll('select');
  picker[0].value = 'two';
  picker[1].value = 'goals';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(add).toHaveBeenLastCalledWith('two', 'goals', 'Goals');
  expect(view.querySelector('[role="status"]')!.textContent).toBe('Added to <b>Second</b>.');
  expect(chapterAttachment({ chapters: [{ id: 'two', title: 'Second' }], current: 'two', headings: [], add }).querySelector('select')!.value).toBe('two');
});
