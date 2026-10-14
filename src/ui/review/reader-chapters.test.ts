import { expect, it, vi } from 'vitest';
import { contents, guide, readerHarness, review } from '../../testing/reader.ts';
import type { DocRef } from '../../platforms/types.ts';

const h = readerHarness();
const code = (path: string): DocRef => ({ path, oldPath: path, status: 'modified', kind: 'code' });
const source = code('src/limits/quota.ts');
const test = code('tests/quota.test.ts');
const lock = code('package-lock.json');
const gone = { ...code('old/legacy.ts'), status: 'removed' as const };
const renamed = { ...code('src/auth/access.ts'), oldPath: 'src/auth/login.ts', status: 'renamed' as const };
const image: DocRef = { path: 'assets/image.png', oldPath: 'assets/image.png', status: 'added' };
const docs = [guide, { ...guide, path: 'docs/rfcs/plan.md' }];
const load = async (doc: DocRef) => (doc.kind === 'code' ? { base: 'export const quota = 1;\n', head: 'export const quota = 2;\n' } : contents);
const set = (patch = {}) => review({ docs, codeDocs: [source, test, lock, gone, renamed], otherFiles: [image], load: vi.fn(load), ...patch });

/** The sheet on top of the stack, which has the keys. */
const top = () => [...h.shadow().querySelectorAll<HTMLElement>('.mr-chapters > .mr-sheet-layer')].filter((layer) => !layer.hidden).at(-1)!;
const title = () => top().querySelector('.mr-sheet-title')?.textContent ?? null;
const buttons = (text: string, scope: ParentNode = top()) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === text);
const click = (text: string, scope?: ParentNode) => {
  const button = buttons(text, scope)[0];
  expect(button, text).toBeTruthy();
  button.click();
};
const chapterRow = (id: string) => [...top().querySelectorAll<HTMLElement>('.mr-sheet-row[data-chapter]')].find((row) => row.dataset.chapter === id)!;
const rows = () => [...top().querySelectorAll<HTMLElement>('.mr-sheet-row[data-file]')];
const row = (path: string) => rows().find((item) => item.title === path)!;
const words = (el: Element) =>
  [...el.querySelectorAll('.mr-sheet-row-title, .mr-sheet-row-meta, .mr-sheet-row-end')].map((part) => part.textContent).join(' | ');
const block = (id: string) => [...top().querySelectorAll<HTMLElement>('.mr-chapter-edit')].find((el) => el.dataset.chapter === id)!;
/** The progress bar: each chapter's segment, as long as its files and filled as they are viewed. */
const bar = () =>
  [...top().querySelectorAll<HTMLElement>('.mr-chapters-bar > span')].map((part) => `${part.style.flexGrow}:${part.querySelector('span')!.style.width}`);
const keys = () => top().querySelector('.mr-sheet-keys')!.textContent;

it('lists the chapters as a numbered path with what is in each, and opens one on top of the list', async () => {
  await h.open(set());
  h.key('m');
  expect(h.q('.mr-chapters').hidden).toBe(false);
  expect(top().getAttribute('aria-label')).toBe('Chapters');
  // No repository behind this review: a heading, and no Library to switch to.
  expect(top().querySelector('.mr-sheet-heading')!.textContent).toBe('Chapters');
  expect(top().querySelector('.mr-sheet-tabs')).toBe(null);
  expect(h.q('.mr-chapters-progress').textContent).toBe('0 of 8 files viewed');
  expect(bar()).toStrictEqual(['1:0%', '1:0%', '2:0%', '1:0%', '1:0%', '1:0%', '1:0%']);
  expect(
    [...top().querySelectorAll<HTMLElement>('.mr-sheet-row[data-chapter]')].map((item) => `${item.querySelector('.mr-sheet-num')!.textContent} ${words(item)}`),
  ).toStrictEqual([
    '1 docs | guide.md | 0/1 viewed',
    '2 docs/rfcs | plan.md | 0/1 viewed',
    '3 src/limits | quota.ts, quota.test.ts | 0/2 viewed',
    '4 old | legacy.ts | 0/1 viewed',
    '5 src/auth | access.ts | 0/1 viewed',
    '6 Supporting files | package-lock.json | 0/1 viewed',
    '7 Other changed files | image.png | 0/1 viewed',
  ]);
  // Nothing viewed yet, the counts are for assistive technology only.
  expect(chapterRow('docs:docs').querySelector('.mr-sheet-row-end')!.classList).toContain('mr-visually-hidden');
  expect(top().querySelector('.mr-sheet-section')!.getAttribute('aria-label')).toBe('Reading path');
  // The keys that work here are at its foot.
  expect(keys()).toBe('↑↓ Move↵ OpenEsc Close');
  // ↓ goes into the list; a chapter opens on top, takes focus, and names the chapters on its Back.
  expect(h.shadow().activeElement).toBe(top());
  h.key('ArrowDown');
  h.key('ArrowDown');
  expect(h.shadow().activeElement).toBe(chapterRow('docs:docs/rfcs'));
  chapterRow('docs:docs/rfcs').click();
  expect(h.shadow().activeElement).toBe(top());
  expect(top().querySelector('.mr-sheet-back')!.getAttribute('aria-label')).toBe('Back to Chapters');
  expect(top().querySelector('.mr-sheet-kicker')!.textContent).toBe('Chapter 2 of 7');
  expect(title()).toBe('docs/rfcs');
  expect(top().querySelector('.mr-sheet-description')!.textContent).toBe('Documents grouped by their folder.');
  expect(top().querySelector('.mr-chapters-count')!.textContent).toBe('0 of 1 file viewed');
  expect(rows().map(words)).toStrictEqual(['plan.md | docs/rfcs · Edited | ']);
  expect(keys()).toBe('↑↓ Move↵ Open←→ ChapterEsc Back');
  // → and ← go to the next and previous chapter in its place, never past the ends; with a modifier they are the browser's.
  const layers = () => h.shadow().querySelectorAll('.mr-chapters > .mr-sheet-layer').length;
  h.key('ArrowRight');
  expect([top().querySelector('.mr-sheet-kicker')!.textContent, title(), layers()]).toStrictEqual(['Chapter 3 of 7', 'src/limits', 2]);
  for (const modifier of ['altKey', 'metaKey', 'ctrlKey']) h.key('ArrowLeft', { [modifier]: true });
  expect(title()).toBe('src/limits');
  h.key('ArrowLeft');
  h.key('ArrowLeft');
  expect(title()).toBe('docs');
  expect(top().querySelector<HTMLButtonElement>('[data-step="previous"]')!.disabled).toBe(true);
  h.key('ArrowLeft');
  expect(title()).toBe('docs');
  // Its buttons do the same, focus staying on the one used while it can go further.
  const next = top().querySelector<HTMLButtonElement>('[data-step="next"]')!;
  expect([next.textContent, next.title]).toStrictEqual(['Next chapter', 'Next chapter (→)']);
  next.focus();
  next.click();
  expect(title()).toBe('docs/rfcs');
  expect(h.shadow().activeElement).toBe(top().querySelector('[data-step="next"]'));
  // Esc goes back to the list, on the chapter it opened; then it closes.
  h.key('Escape');
  expect(title()).toBe(null);
  expect(h.shadow().activeElement).toBe(chapterRow('docs:docs/rfcs'));
  h.key('Escape');
  expect(h.q('.mr-chapters').hidden).toBe(true);
});

it('accounts for disabled, folded, renamed, deleted and platform-only files, and enables selected code', async () => {
  const src = set();
  await h.open(src);
  h.key('m');
  click('All files');
  expect(title()).toBe('All files');
  expect(rows()).toHaveLength(8);
  expect(words(row(source.path))).toBe('quota.ts | src/limits · Edited · Code files off | ');
  expect(words(row(test.path))).toBe(`quota.test.ts | tests · Edited · Test for ${source.path} · matched by name and nearest folder · Code files off | `);
  expect(words(row(renamed.path))).toBe(`access.ts | src/auth · Renamed · from ${renamed.oldPath} · Code files off | `);
  expect(words(row(gone.path))).toBe('legacy.ts | old · Deleted · Code files off | ');
  expect(words(row(image.path))).toBe('image.png | assets · Added · Platform only | ');
  const link = row(image.path) as HTMLAnchorElement;
  expect([link.tagName, link.href, link.rel]).toStrictEqual(['A', src.diffUrl, 'noopener noreferrer']);
  expect(src.load).not.toHaveBeenCalledWith(image);
  link.addEventListener('click', (event) => event.preventDefault());
  link.click();
  expect(h.q('.mr-chapters').hidden).toBe(true);
  h.key('m');
  click('All files');
  row(source.path).click();
  await vi.waitFor(() => expect(h.q('[aria-label="src/limits/quota.ts"] .mr-content')).toBeTruthy());
  expect(h.q('[aria-label="src/limits/quota.ts"]').hidden).toBe(false);
  expect(h.q('.mr-chapters').hidden).toBe(true);
  h.key('m');
  click('All files');
  await vi.waitFor(() => expect(words(row(lock.path))).toContain('Folded'));
  h.key('Escape');
  h.key('Escape');
  expect(h.q('.mr-chapters').hidden).toBe(true);
});

it('counts only explicit Viewed actions, checks off a chapter, and follows the next readable chapter without changing folds', async () => {
  await h.open(set());
  await h.readyViewed();
  h.q('.mr-root').dispatchEvent(new Event('scroll'));
  h.flushFrame();
  h.click('.mr-chapters-toggle');
  expect(h.q('.mr-chapters-progress').textContent).toBe('0 of 8 files viewed');
  click('Start here');
  await h.readyViewed();
  h.key('v');
  await vi.waitFor(() => expect(h.q('.mr-viewed').getAttribute('aria-pressed')).toBe('true'));
  h.key('m');
  expect(h.q('.mr-chapters-progress').textContent).toBe('1 of 8 files viewed');
  expect(bar()).toStrictEqual(['1:100%', '1:0%', '2:0%', '1:0%', '1:0%', '1:0%', '1:0%']);
  // A chapter whose files are all viewed has a check instead of its number, and joins the next by a filled line.
  expect(chapterRow('docs:docs').querySelector('.mr-sheet-num')!.textContent).toBe('');
  expect(chapterRow('docs:docs').querySelector('.mr-sheet-num svg')).toBeTruthy();
  expect(chapterRow('docs:docs').classList).toContain('is-done');
  const done = chapterRow('docs:docs').querySelector('.mr-sheet-row-end')!;
  expect([done.textContent, done.classList.contains('mr-visually-hidden')]).toStrictEqual(['1/1 viewed', true]);
  expect(buttons('Continue here')[0].disabled).toBe(false);
  click('Continue here');
  h.flushFrame();
  h.key('m');
  expect(chapterRow('docs:docs/rfcs').getAttribute('aria-current')).toBe('true');
  chapterRow('docs:docs/rfcs').click();
  expect(row(docs[1].path).getAttribute('aria-current')).toBe('true');
  h.key('Escape');
  h.key('Escape');
  h.click('.mr-chapter-next');
  await h.readyViewed();
  h.key('v');
  await vi.waitFor(() => expect(h.q('.mr-viewed').getAttribute('aria-pressed')).toBe('true'));
  h.key('m');
  expect(chapterRow('code:src/limits').getAttribute('aria-current')).toBe('true');
  // A chapter under way says how far it is, and so does its segment of the bar.
  const under = chapterRow('code:src/limits').querySelector('.mr-sheet-row-end')!;
  expect([under.textContent, under.classList.contains('mr-visually-hidden')]).toStrictEqual(['1/2 viewed', false]);
  expect(bar()[2]).toBe('2:50%');
  h.key('Escape');
  // Explicitly folding and reopening the chapter keeps the original document nodes.
  const section = h.q('[aria-label="src/limits/quota.ts"]');
  await vi.waitFor(() => expect(section.querySelector('[data-act="fold-file"]')).toBeTruthy());
  section.querySelector<HTMLButtonElement>('[data-act="fold-file"]')!.click();
  h.key('m');
  chapterRow('code:src/limits').click();
  expect(words(row(source.path))).toContain('Folded');
  click('Continue chapter');
  expect(section.classList.contains('is-folded')).toBe(true);
});

it('keeps focus on the row it was on while the review changes what the sheet shows', async () => {
  await h.open(set());
  await h.readyViewed();
  h.key('m');
  click('All files');
  row(guide.path).focus();
  // Viewed, chosen in the review beside the sheet, draws the file's row again.
  h.click('.mr-viewed');
  await vi.waitFor(() => expect(row(guide.path).querySelector('.mr-sheet-row-end')!.textContent).toBe('Viewed'));
  expect(h.shadow().activeElement).toBe(row(guide.path));
  h.key('Escape');
  chapterRow('docs:docs').focus();
  h.click('.mr-viewed');
  await vi.waitFor(() => expect(chapterRow('docs:docs').querySelector('.mr-sheet-row-end')!.textContent).toBe('0/1 viewed'));
  expect(h.shadow().activeElement).toBe(chapterRow('docs:docs'));
});

it('preserves failed files in the map and updates their status after retry', async () => {
  let failed = true;
  await h.open(
    set({
      load: vi.fn(async (doc: DocRef) => {
        if (doc === guide && failed) throw new Error('Temporary error');
        return load(doc);
      }),
    }),
  );
  h.key('m');
  chapterRow('docs:docs').click();
  expect(words(row(guide.path))).toContain('Failed to load');
  row(guide.path).click();
  failed = false;
  h.click('[data-act="retry-doc"]');
  await vi.waitFor(() => expect(h.q('[aria-label="docs/guide.md"] .mr-content')).toBeTruthy());
  h.key('m');
  chapterRow('docs:docs').click();
  expect(words(row(guide.path))).not.toContain('Failed to load');
});

it('edits names and introductions, moves chapters and files, and retains the active section and draft', async () => {
  await h.open(set());
  const section = h.q('[aria-label="docs/guide.md"]');
  await h.commentOn();
  h.input('Keep this question for later');
  const editor = h.q<HTMLTextAreaElement>('.mr-composer textarea');
  h.q('.mr-root').focus();
  h.click('.mr-chapters-toggle');
  click('Edit');
  expect(title()).toBe('Edit chapters');
  expect(top().querySelector('.mr-sheet-back')!.getAttribute('aria-label')).toBe('Back to Chapters');
  const name = block('docs:docs').querySelector<HTMLInputElement>('input')!;
  name.value = 'Context and intention';
  name.dispatchEvent(new Event('input'));
  expect(top().querySelector<HTMLSelectElement>('[data-chapter-destination]')!.selectedOptions[0].textContent).toBe(name.value);
  h.input('Read the intent before the implementation.', '[data-chapter="docs:docs"] textarea');
  // The first chapter cannot move earlier; its moves say its new name. Later moves it, says so, and keeps focus on it.
  expect(block('docs:docs').querySelector<HTMLButtonElement>('[aria-label="Move Context and intention earlier"]')!.disabled).toBe(true);
  click('Later', block('docs:docs'));
  expect([...top().querySelectorAll<HTMLElement>('.mr-chapter-edit')].map((el) => el.dataset.chapter).slice(0, 2)).toStrictEqual([
    'docs:docs/rfcs',
    'docs:docs',
  ]);
  expect(h.q('.mr-chapters-feedback').textContent).toBe('Context and intention moved later.');
  expect(h.shadow().activeElement).toBe(block('docs:docs').querySelector('input'));
  expect(h.q('[aria-label="docs/guide.md"]')).toBe(section);
  expect(h.q<HTMLTextAreaElement>('.mr-composer textarea')).toBe(editor);
  expect(editor.value).toBe('Keep this question for later');
  click('Earlier', block('docs:docs'));
  click('New chapter');
  expect(block('custom:1').textContent).toContain('No files yet');
  expect(h.shadow().activeElement).toBe(block('custom:1').querySelector('input'));
  const customName = block('custom:1').querySelector<HTMLInputElement>('input')!;
  customName.value = '';
  customName.dispatchEvent(new Event('input'));
  const form = top().querySelector<HTMLFormElement>('.mr-chapter-assignment')!;
  form.querySelectorAll('select')[0].value = '0';
  form.querySelectorAll('select')[1].value = 'custom:1';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(block('custom:1').textContent).toContain('1 file');
  expect(h.q('.mr-chapters-feedback').textContent).toBe('docs/guide.md moved to Untitled chapter.');
  // Back on the list, the chapters are as edited; a chapter shows what was written for it above its way in.
  h.key('Escape');
  expect(words(chapterRow('custom:1'))).toBe('Untitled chapter | guide.md | 0/1 viewed');
  expect(words(chapterRow('docs:docs'))).toBe('Context and intention | No files yet | 0/0 viewed');
  // All files goes chapter by chapter, leaving out one with none.
  click('All files');
  expect([...top().querySelectorAll('.mr-sheet-subhead')].map((el) => el.textContent)).toStrictEqual([
    '2 · docs/rfcs',
    '3 · src/limits',
    '4 · old',
    '5 · src/auth',
    '6 · Supporting files',
    '7 · Other changed files',
    '8 · Untitled chapter',
  ]);
  h.key('Escape');
  chapterRow('docs:docs').click();
  expect(top().querySelector('.mr-chapter-introduction')!.textContent).toBe('Read the intent before the implementation.');
  expect(top().querySelector('.mr-sheet-note')!.textContent).toBe('No files yet. Move one here in Edit.');
  expect(buttons('Read chapter')[0].disabled).toBe(true);
  h.key('Escape');
  chapterRow('custom:1').click();
  expect(top().querySelector('.mr-sheet-description')!.textContent).toBe('Grouped by you.');
  h.key('Escape');
  // Edit again starts without the last change's message.
  click('Edit');
  expect(h.q('.mr-chapters-feedback').textContent).toBe('');
  click('Reset chapters');
  expect(block('docs:docs').querySelector<HTMLInputElement>('input')!.value).toBe('docs');
  expect(block('custom:1')).toBeUndefined();
  expect(h.q<HTMLTextAreaElement>('.mr-composer textarea').value).toBe('Keep this question for later');
  h.key('Escape');
  h.key('Escape');
  // An explicit file-order setting replaces the custom chapter ordering.
  h.click('[data-act="settings"]');
  h.click('[data-settings-tab="review"]');
  h.click('[data-setting="order"] [data-value="listed"]');
  expect([...h.shadow().querySelectorAll<HTMLElement>('.mr-document')].map((el) => el.getAttribute('aria-label'))).toEqual(
    [...docs, source, test, lock, gone, renamed].map((doc) => doc.path),
  );
});

it('sits beside the review on wide screens: the review keeps its keys, Escape closes the sheet first, Chapters toggles it', async () => {
  await h.open(set());
  const toggle = h.q<HTMLButtonElement>('.mr-chapters-toggle');
  toggle.focus();
  toggle.click();
  expect(h.shadow().activeElement).toBe(top());
  expect(h.q('.mr-root').classList).toContain('has-sheet');
  expect(h.q('.mr-chapters').hasAttribute('aria-modal')).toBe(false);
  expect(h.q('.mr-topbar').inert).not.toBe(true);
  expect(h.q('.mr-main').inert).not.toBe(true);
  // Keys typed in the sheet stay in it; with the review focused, the review has them.
  h.key('a');
  expect(h.q('.mr-toast').hidden).toBe(true);
  h.q('.mr-root').focus();
  h.key('a');
  expect(h.q('.mr-toast').textContent).toBe('Whole files');
  expect(h.q('.mr-chapters').hidden).toBe(false);
  h.key('Escape');
  expect(h.q('.mr-chapters').hidden).toBe(true);
  expect(h.q('.mr-root').classList).not.toContain('has-sheet');
  expect(h.shadow().activeElement).toBe(toggle);
  // Chapters, and the route's Chapters, open the sheet and close it again; so does its backdrop.
  toggle.click();
  toggle.click();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  h.click('.mr-chapter-route button');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  h.click('.mr-chapters-backdrop');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  // Opened again, it starts at the chapters, whatever was open on top when it closed.
  toggle.click();
  chapterRow('docs:docs').click();
  toggle.click();
  toggle.click();
  expect(title()).toBe(null);
  expect(h.shadow().querySelectorAll('.mr-chapters > .mr-sheet-layer')).toHaveLength(1);
  h.close();
  await h.open(review());
  expect(h.q('.mr-chapters-toggle').hidden).toBe(true);
  expect(h.q('.mr-chapter-route').hidden).toBe(true);
  h.key('m');
  expect(h.q('.mr-chapters').hidden).toBe(true);
});

it('covers the review on phones: focus stays in the sheet, the review waits behind it, and focus comes back', async () => {
  const scheme = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', (query: string) => (query.includes('color-scheme') ? scheme : { matches: query.includes('max-width: 760px') }));
  await h.open(set());
  const toggle = h.q<HTMLButtonElement>('.mr-chapters-toggle');
  toggle.focus();
  toggle.click();
  expect(h.q('.mr-chapters').getAttribute('aria-modal')).toBe('true');
  expect(h.q('.mr-topbar').inert).toBe(true);
  // Tab goes round inside the sheet on top: from Close to the last chapter and back.
  const controls = [...top().querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex="0"]')];
  expect([controls[0], controls.at(-1)]).toStrictEqual([top().querySelector('.mr-sheet-close'), chapterRow('other')]);
  controls[0].focus();
  h.key('Tab', { shiftKey: true });
  expect(h.shadow().activeElement).toBe(chapterRow('other'));
  h.key('Tab');
  expect(h.shadow().activeElement).toBe(controls[0]);
  // Reader shortcuts wait while the sheet covers the review.
  h.key('a');
  expect(h.q('.mr-toast').hidden).toBe(true);
  h.key('Escape');
  expect(h.shadow().activeElement).toBe(toggle);
  expect(h.q('.mr-topbar').inert).toBe(false);
  toggle.click();
  h.q('.mr-chapters .mr-sheet-close').click();
  h.q('.mr-root').focus();
  h.q('.mr-root').blur();
  toggle.click();
  h.q('.mr-chapters .mr-sheet-close').click();
  expect(h.shadow().activeElement).toBe(toggle);
});

it('can revisit a fully viewed chapter, skips empty and platform-only chapters, and never invents progress', async () => {
  await h.open(set({ codeDocs: [source, test, lock] }));
  await h.readyViewed();
  h.key('v');
  await vi.waitFor(() => expect(h.q('.mr-viewed').getAttribute('aria-pressed')).toBe('true'));
  h.key('m');
  chapterRow('docs:docs').click();
  click('Continue chapter');
  h.key('m');
  click('Edit');
  for (let step = 0; step < 3; step++) click('Earlier', block('other'));
  click('New chapter');
  for (let step = 0; step < 4; step++) click('Earlier', block('custom:1'));
  h.key('Escape');
  h.key('Escape');
  expect(h.q('.mr-chapter-route').hidden).toBe(false);
  h.click('.mr-chapter-next');
  h.key('m');
  expect(chapterRow('docs:docs/rfcs').getAttribute('aria-current')).toBe('true');
  expect(h.q('.mr-chapters-progress').textContent).toBe('1 of 6 files viewed');
});

it('keeps an unsupported-only review accessible and sanitizes its platform link', async () => {
  await h.open(review({ docs: [], otherFiles: [image, { ...image, path: 'assets/second.png' }], diffUrl: 'javascript:alert(1)' }));
  h.q('.mr-chapters-toggle').click();
  expect(buttons('Start here')[0].disabled).toBe(true);
  click('All files');
  expect(rows()).toHaveLength(2);
  expect(row(image.path).hasAttribute('href')).toBe(false);
  h.key('Escape');
  click('Edit');
  click('Reset chapters');
  expect(h.shadow().activeElement).toBe(block('other').querySelector('input'));
  h.key('Escape');
  h.key('Escape');
  expect(h.q('.mr-chapters').hidden).toBe(true);
});

it('slides the sheet away: closed at once for keys and focus, and drawn only until the slide ends', async () => {
  await h.open(set());
  h.key('m');
  const sheet = h.q('.mr-chapters');
  // The slide in ending changes nothing.
  sheet.dispatchEvent(new Event('animationend'));
  expect(sheet.classList).not.toContain('is-closing');
  h.q('.mr-chapters .mr-sheet-close').click();
  expect([sheet.hidden, sheet.inert, sheet.classList.contains('is-closing')]).toStrictEqual([true, true, true]);
  sheet.dispatchEvent(new Event('animationend'));
  expect(sheet.classList).not.toContain('is-closing');
  // Opening again while it slides away brings it straight back.
  h.key('m');
  h.q('.mr-chapters .mr-sheet-close').click();
  h.key('m');
  expect([sheet.classList.contains('is-closing'), sheet.inert]).toStrictEqual([false, false]);
});

it('narrowing the review keeps the paragraph at the top of the view, and a wide window drops to one column only while it is narrowed', async () => {
  vi.stubGlobal('innerWidth', 1440);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('has-sheet') ? 1000 : 1440;
  });
  await h.open(set());
  const root = h.q('.mr-root');
  const paragraph = h.q('.mr-main [data-mr-u]');
  // The paragraph at the top of the view moves as the text reflows; the view moves with it.
  h.bounds(root, 0);
  const scrolled = vi.spyOn(Element.prototype, 'scrollTop', 'set');
  Object.defineProperty(paragraph, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(360, root.classList.contains('has-sheet') ? 180 : 120, 600, 40),
  });
  h.q('.mr-chapters-toggle').click();
  expect(root.classList).toContain('is-narrowed');
  expect(scrolled).toHaveBeenCalledWith(60);
  h.q('.mr-chapters .mr-sheet-close').click();
  expect(root.classList).not.toContain('is-narrowed');
});

it('the review slides aside with the sheet as it opens, and back as it closes', async () => {
  await h.open(set());
  const root = h.q('.mr-root');
  const article = h.q('.mr-article');
  // Narrowed, the text starts further left; it slides there instead of jumping.
  Object.defineProperty(article, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(root.classList.contains('has-sheet') ? 160 : 320, 0, 680, 400),
  });
  const animate = vi.fn();
  Object.defineProperty(article, 'animate', { configurable: true, value: animate });
  h.q('.mr-chapters-toggle').click();
  expect(root.classList).toContain('has-sheet');
  expect(animate).toHaveBeenLastCalledWith([{ transform: 'translateX(160px)' }, { transform: 'translateX(0)' }], expect.objectContaining({ duration: 280 }));
  h.q('.mr-chapters .mr-sheet-close').click();
  expect(animate).toHaveBeenLastCalledWith([{ transform: 'translateX(-160px)' }, { transform: 'translateX(0)' }], expect.objectContaining({ duration: 220 }));
});
