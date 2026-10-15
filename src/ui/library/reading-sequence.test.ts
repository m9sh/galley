import { expect, it } from 'vitest';
import { ReadingSequence, sequenceRoute, sequenceSheet } from './reading-sequence.ts';

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

/** Everything a sheet would show, in one element, to read as a whole. */
function sheet(content: ReturnType<typeof sequenceSheet>): HTMLElement {
  const box = document.createElement('div');
  box.append(...(content.extra ?? []), ...content.body);
  return box;
}

it('shows the chapter as a numbered path with its chosen order, the current stop and accessible order controls', () => {
  const items = [
    { path: 'README.md', anchor: '', title: '<img src=x>' },
    { path: 'guide.md', anchor: 'goals', title: 'Guide — Goals' },
  ];
  const content = sequenceSheet({ items, current: 1, commit: 'c0ffee1', from: null, links: [] });
  expect(content.description).toBe('Choose a path through the project. Add documents or headings, then put them in the order you want to read.');
  expect(content.keys!.map(([, what]) => what)).toStrictEqual(['Move', 'Open']);
  const view = sheet(content);
  expect(view.querySelector('img')).toBeNull();
  expect([...view.querySelectorAll('.mr-sheet-num')].map((num) => num.textContent)).toStrictEqual(['1', '2']);
  expect(view.textContent).toContain('guide.md · § goals');
  expect(view.textContent).toContain('Stop 2 of 2');
  const current = view.querySelector('[aria-current="step"]')!;
  expect(current.textContent).toContain('Guide');
  expect(current.querySelector('.mr-sheet-row-end')!.textContent).toBe('You are here');
  expect(view.querySelector<HTMLButtonElement>('[data-act="sequence-earlier"]')!.disabled).toBe(true);
  expect(view.querySelectorAll<HTMLButtonElement>('[data-act="sequence-later"]')[1].disabled).toBe(true);
  expect(view.querySelector('[data-act="docs"]')!.textContent).toBe('All documents');
  expect(view.querySelector('[data-act="sequence-remove"]')!.getAttribute('aria-label')).toBe('Remove <img src=x> from this chapter');
  expect(view.textContent).toContain('Only for this session at c0ffee1.');
  // Read chapter starts at the first stop, and is offered only when there is one.
  expect(view.querySelector<HTMLElement>('.mr-chapters-start')!.dataset.at).toBe('0');
  expect(sheet(sequenceSheet({ items, current: -1, commit: 'c0ffee1', from: null, links: [] })).textContent).toContain('2 stops');
  expect(sheet(sequenceSheet({ items: items.slice(0, 1), current: -1, commit: 'c0ffee1', from: null, links: [] })).textContent).toContain('1 stop');
  const empty = sheet(sequenceSheet({ items: [], current: -1, commit: 'c0ffee1', from: null, links: [] }));
  expect(empty.textContent).toContain('No documents yet');
  expect(empty.querySelector('[data-act="sequence-open"], .mr-chapters-status')).toBeNull();
  expect(sequenceRoute(items, -1).hidden).toBe(true);
  const first = sequenceRoute(items, 0);
  expect(first.hidden).toBe(false);
  expect(first.textContent).toContain('1 of 2');
  expect(first.querySelector<HTMLButtonElement>('[data-at="-1"]')!.disabled).toBe(true);
  expect(first.querySelector<HTMLButtonElement>('[data-at="1"]')!.disabled).toBe(false);
  expect(sequenceRoute(items, 1).querySelector<HTMLButtonElement>('[data-at="2"]')!.disabled).toBe(true);
});

it('offers the links of the document being read, each Add away, and says which are in the sequence already', () => {
  const view = sheet(
    sequenceSheet({
      items: [],
      current: -1,
      commit: 'c0ffee1',
      from: 'README.md',
      links: [
        { path: 'guide.md', anchor: 'goals', title: 'Guide', line: 3, added: true },
        { path: 'adr/1.md', anchor: '', title: 'One', line: 5, added: false },
      ],
    }),
  );
  expect(view.textContent).toContain('In README.md');
  const rows = [...view.querySelectorAll<HTMLElement>('.mr-sheet-row[data-act="open"]')];
  expect(rows.map((row) => [row.dataset.path, row.dataset.anchor])).toStrictEqual([
    ['guide.md', 'goals'],
    ['adr/1.md', undefined],
  ]);
  expect(rows[0].textContent).toContain('guide.md#goals · line 3');
  expect(rows[1].textContent).toContain('adr/1.md · line 5');
  const adds = [...view.querySelectorAll<HTMLElement>('[data-act="sequence-add"]')];
  expect(adds.map((add) => add.textContent)).toStrictEqual(['Added', 'Add']);
  expect(adds.map((add) => add.getAttribute('aria-label'))).toStrictEqual(['Guide is in your reading sequence', 'Add One to your reading sequence']);
});
