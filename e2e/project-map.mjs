import assert from 'node:assert/strict';
import { join } from 'node:path';

/** A proposal can be exercised with real index evidence without changing the extension's accepted Map. */
export async function checkProjectMap(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [],
    remote = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(demoUrl) && !request.url().startsWith('data:')) remote.push(request.url());
  });
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  const click = (selector) => inspect((selector) => document.querySelector('#galley-map-prototype').shadowRoot.querySelector(selector).click(), selector);
  const settle = () => inspect(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const open = async (fixture = '') => {
    await page.goto(`${demoUrl}/?atlas=${fixture}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#galley-map-prototype')?.shadowRoot.querySelectorAll('.mr-atlas-place').length > 0);
    await settle();
  };
  const change = (key, value) =>
    inspect(
      (key, value) => {
        const s = document.querySelector('#galley-map-prototype').shadowRoot;
        const select = s.querySelector(`[data-setting="${key}"]`);
        select.value = String(value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
      key,
      value,
    );
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open();
  const stored = await inspect(() => localStorage.getItem('galley:settings'));
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-status').textContent),
    /9 of 9.*4f2c9e1.*2 unresolved/,
  );
  const places = () =>
    inspect(() =>
      [...document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-world .mr-atlas-place')].map((el) => [
        el.dataset.id,
        el.offsetLeft,
        el.offsetTop,
      ]),
    );
  const before = await places();
  await click('.mr-atlas-world [data-id="README.md"]');
  assert.deepEqual(await places(), before, 'inspection must not re-centre the neighbourhood');
  assert.equal(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-here').parentElement.dataset.id),
    'docs/architecture/overview.md',
  );
  await click('.mr-atlas-world [data-id="docs/architecture/overview.md"]');
  await settle();
  await inspect(() => {
    const s = document.querySelector('#galley-map-prototype').shadowRoot;
    const edge = [...s.querySelectorAll('.mr-atlas-edge')].find((el) => el.getAttribute('aria-label').startsWith('Architecture overview links to ADR 0003'));
    edge.click();
  });
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-detail').textContent),
    /Receiving changes · line 14 · 4f2c9e1/,
  );
  const panPoint = await inspect(() => {
    const b = document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-canvas').getBoundingClientRect();
    return { x: Math.round(b.right - 20), y: Math.round(b.top + 15) };
  });
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down();
  await page.mouse.move(panPoint.x - 30, panPoint.y + 10);
  await page.mouse.up();
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-world').style.transform),
    /translate\(-30px, 10px\)/,
  );
  await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-canvas').focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  const camera = await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-world').style.transform);
  await click('[data-act="proof"]');
  const proof = await inspect(() => {
    const s = document.querySelector('#galley-map-prototype').shadowRoot;
    return {
      article: !s.querySelector('.mr-atlas-article').hidden,
      paragraph: s.querySelector('.mr-atlas-article .mr-flash')?.textContent,
      focused: s.activeElement.dataset.act,
    };
  });
  assert.equal(proof.article, true);
  assert.match(proof.paragraph, /Why a queue and not direct calls/i);
  assert.equal(proof.focused, 'return');
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-world').style.transform), camera);
  assert.deepEqual(await places(), before);
  await click('[data-act="fit"]');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-world').style.transform),
    /translate\(0px, 0px\) scale\(1\)/,
  );
  await click('[data-act="list"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-list .mr-atlas-place').length), 9);
  const search = (value) =>
    inspect((value) => {
      const input = document.querySelector('#galley-map-prototype').shadowRoot.querySelector('input');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  await search('no-such-place');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-list').textContent),
    /No indexed name or path matches/,
  );
  await search('Architecture');
  assert.deepEqual(
    await inspect(() =>
      [...document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-list .mr-atlas-place')].map((node) => node.dataset.id),
    ),
    ['docs/adr/0001-record-decisions.md', 'docs/architecture/overview.md'],
  );
  await search('');
  await click('[data-act="list"]');
  await click('.mr-atlas-list [data-id="docs/rfcs/0042-reading-first-reviews.md"]');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-detail').textContent),
    /rendering-pipeline.*not found/,
  );
  await click('.mr-atlas-list [data-id="README.md"]');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-detail').textContent),
    /Acme Handbook links to Architecture overview/,
  );
  await click('[data-act="read"]');
  await click('.mr-atlas-article a[data-mr-path="docs/architecture/overview.md"]');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-article .mr-atlas-path').textContent),
    /docs\/architecture\/overview.md/,
  );
  await click('[data-act="return"]');
  await click('[data-act="overview"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-region').length), 7);
  await click('[data-act="region"][data-folder="docs/adr"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-list .mr-atlas-place').length), 3);
  await click('[data-act="home"]');

  // Every combination is measured; representative captures are retained for actual visual review.
  for (const theme of ['sage', 'paper', 'sepia', 'contrast'])
    for (const appearance of ['light', 'dark']) {
      await change('theme', theme);
      await change('appearance', appearance);
      for (const width of [1440, 1280, 1100, 390, 320])
        for (const [density, size] of [
          ['comfortable', 0],
          ['compact', 4],
        ]) {
          await page.setViewport({ width, height: width <= 760 ? 844 : 1000 });
          await change('density', density);
          await change('size', size);
          await settle();
          const layout = await inspect(() => {
            const s = document.querySelector('#galley-map-prototype').shadowRoot,
              root = s.querySelector('.mr-root');
            const nodes = [...s.querySelectorAll('.mr-atlas-world .mr-atlas-place')].map((el) => el.getBoundingClientRect().toJSON());
            const overlap = nodes.some((a, i) => nodes.slice(i + 1).some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
            const targets = [...s.querySelectorAll('button,summary,input')].filter((el) => el.getClientRects().length && !el.closest('[inert]'));
            return {
              overflow: root.scrollWidth > innerWidth,
              overlap,
              canvasOverflow: s.querySelector('.mr-atlas-world').scrollWidth > s.querySelector('.mr-atlas-canvas').clientWidth + 2,
              short: targets.filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent),
            };
          });
          assert.equal(layout.overflow, false, `${theme}/${appearance}/${width}/${size}: page overflow`);
          assert.equal(layout.overlap, false, `${width}: overlapping places`);
          assert.equal(layout.canvasOverflow, false, `${width}: neighbourhood must fit at readable size`);
          if (width <= 760) assert.deepEqual(layout.short, [], `${width}: short touch controls`);
          if (theme === 'sage' && ((appearance === 'light' && size === 0) || (appearance === 'dark' && size === 4))) {
            await inspect(() => {
              document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-root').scrollTop = 0;
            });
            await page.screenshot({ path: join(screenshots, `atlas-${width}-${appearance}.png`) });
          }
        }
    }

  const palettes = await inspect(() =>
    [...document.querySelector('#galley-map-prototype').shadowRoot.querySelector('[data-setting="theme"]').options].map((option) => option.value),
  );
  const ratio = (first, second) => {
    const luminance = (rgb) =>
      rgb
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(first),
      b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  for (const theme of palettes)
    for (const appearance of ['light', 'dark']) {
      await change('theme', theme);
      await change('appearance', appearance);
      await settle();
      const colours = await inspect(() => {
        const s = document.querySelector('#galley-map-prototype').shadowRoot,
          node = s.querySelector('.mr-atlas-place');
        const colour = (value) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        const root = getComputedStyle(s.querySelector('.mr-root')),
          card = getComputedStyle(node);
        return {
          bg: colour(root.backgroundColor),
          fg: colour(root.color),
          card: colour(card.backgroundColor),
          muted: colour(getComputedStyle(node.querySelector('small')).color),
          line: colour(getComputedStyle(s.querySelector('.mr-atlas-line')).stroke),
          border: colour(card.borderTopColor),
        };
      });
      assert.ok(ratio(colours.fg, colours.bg) >= 7, `${theme}/${appearance}: page text`);
      assert.ok(ratio(colours.fg, colours.card) >= 4.5, `${theme}/${appearance}: place names`);
      assert.ok(ratio(colours.muted, colours.card) >= 4.5, `${theme}/${appearance}: place metadata`);
      assert.ok(ratio(colours.line, colours.bg) >= 3, `${theme}/${appearance}: connection lines`);
      assert.ok(ratio(colours.border, colours.card) >= 3, `${theme}/${appearance}: place borders`);
    }
  await change('theme', 'sage');
  await change('appearance', 'dark');
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await click('.mr-atlas-world [data-id="docs/architecture/overview.md"]');
  const sheet = await inspect(() => {
    const s = document.querySelector('#galley-map-prototype').shadowRoot,
      detail = s.querySelector('.mr-atlas-detail');
    return {
      modal: detail.getAttribute('aria-modal'),
      focus: s.activeElement.textContent,
      inert: s.querySelector('.mr-atlas-map-column').inert,
      box: detail.getBoundingClientRect().toJSON(),
    };
  });
  assert.equal(sheet.modal, 'true');
  assert.equal(sheet.focus, 'Close details');
  assert.equal(sheet.inert, true);
  assert.equal(sheet.box.bottom, 844);
  assert.ok(sheet.box.top >= 0);
  await page.screenshot({ path: join(screenshots, 'atlas-phone-details.png') });
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(
    await inspect(() =>
      document
        .querySelector('#galley-map-prototype')
        .shadowRoot.querySelector('.mr-atlas-detail')
        .contains(document.querySelector('#galley-map-prototype').shadowRoot.activeElement),
    ),
    true,
  );
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.activeElement.dataset.id), 'docs/architecture/overview.md');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-map-column').inert), false);
  await click('[data-act="list"]');
  await click('.mr-atlas-list [data-id="README.md"]');
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.activeElement.closest('.mr-atlas-list') !== null), true);
  await click('[data-act="map"]');

  assert.equal(await inspect(() => localStorage.getItem('galley:settings')), stored, 'preview controls do not persist settings');
  await page.setViewport({ width: 1440, height: 1000 });
  await open('dense');
  assert.match(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-status').textContent), /309 of 309/);
  assert.ok((await places()).length <= 5);
  await click('[data-act="more"]');
  await settle();
  assert.ok((await places()).length <= 17);
  assert.ok(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('[data-act="more"]').textContent.includes('more')));
  await click('[data-act="list"]');
  await click('[data-act="list-more"]');
  await click('[data-act="list-more"]');
  await click('[data-act="list-more"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-list .mr-atlas-place').length), 309);
  await open('sparse');
  await click('[data-act="list"]');
  await click('.mr-atlas-list [data-id="docs/synthetic/000.md"]');
  assert.match(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-detail').textContent), /0 connections/);
  await click('[data-act="focus"]');
  assert.equal((await places()).length, 1);
  await open('partial');
  assert.match(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-status').textContent), /32 of 39/);
  await click('[data-act="list"]');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-list').textContent),
    /unindexed documents may be incomplete/,
  );
  await click('.mr-atlas-list [data-id="docs/adr/0003-queue-for-reviews.md"]');
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-detail').textContent),
    /outgoing links are unknown/,
  );
  await click('[data-act="close"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype')), null);
  await page.setRequestInterception(true);
  let held, resolveHeld;
  const paused = new Promise((resolve) => {
    resolveHeld = resolve;
  });
  const pause = (request) => {
    if (request.url().endsWith('/samples/repo/README.md')) {
      held = request;
      resolveHeld();
    } else void request.continue();
  };
  page.on('request', pause);
  await page.goto(`${demoUrl}/?atlas`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#galley-map-prototype')?.shadowRoot.querySelector('.mr-atlas-status'));
  await paused;
  await click('[data-act="close"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype')), null);
  await held.continue();
  await page.waitForNetworkIdle();
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype')), null, 'late loading must not reopen a closed map');
  page.off('request', pause);
  const fail = (request) => {
    if (request.url().endsWith('/samples/repo/README.md')) void request.abort();
    else void request.continue();
  };
  page.on('request', fail);
  await page.goto(`${demoUrl}/?atlas`, { waitUntil: 'networkidle0' });
  assert.match(
    await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-status').textContent),
    /could not be read/,
  );
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelectorAll('.mr-atlas-place').length), 0);
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype')), null);
  await page.setRequestInterception(false);
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  await page.close();
  await captureProjectMaps(browser, demoUrl, screenshots);
  console.log('Project map proposal: evidence, placement, camera, list, phone sheet and 80 layout combinations passed.');
}

/** Matched source, size, palette and widths make the proposal's before/after captures reproducible. */
export async function captureProjectMaps(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() =>
    localStorage.setItem('galley:settings', JSON.stringify({ theme: 'sage', appearance: 'light', font: 'galley', density: 'comfortable', size: 2 })),
  );
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  for (const kind of ['current', 'prototype'])
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${demoUrl}/?${kind === 'current' ? 'repo=docs/architecture/overview.md' : 'atlas'}`, { waitUntil: 'networkidle0' });
      if (kind === 'current') {
        await page.waitForFunction(() => document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-content'));
        await page.keyboard.press('m');
        await page.waitForFunction(() =>
          /^Built from all 9/.test(document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-map-status')?.textContent ?? ''),
        );
      } else await page.waitForFunction(() => document.querySelector('#galley-map-prototype')?.shadowRoot.querySelector('.mr-atlas-place'));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(screenshots, `map-${kind}-${width}.png`) });
      if (kind === 'prototype' && width === 390) {
        await page.evaluate(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('[data-act="details"]').click());
        await page.screenshot({ path: join(screenshots, 'map-prototype-phone-details.png') });
      }
    }
  await page.close();
}
