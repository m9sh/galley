import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SHEET_IN, SHEET_OUT } from './motion.ts';
import { kbd, Sheet, sheetRow, sheetSection, type SheetOptions } from './sheet.ts';

let phone = false;

beforeEach(() => {
  phone = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return phone && query.includes('max-width: 760px');
    },
  }));
  // jsdom draws nothing; every control counts as shown.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
});

afterEach(() => {
  document.body.replaceChildren();
});

/** A page with a top bar, a column that the sheet pushes aside, and the sheet. */
function page(extra: Partial<SheetOptions> = {}) {
  const root = document.createElement('div');
  const topbar = document.createElement('header');
  const column = document.createElement('main');
  column.getBoundingClientRect = () => new DOMRect(root.classList.contains('has-sheet') ? 160 : 320, 0, 600, 400);
  column.animate = vi.fn() as typeof column.animate;
  root.append(topbar, column);
  document.body.append(root);
  const dismiss = vi.fn();
  const sheet = new Sheet({ root, className: 'mr-test-sheet', closeLabel: 'Close', parts: () => [column], background: () => [topbar], dismiss, ...extra });
  return { root, topbar, column, sheet, dismiss };
}

const key = (name: string, shiftKey = false) => new KeyboardEvent('keydown', { key: name, shiftKey, cancelable: true });
const text = (el: Element) => el.textContent;
const rows = (...titles: string[]) => titles.map((title) => sheetRow({ title }));

it('builds every list from one row: a mark, the title over one quiet line, a value, a chevron when it opens a sheet', () => {
  const action = vi.fn();
  const mark = document.createElement('i');
  const row = sheetRow({ title: 'Architecture overview', meta: 'Architecture · Worth checking', lead: mark, end: '2/3', opens: true, action });
  expect(row.tagName).toBe('BUTTON');
  expect((row as HTMLButtonElement).type).toBe('button');
  expect([...row.children].map((el) => el.className)).toStrictEqual(['mr-sheet-row-lead', 'mr-sheet-row-text', 'mr-sheet-row-end', 'mr-sheet-row-go']);
  expect(row.querySelector('.mr-sheet-row-lead')!.contains(mark)).toBe(true);
  expect(row.querySelector('.mr-sheet-row-lead')!.getAttribute('aria-hidden')).toBe('true');
  expect(text(row)).toBe('Architecture overviewArchitecture · Worth checking2/3');
  expect(row.classList).toContain('is-push');
  row.click();
  expect(action).toHaveBeenCalledOnce();
  // Plain: no mark, no line, no value, no chevron.
  const plain = sheetRow({ title: 'README.md' });
  expect([...plain.children].map((el) => el.className)).toStrictEqual(['mr-sheet-row-lead', 'mr-sheet-row-text', 'mr-sheet-row-end']);
  expect(plain.querySelector('.mr-sheet-row-meta')).toBe(null);
  // A page elsewhere opens in a new tab; without an address it is only words.
  const link = sheetRow({ title: 'review.png', href: 'https://example.org/diff' }) as HTMLAnchorElement;
  expect([link.tagName, link.href, link.target, link.rel]).toStrictEqual(['A', 'https://example.org/diff', '_blank', 'noopener noreferrer']);
  expect((sheetRow({ title: 'review.png', href: '' }) as HTMLAnchorElement).hasAttribute('href')).toBe(false);
  // Sections: a heading, how many, quiet actions.
  const more = document.createElement('button');
  const section = sheetSection('Changed files', rows('a.md'), { count: 1200, actions: [more] });
  expect(section.getAttribute('aria-label')).toBe('Changed files');
  expect(text(section.querySelector('.mr-sheet-section-head')!)).toBe('Changed files1,200');
  expect(section.querySelector('.mr-sheet-section-head')!.contains(more)).toBe(true);
  expect(sheetSection('Docs', []).querySelector('.mr-sheet-count')).toBe(null);
  expect(kbd('Esc').outerHTML).toBe('<kbd aria-hidden="true">Esc</kbd>');
});

it('lays out every sheet the same way: a lead and actions with Close last, then the title, one body, and its keys', () => {
  const { sheet } = page();
  const read = Object.assign(document.createElement('button'), { textContent: 'Read' });
  const tabs = Object.assign(document.createElement('div'), { textContent: 'Chapters Library' });
  const search = Object.assign(document.createElement('div'), { textContent: 'Search' });
  sheet.fill({
    label: 'Library',
    lead: [tabs],
    actions: [read],
    kicker: 'Linked from',
    title: 'Reading',
    description: 'docs/reading.md · c0ffee1',
    extra: [search],
    body: [Object.assign(document.createElement('p'), { textContent: 'Goals' })],
    keys: [
      [['↑', '↓'], 'Move'],
      [['↵'], 'Open'],
    ],
  });
  expect(sheet.element.className).toBe('mr-sheet mr-test-sheet');
  expect(sheet.element.getAttribute('aria-label')).toBe('Library');
  expect(sheet.root.element.getAttribute('aria-label')).toBe('Library');
  expect(sheet.backdrop.className).toBe('mr-sheet-backdrop mr-test-sheet-backdrop');
  expect(sheet.element.hidden).toBe(true);
  const header = sheet.root.element.querySelector('.mr-sheet-header')!;
  expect([...header.children].map((el) => el.className)).toStrictEqual(['mr-sheet-top', 'mr-sheet-kicker', 'mr-sheet-title', 'mr-sheet-description', '']);
  expect(text(header)).toBe('Chapters LibraryReadCloseLinked fromReadingdocs/reading.md · c0ffee1Search');
  expect([...sheet.root.element.querySelectorAll('.mr-sheet-actions > *')].map((el) => el.className)).toStrictEqual(['', 'mr-btn mr-icon-btn mr-sheet-close']);
  expect(sheet.close.title).toBe('Close (Esc)');
  expect(sheet.body.textContent).toBe('Goals');
  // Its keys, then Esc, which closes the first sheet.
  expect(text(sheet.root.element.querySelector('.mr-sheet-keys')!)).toBe('↑↓ Move↵ OpenEsc Close');
  expect(sheet.root.element.hasAttribute('data-kind')).toBe(false);
  // Filled again with less: what it leaves out is gone, and Close stays put, focus and all; Esc is always among its keys.
  sheet.show();
  sheet.close.focus();
  sheet.fill({ label: 'Chapters', body: [], kind: 'chapters' });
  expect(document.activeElement).toBe(sheet.close);
  expect(text(header)).toBe('Close');
  expect(text(sheet.root.element.querySelector('.mr-sheet-keys')!)).toBe('Esc Close');
  expect(sheet.root.element.dataset.kind).toBe('chapters');
  expect(sheet.root.name).toBe('Chapters');
  sheet.fill({ label: 'Library', body: [] });
  expect(sheet.root.element.hasAttribute('data-kind')).toBe(false);
});

it('on a wide screen opens beside the page, which narrows and slides aside with it, and slides away again', () => {
  const { root, topbar, column, sheet } = page();
  sheet.fill({ label: 'Chapters', body: [] });
  sheet.show();
  expect([sheet.isOpen, sheet.isModal]).toStrictEqual([true, false]);
  expect(sheet.element.hasAttribute('role')).toBe(false);
  expect([sheet.backdrop.hidden, topbar.inert]).toStrictEqual([true, false]);
  expect(root.classList).toContain('has-sheet');
  expect(column.animate).toHaveBeenLastCalledWith([{ transform: 'translateX(160px)' }, { transform: 'translateX(0)' }], SHEET_IN);
  sheet.show();
  expect(column.animate).toHaveBeenCalledOnce();
  expect(sheet.hide()).toBe(true);
  expect([sheet.isOpen, sheet.element.inert]).toStrictEqual([false, true]);
  expect(root.classList).not.toContain('has-sheet');
  expect(column.animate).toHaveBeenLastCalledWith([{ transform: 'translateX(-160px)' }, { transform: 'translateX(0)' }], SHEET_OUT);
  // Closed at once, it is drawn while it slides away, then not at all; a sheet inside it ending its own slide changes nothing.
  expect(sheet.element.classList).toContain('is-closing');
  sheet.root.element.dispatchEvent(new Event('animationend', { bubbles: true }));
  expect(sheet.element.classList).toContain('is-closing');
  sheet.element.dispatchEvent(new Event('animationend'));
  expect(sheet.element.classList).not.toContain('is-closing');
  expect(sheet.hide()).toBe(false);
  sheet.show();
  sheet.hide();
  sheet.show();
  expect(sheet.element.classList).not.toContain('is-closing');
  sheet.element.dispatchEvent(new Event('animationend'));
  expect(sheet.isOpen).toBe(true);
});

it('narrows the page through the page’s own reflow when it has one, so it keeps the reader’s place', () => {
  const reflow = vi.fn((change: () => void) => change());
  const { root, sheet } = page({ reflow });
  sheet.show();
  expect(reflow).toHaveBeenCalledOnce();
  expect(root.classList).toContain('has-sheet');
});

it('is a stack: what a list opens slides in on top, named on its Back by the sheet beneath, and Esc goes down a level at a time', () => {
  const { sheet, dismiss } = page();
  const chapter = rows('docs/rfcs')[0];
  chapter.dataset.chapter = 'docs:docs/rfcs';
  sheet.fill({ label: 'Chapters', body: [chapter] });
  sheet.show();
  chapter.focus();
  const second = sheet.push({ label: 'docs/rfcs', title: 'docs/rfcs', body: rows('0042.md', 'README.md'), kind: 'chapter' });
  expect(sheet.depth).toBe(1);
  expect(sheet.top).toBe(second);
  // It takes focus itself; Back names the sheet beneath, and its keys say Esc goes back to it.
  expect(document.activeElement).toBe(second.element);
  expect(second.back!.getAttribute('aria-label')).toBe('Back to Chapters');
  expect(second.back!.title).toBe('Back (Esc)');
  expect(text(second.back!)).toBe('Chapters');
  expect(second.close.title).toBe('Close');
  expect(text(second.element.querySelector('.mr-sheet-keys')!)).toBe('Esc Back');
  expect(second.element.dataset.kind).toBe('chapter');
  // The first sheet waits beneath, out of reach, its edge a way back.
  expect([sheet.root.element.classList.contains('is-under'), sheet.root.element.inert, second.element.inert]).toStrictEqual([true, true, false]);
  expect([sheet.root.element.style.getPropertyValue('--at'), sheet.root.element.style.getPropertyValue('--under')]).toStrictEqual(['0', '1']);
  expect([second.element.style.getPropertyValue('--at'), second.element.style.getPropertyValue('--under')]).toStrictEqual(['1', '0']);
  expect(sheet.element.querySelectorAll('.mr-sheet-edge')).toHaveLength(1);
  // A document on top of that, and one it links to on top of it: each stacks, so Esc goes back through them.
  const doc = sheet.push({ label: 'Document', title: 'Architecture overview', body: [], kind: 'document' });
  expect(sheet.depth).toBe(2);
  const linked = sheet.push({ label: 'Document', title: 'ADR 0007', body: [], kind: 'document' });
  expect([linked === doc, sheet.depth, linked.back!.getAttribute('aria-label')]).toStrictEqual([false, 3, 'Back to Architecture overview']);
  expect(doc.back!.getAttribute('aria-label')).toBe('Back to docs/rfcs');
  // Deeper sheets sit two steps in at most; their edges, up to two, go back to them.
  expect([...sheet.element.querySelectorAll<HTMLElement>('.mr-sheet-layer')].map((layer) => layer.style.getPropertyValue('--at'))).toStrictEqual([
    '0',
    '1',
    '2',
    '2',
  ]);
  expect([...sheet.element.querySelectorAll<HTMLElement>('.mr-sheet-layer')].map((layer) => layer.style.getPropertyValue('--under'))).toStrictEqual([
    '2',
    '2',
    '1',
    '0',
  ]);
  expect([...sheet.element.querySelectorAll<HTMLElement>('.mr-sheet-edge')].map((edge) => edge.title)).toStrictEqual(['Back to Chapters', 'Back to docs/rfcs']);
  // Esc goes back one sheet; it is drawn, out of reach, while it slides away, and focus returns to what opened it.
  const esc = key('Escape');
  expect(sheet.onKey(esc)).toBe(true);
  expect(esc.defaultPrevented).toBe(true);
  expect(sheet.depth).toBe(2);
  expect(document.activeElement).toBe(doc.element);
  const gone = sheet.element.querySelector<HTMLElement>('.mr-sheet-layer.is-leaving')!;
  expect([gone.hidden, gone.inert]).toStrictEqual([true, true]);
  gone.dispatchEvent(new Event('animationend'));
  expect(gone.isConnected).toBe(false);
  // Its edge goes straight back to a sheet further down.
  sheet.element.querySelector<HTMLElement>('.mr-sheet-edge')!.click();
  expect(sheet.depth).toBe(0);
  expect(document.activeElement).toBe(chapter);
  // Back does the same as Esc; at the first sheet, Esc asks the page to close it.
  const again = sheet.push({ label: 'docs/rfcs', body: [], kind: 'chapter' });
  again.back!.click();
  expect(sheet.depth).toBe(0);
  expect(sheet.pop()).toBe(false);
  sheet.onKey(key('Escape'));
  expect(dismiss).toHaveBeenCalledOnce();
  // Closing from any sheet asks the page; so does the backdrop.
  sheet.push({ label: 'docs/rfcs', body: [], kind: 'chapter' }).close.click();
  sheet.backdrop.click();
  sheet.close.click();
  expect(dismiss).toHaveBeenCalledTimes(4);
  // Filling the first sheet anew closes every sheet on top at once.
  sheet.fill({ label: 'Library', body: [] });
  expect(sheet.element.querySelectorAll('.mr-sheet-layer')).toHaveLength(1);
});

it('steps to a sibling in place of the sheet on top, keeping its way back, and focus on the control that stepped while it can', () => {
  const { sheet } = page();
  sheet.fill({ label: 'Chapters', body: [] });
  sheet.show();
  const next = (disabled = false) => {
    const button = Object.assign(document.createElement('button'), { disabled });
    button.dataset.step = 'next';
    return button;
  };
  const chapter = sheet.push({ label: 'One', title: 'One', actions: [next()], body: [], kind: 'chapter' });
  chapter.body.scrollTop = 300;
  chapter.element.querySelector<HTMLElement>('[data-step]')!.focus();
  const two = sheet.replace({ label: 'Two', title: 'Two', actions: [next()], body: [], kind: 'chapter' });
  expect([two === chapter, sheet.depth, chapter.name, chapter.body.scrollTop, chapter.back!.getAttribute('aria-label')]).toStrictEqual([
    true,
    1,
    'Two',
    0,
    'Back to Chapters',
  ]);
  expect(document.activeElement).toBe(chapter.element.querySelector('[data-step]'));
  // At the last one Next cannot be used, so the sheet takes focus; stepped from elsewhere, so does it.
  sheet.replace({ label: 'Three', actions: [next(true)], body: [], kind: 'chapter' });
  expect(document.activeElement).toBe(chapter.element);
  sheet.replace({ label: 'Four', actions: [next()], body: [], kind: 'chapter' });
  expect(document.activeElement).toBe(chapter.element);
});

it('gives focus back to what opened a sheet, or to what was drawn in its place, or to the sheet beneath', () => {
  const { sheet } = page();
  const list = document.createElement('div');
  const draw = () =>
    list.replaceChildren(
      ...['a.md', 'b.md'].map((path) => {
        const row = sheetRow({ title: path });
        row.dataset.path = path;
        return row;
      }),
    );
  draw();
  sheet.fill({ label: 'Library', body: [list] });
  sheet.show();
  list.querySelector<HTMLElement>('[data-path="b.md"]')!.focus();
  sheet.push({ label: 'Document', body: [], kind: 'document' });
  // The list was drawn again while the document was open: focus goes to the same row, drawn anew.
  draw();
  sheet.pop();
  expect(document.activeElement).toBe(list.querySelector('[data-path="b.md"]'));
  // A row with no data of its own, or one that is gone for good, gives way to the sheet beneath.
  const plain = sheetRow({ title: 'Plain' });
  list.append(plain);
  plain.focus();
  sheet.push({ label: 'Document', body: [], kind: 'document' });
  plain.remove();
  sheet.pop();
  expect(document.activeElement).toBe(sheet.root.element);
  list.querySelector<HTMLElement>('[data-path="a.md"]')!.focus();
  sheet.push({ label: 'Document', body: [], kind: 'document' });
  list.replaceChildren();
  sheet.pop();
  expect(document.activeElement).toBe(sheet.root.element);
  // Opened with nothing focused in the page.
  (document.activeElement as HTMLElement).blur();
  sheet.push({ label: 'Document', body: [], kind: 'document' });
  sheet.pop();
  expect(document.activeElement).toBe(sheet.root.element);
});

it('moves between rows with the arrow keys, Home and End, and goes to its search with /, only with focus inside it', () => {
  const { sheet } = page();
  const search = document.createElement('label');
  search.className = 'mr-sheet-search';
  const field = document.createElement('input');
  search.append(field);
  const note = document.createElement('textarea');
  const [a, b, c] = rows('a', 'b', 'c');
  (c as HTMLButtonElement).disabled = true;
  const d = rows('d')[0];
  sheet.fill({ label: 'Library', extra: [search], body: [a, b, c, d, note] });
  sheet.show();
  const press = (name: string) => {
    const event = key(name);
    return [sheet.onKey(event), event.defaultPrevented];
  };
  // From the sheet itself, ↓ goes into the list; ↑ does nothing there.
  sheet.root.element.focus();
  expect(press('ArrowUp')).toStrictEqual([false, false]);
  expect(press('ArrowDown')).toStrictEqual([true, true]);
  expect(document.activeElement).toBe(a);
  press('ArrowDown');
  expect(document.activeElement).toBe(b);
  // Rows that cannot be chosen are skipped; the ends stay put.
  press('ArrowDown');
  expect(document.activeElement).toBe(d);
  press('ArrowDown');
  expect(document.activeElement).toBe(d);
  press('Home');
  expect(document.activeElement).toBe(a);
  press('ArrowUp');
  expect(document.activeElement).toBe(a);
  press('End');
  expect(document.activeElement).toBe(d);
  // / goes to the search; from it ↓ goes into the list, while other keys are typed.
  expect(press('/')).toStrictEqual([true, true]);
  expect(document.activeElement).toBe(field);
  expect(press('/')).toStrictEqual([false, false]);
  expect(press('Home')).toStrictEqual([false, false]);
  expect(press('ArrowDown')).toStrictEqual([true, true]);
  expect(document.activeElement).toBe(a);
  // Other fields keep their keys, and other keys are the page's.
  note.focus();
  expect(press('ArrowDown')).toStrictEqual([false, false]);
  a.focus();
  expect(press('j')).toStrictEqual([false, false]);
  // With focus outside it, the page has its keys; a sheet without rows or search lets them pass.
  (document.activeElement as HTMLElement).blur();
  expect(press('ArrowDown')).toStrictEqual([false, false]);
  sheet.fill({ label: 'Empty', body: [] });
  sheet.root.element.focus();
  expect(press('/')).toStrictEqual([false, false]);
  expect(press('ArrowDown')).toStrictEqual([false, false]);
  sheet.hide();
  expect(press('Escape')).toStrictEqual([false, false]);
});

it('on a phone covers the page as a dialog, which waits behind it, keeps Tab inside, and becomes a side sheet again on a wide screen', () => {
  phone = true;
  const { root, topbar, sheet } = page();
  const read = document.createElement('button');
  sheet.fill({ label: 'Document', actions: [read], body: [] });
  expect(sheet.onKey(key('Tab'))).toBe(false);
  sheet.show();
  expect(sheet.isModal).toBe(true);
  expect([sheet.element.getAttribute('role'), sheet.element.getAttribute('aria-modal')]).toStrictEqual(['dialog', 'true']);
  expect([sheet.backdrop.hidden, sheet.backdrop.getAttribute('aria-label'), topbar.inert]).toStrictEqual([false, 'Close', true]);
  // From the last control (the body) Tab goes round to the first, and Shift+Tab back again; between them it moves as usual.
  sheet.body.focus();
  const forward = key('Tab');
  expect(sheet.onKey(forward)).toBe(true);
  expect([forward.defaultPrevented, document.activeElement]).toStrictEqual([true, read]);
  sheet.onKey(key('Tab', true));
  expect(document.activeElement).toBe(sheet.body);
  sheet.close.focus();
  for (const between of [key('Tab'), key('Tab', true)]) {
    expect(sheet.onKey(between)).toBe(true);
    expect(between.defaultPrevented).toBe(false);
  }
  // Turned to a wide screen while open, it sits beside the page again.
  phone = false;
  sheet.show();
  expect([sheet.isModal, sheet.element.hasAttribute('aria-modal'), sheet.backdrop.hidden]).toStrictEqual([false, false, true]);
  expect(sheet.onKey(key('Tab'))).toBe(false);
  phone = true;
  sheet.show();
  // Closing: the scrim fades with it, and the page is in reach again.
  sheet.hide();
  expect([sheet.element.hasAttribute('role'), sheet.backdrop.hidden, sheet.backdrop.classList.contains('is-closing')]).toStrictEqual([false, true, true]);
  sheet.backdrop.dispatchEvent(new Event('animationend'));
  expect(sheet.backdrop.classList).not.toContain('is-closing');
  expect([topbar.inert, root.classList.contains('has-sheet')]).toStrictEqual([false, false]);
});
