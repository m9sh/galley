import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Standalone chapter choices use the review presentation, without progress or a second grouping system. */
export async function checkLibraryChapters(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  const click = (selector) => inspect((selector) => document.querySelector('#galley-repo-reader').shadowRoot.querySelector(selector).click(), selector);
  const settled = () => page.waitForFunction(() => !document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-doc .mr-skeleton'));
  for (const [appearance, density, size] of [
    ['light', 'comfortable', 0],
    ['dark', 'compact', 4],
  ]) {
    await page.evaluateOnNewDocument(
      (settings) => {
        if (window === window.top) localStorage.setItem('galley:settings', JSON.stringify(settings));
      },
      { theme: 'sage', appearance, density, size },
    );
    await page.setViewport({ width: 1440, height: 1000 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${demoUrl}/?repo=docs/architecture/overview.md`, { waitUntil: 'networkidle0' });
    await settled();
    await click('.mr-chapter-attachment summary');
    await click('.mr-chapter-attachment button[type="submit"]');
    await click('[data-view="chapters"]');
    await click('[data-act="sequence-add"][data-path="docs/adr/0003-queue-for-reviews.md"]');
    const selections = await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      return { titles: [...s.querySelectorAll('.mr-sequence-title')].map((el) => el.textContent), proof: s.querySelector('.mr-sequence-links').textContent };
    });
    assert.deepEqual(selections.titles, ['Architecture overview', 'ADR 0003']);
    assert.match(selections.proof, /Source link · line 14/);
    await click('.mr-repo-chapters [data-act="docs"]');
    await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-repo-outline .mr-menu-item').length === 9);
    await click('.mr-repo-outline [data-act="sequence-add"][data-path="README.md"]');
    await page.keyboard.press('Escape');
    await click('[data-act="sequence-open"][data-at="1"]');
    await settled();
    assert.equal(
      await inspect(() => {
        const s = document.querySelector('#galley-repo-reader').shadowRoot;
        return s.activeElement === s.querySelector('.mr-root');
      }),
      true,
    );
    await click('.mr-chapter-route [data-at="0"]');
    await settled();
    await click('.mr-chapter-attachment summary');
    await inspect(() => (document.querySelector('#galley-repo-reader').shadowRoot.querySelector('[aria-label="Section to add"]').value = 'rendering'));
    await click('.mr-chapter-attachment button[type="submit"]');
    await click('.mr-chapter-route [data-act="sequence"]');
    await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-toast').hidden);
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: width < 760 ? 844 : 1000 });
      const overview = await inspect(() => {
        const s = document.querySelector('#galley-repo-reader').shadowRoot;
        const root = s.querySelector('.mr-root');
        const buttons = [...s.querySelectorAll('.mr-repo-chapters button')].filter((el) => el.getClientRects().length);
        return {
          overflow: root.scrollWidth > innerWidth,
          heights: buttons.map((el) => el.getBoundingClientRect().height),
          current: s.querySelectorAll('.mr-repo-chapters [aria-current="step"]').length,
        };
      });
      assert.equal(overview.overflow, false, `Chapter overview must fit at ${width}px (${appearance})`);
      assert.ok(
        overview.heights.every((height) => height >= 44),
        `Chapter buttons need 44px: ${overview.heights}`,
      );
      assert.equal(overview.current, 1);
      await page.screenshot({ path: join(screenshots, `library-chapter-${width}-${appearance}.png`) });
      await click('.mr-repo-chapters [data-act="docs"]');
      const menu = await inspect(() => {
        const s = document.querySelector('#galley-repo-reader').shadowRoot;
        const names = [...s.querySelectorAll('.mr-repo-outline .mr-menu-name')];
        const rows = [...s.querySelectorAll('.mr-repo-document-row')];
        const panel = s.querySelector('.mr-repo-docs').getBoundingClientRect();
        return {
          fits: panel.left >= 0 && panel.right <= innerWidth,
          leading: names.map((el) => getComputedStyle(el.querySelector('.mr-path-name')).lineHeight),
          gaps: rows.slice(1).map((el, at) => el.getBoundingClientRect().top - rows[at].getBoundingClientRect().bottom),
        };
      });
      assert.equal(menu.fits, true);
      assert.ok(
        menu.leading.every((line) => parseFloat(line) < 24),
        `Wrapped titles need compact leading: ${menu.leading}`,
      );
      assert.ok(
        menu.gaps.every((gap) => gap >= 10),
        `Documents need distinct gaps: ${menu.gaps}`,
      );
      await page.screenshot({ path: join(screenshots, `library-list-${width}-${appearance}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(
        await inspect(() => {
          const s = document.querySelector('#galley-repo-reader').shadowRoot;
          return s.activeElement === s.querySelector('[data-act="docs"]');
        }),
        true,
      );
    }
    // Navigate a heading, switch layout, and use Back to restore the same paragraph.
    await click('[data-act="sequence-open"][data-at="3"]');
    await settled();
    const at = await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      return { route: s.querySelector('.mr-chapter-route').textContent, top: s.querySelector('#user-content-rendering').getBoundingClientRect().top };
    });
    assert.match(at.route, /4 of 4/);
    await page.setViewport({ width: 1440, height: 600 });
    const bookmark = await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const block = [...s.querySelectorAll('.mr-content [data-mr-u]')].find((el) => el.getBoundingClientRect().bottom > 72);
      return { id: block.dataset.mrU, top: block.getBoundingClientRect().top };
    });
    await page.keyboard.press('l');
    await page.keyboard.press('l');
    const after = await inspect(
      (id) =>
        [...document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('[data-mr-u]')]
          .find((el) => el.dataset.mrU === id)
          .getBoundingClientRect().top,
      bookmark.id,
    );
    assert.ok(Math.abs(after - bookmark.top) < 4, `Library chapter layout preserves place: ${after} vs ${bookmark.top}`);
    await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').scrollTo({ top: 0 }));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-diagram-view')?.dataset.state === 'ready');
    await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-toast').hidden);
    await page.screenshot({ path: join(screenshots, `library-chapter-reading-${appearance}.png`) });
    await click('.mr-chapter-route [data-at="2"]');
    await settled();
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Alt');
    await settled();
    assert.match(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-chapter-route').textContent), /4 of 4/);
    assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-viewed, .mr-comment-btn').length), 0);
    await click('[data-act="docs"]');
    await click('.mr-repo-outline [data-act="open"][data-path="docs/README.md"]');
    await settled();
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: width < 760 ? 844 : 1000 });
      assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').scrollWidth > innerWidth), false);
      const titleLines = await inspect(() => {
        const title = document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-lead');
        return title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight);
      });
      assert.ok(titleLines < 1.1, `The single-word Documentation title must not leave one letter on a new line at ${width}px: ${titleLines} lines`);
      await page.screenshot({ path: join(screenshots, `library-table-${width}-${appearance}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
}
