import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Changes since the reviewer last looked (RFC 0039) in Chrome: the bar, reading only what changed, the mark, and phones. */
export async function checkRevisions(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  const reader = () =>
    inspect(() => {
      const s = document.querySelector('#galley-reader').shadowRoot;
      const bar = s.querySelector('.mr-since');
      const shown = [...s.querySelectorAll('.mr-document:not(.mr-overview):not([hidden])')];
      return {
        bar: bar.hidden ? null : { title: bar.querySelector('.mr-since-title').textContent, meta: bar.querySelector('.mr-since-meta').textContent },
        buttons: [...bar.querySelectorAll('button')].map((button) => button.textContent),
        foot: s.querySelector('.mr-reviewed-text').textContent,
        files: shown.map((section) => section.getAttribute('aria-label')),
        chips: [...s.querySelectorAll('.mr-chip.is-updated')].map((chip) => chip.textContent),
        inserted: s.querySelectorAll('.mr-document:not([hidden]) ins, .mr-document:not([hidden]) [data-mr-change="added"]').length,
        overflow: document.documentElement.scrollWidth > innerWidth || s.querySelector('.mr-root').scrollWidth > innerWidth,
        sinceBox: bar.hidden ? null : bar.getBoundingClientRect().toJSON(),
        buttonBoxes: [...s.querySelectorAll('.mr-since button, .mr-reviewed button')].map((button) => button.getBoundingClientRect().toJSON()),
      };
    });
  const settled = () =>
    page.waitForFunction(() => {
      const s = document.querySelector('#galley-reader')?.shadowRoot;
      return s && ![...s.querySelectorAll('.mr-skeleton')].some((el) => !el.closest('[hidden]'));
    });
  const click = (selector) =>
    inspect((selector) => {
      document.querySelector('#galley-reader').shadowRoot.querySelector(selector).click();
    }, selector);

  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${demoUrl}/?closed`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.setItem('galley:settings', JSON.stringify({ theme: 'paper', appearance: 'light', mode: 'changes' })));
  await page.goto(`${demoUrl}/?updated`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('#galley-reader')?.shadowRoot.querySelector('.mr-since')?.hidden);
  await settled();
  await page.evaluate(() => document.fonts.ready);

  let state = await reader();
  assert.deepEqual(state.bar, { title: 'New changes since you last opened this', meta: '2 of 3 files changed since aaaaaaa.' });
  assert.deepEqual(state.buttons, ['Show only what changed', 'Mark as reviewed']);
  assert.equal(state.foot, 'Mark this version as reviewed to see what changes after it.');
  assert.equal(state.files.length, 3, 'the whole review is shown first');
  assert.deepEqual(state.chips, ['Updated since aaaaaaa', 'Updated since aaaaaaa'], 'the two files that changed say so');
  assert.equal(state.overflow, false);
  await page.screenshot({ path: join(screenshots, 'galley-since-bar-desktop.png') });

  // U reads only what changed, against the version the reader was last at.
  await page.keyboard.press('u');
  await page.waitForFunction(() =>
    document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-since-title').textContent.startsWith('Showing what changed'),
  );
  await settled();
  state = await reader();
  assert.deepEqual(state.bar, {
    title: 'Showing what changed since aaaaaaa',
    meta: '2 of 3 files, aaaaaaa → bbbbbbb. To comment on removed text, show the whole review.',
  });
  assert.deepEqual(state.buttons, ['Show the whole review', 'Mark as reviewed']);
  assert.deepEqual(
    state.files,
    ['docs/rfcs/0042-reading-first-reviews.md', 'docs/adr/0007-render-markdown-in-the-browser.md'],
    'the README did not change since',
  );
  assert.deepEqual(state.chips, [], 'every file shown changed, so none needs saying');
  const insertedLines = await inspect(() => {
    const s = document.querySelector('#galley-reader').shadowRoot;
    const rfc = s.querySelector('.mr-document[aria-label="docs/rfcs/0042-reading-first-reviews.md"]');
    return [...rfc.querySelectorAll('[data-mr-change="added"]')].map((el) => el.textContent.trim().slice(0, 40));
  });
  assert.ok(
    insertedLines.some((line) => line.includes('We review prose')),
    `the quote added since is marked: ${insertedLines.join(' | ')}`,
  );
  assert.ok(!insertedLines.some((line) => line.includes('Render changed documents')), 'text from before is not marked as new');
  await page.screenshot({ path: join(screenshots, 'galley-since-view-desktop.png') });

  // Back to the whole review with the same key.
  await page.keyboard.press('u');
  await settled();
  state = await reader();
  assert.equal(state.files.length, 3);
  assert.equal(state.bar.title, 'New changes since you last opened this');

  // Marking the version reviewed puts the comparison away, and it is remembered after a reload.
  await click('.mr-reviewed [data-act="mark-reviewed"]');
  await page.waitForFunction(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-since').hidden);
  state = await reader();
  assert.match(state.foot, /^Marked as reviewed at bbbbbbb\.$/);
  assert.deepEqual(state.chips, []);
  await page.screenshot({ path: join(screenshots, 'galley-since-marked-desktop.png') });

  // A phone: the card stacks, and every control is large enough to touch.
  await page.goto(`${demoUrl}/?updated`, { waitUntil: 'networkidle0' });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => !document.querySelector('#galley-reader')?.shadowRoot.querySelector('.mr-since')?.hidden);
  await settled();
  state = await reader();
  assert.equal(state.overflow, false, 'no sideways scrolling on a phone');
  for (const box of state.buttonBoxes) assert.ok(box.height >= 44 && box.width >= 44, `touch target ${JSON.stringify(box)}`);
  assert.ok(state.sinceBox.right <= 390 - 8, `the card fits: ${JSON.stringify(state.sinceBox)}`);
  await page.screenshot({ path: join(screenshots, 'galley-since-bar-mobile.png') });
  assert.deepEqual(errors, [], 'no page errors');
  await page.close();
}
