import assert from 'node:assert/strict';
import { join } from 'node:path';

/** The joined chapter → supporting article → review journey, including a session heading attachment. */
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
    await inspect(() => {
      const s = document.querySelector('#galley-reader').shadowRoot;
      s.querySelector('[data-chapter="docs:docs/rfcs"] [data-context-key="find"]').focus();
    });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-review-status .mr-map-status')?.textContent.startsWith('Built from all'),
    );
    await click('[data-act="open"][data-path="docs/architecture/overview.md"]');
    await page.waitForFunction(
      () => document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-lead')?.textContent === 'Architecture overview',
    );
    await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const details = s.querySelector('.mr-chapter-attachment');
      details.open = true;
      const form = details.querySelector('form');
      form.querySelector('[aria-label="Section to add"]').value = 'rendering';
      form.querySelector('button[type="submit"]').click();
    });
    assert.equal(
      await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-chapter-attachment [role="status"]').textContent),
      'Added to docs/rfcs.',
    );
    await page.screenshot({ path: join(screenshots, `chapter-context-article-${width}.png`) });
    await click('.mr-repo-return [data-act="close"]');
    const returned = await inspect(() => {
      const s = document.querySelector('#galley-reader').shadowRoot;
      const panel = s.querySelector('.mr-chapters-panel');
      const chapter = s.querySelector('[data-chapter="docs:docs/rfcs"]');
      return {
        position: s.querySelector('.mr-root').scrollTop,
        viewed: s.querySelector('.mr-viewed').getAttribute('aria-pressed'),
        folded: [...s.querySelectorAll('[data-act="fold-file"]')].map((el) => el.getAttribute('aria-expanded')),
        focused: s.activeElement.dataset.contextKey,
        context: chapter.querySelector('.mr-chapter-context').textContent,
        overflow: panel.scrollWidth > panel.clientWidth + 1,
        revisionHeight: chapter.querySelector('[aria-label="Project context revision"]').getBoundingClientRect().height,
      };
    });
    assert.equal(returned.position, before.position);
    assert.equal(returned.viewed, before.viewed);
    assert.deepEqual(returned.folded, before.folded);
    assert.equal(returned.focused, 'find');
    assert.match(returned.context, /Added by you/);
    assert.match(returned.context, /Links to docs\/rfcs\/0042-reading-first-reviews.md/);
    assert.equal(returned.overflow, false, `Chapter context overflows at ${width}`);
    assert.ok(returned.revisionHeight >= 44, `Revision picker is too small at ${width}`);
    await page.screenshot({ path: join(screenshots, `chapter-context-map-${width}.png`) });
    await inspect(() =>
      document.querySelector('#galley-reader').shadowRoot.querySelector('[data-context-key="attached:docs/architecture/overview.md:rendering"]').click(),
    );
    await page.waitForFunction(
      () => document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-lead')?.textContent === 'Architecture overview',
    );
    const geometry = await inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const root = s.querySelector('.mr-root');
      const heading = s.querySelector('#user-content-rendering');
      const target = [...s.querySelectorAll('[id]')].find((el) => el.id === 'rendering') ?? heading;
      return {
        top: target.getBoundingClientRect().top,
        bylineWidth: s.querySelector('.mr-repo-at').getBoundingClientRect().width,
        nameWidth: s.querySelector('.mr-file-name').getBoundingClientRect().width,
        overflow: root.scrollWidth > root.clientWidth + 1,
        returnButtons: [...s.querySelectorAll('.mr-repo-return button')].map((el) => ({ name: el.textContent, height: el.getBoundingClientRect().height })),
      };
    });
    assert.ok(geometry.top >= 52 && geometry.top < 550, `Heading not restored at ${width}: ${geometry.top}`);
    assert.equal(geometry.overflow, false, `Library overflow at ${width}`);
    if (width <= 390) assert.ok(geometry.bylineWidth >= width - 64, `Document metadata is squeezed at ${width}: ${geometry.bylineWidth}`);
    if (width <= 390) {
      assert.ok(geometry.nameWidth >= 100, `Document name is squeezed at ${width}: ${geometry.nameWidth}`);
      await click('[data-act="docs"]');
      assert.equal(
        await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-menu-views').getBoundingClientRect().height > 0),
        true,
      );
      await click('.mr-repo-menu-views [data-view="map"]');
      await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-map').hidden === false);
      await click('[data-act="docs"]');
      await click('.mr-repo-menu-views [data-view="read"]');
      assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-read').hidden), false);
      assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-docs').hidden), true);
    }
    assert.ok(geometry.returnButtons.every((button) => button.height >= 44));
    // Escape returns to the same attachment control; the next Escape leaves Chapters and keeps the review open.
    await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').focus());
    await page.keyboard.press('Escape');
    assert.equal(
      await inspect(() => document.querySelector('#galley-reader').shadowRoot.activeElement.dataset.contextKey),
      'attached:docs/architecture/overview.md:rendering',
    );
    await page.keyboard.press('Escape');
    assert.equal(await inspect(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-chapters').hidden), true);
  }
  assert.deepEqual(errors, []);
  await page.close();
}
