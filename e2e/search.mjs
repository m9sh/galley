import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Review search in Chrome (RFC 0045): folded files found and opened, the match marked, and the way back. */
export async function checkSearch(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  const reader = () =>
    inspect(() => {
      const s = document.querySelector('#galley-reader').shadowRoot;
      const box = (el) => el.getBoundingClientRect().toJSON();
      return {
        open: !s.querySelector('.mr-search').hidden,
        bar: !s.querySelector('.mr-search-bar').hidden,
        status: s.querySelector('.mr-search-status').textContent,
        popup: box(s.querySelector('.mr-search')),
        focus: s.activeElement?.className ?? null,
        scroll: s.querySelector('.mr-root').scrollTop,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${demoUrl}/?closed`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.setItem('galley:settings', JSON.stringify({ theme: 'paper', appearance: 'light', codeFiles: true, mode: 'changes' })));
  await page.goto(`${demoUrl}/?large`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#galley-reader')?.shadowRoot.querySelectorAll('.mr-symbol-plan').length === 2);
  await page.evaluate(() => document.fonts.ready);
  // The line at the top of the view is the reader's place; Back to where you were must bring it back there.
  const place = () =>
    inspect(() => {
      const s = document.querySelector('#galley-reader').shadowRoot;
      const top = s.querySelector('.mr-root').getBoundingClientRect().top + 60;
      const lines = [...s.querySelectorAll('.mr-code-line')];
      const line = lines.find((el) => el.getBoundingClientRect().top >= top);
      return { index: lines.indexOf(line), top: Math.round(line.getBoundingClientRect().top) };
    });
  await inspect(() => {
    document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-root').scrollTop = 900;
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const before = await place();

  await page.keyboard.press('/');
  await page.keyboard.type('limit');
  await page.waitForFunction(() => /matches\.$/.test(document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-status').textContent));
  let state = await reader();
  assert.equal(state.open, true, '/ opens search');
  assert.equal(state.focus, 'mr-search-field', 'typing goes to the search field');
  assert.ok(state.popup.right <= 1440 && state.popup.bottom <= 1000, 'the popup fits the window');
  const folded = await inspect(() => {
    const s = document.querySelector('#galley-reader').shadowRoot;
    const group = [...s.querySelectorAll('.mr-search-group')].find((el) => el.querySelector('.mr-search-file-name').textContent === 'package-lock.json');
    const option = group.querySelector('.mr-search-result');
    option.scrollIntoView({ block: 'nearest' });
    const box = option.getBoundingClientRect();
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      lockFolded: [...s.querySelectorAll('.mr-quiet-name')].some((el) => el.textContent.endsWith('package-lock.json')),
    };
  });
  assert.equal(folded.lockFolded, true, 'the lockfile starts folded, and is searched all the same');
  await page.screenshot({ path: join(screenshots, 'search-1440.png') });
  await page.mouse.click(folded.x, folded.y);
  await page.waitForFunction(() => {
    const s = document.querySelector('#galley-reader').shadowRoot;
    return s.activeElement?.closest('.mr-document')?.getAttribute('aria-label') === 'package-lock.json';
  });
  const shown = await inspect(() => {
    const s = document.querySelector('#galley-reader').shadowRoot;
    const highlight = CSS.highlights.get('galley-search');
    return {
      stillFolded: [...s.querySelectorAll('.mr-quiet-name')].some((el) => el.textContent.endsWith('package-lock.json')),
      marked: highlight ? [...highlight].map((range) => range.toString().toLowerCase()) : [],
      bar: s.querySelector('.mr-search-bar-text').textContent,
      viewed: s.querySelector('.mr-document[aria-label="package-lock.json"] .mr-file-viewed').getAttribute('aria-checked'),
    };
  });
  assert.equal(shown.stillFolded, false, 'choosing a result opens the folded file');
  assert.deepEqual(shown.marked, ['limit'], 'the found words are marked where they are');
  assert.match(shown.bar, /^“limit” · \d+ of \d+$/);
  assert.equal(shown.viewed, 'false', 'showing a result never marks a file viewed');
  await page.screenshot({ path: join(screenshots, 'search-1440-result.png') });
  await inspect(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-back').click());
  await page.waitForFunction(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-bar').hidden);
  // Nothing may move the page afterwards, such as a scroll towards the result still under way.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const after = await inspect(
    ({ index }) => Math.round([...document.querySelector('#galley-reader').shadowRoot.querySelectorAll('.mr-code-line')][index].getBoundingClientRect().top),
    before,
  );
  assert.ok(Math.abs(after - before.top) < 4, `Back to where you were brings the same line back to the same place (${after} vs ${before.top})`);
  assert.equal(await inspect(() => CSS.highlights.has('galley-search')), false);
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  state = await reader();
  assert.equal(state.open, false, 'Escape closes search first');
  assert.ok(await inspect(() => document.querySelector('#galley-reader')), 'and leaves the reader open');

  // Phones: search opens from the files menu, and every control is a full touch target.
  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-btn').getClientRects().length);
  await inspect(() => document.querySelector('#galley-reader').shadowRoot.querySelector('[data-act="files"]').click());
  await inspect(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-files-search').click());
  await page.keyboard.type('limit');
  await page.waitForFunction(() => /matches\.$/.test(document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-status').textContent));
  state = await reader();
  assert.ok(state.popup.left >= 0 && state.popup.right <= 390, 'the popup fits a phone');
  assert.equal(state.overflow, false);
  await page.screenshot({ path: join(screenshots, 'search-390.png') });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-bar').hidden);
  const targets = await inspect(() =>
    [...document.querySelector('#galley-reader').shadowRoot.querySelectorAll('.mr-search-bar button')]
      .filter((button) => button.getClientRects().length)
      .map((button) => [button.textContent || button.getAttribute('aria-label'), Math.round(button.getBoundingClientRect().height)]),
  );
  for (const [name, height] of targets) assert.ok(height >= 44, `${name} is a touch target (${height}px)`);
  const bar = await inspect(() => document.querySelector('#galley-reader').shadowRoot.querySelector('.mr-search-bar').getBoundingClientRect().toJSON());
  assert.ok(bar.left >= 0 && bar.right <= 390 && Math.abs(bar.left - (390 - bar.right)) < 2, 'the results bar fits a phone, centred from its first frame');
  await page.screenshot({ path: join(screenshots, 'search-390-result.png') });
  assert.deepEqual(errors, []);
  await page.close();
  console.log('Review search: folded files found and opened, the match marked, the way back, Escape, and the phone files menu.');
}
