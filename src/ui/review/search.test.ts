import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SEARCH_BUDGET } from '../../core/search.ts';
import { ReviewSearch, type SearchKind, type SearchScope, type SearchTarget } from './search.ts';

type At = { id: string };
const target = (text: string, patch: Partial<SearchTarget<At>> = {}): SearchTarget<At> => ({
  kind: 'document',
  path: 'docs/guide.md',
  place: 'Limits',
  version: null,
  changed: false,
  text,
  at: { id: text },
  ...patch,
});

let targets: SearchTarget<At>[] = [];
let scope: SearchScope = { files: 1, comments: 0, drafts: 0, code: 0, loading: 0, failed: 0 };
const options = {
  root: document.createElement('div'),
  toggle: document.createElement('button'),
  beforeOpen: vi.fn(),
  targets: () => targets,
  scope: () => scope,
  reveal: vi.fn(async () => {}),
  remember: vi.fn(),
  forget: vi.fn(),
  showCode: vi.fn(),
};
let search: ReviewSearch<At>;
let back: ReturnType<typeof vi.fn>;

const q = <E extends HTMLElement = HTMLElement>(selector: string) => options.root.querySelector<E>(selector)!;
const field = () => q<HTMLInputElement>('.mr-search-field');
const type = async (text: string) => {
  field().value = text;
  field().dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(q('.mr-search-status').textContent).not.toBe(''));
};
const status = () => q('.mr-search-status').textContent;
const results = () => [...options.root.querySelectorAll('.mr-search-result')].map((el) => el.textContent);
const chips = () => [...options.root.querySelectorAll('.mr-search-filters button')].map((el) => [el.textContent, el.getAttribute('aria-pressed')]);
const press = (key: string, at: HTMLElement = field()) => {
  let handled: boolean | undefined;
  at.addEventListener('keydown', (e) => (handled = search.onKey(e)), { once: true });
  at.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  return handled;
};
const chip = (name: string) => [...options.root.querySelectorAll<HTMLElement>('.mr-search-filters button')].find((el) => el.textContent!.startsWith(name))!;
const bar = () => q('.mr-search-bar');

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  options.root.replaceChildren();
  document.body.append(options.root, options.toggle);
  targets = [];
  scope = { files: 1, comments: 0, drafts: 0, code: 0, loading: 0, failed: 0 };
  back = vi.fn();
  options.remember.mockReset().mockReturnValue(back);
  for (const fn of [options.beforeOpen, options.reveal, options.forget, options.showCode]) fn.mockClear();
  search = new ReviewSearch<At>(options);
});

afterEach(() => {
  search.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('opens beside the top bar with the field focused, and asks for a phrase', async () => {
  search.toggle();
  expect(search.isOpen).toBe(true);
  expect(options.beforeOpen).toHaveBeenCalled();
  expect(options.toggle.getAttribute('aria-expanded')).toBe('true');
  expect(options.root.ownerDocument.activeElement).toBe(field());
  expect(field().getAttribute('role')).toBe('combobox');
  await vi.waitFor(() => expect(status()).toBe('Type at least two characters to search the review.'));
  expect(q('.mr-search-filters').hidden).toBe(true);
  await type('x'.repeat(SEARCH_BUDGET.maxQuery + 1));
  expect(status()).toBe('Search for 200 characters or fewer.');
  search.toggle();
  expect(search.isOpen).toBe(false);
  expect(options.toggle.getAttribute('aria-expanded')).toBe('false');
  expect(search.close()).toBe(false);
});

it('lists every match in reading order, grouped by file, saying where it is and which version', async () => {
  targets = [
    target('The description sets a limit.', { kind: 'description', path: null, place: '', changed: true }),
    target('The limit is 20 euros, and the limit resets.', { version: 'new', changed: true }),
    target('The limit is 10 euros.', { version: 'old', changed: true, alsoNew: 'The limit is 20 euros.' }),
    target('Old limit and old limit.', { version: 'old', changed: true, alsoNew: 'The limit is 20.' }),
    target('const LIMIT = 20;', { kind: 'code', path: 'quota.ts', place: 'line 4' }),
    target('it("checks the limit")', { kind: 'test', path: 'src/quota.test.ts', place: 'line 9' }),
    target('Is this limit right?', { kind: 'comment', path: 'src/quota.test.ts', place: 'Ada · line 9', changed: true }),
    target('Raise the limit', { kind: 'draft', path: 'src/quota.test.ts', place: 'Your reply', changed: true }),
    target('Nothing here.'),
  ];
  search.open();
  await type('  the   LIMIT ');
  expect(status()).toBe('4 matches.');
  await type('limit');
  expect(status()).toBe('8 matches.');
  // A phrase both versions of a block share is reported once, in the new version; the old one keeps what only it had.
  expect(results()).toEqual([
    'DescriptionThe description sets a limit.',
    'DocumentLimitsNew versionThe limit is 20 euros, and the limit resets.',
    'DocumentLimitsNew versionThe limit is 20 euros, and the limit resets.',
    'DocumentLimitsOld versionOld limit and old limit.',
    'Codeline 4const LIMIT = 20;',
    'Testline 9it("checks the limit")',
    'CommentAda · line 9Is this limit right?',
    'Your draftYour replyOnly you can see itRaise the limit',
  ]);
  expect([...options.root.querySelectorAll('.mr-search-file')].map((el) => el.textContent)).toEqual([
    'Request description',
    'guide.mddocs/',
    'quota.ts',
    'quota.test.tssrc/',
  ]);
  expect(q('.mr-search-result mark').textContent).toBe('limit');
  expect(field().getAttribute('aria-activedescendant')).toBe('mr-search-result-0');
  expect(field().getAttribute('aria-expanded')).toBe('true');
  expect(q('.mr-search-group').getAttribute('aria-labelledby')).toBe(q('.mr-search-file').id);
});

it('filters by kind of content, and to what the review changed', async () => {
  const kinds: SearchKind[] = ['document', 'description', 'code', 'test', 'comment', 'draft'];
  targets = kinds.map((kind, i) => target(`limit ${kind}`, { kind, path: `f${i}.md`, changed: kind !== 'code' && kind !== 'document' }));
  search.open();
  await type('limit');
  expect(chips()).toEqual([
    ['All6', 'true'],
    ['Documents2', 'false'],
    ['Code2', 'false'],
    ['Comments1', 'false'],
    ['Your drafts1', 'false'],
    ['Changed parts only', 'false'],
  ]);
  chip('Code').click();
  expect(results()).toEqual(['CodeLimitslimit code', 'TestLimitslimit test']);
  expect(status()).toBe('6 matches, 2 shown.');
  chip('Changed parts only').click();
  expect(chip('Changed parts only').getAttribute('aria-pressed')).toBe('true');
  // The chosen filter stays, with nothing in it, so it can be changed back.
  expect(chips()).toEqual([
    ['All4', 'false'],
    ['Documents1', 'false'],
    ['Code1', 'true'],
    ['Comments1', 'false'],
    ['Your drafts1', 'false'],
    ['Changed parts only', 'true'],
  ]);
  expect(results()).toEqual(['TestLimitslimit test']);
  targets = targets.filter((item) => item.kind !== 'test');
  await type('limit ');
  expect(chips()[2]).toEqual(['Code0', 'true']);
  expect(status()).toBe('5 matches, none with these filters.');
  expect(field().hasAttribute('aria-activedescendant')).toBe(false);
  expect(field().getAttribute('aria-expanded')).toBe('false');
});

it('says when nothing matches, and what it did not search', async () => {
  search.open();
  await type('limit');
  expect(status()).toBe('No matches for “limit”.');
  expect(q('.mr-search-scope').textContent).toBe('Searches 1 file, including folded parts.');
  scope = { files: 3, comments: 4, drafts: 1, code: 2, loading: 1, failed: 1 };
  await type('limit ');
  expect([...options.root.querySelectorAll('.mr-search-scope p')].map((p) => p.textContent)).toEqual([
    'Searches 3 files, 4 comments and 1 draft, including folded parts.',
    '2 code files not searched while Code files is off.Turn on Code files',
    '1 file still loading; results update when they arrive.',
    '1 file could not be loaded and was not searched.',
  ]);
  scope = { files: 1, comments: 1, drafts: 0, code: 1, loading: 0, failed: 2 };
  q('.mr-search-code').click();
  expect(options.showCode).toHaveBeenCalled();
  await vi.waitFor(() => expect(q('.mr-search-scope').textContent).toContain('2 files could not be loaded and were not searched.'));
  expect(q('.mr-search-scope').textContent).toContain('Searches 1 file and 1 comment');
  expect(q('.mr-search-scope').textContent).toContain('1 code file not searched');
  expect(options.root.ownerDocument.activeElement).toBe(field());
});

it('reports how many matches there are beyond the ones it lists', async () => {
  targets = [target(Array.from({ length: SEARCH_BUDGET.results + 5 }, () => 'limit').join(' '))];
  search.open();
  await type('limit');
  expect(results()).toHaveLength(SEARCH_BUDGET.results);
  expect(status()).toBe('205 matches. Showing the first 200.');
});

it('moves through results with the arrow keys, wrapping, and shows one with Enter', async () => {
  targets = [target('limit one'), target('limit two'), target('limit three')];
  search.open();
  expect(press('ArrowDown')).toBe(true);
  expect(press('Enter')).toBe(true);
  expect(options.reveal).not.toHaveBeenCalled();
  await type('limit');
  expect(press('ArrowUp')).toBe(true);
  expect(field().getAttribute('aria-activedescendant')).toBe('mr-search-result-2');
  press('ArrowDown');
  expect(field().getAttribute('aria-activedescendant')).toBe('mr-search-result-0');
  press('ArrowDown');
  expect(q('[aria-selected="true"]').textContent).toContain('limit two');
  expect(press('a')).toBe(false);
  expect(press('ArrowDown', options.toggle)).toBe(false);
  expect(press('Enter')).toBe(true);
  expect(options.reveal).toHaveBeenCalledWith({ target: targets[1], start: 0, end: 5 });
  expect(search.isOpen).toBe(false);
  expect(press('ArrowDown')).toBe(false);
  expect(bar().hidden).toBe(false);
  expect(q('.mr-search-bar-text').textContent).toBe('“limit” · 2 of 3');
});

it('steps through results from the bar, and goes back to where the reader was', async () => {
  targets = [target('limit one'), target('limit two')];
  search.open();
  expect(options.remember).toHaveBeenCalledTimes(1);
  await type('limit');
  q<HTMLElement>('#mr-search-result-0').click();
  const [previous, next] = options.root.querySelectorAll<HTMLButtonElement>('.mr-search-step');
  expect([previous.disabled, next.disabled]).toEqual([true, false]);
  next.click();
  expect(q('.mr-search-bar-text').textContent).toBe('“limit” · 2 of 2');
  expect([previous.disabled, next.disabled]).toEqual([false, true]);
  previous.click();
  expect(options.reveal).toHaveBeenCalledTimes(3);
  // Reopening to choose another result keeps the place from before the first one.
  search.open();
  expect(options.remember).toHaveBeenCalledTimes(1);
  await type('limit');
  q<HTMLElement>('#mr-search-result-1').click();
  q('.mr-search-back').click();
  expect(back).toHaveBeenCalledTimes(1);
  expect(options.forget).toHaveBeenCalledTimes(1);
  expect(bar().hidden).toBe(true);
  expect(search.closeBar()).toBe(false);
  // A new search remembers the place again.
  search.open();
  expect(options.remember).toHaveBeenCalledTimes(2);
  await type('limit');
  q<HTMLElement>('#mr-search-result-0').click();
  q('.mr-search-close').click();
  expect(bar().hidden).toBe(true);
  expect(back).toHaveBeenCalledTimes(1);
  expect(options.forget).toHaveBeenCalledTimes(2);
});

it('keeps its clicks to itself, so redrawing a filter never closes it', async () => {
  const outside = vi.fn();
  options.root.addEventListener('click', outside);
  targets = [target('limit', { kind: 'code' })];
  search.open();
  await type('limit');
  chip('Code').click();
  expect(outside).not.toHaveBeenCalled();
  options.root.removeEventListener('click', outside);
});

it('gives focus back when it closes: to what had it, or to the search button when that is gone', () => {
  const before = document.createElement('button');
  document.body.append(before);
  before.focus();
  search.open();
  search.close();
  expect(document.activeElement).toBe(before);
  search.open();
  before.remove();
  search.close();
  expect(document.activeElement).toBe(options.toggle);
  // Closing while focus is elsewhere leaves it there.
  search.open();
  before.focus();
  document.body.append(before);
  before.focus();
  search.close();
  expect(document.activeElement).toBe(before);
  // In the reader, focus outside its shadow root is no one's to give back: the search button takes it.
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const root = document.createElement('div');
  const toggle = document.createElement('button');
  shadow.append(root, toggle);
  const inner = new ReviewSearch<At>({ ...options, root, toggle });
  before.focus();
  inner.open();
  inner.close();
  expect(shadow.activeElement).toBe(toggle);
  inner.destroy();
});

it('keeps focus in the field when a result is chosen with the pointer', () => {
  const down = new Event('pointerdown', { cancelable: true });
  q('.mr-search-results').dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
});

it('searches again when something arrives, only while results are showing', async () => {
  vi.useFakeTimers();
  search.refresh();
  search.open();
  await vi.runAllTimersAsync();
  search.refresh();
  expect(vi.getTimerCount()).toBe(0);
  field().value = 'limit';
  field().dispatchEvent(new Event('input'));
  await vi.runAllTimersAsync();
  targets = [target('limit')];
  search.refresh();
  search.refresh();
  expect(vi.getTimerCount()).toBe(1);
  await vi.runAllTimersAsync();
  expect(results()).toHaveLength(1);
  search.close();
  search.refresh();
  expect(vi.getTimerCount()).toBe(0);
});

it('pauses on large reviews so the reader stays responsive, and a newer search replaces an older one', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (now += 5));
  targets = [target('limit a'), target('limit b'), target('limit c'), target('limit d')];
  search.open();
  field().value = 'limit';
  field().dispatchEvent(new Event('input'));
  expect(status()).toBe('Searching…');
  field().value = 'limit d';
  field().dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(status()).toBe('1 match.'));
  expect(results()).toEqual(['DocumentLimitslimit d']);
  // Closing the reader stops a search that is still running.
  field().value = 'limit';
  field().dispatchEvent(new Event('input'));
  search.destroy();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(status()).toBe('Searching…');
});
