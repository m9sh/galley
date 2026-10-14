import assert from 'node:assert/strict';
import { join } from 'node:path';

/** The sheet on top of the stack: the one in reach, with the keys. */
const TOP = '.mr-chapters > .mr-sheet-layer:not([hidden]):not(.is-under)';

/**
 * The real chapter sheet: beside the review on wide screens, a stack of sheets that Esc goes back through one at a
 * time, complete file accounting, state-preserving edits and phone layout.
 */
export async function checkChapters(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  // The review reader's shadow root, and the sheet on top, for checks inside it.
  let shadow;
  const review = (fn, ...args) => shadow.evaluate(fn, TOP, ...args);
  const open = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelector('#galley-reader')?.shadowRoot.querySelectorAll('.mr-document:not([hidden]) .mr-skeleton').length === 0,
    );
    shadow = await page.evaluateHandle(() => document.querySelector('#galley-reader').shadowRoot);
  };
  const click = (text) => review((s, top, text) => [...s.querySelector(top).querySelectorAll('button')].find((el) => el.textContent === text).click(), text);
  const title = () => review((s, top) => s.querySelector(top).querySelector('.mr-sheet-title')?.textContent ?? null);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${demoUrl}/?closed`, { waitUntil: 'networkidle0' });
  await inspect(() => localStorage.setItem('galley:settings', JSON.stringify({ theme: 'paper', appearance: 'light', codeFiles: false })));
  await open(`${demoUrl}/?chapters`);
  await review((s) => s.querySelector('.mr-chapters-toggle').focus());
  await page.keyboard.press('m');
  const initial = await review((s, top) => {
    const layer = s.querySelector(top);
    const keys = layer.querySelector('.mr-sheet-keys');
    return {
      chapters: layer.querySelectorAll('.mr-sheet-row[data-chapter]').length,
      progress: s.querySelector('.mr-chapters-progress').textContent,
      focused: s.activeElement === layer,
      keys: getComputedStyle(keys).display === 'none' ? null : keys.textContent,
      inert: s.querySelector('.mr-main').inert,
    };
  });
  assert.ok(initial.chapters >= 5, `Chapters: ${initial.chapters}`);
  assert.equal(initial.progress, '0 of 13 files viewed');
  assert.equal(initial.focused, true, 'The sheet takes focus as it opens');
  assert.equal(initial.keys, '↑↓ Move↵ OpenEsc Close', 'With a keyboard, the keys that work are at the foot, Esc among them');
  assert.equal(initial.inert, false, 'Beside the review, the sheet leaves it in reach');
  const cdp = await page.createCDPSession();
  const accessibility = await cdp.send('Accessibility.getFullAXTree');
  // Beside the review it is a region of the page, not a dialog; a chapter is named by what is in it and how much is viewed.
  assert.ok(accessibility.nodes.some((node) => node.role?.value === 'complementary' && node.name?.value === 'Chapters'));
  assert.ok(accessibility.nodes.some((node) => node.role?.value === 'button' && node.name?.value === 'Start here'));
  assert.ok(
    accessibility.nodes.some((node) => node.role?.value === 'button' && /^docs\/rfcs.*0042-reading-first-reviews\.md.*viewed$/.test(node.name?.value ?? '')),
  );
  await cdp.detach();
  // The sheet narrows the review instead of covering it: the review reflows into the width that is left.
  const squeeze = await review((s) => {
    const root = s.querySelector('.mr-root');
    return {
      reader: Math.round(root.getBoundingClientRect().right),
      sheet: Math.round(s.querySelector('.mr-chapters').getBoundingClientRect().left),
      text: Math.round(s.querySelector('.mr-article').getBoundingClientRect().right),
      sideways: root.scrollWidth > root.clientWidth,
      narrowed: root.classList.contains('is-narrowed'),
    };
  });
  // One width for every sheet: clamp(380px, 42vw, 620px).
  const edge = 1440 - Math.round(Math.min(620, Math.max(380, 1440 * 0.42)));
  assert.equal(squeeze.reader, edge);
  assert.equal(squeeze.sheet, edge);
  assert.ok(squeeze.text <= edge, `The text runs under the sheet: ${squeeze.text}`);
  assert.equal(squeeze.sideways, false);
  assert.equal(squeeze.narrowed, true, `At ${edge} pixels the review reads in one column`);
  await page.screenshot({ path: join(screenshots, 'galley-chapters-desktop.png') });

  // ↓ goes into the list and Enter opens a chapter on top: the list waits beneath, its edge in view, and Esc returns to it.
  await page.keyboard.press('ArrowDown');
  const first = await review((s) => s.activeElement.dataset.chapter);
  assert.ok(first, 'Down goes into the list of chapters');
  await page.keyboard.press('Enter');
  const stacked = await review((s, top) => {
    const layer = s.querySelector(top);
    const under = s.querySelector('.mr-chapters > .mr-sheet-layer.is-under');
    return {
      focused: s.activeElement === layer,
      back: layer.querySelector('.mr-sheet-back').getAttribute('aria-label'),
      under: under.getAttribute('aria-label'),
      inert: under.inert,
      edges: s.querySelectorAll('.mr-chapters .mr-sheet-edge').length,
      peek: Math.round(layer.getBoundingClientRect().left - s.querySelector('.mr-chapters').getBoundingClientRect().left),
      // Beneath another, a sheet is only its edge: full height, its contents out of view.
      height: Math.round(under.getBoundingClientRect().height) === Math.round(layer.getBoundingClientRect().height),
      contents: getComputedStyle(under.querySelector('.mr-sheet-body')).visibility,
      width: Math.round(s.querySelector('.mr-chapters').getBoundingClientRect().width),
    };
  });
  assert.deepEqual(stacked, {
    focused: true,
    back: 'Back to Chapters',
    under: 'Chapters',
    inert: true,
    edges: 1,
    peek: 14,
    height: true,
    contents: 'hidden',
    width: 1440 - edge,
  });
  assert.match(await title(), /\S/);
  await page.screenshot({ path: join(screenshots, 'galley-chapters-stack.png') });
  await page.keyboard.press('Escape');
  assert.deepEqual(await review((s, top) => [s.querySelector(top).querySelector('.mr-sheet-title'), s.activeElement.dataset.chapter]), [null, first]);
  // The edge of the sheet beneath goes back to it too.
  await page.keyboard.press('Enter');
  await review((s) => s.querySelector('.mr-chapters .mr-sheet-edge').click());
  assert.equal(await title(), null);

  await click('Start here');
  await page.waitForFunction(() => {
    const s = document.querySelector('#galley-reader').shadowRoot;
    return s.querySelector('.mr-document[data-document]').getBoundingClientRect().top < 150;
  });
  await review((s) => s.querySelector('.mr-chapters-toggle').focus());
  await page.keyboard.press('m');

  // Chapter editing moves existing document nodes, and anchors the file at its former viewport position.
  const before = await review((s) => {
    const file = s.querySelector('.mr-document[data-document]');
    window.chapterFile = file;
    return file.getBoundingClientRect().top;
  });
  await click('Edit');
  assert.equal(await title(), 'Edit chapters');
  await review((s, top) => {
    const chapter = s.querySelector(top).querySelector('.mr-chapter-edit[data-chapter="docs:docs/rfcs"]');
    chapter.querySelector('input').value = 'Start with the intent';
    chapter.querySelector('input').dispatchEvent(new Event('input'));
    chapter.querySelector('[aria-label="Move Start with the intent later"]').click();
  });
  const after = await review((s) => ({
    retained: [...s.querySelectorAll('.mr-document')].includes(window.chapterFile),
    top: window.chapterFile.getBoundingClientRect().top,
    current: [...s.querySelectorAll('.mr-chapters .mr-sheet-row[aria-current]')].map((row) => [
      row.dataset.chapter,
      row.querySelector('.mr-sheet-row-title').textContent,
    ]),
    feedback: s.querySelector('.mr-chapters-feedback').textContent,
  }));
  assert.equal(after.retained, true);
  assert.ok(Math.abs(after.top - before) < 2, JSON.stringify({ before, after }));
  assert.deepEqual(after.current, [['docs:docs/rfcs', 'Start with the intent']]);
  assert.equal(after.feedback, 'Start with the intent moved later.');
  await page.keyboard.press('Escape');
  await click('All files');
  assert.equal(await review((s, top) => s.querySelector(top).querySelectorAll('.mr-sheet-row[data-file]').length), 13);
  // Esc goes back a sheet at a time, then closes, and focus is where the sheet was opened from.
  await page.keyboard.press('Escape');
  assert.equal(await title(), null);
  await page.keyboard.press('Escape');
  assert.equal(await review((s) => s.querySelector('.mr-chapters').hidden), true);
  assert.equal(await review((s) => s.activeElement.classList.contains('mr-chapters-toggle')), true);
  assert.equal(await review((s) => s.querySelector('.mr-main').inert), false);
  // Closed, the sheet gives the review its whole width back.
  assert.deepEqual(
    await review((s) => {
      const root = s.querySelector('.mr-root');
      return [Math.round(root.getBoundingClientRect().right), root.classList.contains('is-narrowed')];
    }),
    [1440, false],
  );

  for (const [width, appearance] of [
    [1440, 'dark'],
    [390, 'light'],
    [320, 'dark'],
  ]) {
    await page.setViewport({ width, height: 844 });
    await inspect((appearance) => localStorage.setItem('galley:settings', JSON.stringify({ theme: 'paper', appearance, codeFiles: true })), appearance);
    await open(`${demoUrl}/?chapters`);
    await page.keyboard.press('m');
    // Every control of the sheet on top, and whether anything in it runs sideways.
    const measure = () =>
      review((s, top) => {
        const sheet = s.querySelector('.mr-chapters');
        const layer = s.querySelector(top);
        const body = layer.querySelector('.mr-sheet-body');
        const rect = sheet.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          sideways: body.scrollWidth > body.clientWidth || layer.querySelector('.mr-sheet-header').scrollWidth > layer.clientWidth,
          page: s.querySelector('.mr-root').scrollWidth,
          modal: sheet.getAttribute('aria-modal'),
          keys: layer.querySelector('.mr-sheet-keys').hidden ? null : getComputedStyle(layer.querySelector('.mr-sheet-keys')).display !== 'none',
          small: [...layer.querySelectorAll('button, input, select, textarea')]
            .filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 44)
            .map((el) => `${el.className || el.localName} ${el.textContent || el.getAttribute('aria-label')}`.trim()),
        };
      });
    const phone = width < 760;
    const fits = (geometry, what) => {
      assert.ok(geometry.left >= 0 && geometry.right <= width && !geometry.sideways && geometry.page <= width, JSON.stringify({ width, what, geometry }));
      assert.equal(geometry.modal, phone ? 'true' : null);
      // A phone has no keys to show; its controls are big enough to touch.
      if (geometry.keys !== null) assert.equal(geometry.keys, !phone, `Keys at ${width}`);
      if (phone) assert.deepEqual(geometry.small, [], `Touch targets at ${width} in ${what}`);
    };
    fits(await measure(), 'Chapters');
    await page.screenshot({ path: join(screenshots, `galley-chapters-${width}-${appearance}.png`) });
    await click('All files');
    fits(await measure(), 'All files');
    assert.equal(
      await review((s, top) => [...s.querySelector(top).querySelectorAll('.mr-sheet-row-meta')].some((el) => el.textContent.includes('Folded'))),
      true,
    );
    if (phone) {
      // On a phone the deck rises: the sheet on top sits a step lower than the one beneath.
      const rise = await review((s, top) =>
        Math.round(s.querySelector(top).getBoundingClientRect().top - s.querySelector('.mr-chapters > .mr-sheet-layer.is-under').getBoundingClientRect().top),
      );
      assert.ok(rise >= 8, `The sheet beneath shows above the one on top: ${rise}`);
    }
    await page.screenshot({ path: join(screenshots, `galley-chapters-files-${width}-${appearance}.png`) });
    await page.keyboard.press('Escape');
    await click('Edit');
    fits(await measure(), 'Edit chapters');
    await page.screenshot({ path: join(screenshots, `galley-chapters-edit-${width}-${appearance}.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert.equal(await review((s) => s.querySelector('.mr-chapters').hidden), true);
  }
  assert.deepEqual(errors, []);
  await page.close();
}
