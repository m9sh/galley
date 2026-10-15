import { expect, it, vi } from 'vitest';
import { deferred } from '../../testing/reader.ts';
import { handbook, listing, repoHarness, repository } from '../../testing/repo.ts';
import { readConfig } from '../sandbox/config-frame.ts';
import type { ReviewContext } from './repo-reader-shared.ts';
import { ChapterContext } from '../../core/review-context.ts';

const drawn = vi.hoisted(() => ({ renderDiagrams: vi.fn(), highlightCode: vi.fn(async () => {}) }));
vi.mock('../rendering/diagrams.ts', async (original) => ({
  ...(await original<typeof import('../rendering/diagrams.ts')>()),
  renderDiagrams: drawn.renderDiagrams,
}));
vi.mock('../rendering/code.ts', async (original) => ({ ...(await original<typeof import('../rendering/code.ts')>()), highlightCode: drawn.highlightCode }));
const frame = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./configs.ts', () => ({ readConfiguration: frame.read }));
frame.read.mockImplementation(async (_host: unknown, path: string, format: Parameters<typeof readConfig>[1], text: string) => readConfig(path, format, text));

const ui = repoHarness();
const spec = 'docs/specs/reading.md';
const decision = 'docs/adr/0001-use-markdown.md';
const files: Record<string, string> = {
  ...handbook,
  'docs/architecture/rendering.md': '# Rendering\n\nThe [renderer](../../src/render.ts) draws documents. See [the spec](../specs/reading.md).',
  'NOTES.md': '# Field notes\n\nWatch [render.ts](src/render.ts).\n\nAnd [](src/render.ts).',
  'docker-compose.yml': 'services:\n  web:\n    image: shop/web\n',
};
const review: ReviewContext = {
  title: 'Fix rendering',
  ref: 'feature/render',
  chapters: [
    { title: 'Reading', paths: [spec, decision] },
    { title: 'Code', paths: ['src/render.ts', 'docker-compose.yml'] },
  ],
};

it('a repository read on its own has no review view', async () => {
  await ui.openMap(repository());
  expect(ui.all('.mr-lens-switch button').map((b) => b.textContent)).toStrictEqual(['Documents', 'Architecture', 'Infrastructure', 'Decisions']);
  expect(ui.q('[data-act="close"]').title).toBe('Close reader (Esc)');
});

it('opened from a review, the reader starts at what it changes, on the map: its files between what links to them and what they link to', async () => {
  const onClose = vi.fn();
  await ui.open(repository(files, { pinned: true }), { review, onClose });
  // The way back leads the top bar, in place of Close.
  expect(ui.q('.mr-tb-left [data-act="close"]').getAttribute('aria-label')).toBe('Return to review (Esc)');
  expect(ui.q('.mr-tb-left [data-act="close"]').classList).toContain('mr-repo-return');
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-map-status').textContent).toMatch(/^Built from all 5 documents/));
  // This review comes first in the map's switch, chosen; the review is named at the commit read.
  expect(ui.q('.mr-root').classList).toContain('is-map-space');
  expect(ui.text('.mr-repo-review .mr-map-head .mr-title')).toBe('Project map');
  expect(ui.all('.mr-repo-review .mr-lens-switch button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toStrictEqual([
    ['This review', 'true'],
    ['Documents', 'false'],
    ['Architecture', 'false'],
    ['Infrastructure', 'false'],
    ['Decisions', 'false'],
  ]);
  expect(ui.text('.mr-review-at')).toBe('Fix rendering · feature/render @ c0ffee1');
  expect(ui.q('.mr-review-at').title).toBe('The repository as this change leaves it');
  // Opened from the review itself, not from one of its chapters, there is no chapter to continue.
  expect(ui.all('.mr-review-route')).toHaveLength(0);
  expect(ui.all('.mr-repo-review .mr-pm-lane-head').map((head) => head.textContent)).toStrictEqual(['Linked from3', 'In this review4', 'Links to0']);
  // Its files chapter by chapter, a changed configuration file that nothing links to a quiet chip among them.
  expect(ui.all('.mr-repo-review .mr-pm-place').map((place) => [place.dataset.id, place.dataset.lane])).toStrictEqual([
    ['README.md', 'incoming'],
    ['docs/architecture/rendering.md', 'incoming'],
    ['NOTES.md', 'incoming'],
    [spec, 'here'],
    [decision, 'here'],
    ['src/render.ts', 'here'],
    ['docker-compose.yml', 'here'],
  ]);
  expect(ui.q('.mr-pm-place[data-id="docker-compose.yml"]').classList).toContain('is-chip');
  expect(ui.all('.mr-repo-review .mr-pm-group-head').map((head) => head.textContent)).toStrictEqual(['Reading', 'Code']);
  // A changed configuration file says what it declares, once configuration is read.
  ui.press('Read configuration', '.mr-review-status button');
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-lens-configs').textContent).not.toContain('Read configuration'));
  ui.click('.mr-pm-place[data-id="docker-compose.yml"]');
  await vi.waitFor(() => expect(ui.all('.mr-pm-sheet .mr-sheet-body > .mr-pm-note').map((note) => note.textContent)).toContain('Declares web.'));

  // How a document connects to the review, each link a way to its paragraph; a changed document is flagged where it is read.
  ui.click('.mr-pm-place[data-id="docs/architecture/rendering.md"]');
  ui.click('.mr-pm-sheet [data-tab="links"]');
  expect(ui.all('.mr-pm-sheet .mr-pm-why-direction').map((p) => p.textContent)).toStrictEqual(['This links to Reading', 'This links to render.ts']);
  ui.press('Read source paragraph', '.mr-pm-sheet button');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Rendering');
  // Reading, the one way back is to the map, in place of Return to review.
  expect(ui.q('.mr-repo-return').hidden).toBe(true);
  ui.click('[data-act="back-to-map"]');
  expect(ui.q('.mr-repo-review').hidden).toBe(false);
  expect(ui.q('.mr-repo-return').hidden).toBe(false);
  ui.click(`.mr-pm-place[data-id="${spec}"]`);
  ui.press('Read', '.mr-pm-sheet .mr-sheet-actions button');
  await ui.settled();
  expect(ui.text('.mr-file-meta')).toContain('Changed in this review');
  ui.click('[data-act="docs"]');
  expect(ui.all('.mr-repo-outline [data-path] .mr-chip.is-modified').map((f) => f.closest('button')!.dataset.path)).toStrictEqual([decision, spec]);
  ui.key('Escape');
  // The Documents map, from the map's switch, is around the document being read.
  ui.click('[data-act="back-to-map"]');
  ui.click('[data-act="lens"][data-lens="documents"]');
  await vi.waitFor(() => expect(ui.text('.mr-pm-place[data-lane="here"]')).toBe('Spec Reading docs/specs Changed in this review You are here'));

  ui.key('Escape');
  expect(onClose).toHaveBeenCalled();
});

it('before any document is read, M stays on This review, and the documents list reads one', async () => {
  await ui.open(repository(files), { review });
  await vi.waitFor(() => expect(ui.all('.mr-repo-review .mr-pm-place').length).toBe(7));
  // With nothing read yet, M has no document to go back to; the documents list reads one.
  ui.key('m');
  expect(ui.q('.mr-repo-review').hidden).toBe(false);
  ui.click('[data-act="docs"]');
  ui.click('.mr-repo-outline .mr-menu-item[data-path="README.md"]');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Handbook');
  // Back to map is back to This review.
  ui.click('[data-act="back-to-map"]');
  expect(ui.q('.mr-repo-review').hidden).toBe(false);
});

it('a listing that fails in the review view can be tried again', async () => {
  const source = repository(files);
  vi.mocked(source.discover).mockRejectedValueOnce(new Error('offline'));
  await ui.open(source, { review });
  await vi.waitFor(() => expect(ui.text('.mr-repo-review .mr-message h2')).toBe('Galley could not read this.'));
  expect(ui.text('.mr-repo-review .mr-message p')).toBe('offline');
  ui.press('Try again', '.mr-repo-review button');
  await vi.waitFor(() => expect(ui.all('.mr-repo-review .mr-pm-place')).toHaveLength(7));
});

it('a listing that fails after the reader left the review view stays quiet there', async () => {
  const source = repository(files);
  let fail!: (err: Error) => void;
  vi.mocked(source.discover).mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
  // Opened at a document from the review: to This review and back before the listing fails.
  await ui.open(source, { review: { ...review, entry: { key: 'doc', path: 'NOTES.md', canContinue: false } } });
  await ui.settled();
  ui.click('[data-act="back-to-map"]');
  ui.key('m');
  fail(new Error('offline'));
  await vi.waitFor(() => expect(ui.q('.mr-repo-read').hidden).toBe(false));
  await Promise.resolve();
  expect(ui.text('.mr-lead')).toBe('Field notes');
  expect(ui.q('.mr-repo-review .mr-message')).toBe(null);
});

it('a review that changes no configuration does not offer to read it', async () => {
  await ui.open(repository(files, { discover: vi.fn(async () => listing(Object.keys(files).filter((p) => p.endsWith('.md')))) }), {
    review: { ...review, chapters: [{ title: 'Reading', paths: [spec] }] },
  });
  await vi.waitFor(() => expect(ui.all(`.mr-repo-review .mr-pm-place[data-id="${spec}"]`)).toHaveLength(1));
  expect(ui.all('.mr-review-status .mr-lens-configs')).toHaveLength(0);
});

it('a newer commit redraws the review view from the new snapshot', async () => {
  const next = repository(files, { commit: 'beef000000000000000000000000000000000000' });
  await ui.open(repository(files, { refresh: vi.fn(async () => next) }), { review });
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-map-status').textContent).toMatch(/^Built from all/));
  // A document shown from the old commit closes with it.
  ui.click(`.mr-pm-place[data-id="${spec}"]`);
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-map-status').textContent).toMatch(/at beef000/));
  expect(ui.text('.mr-review-at')).toBe('Fix rendering · feature/render @ beef000');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
});

it('a directly opened context document stays readable if its repository listing fails, with a disabled continuation for a platform-only chapter', async () => {
  const source = repository(files, {
    discover: vi.fn(async () => {
      throw new Error('offline');
    }),
  });
  const chapters = [...review.chapters, { id: 'platform', title: 'Platform files', paths: ['logo.png'] }];
  await ui.open(source, {
    review: { ...review, chapters, context: new ChapterContext(), entry: { chapter: 'platform', key: 'doc', path: 'NOTES.md', canContinue: false } },
  });
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Field notes');
  expect(ui.q<HTMLButtonElement>('[data-act="continue-chapter"]').disabled).toBe(true);
  expect(ui.text('.mr-review-route-text')).toBe('From the review chapter Platform files');
  // Notes open beside it, with nothing listed to connect them to.
  ui.click('.mr-tb-right [data-panel="notes"]');
  expect(ui.q('.mr-pm-sheet .mr-sheet-layer').getAttribute('aria-label')).toBe('Notes');
  ui.key('Escape');
  // This review says why it cannot be drawn, and Return to review leads back.
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.text('.mr-repo-review .mr-message h2')).toBe('Galley could not read this.'));
  ui.click('.mr-repo-return');
  // Opened from the review's Library rather than a chapter, a document has no chapter to carry on with.
  await ui.open(source, { review: { ...review, context: new ChapterContext(), entry: { key: 'doc', path: 'NOTES.md', canContinue: false } } });
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Field notes');
  expect(ui.q('[data-act="continue-chapter"]')).toBeNull();
  ui.close();
});

it('a context listing that arrives after closing cannot start another indexing pass', async () => {
  let resolve!: (found: ReturnType<typeof listing>) => void;
  const source = repository(files, {
    discover: vi.fn(
      () =>
        new Promise<ReturnType<typeof listing>>((found) => {
          resolve = found;
        }),
    ),
  });
  const handle = await ui.open(source, {
    review: { ...review, entry: { chapter: 'code', key: 'doc', path: 'NOTES.md', canContinue: true } },
  });
  await ui.settled();
  handle.close();
  resolve(listing(Object.keys(files).filter((path) => path.endsWith('.md'))));
  await Promise.resolve();
  await Promise.resolve();
  expect(source.load).toHaveBeenCalledTimes(1);
  expect(source.load).toHaveBeenCalledWith('NOTES.md');
});

it('This review shows a chosen document in the map’s sheet: how it connects to the review, then the document, which leads on', async () => {
  // A glossary that links to nothing the review changes; the changed spec links to it.
  const withGlossary = {
    ...files,
    'docs/specs/reading.md': `${files['docs/specs/reading.md']}\n\nSee the [glossary](glossary.md).`,
    'docs/specs/glossary.md': '# Glossary',
  };
  await ui.open(repository(withGlossary, { pinned: true }), { review });
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-map-status').textContent).toMatch(/^Built from all/));
  const card = () => ui.q('.mr-repo-review .mr-pm-place[data-id="docs/architecture/rendering.md"]');
  card().click();
  expect(card().getAttribute('aria-pressed')).toBe('true');
  expect(ui.q('.mr-root').classList).toContain('has-sheet');
  expect(ui.q('.mr-pm-sheet').hasAttribute('aria-modal')).toBe(false);
  expect(ui.q('.mr-pm-sheet').classList).toContain('mr-map-sheet');
  expect(ui.text('.mr-pm-sheet .mr-sheet-header')).toBe('Architecture Read Close Rendering docs/architecture/rendering.md · c0ffee1 Preview Links 2');
  await vi.waitFor(() => expect(ui.q('.mr-pm-sheet .mr-pm-preview')).toBeTruthy());
  // Drawn again, as when configuration is read, the map still shows which document the sheet is about.
  ui.press('Read configuration', '.mr-review-status button');
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-lens-configs').textContent).not.toContain('Read configuration'));
  expect(card().getAttribute('aria-pressed')).toBe('true');
  // A link to a document shows it in the sheet; to a file the review changes, what links to it; anything else is followed as usual.
  const outside = ui.q<HTMLAnchorElement>('.mr-pm-sheet a[href="https://example.org"]') ?? null;
  expect(outside).toBe(null);
  ui.q<HTMLAnchorElement>('.mr-pm-sheet a[data-mr-path="src/render.ts"]').click();
  expect(ui.text('.mr-pm-sheet h2')).toBe('render.ts');
  expect(ui.q('.mr-pm-sheet [data-tab="links"]').getAttribute('aria-selected')).toBe('true');
  ui.click('.mr-repo-review .mr-pm-place[data-id="docs/architecture/rendering.md"]');
  await vi.waitFor(() => expect(ui.q('.mr-pm-sheet a[data-mr-path="docs/specs/reading.md"]')).toBeTruthy());
  ui.q<HTMLAnchorElement>('.mr-pm-sheet a[data-mr-path="docs/specs/reading.md"]').click();
  expect(ui.text('.mr-pm-sheet h2')).toBe('Reading');
  // From there on to the glossary, which the map shows on its right, where the review's documents lead.
  await vi.waitFor(() => expect(ui.q('.mr-pm-sheet a[data-mr-path="docs/specs/glossary.md"]')).toBeTruthy());
  ui.q<HTMLAnchorElement>('.mr-pm-sheet a[data-mr-path="docs/specs/glossary.md"]').click();
  expect(ui.text('.mr-pm-sheet h2')).toBe('Glossary');
  expect(ui.all('.mr-repo-review .mr-pm-place[aria-pressed="true"]').map((place) => [place.dataset.id, place.dataset.lane])).toStrictEqual([
    ['docs/specs/glossary.md', 'outgoing'],
  ]);
  ui.key('Escape');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  expect(ui.q('.mr-root').classList).not.toContain('has-sheet');
  // Escape gives focus back to the card the sheet was about.
  card().click();
  ui.key('Escape');
  expect(ui.shadow().activeElement).toBe(card());
  // On a phone it covers the map, which waits behind it.
  Object.defineProperty(ui.media, 'matches', { value: true, configurable: true });
  ui.click(`.mr-repo-review .mr-pm-place[data-id="${spec}"]`);
  expect(ui.q('.mr-pm-sheet').getAttribute('aria-modal')).toBe('true');
  expect(ui.q('.mr-main').inert).toBe(true);
  // Tab goes round inside it.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('[hidden]') ? [] : [new DOMRect()]) as unknown as DOMRectList;
  });
  const controls = ui.all('.mr-pm-sheet .mr-sheet-layer:not(.is-under) :is(button, a[href], input, textarea, select, [tabindex="0"])');
  controls.at(-1)!.focus();
  ui.key('Tab');
  expect(ui.shadow().activeElement).toBe(controls[0]);
  ui.click('.mr-pm-sheet-backdrop');
  expect(ui.q('.mr-main').inert).toBe(false);
  // Notes take the sheet; choosing the document again brings its details back.
  Object.defineProperty(ui.media, 'matches', { value: false, configurable: true });
  ui.click(`.mr-repo-review .mr-pm-place[data-id="${spec}"]`);
  ui.click('.mr-tb-right [data-panel="notes"]');
  expect(ui.q('.mr-pm-sheet .mr-sheet-layer').getAttribute('aria-label')).toBe('Notes');
  expect(ui.q('.mr-pm-sheet').classList).not.toContain('mr-map-sheet');
  ui.click(`.mr-repo-review .mr-pm-place[data-id="${spec}"]`);
  expect(ui.q('.mr-pm-sheet .mr-sheet-layer').getAttribute('aria-label')).toBe('Document preview');
  expect(ui.q('.mr-tb-right [data-panel="notes"]').getAttribute('aria-expanded')).toBe('false');
  // Leaving This review puts its sheet away; Show its connections opens the Documents map at the document.
  ui.click('.mr-pm-sheet [data-act="pm-focus"]');
  expect(ui.q('.mr-repo-map').hidden).toBe(false);
  expect(ui.q('[data-act="lens"][data-lens="documents"]').getAttribute('aria-pressed')).toBe('true');
  expect(ui.q('.mr-pm-place[data-lane="here"]').dataset.id).toBe(spec);
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  // This review, from the map's switch, is as it was left, its sheet and all.
  ui.click('[data-act="lens"][data-lens="review"]');
  await vi.waitFor(() => expect(ui.shadow().activeElement).toBe(ui.q('.mr-repo-review [data-act="lens"][data-lens="review"]')));
  expect(ui.q('.mr-repo-review').hidden).toBe(false);
  expect(ui.q('.mr-pm-sheet').hidden).toBe(false);
  expect(ui.text('.mr-pm-sheet .mr-sheet-title')).toBe('Reading');
});

it('over a review, Notes open beside This review in the same sheet, and there are no library chapters', async () => {
  await ui.open(repository(files, { pinned: true }), { review });
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-map-status').textContent).toMatch(/^Built from all/));
  // The review has its own chapters: only Notes opens beside This review, with no switch at its head.
  expect(ui.q('.mr-tb-right [data-panel="chapters"]').hidden).toBe(true);
  const notes = ui.q('.mr-tb-right [data-panel="notes"]');
  notes.focus();
  notes.click();
  expect(ui.q('.mr-pm-sheet').hidden).toBe(false);
  expect(ui.q('.mr-root').classList).toContain('has-sheet');
  expect(ui.text('.mr-pm-sheet .mr-sheet-lead')).toBe('Notes');
  expect(ui.all('.mr-pm-sheet .mr-sheet-tab')).toHaveLength(0);
  expect(notes.getAttribute('aria-expanded')).toBe('true');
  // Esc closes them, and focus goes back to Notes.
  ui.key('Escape');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  expect(notes.getAttribute('aria-expanded')).toBe('false');
  expect(ui.shadow().activeElement).toBe(notes);
});

it('the sheet shows a document that is not read yet, and says when it cannot show one', async () => {
  const later = deferred<string>();
  const source = repository(files, { pinned: true });
  const load = source.load;
  source.load = vi.fn((path: string) => (path === spec ? later.promise : load(path)));
  await ui.open(source, { review });
  await vi.waitFor(() => expect(ui.all(`.mr-repo-review .mr-pm-place[data-id="${spec}"]`)).toHaveLength(1));
  ui.click(`.mr-repo-review .mr-pm-place[data-id="${spec}"]`);
  expect(ui.text('.mr-pm-sheet .mr-sheet-body')).toBe('Opening the document…');
  later.reject(new Error('offline'));
  await vi.waitFor(() => expect(ui.text('.mr-pm-sheet .mr-sheet-body')).toBe('This document cannot be shown here. Read it to see why.'));
  // A link written without words is still evidence.
  await vi.waitFor(() => expect(ui.all('.mr-repo-review .mr-pm-place[data-id="NOTES.md"]')).toHaveLength(1));
  ui.click('.mr-repo-review .mr-pm-place[data-id="NOTES.md"]');
  ui.click('.mr-pm-sheet [data-tab="links"]');
  expect(ui.all('.mr-pm-sheet .mr-pm-why .mr-pm-proof blockquote').map((quote) => quote.textContent)).toStrictEqual(['render.ts', 'A link without text']);
});

it('This review starts as a map on wide screens; List shows the same, and closing a document’s sheet goes back to its card', async () => {
  await ui.open(repository(files, { pinned: true }), { review });
  await vi.waitFor(() => expect(ui.q('.mr-review-status .mr-map-status').textContent).toMatch(/^Built from all/));
  expect(ui.q('.mr-repo-review [data-act="pm-view-map"]').getAttribute('aria-pressed')).toBe('true');
  const card = () => ui.q('.mr-repo-review .mr-pm-place[data-id="docs/architecture/rendering.md"]');
  card().click();
  ui.key('Escape');
  expect(ui.shadow().activeElement).toBe(card());
  // List: what links in, then each chapter's files, every one of them.
  ui.click('.mr-repo-review [data-act="pm-view-list"]');
  expect(ui.all('.mr-repo-review .mr-pm-list .mr-pm-folder').map((head) => head.textContent)).toStrictEqual([
    'Linked from3 documents',
    'Reading2 files',
    'Code2 files',
  ]);
  ui.click('.mr-repo-review [data-act="pm-view-map"]');
  // The map's own keys work while This review is shown.
  ui.q('.mr-repo-review .mr-pm-canvas').focus();
  ui.key('ArrowLeft');
  expect(ui.q('.mr-repo-review .mr-pm-world').style.transform).toMatch(/^translate\(/);
});
