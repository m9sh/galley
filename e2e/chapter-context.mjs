import assert from 'node:assert/strict';
import { join } from 'node:path';

/** The sheet on top of the stack: the one in reach, with the keys. */
const TOP = '.mr-chapters > .mr-sheet-layer:not([hidden]):not(.is-under)';

/**
 * Review chapters and the project library in one sheet: a chapter's linked docs read on top of it, a document's links
 * taking its place, the full library a step away, and a section added there joining the chapter.
 */
export async function checkChapterContext(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  const click = (selector) => inspect((selector) => document.querySelector('#galley-repo-reader').shadowRoot.querySelector(selector).click(), selector);
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewport({ width, height: 1000 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${demoUrl}/?closed`, { waitUntil: 'networkidle0' });
    await inspect(
      (width) =>
        localStorage.setItem(
          'galley:settings',
          JSON.stringify({
            theme: 'sage',
            appearance: width === 390 ? 'dark' : 'light',
            density: width === 390 ? 'compact' : 'comfortable',
            size: width === 390 || width === 1440 ? 4 : 0,
          }),
        ),
      width,
    );
    await page.goto(`${demoUrl}/?chapters`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelector('#galley-reader')?.shadowRoot.querySelectorAll('.mr-document:not([hidden]) .mr-skeleton').length === 0,
    );
    const before = await inspect(() => {
      const s = document.querySelector('#galley-reader').shadowRoot;
      s.querySelector('.mr-root').scrollTop = 240;
      return {
        position: s.querySelector('.mr-root').scrollTop,
        viewed: s.querySelector('.mr-viewed').getAttribute('aria-pressed'),
        folded: [...s.querySelectorAll('[data-act="fold-file"]')].map((el) => el.getAttribute('aria-expanded')),
      };
    });
    await inspect(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-chapters-toggle').focus());
    await page.keyboard.press('m');
    // The review reader's shadow root, and the sheet on top, for checks inside it.
    const shadow = await page.evaluateHandle(() => document.querySelector('#galley-reader').shadowRoot);
    const review = (fn, ...args) => shadow.evaluate(fn, TOP, ...args);
    const press = (selector) => review((s, top, selector) => s.querySelector(top).querySelector(selector).click(), selector);
    const sheetTitle = () => review((s, top) => s.querySelector(top).querySelector('.mr-sheet-title')?.textContent ?? null);
    const waitInTop = (selector) =>
      page.waitForFunction(
        (top, selector) => document.querySelector('#galley-reader').shadowRoot.querySelector(top)?.querySelector(selector),
        {},
        TOP,
        selector,
      );

    // A chapter opens on top of the list. Find linked docs reads the repository at the review's head, and the chapter
    // then shows each document that links to its files.
    await press('.mr-sheet-row[data-chapter="docs:docs/rfcs"]');
    assert.equal(await sheetTitle(), 'docs/rfcs');
    const chaptersWidth = await review((s) => Math.round(s.querySelector('.mr-chapters').getBoundingClientRect().width));
    await press('.mr-docs-find');
    await waitInTop('[data-context-key="doc:docs/architecture/overview.md"]');
    const found = await review((s, top) => ({
      docs: [...s.querySelector(top).querySelectorAll('[data-context-key^="doc:"] .mr-sheet-row-title')].map((el) => el.textContent),
      find: s.querySelector(top).querySelector('.mr-docs-find'),
    }));
    assert.ok(found.docs.includes('Architecture overview'), JSON.stringify(found.docs));
    assert.equal(found.find, null);
    await page.screenshot({ path: join(screenshots, `chapter-context-docs-${width}.png`) });

    // A document opens on top of the chapter, beside the review; its link to the review shows the paragraph that holds it.
    await review((s, top) => s.querySelector(top).querySelector('[data-context-key="doc:docs/architecture/overview.md"]').focus());
    await page.keyboard.press('Enter');
    await waitInTop('.mr-docs-doc .mr-content');
    await review((s, top) =>
      [...s.querySelector(top).querySelectorAll('.mr-sheet-section[aria-label="Links to this review"] .mr-sheet-row')]
        .find((row) => row.textContent.includes('Line 18'))
        .click(),
    );
    await waitInTop('.mr-docs-doc .mr-flash');
    const reading = await review((s, top) => {
      const layer = s.querySelector(top);
      const body = layer.querySelector('.mr-sheet-body');
      return {
        back: layer.querySelector('.mr-sheet-back').getAttribute('aria-label'),
        flashed: layer.querySelector('.mr-docs-doc .mr-flash').textContent,
        overflow: body.scrollWidth > body.clientWidth + 1,
        // The sheet's own controls; the document's, such as an enlargeable diagram, are the reader's content.
        buttons: [...layer.querySelectorAll('button')]
          .filter((el) => el.getClientRects().length && !el.closest('.mr-docs-doc'))
          .map((el) => el.getBoundingClientRect().height),
        position: s.querySelector('.mr-root').scrollTop,
        sheet: Math.round(s.querySelector('.mr-chapters').getBoundingClientRect().width),
      };
    });
    assert.equal(await sheetTitle(), 'Architecture overview');
    assert.equal(reading.back, 'Back to docs/rfcs');
    assert.match(reading.flashed, /rendered in the reader’s browser/);
    assert.equal(reading.overflow, false, `The document overflows the sheet at ${width}`);
    if (width <= 390)
      assert.ok(
        reading.buttons.every((height) => height >= 44),
        `Sheet controls need 44px: ${reading.buttons}`,
      );
    // A document is read at the sheet's one width: nothing beside it moves.
    assert.equal(reading.sheet, chaptersWidth, `The sheet changes width for a document at ${width}`);
    assert.equal(await inspect(() => document.querySelector('#galley-repo-reader')), null, 'Reading context never leaves the review');
    await page.screenshot({ path: join(screenshots, `chapter-context-sheet-${width}.png`) });
    // A document it links to opens on top of it; Esc goes back through them, to the chapter, on the document it opened.
    await press('.mr-docs-doc a[data-mr-path="docs/adr/0007-render-markdown-in-the-browser.md"]');
    assert.equal(await sheetTitle(), 'ADR 0007: Render Markdown in the browser');
    assert.equal(await review((s) => s.querySelectorAll('.mr-chapters > .mr-sheet-layer:not([hidden])').length), 4);
    await page.keyboard.press('Escape');
    assert.equal(await sheetTitle(), 'Architecture overview');
    await page.keyboard.press('Escape');
    assert.equal(await sheetTitle(), 'docs/rfcs');
    assert.equal(await review((s) => s.activeElement.dataset.contextKey), 'doc:docs/architecture/overview.md');

    // The Library: the docs that link to this review first, and search across every one, from /.
    await page.keyboard.press('Escape');
    await press('.mr-sheet-tab[data-tab="library"]');
    const library = await review((s, top) => ({
      label: s.querySelector(top).getAttribute('aria-label'),
      at: s.querySelector(top).querySelector('.mr-sheet-description').textContent,
      groups: [...s.querySelector(top).querySelectorAll('.mr-docs-results .mr-sheet-section-title')].map((h) => h.textContent),
    }));
    assert.deepEqual(library, {
      label: 'Library',
      at: 'As this change leaves them · docs/reading-first @ 9c1d7e3',
      groups: ['Linked to this review', 'All documents'],
    });
    await page.keyboard.press('/');
    assert.equal(await review((s) => s.activeElement.getAttribute('aria-label')), 'Search the docs');
    await page.keyboard.type('deploy');
    assert.ok(
      (await review((s, top) => s.querySelector(top).querySelectorAll('.mr-docs-results .mr-sheet-row').length)) > 0,
      'Search finds the deploy runbook',
    );
    await page.screenshot({ path: join(screenshots, `chapter-context-library-${width}.png`) });
    await review((s, top) => {
      const search = s.querySelector(top).querySelector('.mr-sheet-search input');
      search.value = '';
      search.dispatchEvent(new Event('input'));
    });

    // The full library, for its map and notes, opens at the document; a section added there joins the chapter.
    await press('.mr-sheet-row[data-path="docs/architecture/overview.md"]');
    await press('.mr-docs-full');
    await page.waitForFunction(
      () => document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-lead')?.textContent === 'Architecture overview',
    );
    await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const details = s.querySelector('.mr-chapter-attachment');
      details.open = true;
      const form = details.querySelector('form');
      form.querySelector('[aria-label="Chapter for this document"]').value = 'docs:docs/rfcs';
      form.querySelector('[aria-label="Section to add"]').value = 'rendering';
      form.querySelector('button[type="submit"]').click();
    });
    assert.equal(
      await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-chapter-attachment [role="status"]').textContent),
      'Added to docs/rfcs.',
    );
    await page.screenshot({ path: join(screenshots, `chapter-context-article-${width}.png`) });
    const geometry = await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const root = s.querySelector('.mr-root');
      return {
        bylineWidth: s.querySelector('.mr-repo-at').getBoundingClientRect().width,
        nameWidth: s.querySelector('.mr-file-name').getBoundingClientRect().width,
        overflow: root.scrollWidth > root.clientWidth + 1,
        returnButtons: [...s.querySelectorAll('.mr-repo-return, .mr-repo-back')]
          .filter((el) => el.getClientRects().length)
          .map((el) => ({ name: el.textContent, height: el.getBoundingClientRect().height })),
        returnInBar: s.querySelector('.mr-topbar .mr-repo-return[data-act="close"]') !== null,
      };
    });
    assert.equal(geometry.overflow, false, `Library overflow at ${width}`);
    if (width <= 390) {
      assert.ok(geometry.bylineWidth >= width - 64, `Document metadata is squeezed at ${width}: ${geometry.bylineWidth}`);
      assert.ok(geometry.nameWidth >= 100, `Document name is squeezed at ${width}: ${geometry.nameWidth}`);
      // Back to map and M go between the map and the document on a phone too.
      await click('[data-act="back-to-map"]');
      await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-review').hidden === false);
      await page.keyboard.press('m');
      assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-read').hidden), false);
      assert.ok(
        geometry.returnButtons.every((button) => button.height >= 44),
        `Return controls need 44px: ${JSON.stringify(geometry.returnButtons)}`,
      );
    }
    // This review is the Documents map around what the review changes: what links in, every changed file chapter by
    // chapter (those nothing links to as quiet chips), and where they lead.
    await click('[data-act="back-to-map"]');
    await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-review .mr-pm-place'));
    const reviewMap = await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const root = s.querySelector('.mr-root');
      return {
        heads: [...s.querySelectorAll('.mr-repo-review .mr-pm-lane-head')].map((head) => head.textContent),
        chips: s.querySelectorAll('.mr-repo-review .mr-pm-place.is-chip').length,
        overflow: root.scrollWidth > root.clientWidth + 1,
        space: root.classList.contains('is-map-space'),
      };
    });
    assert.deepEqual(reviewMap.heads, ['Linked from3', 'In this review13', 'Links to2']);
    assert.ok(reviewMap.chips > 0, 'Changed files nothing links to are on the map too');
    assert.equal(reviewMap.overflow, false, `This review runs sideways at ${width}`);
    assert.equal(reviewMap.space, true);
    await page.screenshot({ path: join(screenshots, `chapter-context-review-map-${width}.png`) });
    await page.keyboard.press('m');
    // Return to review leads the top bar; Escape comes back to the sheet, on what opened the library.
    assert.equal(geometry.returnInBar, true);
    await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').focus());
    // Escape closes the innermost layer first: the open Add to chapter, then the document for This review, then the library.
    await page.keyboard.press('Escape');
    assert.equal(await inspect(() => document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-chapter-attachment').open), false);
    await page.keyboard.press('Escape');
    assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-review').hidden), false);
    await page.keyboard.press('Escape');
    assert.equal(await inspect(() => document.querySelector('#galley-repo-reader')), null);
    const returned = await review((s) => ({
      position: s.querySelector('.mr-root').scrollTop,
      viewed: s.querySelector('.mr-viewed').getAttribute('aria-pressed'),
      folded: [...s.querySelectorAll('[data-act="fold-file"]')].map((el) => el.getAttribute('aria-expanded')),
      focused: s.activeElement.classList.contains('mr-docs-full'),
    }));
    assert.equal(returned.position, before.position);
    assert.equal(returned.viewed, before.viewed);
    assert.deepEqual(returned.folded, before.folded);
    assert.equal(returned.focused, true);
    // The section added there is in the chapter, and opens on top of it at its heading.
    await page.keyboard.press('Escape');
    await press('.mr-sheet-tab[data-tab="chapters"]');
    await press('.mr-sheet-row[data-chapter="docs:docs/rfcs"]');
    assert.match(await review((s, top) => s.querySelector(top).querySelector('.mr-sheet-section[aria-label="Added by you"]').textContent), /Rendering/);
    await press('[data-context-key="attached:docs/architecture/overview.md:rendering"]');
    await page.waitForFunction(
      (top) => document.querySelector('#galley-reader').shadowRoot.querySelector(top).querySelector('.mr-docs-doc .mr-flash')?.textContent === 'Rendering',
      {},
      TOP,
    );
    await page.screenshot({ path: join(screenshots, `chapter-context-attachment-${width}.png`) });
    // Esc goes back a sheet at a time, then closes the sheet; the review stays open.
    for (const title of ['docs/rfcs', null]) {
      await page.keyboard.press('Escape');
      assert.equal(await sheetTitle(), title);
    }
    await page.keyboard.press('Escape');
    assert.equal(await review((s) => s.querySelector('.mr-chapters').hidden), true);
    assert.equal(await inspect(() => document.querySelector('#galley-reader') !== null), true);
  }
  assert.deepEqual(errors, []);
  await page.close();
}
