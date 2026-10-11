import { expect, it } from 'vitest';
import { ReadingSequence, sequenceRoute, sequenceView } from './reading-sequence.ts';

it('keeps the explicitly selected documents and headings in a session order, without duplicate stops', () => {
  const sequence = new ReadingSequence();
  const first = { path: 'README.md', anchor: '', title: 'Start' };
  const section = { path: 'README.md', anchor: 'goals', title: 'Goals' };
  expect(sequence.add(first)).toBe(true);
  expect(sequence.add(first)).toBe(false);
  expect(sequence.add(section)).toBe(true);
  expect(sequence.current(null, '')).toBe(-1);
  expect(sequence.current('README.md', 'goals')).toBe(1);
  sequence.move(1, -1);
  expect(sequence.items).toEqual([section, first]);
  sequence.move(0, 1);
  expect(sequence.items).toEqual([first, section]);
  sequence.remove(0);
  expect(sequence.items).toEqual([section]);
  sequence.clear();
  expect(sequence.items).toEqual([]);
});

it('shows the chapter with its chosen order, an ordinary outline, current step and accessible edit controls', () => {
  const items = [
    { path: 'README.md', anchor: '', title: '<img src=x>' },
    { path: 'guide.md', anchor: 'goals', title: 'Guide — Goals' },
  ];
  const view = sequenceView(items, 1, 'c0ffee1');
  expect(view.querySelector('img')).toBeNull();
  expect(view.textContent).toContain('Added by you');
  expect(view.textContent).toContain('guide.md · § goals');
  expect(view.querySelector('[aria-current="step"]')!.textContent).toContain('Guide');
  expect(view.querySelector<HTMLButtonElement>('[data-act="sequence-earlier"]')!.disabled).toBe(true);
  expect(view.querySelectorAll<HTMLButtonElement>('[data-act="sequence-later"]')[1].disabled).toBe(true);
  expect(view.querySelector('[data-act="docs"]')!.textContent).toBe('Browse all documents');
  expect(view.querySelector('[data-act="sequence-remove"]')!.getAttribute('aria-label')).toBe('Remove <img src=x> from this chapter');
  const empty = sequenceView([], -1, 'c0ffee1');
  expect(empty.textContent).toContain('No documents yet');
  expect(empty.querySelector<HTMLButtonElement>('[data-act="sequence-open"]')!.disabled).toBe(true);
  expect(sequenceRoute(items, -1).hidden).toBe(true);
  const first = sequenceRoute(items, 0);
  expect(first.hidden).toBe(false);
  expect(first.textContent).toContain('1 of 2');
  expect(first.querySelector<HTMLButtonElement>('[data-at="-1"]')!.disabled).toBe(true);
  expect(first.querySelector<HTMLButtonElement>('[data-at="1"]')!.disabled).toBe(false);
  expect(sequenceRoute(items, 1).querySelector<HTMLButtonElement>('[data-at="2"]')!.disabled).toBe(true);
});
