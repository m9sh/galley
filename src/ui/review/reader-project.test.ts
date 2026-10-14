import { expect, it, vi } from 'vitest';
import { MAX_DOCUMENT_CHARS } from '../../core/limits.ts';
import type { DocRef, ReviewProject } from '../../platforms/types.ts';
import { guide, readerHarness, review } from '../../testing/reader.ts';
import { handbook, repository, words } from '../../testing/repo.ts';

// Drawing diagrams happens in a sandboxed frame (diagrams.ts); here it finishes at once.
const drawn = vi.hoisted(() => ({ renderDiagrams: vi.fn() }));
vi.mock('../rendering/diagrams.ts', async (original) => ({
  ...(await original<typeof import('../rendering/diagrams.ts')>()),
  renderDiagrams: drawn.renderDiagrams,
}));

const ui = readerHarness();
const repoShadow = () => document.querySelector('#galley-repo-reader')?.shadowRoot ?? null;
const all = (selector: string, scope: ParentNode = ui.shadow()) => [...scope.querySelectorAll<HTMLElement>(selector)];
/** The sheet on top of the stack, which has the keys. */
const top = () =>
  all('.mr-chapters > .mr-sheet-layer')
    .filter((layer) => !layer.hidden)
    .at(-1)!;
const inTop = <T extends HTMLElement = HTMLElement>(selector: string) => top().querySelector<T>(selector)!;
const text = (selector: string) => words(inTop(selector));
const title = () => top().querySelector('.mr-sheet-title')?.textContent ?? null;
/** Everything read: how much, at the foot of the Library's list. */
const footnote = () => top().querySelector('.mr-docs-footnote')?.textContent ?? '';
/** A section of the sheet on top, by its title. */
const section = (name: string) => all('.mr-sheet-section', top()).find((el) => el.getAttribute('aria-label') === name);
const chapter = (id: string) => all('.mr-sheet-row[data-chapter]', top()).find((row) => row.dataset.chapter === id)!;
const row = (path: string) => all('.mr-sheet-row[data-path]', top()).find((el) => el.dataset.path === path)!;
const back = () => inTop('.mr-sheet-back').click();
const tab = (name: 'chapters' | 'library') => ui.click(`.mr-sheet-tab[data-tab="${name}"]`);
const HEAD = 'bead000000000000000000000000000000000000';

/** The handbook with the changed guide and a document that links to it, a section and the handbook. */
const context: Record<string, string> = {
  'docs/context.md':
    '# Context\n\nRead [the guide](guide.md), the [handbook](../README.md), [its choice](#choice) and [the site](https://example.org).\n\n## Choice\n\nChoose deliberately.\n\n```mermaid\nflowchart LR\n  A --> B\n```',
  ...handbook,
  'docs/guide.md': '# Guide\n\nThe limit is 20 euros.',
};

function project(files: Record<string, string> = handbook): ReviewProject {
  return {
    head: { ref: 'feature/guide', commit: HEAD },
    open: vi.fn(() => repository(files, { commit: HEAD, pinned: true })),
  };
}

/** Open the review's chapters at the guide's chapter, and read the repository's docs with Find linked docs. */
async function readDocs(files: Record<string, string>, docs: DocRef[] = [guide]) {
  await ui.open(review({ docs, project: project(files) }));
  ui.click('.mr-chapters-toggle');
  chapter('docs:docs').click();
  inTop('.mr-docs-find').click();
  // Everything read, the chapter has nothing more to offer.
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-status')).toBe(null));
}

it('a review without its repository has chapters only: no Library and no docs', async () => {
  await ui.open(review({ docs: [guide, { ...guide, path: 'README.md' }] }));
  ui.click('.mr-chapters-toggle');
  expect(text('.mr-sheet-heading')).toBe('Chapters');
  expect(ui.q('.mr-sheet-tabs')).toBe(null);
  chapter('docs:docs').click();
  expect(all('.mr-sheet-section-title', top()).map(words)).toStrictEqual(['Changed files']);
  expect(ui.q('.mr-docs-status')).toBe(null);
  expect(ui.q('[data-act="project"]')).toBe(null);
});

it('Chapters and Library share one sheet: the Library is the repository as the change leaves it, read when opened, and searchable', async () => {
  const behind = project();
  await ui.open(review({ project: behind }));
  // No Library in the top bar: the chapters and the docs are one place.
  expect(ui.q('[data-act="project"]')).toBe(null);
  ui.click('.mr-chapters-toggle');
  expect(all('.mr-sheet-tab').map((el) => [el.textContent, el.getAttribute('aria-pressed')])).toStrictEqual([
    ['Chapters', 'true'],
    ['Library', 'false'],
  ]);
  // A chapter offers to find the docs that link to its files; nothing is read until the reviewer asks.
  chapter('docs:docs').click();
  expect(words(section('Docs that link here')!)).toBe('Docs that link here Find linked docs Galley reads the repository only when you ask');
  expect(behind.open).not.toHaveBeenCalled();
  ui.key('Escape');
  // Opening the Library is asking for it: the repository is read at the review's head, and the switch keeps focus.
  const library = ui.q('.mr-sheet-tab[data-tab="library"]');
  library.focus();
  library.click();
  expect(ui.shadow().activeElement).toBe(library);
  expect(library.getAttribute('aria-pressed')).toBe('true');
  expect(top().getAttribute('aria-label')).toBe('Library');
  expect(text('.mr-sheet-description')).toBe('As this change leaves them · feature/guide @ bead000');
  expect([inTop('.mr-docs-full').getAttribute('aria-label'), inTop('.mr-docs-full').title]).toStrictEqual([
    'Open the full library',
    'Open the full library, with its map and notes',
  ]);
  expect(text('.mr-sheet-keys')).toBe('/ Search ↑ ↓ Move ↵ Open Esc Close');
  expect(behind.open).toHaveBeenCalledOnce();
  expect(text('.mr-docs-line')).toBe('Reading the docs…');
  await vi.waitFor(() => expect(footnote()).toBe('Built from all 3 documents at bead000.'));
  expect(top().querySelector<HTMLElement>('.mr-docs-status')!.hidden).toBe(true);
  // Nothing here links to the guide, so every document, by folder.
  expect(text('.mr-docs-results')).toBe(
    'All documents 3 Top folder Handbook README.md docs/adr ADR 1: Use Markdown 0001-use-markdown.md docs/specs Reading reading.md Built from all 3 documents at bead000.',
  );
  // / goes to the search; ↓ from it goes into the results.
  const search = inTop<HTMLInputElement>('.mr-sheet-search input');
  expect(search.getAttribute('aria-label')).toBe('Search the docs');
  ui.key('/');
  expect(ui.shadow().activeElement).toBe(search);
  const find = (query: string) => {
    search.value = query;
    search.dispatchEvent(new Event('input'));
    return text('.mr-docs-results');
  };
  expect(find('goals')).toBe('Results 1 Reading docs/specs/reading.md · “Goals”');
  expect(find('use markdown')).toBe('Results 1 ADR 1: Use Markdown docs/adr/0001-use-markdown.md');
  expect(find('nothing')).toBe('Results 0 No document matches “nothing”.');
  find('goals');
  ui.key('ArrowDown');
  const opened = row('docs/specs/reading.md');
  expect(ui.shadow().activeElement).toBe(opened);
  // The search is kept while a document is read on top, and Back returns to it, on the row it was opened from.
  opened.click();
  expect(title()).toBe('Reading');
  expect(inTop('.mr-sheet-back').getAttribute('aria-label')).toBe('Back to Library');
  back();
  expect(search.value).toBe('goals');
  expect(ui.shadow().activeElement).toBe(opened);
  // Chapters again: what was read is there, and nothing is read twice.
  tab('chapters');
  expect(words(chapter('docs:docs').querySelector('.mr-sheet-row-meta')!)).toBe('guide.md');
  chapter('docs:docs').click();
  expect(words(section('Docs that link here')!)).toBe('Docs that link here No document read so far links to these files.');
  ui.key('Escape');
  tab('library');
  expect(inTop<HTMLInputElement>('.mr-sheet-search input').value).toBe('goals');
  expect(behind.open).toHaveBeenCalledOnce();
});

it('the Library puts the docs that link to the review first, and long lists a page at a time', async () => {
  const notes = Object.fromEntries(Array.from({ length: 101 }, (_, at) => [`notes/n${String(at).padStart(3, '0')}.md`, `# Note ${at}`]));
  const files = { ...notes, 'docs/both.md': '# Both\n\nThe [guide](guide.md) and the [readme](../README.md).' };
  const behind = project(files);
  const source = repository(files, { commit: HEAD, pinned: true });
  vi.mocked(behind.open).mockReturnValue(source);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(source.load).mockImplementation(async (path) => {
    if (path === 'notes/n000.md') await waiting;
    return files[path as keyof typeof files];
  });
  await ui.open(review({ docs: [guide, { ...guide, path: 'README.md' }, { ...guide, path: 'docs/both.md' }], project: behind }));
  ui.click('.mr-chapters-toggle');
  tab('library');
  // Listed, not yet read: every document can be found and read already.
  await vi.waitFor(() => expect(source.load).toHaveBeenCalledWith('notes/n000.md'));
  tab('chapters');
  tab('library');
  expect(all('.mr-docs-results .mr-sheet-section-title', top()).map(words)).toStrictEqual(['All documents']);
  row('notes/n001.md').click();
  expect(section('Links to this review')).toBeUndefined();
  back();
  release();
  await vi.waitFor(() => expect(footnote()).toBe('Built from all 102 documents at bead000.'));
  const [linked, everything] = all('.mr-docs-results > .mr-sheet-section', top());
  expect(words(linked)).toBe('Linked to this review 1 Both Changed in this review · links to 2 files');
  expect(everything.querySelectorAll('.mr-sheet-row')).toHaveLength(100);
  expect(text('.mr-docs-more')).toBe('Show 2 more of 102');
  inTop('.mr-docs-more').click();
  expect(all('.mr-docs-results > .mr-sheet-section', top())[1].querySelectorAll('.mr-sheet-row')).toHaveLength(102);
  expect(top().querySelector('.mr-docs-more')).toBe(null);
});

it('a document opens on top of its chapter: its links to the review, then the document; a document it links to opens on top of it', async () => {
  await readDocs(context);
  expect(words(section('Docs that link here')!)).toBe('Docs that link here 1 Context Worth checking');
  const opened = inTop('[data-context-key="doc:docs/context.md"]');
  opened.focus();
  opened.click();
  expect(ui.shadow().activeElement).toBe(top());
  expect(words(inTop('.mr-sheet-header'))).toBe('docs Close Worth checking Context docs/context.md · bead000');
  expect(inTop('.mr-sheet-back').getAttribute('aria-label')).toBe('Back to docs');
  expect([inTop('.mr-docs-full').getAttribute('aria-label'), inTop('.mr-docs-full').title]).toStrictEqual([
    'Read it in the full library',
    'Read it in the full library, with its map and notes',
  ]);
  const evidence = () => section('Links to this review')!.querySelector<HTMLElement>('.mr-sheet-row')!;
  expect(words(section('Links to this review')!)).toBe('Links to this review 1 “the guide” Links to guide.md Line 3');
  // Before the document is drawn there is nothing to show yet.
  expect(text('.mr-docs-doc')).toBe('Opening the document…');
  evidence().click();
  expect(top().querySelector('.mr-flash')).toBe(null);
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-doc .mr-content')).toBeTruthy());
  // Its title is in the sheet's header, not repeated.
  expect(top().querySelector('.mr-docs-doc h1')).toBe(null);
  // Esc goes back to the chapter, on the document it opened.
  let settle = () => {};
  drawn.renderDiagrams.mockImplementation((_diagrams: unknown, _dark: boolean, changed: () => void) => {
    settle = changed;
  });
  ui.key('Escape');
  expect(title()).toBe('docs');
  expect(ui.shadow().activeElement).toBe(opened);
  // Its diagram is drawn as the review draws them.
  opened.click();
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-doc .mr-content')).toBeTruthy());
  const box = inTop('.mr-docs-doc');
  const [diagrams] = drawn.renderDiagrams.mock.lastCall!;
  expect((diagrams as Array<{ el: HTMLElement }>).map((diagram) => box.contains(diagram.el))).toStrictEqual([true]);
  // Drawn before anything was shown in the document, a diagram moves nothing.
  const body = inTop('.mr-sheet-body');
  const start = body.scrollTop;
  settle();
  expect(body.scrollTop).toBe(start);
  // The evidence shows its paragraph, a section link its section.
  evidence().click();
  expect(box.querySelector('.mr-flash')!.textContent).toMatch(/^Read the guide/);
  // A diagram that finishes drawing above it moves it: it is shown again, until the reader scrolls.
  const shown = body.scrollTop;
  ui.bounds(body, 0);
  ui.bounds(box.querySelector('.mr-flash')!, 116);
  settle();
  expect(body.scrollTop).toBe(shown + 100);
  body.scrollTop = 5;
  settle();
  expect(body.scrollTop).toBe(5);
  box.querySelector('.mr-flash')!.dispatchEvent(new Event('animationend'));
  expect(box.querySelector('.mr-flash')).toBe(null);
  box.querySelector<HTMLElement>('a[href="#choice"]')!.click();
  expect(words(box.querySelector('.mr-flash')!)).toBe('Choice');
  // A link that leaves the docs, or one opened in a new tab, is the browser's.
  const followed = (link: Element, init: MouseEventInit = {}) => {
    let prevented = false;
    body.addEventListener(
      'click',
      (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    return prevented;
  };
  expect(followed(box.querySelector('a[href="https://example.org"]')!)).toBe(false);
  expect(followed(box.querySelector('a[data-mr-path="README.md"]')!, { metaKey: true })).toBe(false);
  expect(followed(box.querySelector('.mr-content p')!)).toBe(false);
  expect(title()).toBe('Context');
  // A link to another document opens it on top, so Esc goes back through the documents the reader came from.
  const left = settle;
  expect(followed(box.querySelector('a[data-mr-path="README.md"]')!)).toBe(true);
  expect(title()).toBe('Handbook');
  expect(all('.mr-chapters > .mr-sheet-layer')).toHaveLength(4);
  expect(inTop('.mr-sheet-back').getAttribute('aria-label')).toBe('Back to Context');
  expect(ui.shadow().activeElement).toBe(top());
  ui.key('Escape');
  expect(title()).toBe('Context');
  ui.key('Escape');
  expect(title()).toBe('docs');
  expect(ui.shadow().activeElement).toBe(opened);
  // Once its sheet has gone, a diagram of the document that finishes moves nothing.
  const gone = ui.q<HTMLElement>('.mr-chapters > .mr-sheet-layer.is-leaving');
  gone.dispatchEvent(new Event('animationend'));
  const chapterBody = inTop('.mr-sheet-body');
  chapterBody.scrollTop = 7;
  left();
  expect(chapterBody.scrollTop).toBe(7);
  // Closing the sheet and opening it again starts at the chapters, which say how many docs link to each.
  ui.click('.mr-chapters-toggle');
  ui.click('.mr-chapters-toggle');
  expect(title()).toBe(null);
  expect(ui.q('.mr-sheet-tab[data-tab="chapters"]').getAttribute('aria-pressed')).toBe('true');
  expect(words(chapter('docs:docs').querySelector('.mr-sheet-row-meta')!)).toBe('guide.md · 1 doc');
});

it('the full library reads the document with its map and notes; the review and the sheet wait, and Continue chapter carries on', async () => {
  await readDocs(context, [guide, { ...guide, path: 'README.md' }]);
  ui.q('.mr-root').scrollTop = 460;
  inTop('[data-context-key="doc:docs/context.md"]').click();
  const open = inTop('.mr-docs-full');
  open.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Context'));
  expect(words(repoShadow()!.querySelector('.mr-review-route')!)).toBe('From the review chapter docs Continue chapter');
  // This review says which chapter it came from, too.
  repoShadow()!.querySelector<HTMLButtonElement>('[data-view="review"]')!.click();
  await vi.waitFor(() => expect(repoShadow()!.querySelector('.mr-repo-review .mr-review-route')).toBeTruthy());
  repoShadow()!.querySelector<HTMLButtonElement>('.mr-repo-return')!.click();
  expect(repoShadow()).toBe(null);
  expect(ui.shadow().activeElement).toBe(open);
  expect(title()).toBe('Context');
  expect(ui.q('.mr-root').scrollTop).toBe(460);
  open.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Context'));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="continue-chapter"]')!.click();
  expect(repoShadow()).toBe(null);
  expect(ui.q('.mr-chapters').hidden).toBe(true);
  // From a chapter the reader is not in, Continue chapter starts it.
  ui.click('.mr-chapters-toggle');
  chapter('docs:').click();
  inTop('[data-context-key="doc:docs/context.md"]').click();
  inTop('.mr-docs-full').click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Context'));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="continue-chapter"]')!.click();
  expect(ui.q('.mr-chapters').hidden).toBe(true);
  // Opened from the Library rather than a chapter, a document has no chapter to carry on with.
  ui.click('.mr-chapters-toggle');
  tab('library');
  row('README.md').click();
  inTop('.mr-docs-full').click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Handbook'));
  expect(repoShadow()!.querySelector('[data-act="continue-chapter"]')).toBe(null);
  ui.close();
  expect(repoShadow()).toBe(null);
});

it('a document that cannot be read says why and links to the platform; one that arrives after leaving it changes nothing', async () => {
  const files: Record<string, string> = {
    ...handbook,
    'docs/offline.md': '',
    'docs/huge.md': 'x'.repeat(MAX_DOCUMENT_CHARS + 1),
    'docs/slow.md': '',
    'docs/late.md': '',
  };
  const behind = project(files);
  const source = repository(files, { commit: HEAD, pinned: true });
  vi.mocked(behind.open).mockReturnValue(source);
  const pending = new Map<string, { resolve(text: string): void; reject(err: unknown): void }>();
  const calls = new Map<string, number>();
  vi.mocked(source.load).mockImplementation((path) => {
    calls.set(path, (calls.get(path) ?? 0) + 1);
    if (path === 'docs/offline.md') return Promise.reject(new Error('The platform did not answer.'));
    // The slow and late documents fail once while the docs are read, then wait when opened.
    if ((path === 'docs/slow.md' || path === 'docs/late.md') && calls.get(path)! > 1)
      return new Promise((resolve, reject) => pending.set(path, { resolve, reject }));
    if (path === 'docs/slow.md' || path === 'docs/late.md') return Promise.reject('busy');
    return Promise.resolve(files[path]);
  });
  await ui.open(review({ project: behind }));
  ui.click('.mr-chapters-toggle');
  tab('library');
  await vi.waitFor(() => expect(footnote()).toBe('Built from all 7 documents at bead000. 3 documents could not be read. 1 document is too large to read.'));
  row('docs/offline.md').click();
  await vi.waitFor(() => expect(text('.mr-docs-doc')).toBe('The platform did not answer. Open on GitHub'));
  expect(inTop<HTMLAnchorElement>('.mr-docs-doc a').href).toBe('https://github.com/acme/handbook/blob/c0ffee1/docs/offline.md');
  back();
  row('docs/huge.md').click();
  await vi.waitFor(() => expect(text('.mr-docs-doc')).toBe('This document is too large for the reader. Open on GitHub'));
  back();
  // Gone back from before it arrived, a document is not drawn, whether it arrives or fails.
  row('docs/slow.md').click();
  back();
  pending.get('docs/slow.md')!.resolve('# Slow');
  row('docs/late.md').click();
  back();
  pending.get('docs/late.md')!.reject(new Error('Too late.'));
  await ui.tick();
  expect(top().getAttribute('aria-label')).toBe('Library');
  // Only the late one's sheet is still sliding away, as it was left.
  expect(all('.mr-docs-doc').map(words)).toStrictEqual(['Opening the document…']);
  // Opened again, the slow document is read from what arrived.
  row('docs/slow.md').click();
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-doc .mr-content')).toBeTruthy());
  expect(inTop('.mr-docs-doc .mr-content').childElementCount).toBe(0);
});

it('Find linked docs reads the repository at the review’s head when asked, and fills each chapter with what links to its files', async () => {
  const behind = project();
  const many = Object.fromEntries(Array.from({ length: 151 }, (_, at) => [`docs/notes/n${String(at).padStart(3, '0')}.md`, `# Note ${at}`]));
  const files = { 'docs/context.md': '# Context\n\nRead [the guide](guide.md).', ...many };
  let release!: () => void;
  const later = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listed = repository(files, { pinned: true, commit: HEAD });
  const discover = listed.discover;
  vi.mocked(listed.discover)
    .mockRejectedValueOnce(new Error('GitHub did not answer.'))
    .mockImplementationOnce(async () => {
      await later;
      return discover();
    });
  vi.mocked(behind.open).mockReturnValue(listed);
  await ui.open(review({ project: behind }));
  ui.click('.mr-chapters-toggle');
  chapter('docs:docs').click();
  expect(behind.open).not.toHaveBeenCalled();
  // A listing that fails says why, and can be tried again; focus waits in the status, which says when reading ends.
  inTop('.mr-docs-find').click();
  expect(ui.shadow().activeElement).toBe(inTop('.mr-docs-line'));
  await vi.waitFor(() => expect(text('.mr-docs-line')).toBe('GitHub did not answer.'));
  expect(ui.shadow().activeElement).toBe(inTop('.mr-docs-line'));
  expect(text('.mr-docs-find')).toBe('Try again Read the repository’s docs again');
  inTop('.mr-docs-find').click();
  expect(text('.mr-docs-line')).toBe('Reading the docs…');
  expect(ui.shadow().activeElement).toBe(inTop('.mr-docs-line'));
  expect(top().querySelector('.mr-docs-find')).toBe(null);
  // Focus stays where the reader was while the chapter is drawn again: on the chapter, for a control without a place of its own.
  all('button', top())
    .find((control) => control.textContent === 'Read chapter')!
    .focus();
  release();
  await vi.waitFor(() => expect(text('.mr-docs-line')).toMatch(/^Built from 150 of 152 documents at bead000\./));
  expect(ui.shadow().activeElement).toBe(top());
  expect(words(section('Docs that link here')!)).toMatch(
    /^Docs that link here 1 Context Worth checking Built from 150 of 152 .* Read more 2 documents not read yet$/,
  );
  // A document not read yet is still listed, by its file name, and can be read.
  ui.key('Escape');
  tab('library');
  const search = inTop<HTMLInputElement>('.mr-sheet-search input');
  search.value = 'n149';
  search.dispatchEvent(new Event('input'));
  expect(text('.mr-docs-results')).toBe('Results 1 n149 docs/notes/n149.md');
  row('docs/notes/n149.md').click();
  expect(title()).toBe('n149');
  back();
  tab('chapters');
  // Read more: the rest, a batch at a time; a document's row keeps focus.
  chapter('docs:docs').click();
  inTop('.mr-docs-find').click();
  inTop('[data-context-key="doc:docs/context.md"]').focus();
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-status')).toBe(null));
  expect(ui.shadow().activeElement).toBe(inTop('[data-context-key="doc:docs/context.md"]'));
  expect(behind.open).toHaveBeenCalledOnce();
  // Everything read, the reading the reader asked for ends on the chapter.
  await ui.open(review({ project: project({ 'docs/context.md': '# Context\n\nRead [the guide](guide.md).' }) }));
  ui.click('.mr-chapters-toggle');
  chapter('docs:docs').click();
  inTop('.mr-docs-find').click();
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-status')).toBe(null));
  expect(ui.shadow().activeElement).toBe(top());
  // Docs that arrive after the sheet closed are kept for when it opens again; after the review closed, nothing.
  const fewer = Object.fromEntries(Object.entries(files).filter(([path]) => path !== 'docs/notes/n150.md'));
  await ui.open(review({ project: project(fewer) }));
  ui.click('.mr-chapters-toggle');
  chapter('docs:docs').click();
  inTop('.mr-docs-find').click();
  ui.click('.mr-chapters-toggle');
  await vi.waitFor(() => expect(text('.mr-docs-line')).toMatch(/^Built from 150 of 151/));
  ui.click('.mr-chapters-toggle');
  chapter('docs:docs').click();
  expect(words(section('Docs that link here')!)).toMatch(/^Docs that link here 1 Context Worth checking .* Read more 1 document not read yet$/);
  inTop('.mr-docs-find').click();
  ui.close();
});

it('the full library leaves the review layout, paragraph, folds, Viewed and comment draft intact', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ layout: 'review' }));
  await ui.open(review({ project: project() }));
  await ui.readyViewed();
  await ui.commentOn();
  ui.input('Check the rationale before posting');
  ui.click('.mr-chapters-toggle');
  tab('library');
  ui.q('.mr-root').scrollTop = 460;
  const before = {
    layout: ui.q('.mr-root').dataset.layout,
    viewed: ui.q('.mr-viewed').getAttribute('aria-pressed'),
    folds: all('[data-act="fold"]').map((el) => el.getAttribute('aria-checked')),
  };
  expect(before.layout).toBe('review');
  const full = inTop('.mr-docs-full');
  full.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-repo-review .mr-map-head .mr-title')?.textContent).toBe('This review'));
  const library = repoShadow()!;
  expect(library.querySelector<HTMLElement>('.mr-root')!.dataset.layout).toBe('focus');
  library.querySelector<HTMLElement>('[data-setting="layout"] [data-value="wide"]')!.click();
  expect(library.querySelector<HTMLElement>('.mr-root')!.dataset.layout).toBe('wide');
  expect(JSON.parse(localStorage.getItem('galley:settings')!).layout).toBe('review');
  library
    .querySelector<HTMLElement>('.mr-root')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
  expect(repoShadow()).toBeNull();
  expect(ui.q('.mr-root').dataset.layout).toBe(before.layout);
  expect(ui.q('.mr-root').scrollTop).toBe(460);
  expect(ui.q('.mr-viewed').getAttribute('aria-pressed')).toBe(before.viewed);
  expect(all('[data-act="fold"]').map((el) => el.getAttribute('aria-checked'))).toEqual(before.folds);
  expect(ui.q<HTMLTextAreaElement>('.mr-composer textarea').value).toBe('Check the rationale before posting');
  expect(ui.shadow().activeElement).toBe(full);
  // What the full library read is shown in the sheet too.
  expect(footnote()).toMatch(/^Built from all 3 documents/);
});

it('a section added to a chapter in the full library shows in that chapter, opens in the sheet at its heading, and can be removed', async () => {
  await ui.open(review({ project: project(context) }));
  ui.click('.mr-chapters-toggle');
  tab('library');
  await vi.waitFor(() => expect(footnote()).toMatch(/^Built from all/));
  inTop('.mr-docs-full').click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  const library = repoShadow()!;
  // On This review's map, the document's sheet reads it in full.
  library.querySelector<HTMLButtonElement>('.mr-repo-review .mr-pm-place[data-id="docs/context.md"]')!.click();
  library.querySelector<HTMLButtonElement>('.mr-doc-sheet [data-act="open"]')!.click();
  await vi.waitFor(() => expect(library.querySelector('.mr-lead')?.textContent).toBe('Context'));
  const form = library.querySelector<HTMLFormElement>('.mr-chapter-attachment form')!;
  form.querySelector<HTMLSelectElement>('[aria-label="Chapter for this document"]')!.value = 'docs:docs';
  form.querySelector<HTMLSelectElement>('[aria-label="Section to add"]')!.value = 'choice';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(form.querySelector('[role="status"]')!.textContent).toBe('Added to docs.');
  // This review lists it under its chapter, as something the reader added, never as a link.
  library.querySelector<HTMLButtonElement>('[data-view="review"]')!.click();
  library.querySelector<HTMLButtonElement>('.mr-repo-review [data-act="pm-view-list"]')!.click();
  expect(words(library.querySelector('.mr-pm-attachment')!)).toBe('Context — Choice Added by you · bead000');
  library.querySelector<HTMLButtonElement>('.mr-repo-return')!.click();
  tab('chapters');
  chapter('docs:docs').click();
  expect(words(section('Docs that link here')!)).toBe('Docs that link here 1 Context Worth checking');
  expect(words(section('Added by you')!)).toBe('Added by you 1 Context — Choice Added by you · bead000 Remove');
  const attached = inTop('[data-context-key="attached:docs/context.md:choice"]');
  attached.focus();
  attached.click();
  await vi.waitFor(() => expect(words(inTop('.mr-docs-doc .mr-flash'))).toBe('Choice'));
  ui.key('Escape');
  expect(ui.shadow().activeElement).toBe(attached);
  const remove = inTop('[aria-label="Remove Context — Choice from this chapter"]');
  remove.focus();
  remove.click();
  expect(section('Added by you')).toBeUndefined();
  expect(ui.shadow().activeElement).toBe(top());
  // A section that is not in the document opens it at its beginning.
  inTop('[data-context-key="doc:docs/context.md"]').click();
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-doc .mr-content')).toBeTruthy());
  inTop('.mr-docs-doc a[href="#choice"]').setAttribute('href', '#missing');
  inTop('.mr-docs-doc a[href="#missing"]').click();
  expect(top().querySelector('.mr-docs-doc .mr-flash')).toBe(null);
});

it('a whole document without a title can be added to a chapter, and opens in the sheet at its beginning', async () => {
  await ui.open(review({ project: project({ ...handbook, 'CONTEXT.md': 'Only a paragraph.' }) }));
  ui.click('.mr-chapters-toggle');
  tab('library');
  await vi.waitFor(() => expect(footnote()).toMatch(/^Built from all/));
  inTop('.mr-docs-full').click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-view="read"]')!.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-lead')?.textContent).toBe('Handbook'));
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="docs"]')!.click();
  repoShadow()!.querySelector<HTMLButtonElement>('[data-act="open"][data-path="CONTEXT.md"]')!.click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-doc .mr-title')?.textContent).toBe('CONTEXT'));
  repoShadow()!
    .querySelector<HTMLFormElement>('.mr-chapter-attachment form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  repoShadow()!.querySelector<HTMLButtonElement>('.mr-repo-return')!.click();
  tab('chapters');
  chapter('docs:docs').click();
  const attached = inTop('[data-context-key="attached:CONTEXT.md:"]');
  expect(words(attached)).toBe('CONTEXT Added by you · bead000');
  attached.click();
  await vi.waitFor(() => expect(text('.mr-docs-doc')).toBe('Only a paragraph.'));
  expect(top().querySelector('.mr-docs-doc .mr-flash')).toBe(null);
});

it('docs the full library found show in the chapters even when the sheet could not list them, and open there', async () => {
  const behind = project(context);
  const source = repository(context, { commit: HEAD, pinned: true });
  vi.mocked(source.discover).mockRejectedValueOnce(new Error('GitHub did not answer.'));
  vi.mocked(behind.open).mockReturnValue(source);
  await ui.open(review({ project: behind }));
  ui.click('.mr-chapters-toggle');
  tab('library');
  await vi.waitFor(() => expect(text('.mr-docs-line')).toBe('GitHub did not answer.'));
  inTop('.mr-docs-full').click();
  await vi.waitFor(() => expect(repoShadow()?.querySelector('.mr-review-status .mr-map-status')?.textContent).toMatch(/^Built from all/));
  repoShadow()!.querySelector<HTMLButtonElement>('.mr-repo-return')!.click();
  tab('chapters');
  chapter('docs:docs').click();
  inTop('[data-context-key="doc:docs/context.md"]').click();
  // Named by its file until it is read here.
  expect(title()).toBe('context');
  await vi.waitFor(() => expect(top().querySelector('.mr-docs-doc .mr-content')).toBeTruthy());
});
