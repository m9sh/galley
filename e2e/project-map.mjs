import assert from 'node:assert/strict';
import { join } from 'node:path';

const OVERVIEW = 'docs/architecture/overview.md';
const QUEUE = 'docs/adr/0003-queue-for-reviews.md';
const RENDER = 'docs/adr/0007-render-markdown-in-the-browser.md';
const RECORD = 'docs/adr/0001-record-decisions.md';

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
  /** Runs in the page with the prototype's shadow root as its first argument. */
  const within = async (fn, ...args) => {
    const root = await page.evaluateHandle(() => document.querySelector('#galley-map-prototype').shadowRoot);
    try {
      return await page.evaluate(fn, root, ...args);
    } finally {
      await root.dispose();
    }
  };
  const click = (selector) => within((s, selector) => s.querySelector(selector).click(), selector);
  const text = (selector) => within((s, selector) => s.querySelector(selector)?.textContent ?? null, selector);
  const activeAct = () => within((s) => s.activeElement?.dataset.act ?? null);
  const activeId = () => within((s) => s.activeElement?.id ?? null);
  const settle = () => inspect(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const camera = () => within((s) => s.querySelector('.mr-atlas-world').style.transform);
  const doc = () => inspect(() => new URLSearchParams(location.search).get('doc'));
  const untilMap = async () => {
    await page.waitForFunction(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-article').hidden);
    await settle();
  };
  const untilReading = (path) =>
    page.waitForFunction(
      (path) =>
        new URLSearchParams(location.search).get('doc') === path &&
        document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-atlas-article .mr-atlas-path')?.textContent.startsWith(path),
      {},
      path,
    );
  const backToMap = async () => {
    await click('[data-act="return"]');
    await untilMap();
  };
  const sheetBox = () =>
    within((s) => {
      const box = s.querySelector('.mr-atlas-detail').getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    });
  const sheetActions = () => within((s) => [...s.querySelectorAll('.mr-atlas-sheet-actions button')].map((node) => node.dataset.act));
  const open = async (fixture = '') => {
    await page.goto(`${demoUrl}/?atlas=${fixture}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#galley-map-prototype')?.shadowRoot.querySelectorAll('.mr-atlas-place').length > 0);
    await settle();
  };
  const change = (key, value) =>
    within(
      (s, key, value) => {
        if (key === 'font') {
          const select = s.querySelector('#mr-typeface');
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (key === 'size') {
          const sizes = [17, 18, 20, 22, 24];
          let at = sizes.indexOf(parseInt(s.querySelector('.mr-text-size').textContent, 10));
          while (at !== value) {
            s.querySelector(`[data-act="${at < value ? 'larger' : 'smaller'}"]`).click();
            at += at < value ? 1 : -1;
          }
        } else s.querySelector(`[data-setting="${key}"] [data-value="${value}"]`).click();
      },
      key,
      value,
    );
  const places = () => within((s) => [...s.querySelectorAll('.mr-atlas-world .mr-atlas-place')].map((el) => [el.dataset.id, el.offsetLeft, el.offsetTop]));
  const type = (value) =>
    within((s, value) => {
      const input = s.querySelector('.mr-atlas-search input');
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const popup = () =>
    within((s) => ({
      open: !s.querySelector('.mr-atlas-results').hidden,
      expanded: s.querySelector('.mr-atlas-search input').getAttribute('aria-expanded'),
      headings: [...s.querySelectorAll('.mr-atlas-results-heading')].map((node) => node.textContent),
      ids: [...s.querySelectorAll('.mr-atlas-result')].map((node) => node.querySelector('.mr-atlas-result-path')?.textContent ?? node.textContent),
      relations: [...s.querySelectorAll('.mr-atlas-result')].map((node) => node.querySelector('.mr-atlas-result-relation')?.textContent ?? ''),
      active: s.querySelector('.mr-atlas-search input').getAttribute('aria-activedescendant'),
      selected: s.querySelector('.mr-atlas-result[aria-selected="true"]')?.id ?? null,
      marks: [...s.querySelectorAll('.mr-atlas-result mark')].map((node) => node.textContent),
      empty: s.querySelector('.mr-atlas-results-empty').textContent,
      value: s.querySelector('.mr-atlas-search input').value,
      view: s.querySelector('.mr-root').dataset.view,
    }));

  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const savedPreferences = await page.evaluateOnNewDocument(() =>
    localStorage.setItem('galley:settings', JSON.stringify({ theme: 'sepia', appearance: 'auto', font: 'mono', density: 'compact', size: 1, topGlow: false })),
  );
  await open();
  await page.removeScriptToEvaluateOnNewDocument(savedPreferences.identifier);
  assert.deepEqual(
    await within((s) => {
      const root = s.querySelector('.mr-root');
      return [root.dataset.theme, root.dataset.font, root.dataset.density, root.style.getPropertyValue('--body-size'), root.classList.contains('no-top-glow')];
    }),
    ['sepia', 'mono', 'compact', '18px', true],
    'the Map follows saved reading preferences on opening',
  );
  const stored = await inspect(() => localStorage.getItem('galley:settings'));
  await change('size', 2);
  await change('density', 'comfortable');
  await change('font', 'galley');
  await settle();

  // ---- one bar and a full-bleed map
  assert.equal(await text('.mr-atlas-chrome h1'), 'acme/handbook', 'the top bar names the project');
  assert.equal(await within((s) => s.querySelector('[data-act="return"]').hidden), true, 'Back to map appears only while reading');
  const space = await within((s) => {
    const canvas = s.querySelector('.mr-atlas-canvas').getBoundingClientRect();
    const search = s.querySelector('.mr-atlas-search input').getBoundingClientRect();
    return { top: canvas.top, height: canvas.height, width: canvas.width, searchWidth: search.width };
  });
  assert.equal(space.top, 52, 'the map starts right under the one top bar');
  assert.equal(space.width, 1440, 'the map runs edge to edge while details are closed');
  assert.equal(space.height, 948);
  assert.ok(space.searchWidth >= 320, 'search stays prominent in the top bar');
  assert.equal(
    await within((s) => [...s.querySelectorAll('.mr-atlas-world .mr-atlas-place')].every((node) => node.querySelector('.mr-atlas-type svg'))),
    true,
    'every place shows its type icon',
  );
  const decisionCard = await within((s, id) => {
    const node = s.querySelector(`.mr-atlas-world [data-id="${id}"]`);
    return {
      label: node.querySelector('.mr-atlas-type').textContent,
      name: node.querySelector('strong').textContent,
      accessible: node.getAttribute('aria-label'),
      fullTitle: node.title,
      height: node.getBoundingClientRect().height,
    };
  }, QUEUE);
  assert.equal(decisionCard.label, 'ADR 0003');
  assert.equal(decisionCard.name, 'Queue review jobs');
  assert.match(decisionCard.accessible, /^ADR 0003: Queue review jobs, Decision, docs\/adr\//);
  assert.equal(decisionCard.fullTitle, 'ADR 0003: Queue review jobs');
  assert.ok(decisionCard.height <= 100, `cards stay compact at 20px reading size (${decisionCard.height}px)`);
  assert.deepEqual(
    await within((s) =>
      [...s.querySelectorAll('.mr-atlas-lane')].map((lane) => [
        lane.dataset.lane,
        lane.querySelector('.mr-atlas-lane-head').textContent,
        lane.querySelectorAll('.mr-atlas-place').length,
      ]),
    ),
    [
      ['incoming', 'Linked from4', 4],
      ['here', 'In focus', 1],
      ['outgoing', 'Links to2', 2],
    ],
    'the whole neighbourhood is on the map, with counts in the lane headings',
  );
  assert.deepEqual(
    await within((s, id) => {
      const focus = s.querySelector(`.mr-atlas-world [data-id="${id}"]`).getBoundingClientRect();
      const incoming = [...s.querySelectorAll('[data-lane="incoming"] .mr-atlas-place')].map((el) => el.getBoundingClientRect());
      const outgoing = [...s.querySelectorAll('[data-lane="outgoing"] .mr-atlas-place')].map((el) => el.getBoundingClientRect());
      const middle = (boxes) => (boxes[0].top + boxes.at(-1).bottom) / 2;
      return [
        incoming.every((box) => box.right < focus.left),
        outgoing.every((box) => box.left > focus.right),
        Math.abs(middle(incoming) - (focus.top + focus.bottom) / 2) < 2,
        s.querySelector('.mr-atlas-here').closest('.mr-atlas-place').dataset.id,
      ];
    }, OVERVIEW),
    [true, true, true, OVERVIEW],
    'links run left to right through the focus, which sits at the middle of its neighbours, marked You are here',
  );
  const edges = await within((s) =>
    [...s.querySelectorAll('.mr-atlas-edge')].map((edge) => [
      edge.classList.contains('is-focus'),
      getComputedStyle(edge).opacity,
      edge.querySelectorAll('.mr-atlas-arrow').length,
    ]),
  );
  assert.equal(edges.filter(([focus]) => focus).length, 6, 'one line per neighbour of the focus');
  assert.ok(
    edges.filter(([focus]) => focus).every(([, opacity, arrows]) => opacity === '1' && arrows >= 1),
    'lines to and from the focus are visible and show their direction',
  );
  assert.ok(
    edges.filter(([focus]) => !focus).every(([, opacity]) => opacity === '0'),
    'links between two neighbours wait until one of them is pointed at or selected',
  );
  assert.equal(
    await within((s) => [...s.querySelectorAll('.mr-atlas-edge.is-focus')].filter((edge) => edge.querySelectorAll('.mr-atlas-arrow').length === 2).length),
    2,
    'a document that links both ways has an arrow at each end',
  );

  // ---- shared reading settings
  await click('[data-act="settings"]');
  assert.deepEqual(
    await within((s) => [...s.querySelectorAll('[data-settings-tab]')].map((tab) => tab.textContent)),
    ['Reading', 'Layout', 'Keys'],
    'Map uses the readers’ shared settings sheet',
  );
  await change('theme', 'sage');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-shell').inert), true);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(await activeAct(), 'larger');
  await page.keyboard.press('Tab');
  assert.equal(await activeAct(), 'close-settings');
  await click('[data-settings-tab="reading"]');
  await within((s) => s.querySelector('[data-settings-tab="reading"]').focus());
  await page.keyboard.press('ArrowRight');
  assert.equal(await within((s) => s.querySelector('[data-settings-tab="layout"]').getAttribute('aria-selected')), 'true');
  await click('[data-settings-tab="reading"]');
  await click('[data-act="palette-page"][data-page="3"]');
  assert.equal(await within((s) => s.querySelector('[data-act="palette-next"]').disabled), true);
  await click('[data-act="palette-prev"]');
  await click('[data-act="palette-next"]');
  const glowEnabled = await within((s) => s.querySelector('[data-act="top-glow"]').getAttribute('aria-checked') === 'true');
  await click('[data-act="top-glow"]');
  assert.equal(await within((s) => s.querySelector('.mr-root').classList.contains('no-top-glow')), glowEnabled);
  await click('[data-act="top-glow"]');
  const families = new Set();
  for (const font of ['galley', 'serif', 'sans', 'georgia', 'system', 'mono']) {
    await change('font', font);
    families.add(await within((s) => getComputedStyle(s.querySelector('.mr-atlas-place strong')).fontFamily));
  }
  assert.equal(families.size, 5, 'titles follow all six named typefaces; Galley and Newsreader share the heading face');
  await change('font', 'galley');
  await change('appearance', 'auto');
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: 'dark' },
  ]);
  await page.waitForFunction(() => document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-root').classList.contains('is-dark'));
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  await page.waitForFunction(() => !document.querySelector('#galley-map-prototype').shadowRoot.querySelector('.mr-root').classList.contains('is-dark'));
  await change('appearance', 'light');
  await page.keyboard.press('Escape');
  assert.equal(await activeAct(), 'settings');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-shell').inert), false);
  await page.keyboard.press('?');
  assert.equal(await within((s) => s.querySelector('[data-settings-tab="keys"]').getAttribute('aria-selected')), 'true');
  await page.keyboard.press('Escape');

  // ---- the search popup: suggestions, ranked matches, the keyboard, and never a change of view
  await page.keyboard.press('/');
  assert.equal(await within((s) => s.activeElement === s.querySelector('.mr-atlas-search input')), true, '/ finds a document');
  let found = await popup();
  assert.equal(found.open, true, 'focusing search opens the popup');
  assert.equal(found.expanded, 'true');
  assert.deepEqual(found.headings, ['Around Architecture overview'], 'an empty field suggests the places on this map');
  assert.deepEqual(found.relations.slice(0, 2), ['In focus', 'On the map']);
  assert.equal(found.active, null, 'nothing is chosen until the reader types or moves');
  await type('no-such-place');
  found = await popup();
  assert.equal(found.empty, 'No document matches “no-such-place”.');
  assert.deepEqual(found.ids, []);
  await type('Architecture');
  found = await popup();
  assert.deepEqual(found.headings, ['2 matches']);
  assert.deepEqual(found.ids, [OVERVIEW, RECORD], 'a title that starts with the words comes first');
  assert.equal(found.active, 'mr-atlas-result-0', 'the best match is ready for Enter');
  assert.equal(found.selected, 'mr-atlas-result-0');
  assert.deepEqual(found.marks, ['Architecture', 'architecture', 'architecture'], 'matched words are marked in names and paths');
  assert.equal(found.view, 'map', 'search never replaces the Map');
  await page.keyboard.press('ArrowDown');
  assert.equal((await popup()).active, 'mr-atlas-result-1');
  await page.keyboard.press('Enter');
  await settle();
  found = await popup();
  assert.deepEqual([found.open, found.expanded, found.value], [false, 'false', ''], 'choosing closes the popup and clears the field');
  assert.deepEqual(
    await within((s) => [
      s.querySelector('.mr-atlas-place.is-focus').dataset.id,
      s.querySelector('.mr-atlas-detail').dataset.id,
      s.querySelector('.mr-atlas-detail').dataset.tab,
      s.activeElement.dataset.id,
    ]),
    [RECORD, RECORD, 'preview', RECORD],
    'a document off the map becomes the new centre, previewed in the sheet, with focus on its place',
  );
  await type('queue');
  const option = await within((s) => {
    const box = s.querySelector('.mr-atlas-result').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await page.mouse.click(option.x, option.y);
  await settle();
  assert.deepEqual(
    await within(
      (s, id) => [s.querySelector('.mr-atlas-place.is-focus').dataset.id, s.querySelector(`.mr-atlas-world [data-id="${id}"]`).getAttribute('aria-pressed')],
      QUEUE,
    ),
    [RECORD, 'true'],
    'a document already on the map is selected where it is, and the map stays still',
  );
  await type('rev');
  await page.keyboard.press('Escape');
  found = await popup();
  assert.deepEqual([found.open, found.value], [false, 'rev'], 'the first Escape closes the popup');
  await page.keyboard.press('Escape');
  assert.equal((await popup()).value, '', 'the second clears the field');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').classList.contains('is-open')), true, 'neither closes the sheet');
  await page.keyboard.press('ArrowDown');
  found = await popup();
  assert.deepEqual([found.open, found.headings[0], found.active], [true, 'Recent', 'mr-atlas-result-0'], 'arrows open the suggestions, recent first');
  await page.keyboard.press('Tab');
  assert.equal((await popup()).open, false, 'leaving the field closes the popup');
  await click('[data-act="home"]');
  await click('[data-act="close-details"]');

  // ---- the push sheet: List and details scroll on their own, the shell never scrolls
  await page.setViewport({ width: 1280, height: 720 });
  await click('[data-act="list"]');
  await settle();
  await click(`.mr-atlas-list [data-id="${RENDER}"]`);
  const listSheet = await sheetBox();
  await within((s) => {
    s.querySelector('.mr-atlas-list').scrollTop = 180;
    s.querySelector('.mr-atlas-sheet-body').scrollTop = 80;
  });
  assert.deepEqual(await sheetBox(), listSheet, 'the sheet stays in place while List and its contents scroll');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-list').scrollTop), 180, 'List has its own scrolling region');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-sheet-body').scrollTop), 80, 'long sheet contents scroll independently');
  assert.equal(
    await within((s) => {
      const root = s.querySelector('.mr-root');
      return root.scrollHeight <= root.clientHeight + 2;
    }),
    true,
    'the desktop shell stays within the viewport',
  );
  await click('.mr-atlas-detail [data-act="read"]');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').classList.contains('is-open')), false, 'reading takes the whole width');
  assert.equal(await doc(), RENDER, 'the document being read is in the address');
  assert.deepEqual(
    await within((s) => [
      s.querySelector('[data-act="return"]').hidden,
      s.querySelector('[data-act="return"]').closest('.mr-atlas-chrome') !== null,
      s.querySelector('.mr-atlas-reading').textContent,
      [...s.querySelectorAll('.mr-atlas-choices [aria-pressed="true"]')].length,
      s.querySelectorAll('.mr-atlas-article [data-act="return"]').length,
    ]),
    [false, true, 'Render Markdown in the browser', 0, 0],
    'reading puts Back to map and the document’s name in the top bar',
  );
  await backToMap();
  assert.equal(await doc(), null, 'back on the map, the address no longer names a document');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-list').scrollTop), 180, 'reading and returning preserves the List scroll position');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').classList.contains('is-open')), true, 'the sheet the reader left comes back');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-sheet-body').scrollTop), 80, 'with the preview where they left it');
  await click('[data-act="close-details"]');
  await click('[data-act="map"]');
  await click('[data-act="home"]');
  await page.setViewport({ width: 1440, height: 1000 });
  await settle();
  assert.match(await text('.mr-atlas-status'), /9 of 9.*4f2c9e1.*2 unresolved/);
  const closedWidth = await within((s) => s.querySelector('.mr-atlas-canvas').clientWidth);
  assert.equal(await within((s) => s.querySelector('[data-act="details"]').getAttribute('aria-expanded')), 'false');
  await click('[data-act="details"]');
  await settle();
  const pushed = await within((s) => {
    const sheet = s.querySelector('.mr-atlas-detail');
    const box = sheet.getBoundingClientRect();
    return {
      sheet: [box.left, box.top, box.right, box.bottom],
      chrome: s.querySelector('.mr-atlas-chrome').getBoundingClientRect().bottom,
      map: s.querySelector('.mr-atlas-map-view').getBoundingClientRect().right,
      canvas: s.querySelector('.mr-atlas-canvas').clientWidth,
      expanded: s.querySelector('[data-act="details"]').getAttribute('aria-expanded'),
      region: [sheet.getAttribute('role'), sheet.getAttribute('aria-modal')],
      title: sheet.querySelector('h2').textContent,
      parts: [...sheet.children].map((child) => child.className),
      tabs: [...sheet.querySelectorAll('[role="tab"]')].map((tab) => [tab.textContent, tab.getAttribute('aria-selected')]),
    };
  });
  assert.deepEqual(pushed.sheet, [1000, pushed.chrome, 1440, 1000], 'details open as a full-height sheet on the right edge');
  assert.ok(pushed.map <= pushed.sheet[0], 'the sheet sits beside the Map instead of covering it');
  assert.equal(pushed.canvas, closedWidth - 440, 'opening details squeezes the Map by the sheet width');
  assert.equal(pushed.expanded, 'true');
  assert.deepEqual(pushed.region, [null, null], 'beside the Map the sheet is not modal');
  assert.equal(pushed.title, 'Architecture overview', 'Details opens the selected document: the focus at first');
  assert.deepEqual(pushed.parts, ['mr-atlas-sheet-header', 'mr-atlas-sheet-body'], 'no footer: the sheet’s actions are in its header');
  assert.deepEqual(
    pushed.tabs,
    [
      ['Preview', 'true'],
      ['Links8', 'false'],
    ],
    'the sheet opens on the document itself; Links counts both directions',
  );
  assert.deepEqual(await sheetActions(), ['read', 'close-details'], 'the focus needs no Show its connections');

  // ---- selection previews, lights lines, and never moves cards or the camera
  const before = await places();
  const startCamera = await camera();
  await within((s, id) => s.querySelector(`.mr-atlas-world [data-id="${id}"]`).focus(), QUEUE);
  await page.keyboard.press('Enter');
  await settle();
  assert.deepEqual(await places(), before, 'selecting must not re-centre the neighbourhood');
  assert.equal(await camera(), startCamera);
  assert.equal(await within((s, id) => s.activeElement?.dataset.id === id, QUEUE), true, 'selection keeps keyboard focus on the place beside the sheet');
  assert.deepEqual(await within((s) => [s.querySelector('.mr-atlas-detail').dataset.tab, s.querySelector('.mr-atlas-detail').getAttribute('aria-label')]), [
    'preview',
    'Document preview',
  ]);
  assert.deepEqual(await sheetActions(), ['focus', 'read', 'close-details'], 'Show its connections, Read and Close sit together at the top');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-preview h1').hidden), true, 'the sheet names the document once');
  const lit = await within((s) =>
    [...s.querySelectorAll('.mr-atlas-edge')]
      .map((edge) => [edge.dataset.from.split('/').pop(), edge.dataset.to.split('/').pop(), edge.classList.contains('is-lit'), getComputedStyle(edge).opacity])
      .filter(([, , isLit]) => isLit),
  );
  // A link both ways is one line, recorded under whichever document the index read first.
  assert.deepEqual(
    lit.map(([from, to, , opacity]) => `${[from, to].sort().join(' – ')} ${opacity}`).sort(),
    ['0003-queue-for-reviews.md – 0007-render-markdown-in-the-browser.md 1', '0003-queue-for-reviews.md – overview.md 1'],
    'selecting a neighbour lights all of its lines on the map, including links to other neighbours',
  );
  assert.equal(await within((s) => getComputedStyle(s.querySelector('.mr-atlas-edge.is-dim')).opacity), '0.18');
  await within((s) => s.querySelector('#mr-atlas-tab-preview').focus());
  await page.keyboard.press('ArrowRight');
  assert.equal(await activeId(), 'mr-atlas-tab-links', 'arrow keys move between the sheet’s tabs');
  const why = await text('.mr-atlas-why');
  assert.match(why, /^How it connects to Architecture overview/);
  assert.match(why, /Architecture overview links here.*Receiving changes · line 14 · 4f2c9e1/s, 'Links opens with the sentence that put it on the map');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').dataset.tab), 'preview');

  // ---- Preview: links inside it, and the full reader with the address and the browser's Back
  await click(`.mr-atlas-world [data-id="${OVERVIEW}"]`);
  await settle();
  const previewCamera = await camera();
  const preview = await within((s) => {
    const detail = s.querySelector('.mr-atlas-detail');
    return {
      text: s.querySelector('.mr-atlas-preview .mr-content').textContent,
      articleHidden: s.querySelector('.mr-atlas-article').hidden,
      mapHidden: s.querySelector('.mr-atlas-map-view').hidden,
      width: detail.getBoundingClientRect().width,
      overflow: detail.scrollWidth > detail.clientWidth + 1,
      waitingDiagram: [...detail.querySelectorAll('.mr-diagram-view')].some((node) => !node.hidden),
    };
  });
  assert.match(preview.text, /The reviews service turns a merge request/);
  assert.equal(preview.articleHidden, true);
  assert.equal(preview.mapHidden, false);
  assert.equal(preview.waitingDiagram, false, 'unrendered diagrams show readable source without an endless loading message');
  assert.equal(preview.overflow, false);
  assert.equal(preview.width, 440);
  assert.deepEqual(await places(), before, 'previewing never moves map cards');
  assert.equal(await camera(), previewCamera);
  await click(`.mr-atlas-preview a[data-mr-path="${QUEUE}"]`);
  assert.match(await text('.mr-atlas-preview'), /The webhook receiver only enqueues a job/, 'following a document link stays in the preview');
  assert.equal(
    await within((s, id) => s.querySelector(`.mr-atlas-world [data-id="${id}"]`).getAttribute('aria-pressed'), QUEUE),
    'true',
    'the map marks the previewed place',
  );
  await click('.mr-atlas-detail [data-act="read"]');
  await untilReading(QUEUE);
  await click(`.mr-atlas-article a[data-mr-path="${RENDER}"]`);
  await untilReading(RENDER);
  assert.equal(await text('.mr-atlas-reading'), 'Render Markdown in the browser');
  await inspect(() => history.back());
  await untilReading(QUEUE);
  assert.equal(await text('.mr-atlas-reading'), 'Queue review jobs', 'the browser’s Back returns to the previous document');
  await inspect(() => history.back());
  await untilMap();
  assert.equal(await doc(), null, 'and then to the map');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').dataset.tab), 'preview', 'returning from the reader restores the preview');
  await inspect(() => history.forward());
  await untilReading(QUEUE);
  await click(`.mr-atlas-article a[data-mr-path="${RENDER}"]`);
  await untilReading(RENDER);
  await backToMap();
  assert.equal(await doc(), null, 'Back to map retraces every document read since the map');
  assert.equal(await activeId(), 'mr-atlas-tab-preview');
  await click('#mr-atlas-tab-links');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail [data-act="read"]').dataset.id), QUEUE);

  // ---- a line is its own evidence: pointing at it and selecting it
  await click(`.mr-atlas-world [data-id="${OVERVIEW}"]`);
  await settle();
  const line = await within((s, id) => {
    // Connection ids hold a NUL separator, which a CSS selector cannot match.
    const path = [...s.querySelectorAll('.mr-atlas-hit')].find((node) => node.dataset.id === id);
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: Math.round(m.a * point.x + m.c * point.y + m.e), y: Math.round(m.b * point.x + m.d * point.y + m.f) };
  }, `${OVERVIEW}\u0000${QUEUE}`);
  await page.mouse.move(line.x, line.y);
  assert.equal(
    await within(
      (s, id) => getComputedStyle([...s.querySelectorAll('.mr-atlas-hit')].find((node) => node.dataset.id === id).previousElementSibling).stroke,
      `${OVERVIEW}\u0000${QUEUE}`,
    ),
    await within((s) => getComputedStyle(s.querySelector('.mr-atlas-place[aria-pressed="true"]')).outlineColor),
    'pointing at a line lights it in the accent',
  );
  await page.mouse.click(line.x, line.y);
  assert.match(await text('.mr-atlas-detail'), /Receiving changes · line 14 · 4f2c9e1/);
  assert.equal(await text('.mr-atlas-detail h2'), 'Link evidence');
  assert.equal(await text('.mr-atlas-sheet-back'), 'Back to document');
  assert.equal(await activeAct(), 'proof', 'evidence opens on its first source paragraph');

  // ---- the camera: drag, wheel, pinch, keys; the sheet never moves
  const panelBeforePan = await sheetBox();
  const panPoint = await within((s) => {
    const b = s.querySelector('.mr-atlas-canvas').getBoundingClientRect();
    return { x: Math.round(b.left + 80), y: Math.round(b.top + 15) };
  });
  await page.mouse.move(panPoint.x, panPoint.y);
  await page.mouse.down();
  await page.mouse.move(panPoint.x - 30, panPoint.y + 10);
  await page.mouse.up();
  assert.match(await camera(), /translate\(-30px, 10px\) scale\(1\)/);
  assert.deepEqual(await sheetBox(), panelBeforePan, 'panning the Map never moves the sheet');
  await page.mouse.wheel({ deltaX: 20, deltaY: 40 });
  assert.match(await camera(), /translate\(-50px, -30px\) scale\(1\)/, 'a trackpad or wheel scrolls the map');
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: 100 });
  await page.keyboard.up('Control');
  assert.match(await camera(), /scale\(0\.72\)/, 'pinching zooms the map');
  await click('[data-act="fit"]');
  assert.match(await camera(), /translate\(0px, 0px\) scale\(1\)/, 'Fit shows the neighbourhood at full size when it fits');
  await within((s) => s.querySelector('.mr-atlas-canvas').focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  const keyed = await camera();
  assert.match(keyed, /scale\(1\.1\)/);
  await click('[data-act="proof"]');
  await untilReading(OVERVIEW);
  const proof = await within((s) => ({
    paragraph: s.querySelector('.mr-atlas-article .mr-flash')?.textContent,
    focused: s.activeElement.dataset.act,
  }));
  assert.match(proof.paragraph, /Why a queue and not direct calls/i);
  assert.equal(proof.focused, 'return', 'reading starts with focus on Back to map');
  await page.keyboard.press('Escape');
  await untilMap();
  assert.equal(await camera(), keyed, 'returning keeps the camera');
  assert.deepEqual(await places(), before);
  assert.equal(await text('.mr-atlas-detail h2'), 'Link evidence', 'and the evidence the reader came from');
  assert.equal(await activeAct(), 'proof', 'with focus on the source paragraph they opened');
  await click('[data-act="zoom-out"]');
  await click('[data-act="fit"]');
  assert.match(await camera(), /translate\(0px, 0px\) scale\(1\)/);

  // ---- a link straight to a document
  await page.goto(`${demoUrl}/?atlas&doc=${encodeURIComponent(RENDER)}`, { waitUntil: 'networkidle0' });
  await untilReading(RENDER);
  assert.deepEqual(
    await within((s) => [s.querySelector('[data-act="return"]').hidden, s.querySelector('.mr-atlas-map-view').hidden]),
    [false, true],
    'an address with a document opens it directly',
  );
  await backToMap();
  assert.deepEqual(
    [await doc(), await within((s) => s.querySelector('.mr-atlas-world [aria-pressed="true"]')?.dataset.id ?? null)],
    [null, RENDER],
    'Back to map then shows the map with that document selected',
  );

  // ---- List
  await click('[data-act="list"]');
  assert.equal(await within((s) => s.querySelectorAll('.mr-atlas-list .mr-atlas-place').length), 9);
  assert.deepEqual(
    await within((s) =>
      [...s.querySelectorAll('.mr-atlas-choices button')].map((node) => [
        node.textContent,
        node.title,
        node.getAttribute('aria-pressed'),
        node.querySelector('svg').getAttribute('aria-hidden'),
      ]),
    ),
    [
      ['Map', 'Places and the links between them', 'false', 'true'],
      ['List', 'Every document, by folder', 'true', 'true'],
    ],
    'one spatial view and one organised list, with visible labels and a clear selected state',
  );
  assert.equal(await within((s) => s.querySelectorAll('.mr-atlas-list-group').length), 7);
  assert.equal(await text('[data-folder="docs/adr"] .mr-atlas-folder'), 'docs/adr/3 shown');
  assert.equal(await text(`.mr-atlas-list [data-id="${OVERVIEW}"] .mr-atlas-counts`), '4 linked from · 4 links to', 'rows count links in both directions');
  const types = await within((s) =>
    Object.fromEntries(
      [...s.querySelectorAll('.mr-atlas-list .mr-atlas-place')].map((node) => [node.dataset.kind, node.querySelector('.mr-atlas-type path').getAttribute('d')]),
    ),
  );
  assert.ok(Object.keys(types).length >= 4, 'the real fixture must display several document types');
  assert.equal(new Set(Object.values(types)).size, Object.keys(types).length, 'document types must have distinct icons');
  await click('.mr-atlas-list [data-id="docs/rfcs/0042-reading-first-reviews.md"]');
  await click('#mr-atlas-tab-links');
  assert.match(await text('.mr-atlas-detail'), /rendering-pipeline.*not found/);
  await click('.mr-atlas-list [data-id="README.md"]');
  await click('#mr-atlas-tab-links');
  assert.equal(
    await within((s) => s.querySelector('.mr-atlas-detail [data-direction="outgoing"] .mr-atlas-connection').getAttribute('aria-label')),
    'Inspect evidence: Acme Handbook links to Architecture overview',
  );
  assert.match(await text('.mr-atlas-detail [data-direction="outgoing"] h3'), /^Links to/);
  await click('.mr-atlas-source summary');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-source').open), true);
  assert.match(await text('.mr-atlas-source'), /README.md · 4f2c9e1.*Documented/s);
  await click('.mr-atlas-detail [data-act="read"]');
  await untilReading('README.md');
  await click(`.mr-atlas-article a[data-mr-path="${OVERVIEW}"]`);
  await untilReading(OVERVIEW);
  assert.match(await text('.mr-atlas-article .mr-atlas-path'), /docs\/architecture\/overview.md/);
  await backToMap();
  assert.equal(await within((s) => s.querySelector('.mr-root').dataset.view), 'list', 'Back to map returns to List when the reader came from List');
  assert.equal(await within((s) => s.querySelectorAll('[data-folder="docs/adr"] .mr-atlas-place').length), 3);
  await click('.mr-atlas-detail [data-act="focus"]');
  assert.equal(
    await within((s) => s.querySelector('.mr-atlas-place.is-focus').dataset.id),
    'README.md',
    'Show its connections puts the document at the centre',
  );
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').classList.contains('is-open')), true, 'and keeps its sheet open');
  await click('[data-act="home"]');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-place.is-focus').dataset.id), OVERVIEW, 'Back to my place');
  await click('[data-act="close-details"]');

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
          await click('[data-act="fit"]');
          const layout = await within((s) => {
            const root = s.querySelector('.mr-root');
            const nodes = [...s.querySelectorAll('.mr-atlas-world .mr-atlas-place')].map((el) => el.getBoundingClientRect().toJSON());
            const overlap = nodes.some((a, i) => nodes.slice(i + 1).some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
            const targets = [...s.querySelectorAll('button,summary,input')].filter((el) => el.getClientRects().length && !el.closest('[inert]'));
            return {
              overflow: root.scrollWidth > innerWidth,
              overlap,
              fitted: s.querySelector('.mr-atlas-world').style.transform,
              stacked: root.classList.contains('is-stacked'),
              short: targets.filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent || el.getAttribute('aria-label')),
              contentOverflow: [...s.querySelectorAll('.mr-atlas-place')].some((el) => el.scrollHeight > el.clientHeight + 2),
            };
          });
          assert.equal(layout.overflow, false, `${theme}/${appearance}/${width}/${size}: page overflow`);
          assert.equal(layout.overlap, false, `${width}: overlapping places`);
          assert.equal(layout.stacked, width <= 760, `${width}: three lanes on desktop, one column on phones`);
          if (width > 760) assert.match(layout.fitted, /scale\(1\)/, `${width}/${size}: the neighbourhood fits at full size`);
          assert.equal(layout.contentOverflow, false, `${width}/${size}: card labels must fit inside the card`);
          if (width <= 760) assert.deepEqual(layout.short, [], `${width}: short touch controls`);
          await click('[data-act="list"]');
          const listLayout = await within((s) => {
            const nodes = [...s.querySelectorAll('.mr-atlas-list .mr-atlas-place')];
            return {
              overflow: s.querySelector('.mr-root').scrollWidth > innerWidth,
              cardOverflow: nodes.some((node) => node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2),
              short: nodes.some((node) => node.getBoundingClientRect().height < 44),
            };
          });
          assert.equal(listLayout.overflow, false, `${width}/${size}: organised list must fit the page`);
          assert.equal(listLayout.cardOverflow, false, `${width}/${size}: list names and paths must fit`);
          assert.equal(listLayout.short, false, `${width}/${size}: list touch controls`);
          await click('[data-act="map"]');
          await settle();
          if (theme === 'sage' && ((appearance === 'light' && size === 0) || (appearance === 'dark' && size === 4))) {
            await within((s) => {
              s.querySelector('.mr-root').scrollTop = 0;
            });
            await page.screenshot({ path: join(screenshots, `atlas-${width}-${appearance}.png`) });
          }
        }
    }

  // A canvas narrowed by the sheet stacks its lanes rather than hiding a lane off to the side.
  await page.setViewport({ width: 1000, height: 800 });
  await change('size', 2);
  await change('density', 'comfortable');
  await settle();
  assert.equal(await within((s) => s.querySelector('.mr-root').classList.contains('is-stacked')), false);
  await click('[data-act="details"]');
  await settle();
  assert.deepEqual(
    await within((s) => [
      s.querySelector('.mr-root').classList.contains('is-stacked'),
      s.querySelector('.mr-atlas-world').style.transform,
      s.querySelector('.mr-atlas-lines'),
      s.querySelector('.mr-atlas-canvas').scrollWidth <= s.querySelector('.mr-atlas-canvas').clientWidth,
    ]),
    [true, '', null, true],
    'with the sheet open on a narrow window, the map reads top to bottom',
  );
  await click('[data-act="close-details"]');
  await settle();
  assert.equal(await within((s) => s.querySelector('.mr-root').classList.contains('is-stacked')), false);

  const palettes = await within((s) => [...s.querySelectorAll('[data-setting="theme"] [data-value]')].map((option) => option.dataset.value));
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
  await page.setViewport({ width: 1440, height: 1000 });
  await click(`.mr-atlas-world [data-id="${QUEUE}"]`);
  await click('[data-act="close-details"]');
  for (const theme of palettes)
    for (const appearance of ['light', 'dark']) {
      await change('theme', theme);
      await change('appearance', appearance);
      await click('[data-act="map"]');
      await settle();
      await type('queue');
      const map = await within((s) => {
        // Mixed tokens compute to color(srgb r g b) in 0–1; plain ones to rgb() in 0–255.
        const colour = (value) => {
          const numbers = value.match(/[\d.]+/g).map(Number);
          return value.startsWith('color(') ? numbers.map((n, i) => (i < 3 ? n * 255 : n)) : numbers;
        };
        const root = getComputedStyle(s.querySelector('.mr-root'));
        const card = s.querySelector('.mr-atlas-world .mr-atlas-place');
        const result = s.querySelector('.mr-atlas-result[aria-selected="true"]');
        return {
          bg: colour(root.backgroundColor),
          fg: colour(root.color),
          card: colour(getComputedStyle(card).backgroundColor),
          muted: colour(getComputedStyle(card.querySelector('small')).color),
          border: colour(getComputedStyle(card).borderTopColor),
          line: colour(getComputedStyle(s.querySelector('.mr-atlas-edge.is-dim .mr-atlas-line')).stroke),
          lit: colour(getComputedStyle(s.querySelector('.mr-atlas-edge.is-lit .mr-atlas-line')).stroke),
          pin: colour(getComputedStyle(s.querySelector('.mr-atlas-here')).color),
          pinBg: colour(getComputedStyle(s.querySelector('.mr-atlas-here')).backgroundColor),
          result: colour(getComputedStyle(result.querySelector('.mr-atlas-result-title')).color),
          resultPath: colour(getComputedStyle(result.querySelector('.mr-atlas-result-path')).color),
          resultBg: colour(getComputedStyle(result).backgroundColor),
        };
      });
      await within((s) => s.querySelector('.mr-atlas-search input').blur());
      assert.ok(ratio(map.fg, map.bg) >= 7, `${theme}/${appearance}: page text`);
      assert.ok(ratio(map.fg, map.card) >= 4.5, `${theme}/${appearance}: place names`);
      assert.ok(ratio(map.muted, map.card) >= 4.5, `${theme}/${appearance}: place metadata`);
      assert.ok(ratio(map.line, map.bg) >= 3, `${theme}/${appearance}: connection lines`);
      assert.ok(ratio(map.lit, map.bg) >= 3, `${theme}/${appearance}: lit connection lines`);
      assert.ok(ratio(map.border, map.card) >= 3, `${theme}/${appearance}: place borders`);
      assert.ok(ratio(map.pin, map.pinBg) >= 4.5, `${theme}/${appearance}: You are here`);
      assert.ok(ratio(map.result, map.resultBg) >= 4.5, `${theme}/${appearance}: chosen search result`);
      assert.ok(ratio(map.resultPath, map.resultBg) >= 4.5, `${theme}/${appearance}: chosen search result path`);
      await click('[data-act="list"]');
      const samples = await within((s) => {
        // Mixed tokens compute to color(srgb r g b) in 0–1; plain ones to rgb() in 0–255.
        const colour = (value) => {
          const numbers = value.match(/[\d.]+/g).map(Number);
          return value.startsWith('color(') ? numbers.map((n, i) => (i < 3 ? n * 255 : n)) : numbers;
        };
        return [...s.querySelectorAll('.mr-atlas-list .mr-atlas-place')].map((place) => ({
          kind: place.dataset.kind,
          surface: colour(getComputedStyle(place).backgroundColor),
          rows: colour(getComputedStyle(place.parentElement).backgroundColor),
          name: colour(getComputedStyle(place.querySelector('strong')).color),
          badge: colour(getComputedStyle(place.querySelector('.mr-atlas-type')).color),
          metadata: colour(getComputedStyle(place.querySelector('.mr-atlas-path')).color),
          icon: colour(getComputedStyle(place.querySelector('.mr-atlas-type svg')).color),
        }));
      });
      for (const sample of samples) {
        const surface = sample.surface[3] === 0 ? sample.rows : sample.surface;
        assert.ok(ratio(sample.name, surface) >= 4.5, `${theme}/${appearance}/${sample.kind}: name contrast`);
        assert.ok(ratio(sample.badge, surface) >= 4.5, `${theme}/${appearance}/${sample.kind}: badge contrast`);
        assert.ok(ratio(sample.metadata, surface) >= 4.5, `${theme}/${appearance}/${sample.kind}: path contrast`);
        assert.ok(ratio(sample.icon, surface) >= 3, `${theme}/${appearance}/${sample.kind}: type icon contrast`);
      }
    }

  // ---- phones: a modal bottom sheet over a stacked map
  await click('[data-act="map"]');
  await change('theme', 'sage');
  await change('appearance', 'dark');
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await click(`.mr-atlas-world [data-id="${OVERVIEW}"]`);
  const sheet = await within((s) => {
    const detail = s.querySelector('.mr-atlas-detail');
    return {
      modal: detail.getAttribute('aria-modal'),
      role: detail.getAttribute('role'),
      tab: detail.dataset.tab,
      focus: s.activeElement.getAttribute('aria-label'),
      inert: s.querySelector('.mr-atlas-map-view').inert,
      box: detail.getBoundingClientRect().toJSON(),
    };
  });
  assert.equal(sheet.modal, 'true');
  assert.equal(sheet.role, 'dialog');
  assert.equal(sheet.tab, 'preview');
  assert.equal(sheet.focus, 'Close details');
  assert.equal(sheet.inert, true);
  assert.equal(sheet.box.bottom, 844);
  assert.ok(sheet.box.top >= 0);
  await page.screenshot({ path: join(screenshots, 'atlas-phone-details.png') });
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-detail').contains(s.activeElement)), true);
  await page.keyboard.press('Escape');
  assert.equal(await within((s) => s.activeElement.dataset.id), OVERVIEW);
  assert.equal(await within((s) => s.querySelector('.mr-atlas-map-view').inert), false);
  await click(`.mr-atlas-world [data-id="${OVERVIEW}"]`);
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 844 });
    await settle();
    assert.equal(
      await within((s) => {
        const panel = s.querySelector('.mr-atlas-detail');
        return panel.getAttribute('aria-modal') === 'true' && panel.scrollWidth <= panel.clientWidth + 1 && s.querySelector('.mr-atlas-map-view').inert;
      }),
      true,
      `${width}px: preview fits the modal sheet`,
    );
  }
  await within((s) =>
    [...s.querySelectorAll('.mr-atlas-detail button,.mr-atlas-detail summary,.mr-atlas-detail a[href],.mr-atlas-detail [tabindex="0"]')]
      .filter((node) => node.getClientRects().length && !node.disabled && node.tabIndex !== -1)
      .at(-1)
      .focus(),
  );
  await page.keyboard.press('Tab');
  assert.equal(await activeAct(), 'read', 'preview links participate in the sheet focus trap');
  await page.keyboard.press('Escape');
  assert.equal(await within((s) => s.activeElement.dataset.id), OVERVIEW);
  await page.setViewport({ width: 390, height: 844 });
  await click(`.mr-atlas-world [data-id="${OVERVIEW}"]`);
  await click('.mr-atlas-detail [data-act="read"]');
  await untilReading(OVERVIEW);
  assert.deepEqual(
    await within((s) => {
      const back = s.querySelector('[data-act="return"]').getBoundingClientRect();
      return [back.height >= 44, back.top < 60, s.querySelector('.mr-root').scrollWidth <= innerWidth];
    }),
    [true, true, true],
    'on phones, Back to map sits in the top bar too',
  );
  await backToMap();
  await click('[data-act="list"]');
  await click('.mr-atlas-list [data-id="README.md"]');
  await page.keyboard.press('Escape');
  assert.equal(await within((s) => s.activeElement.closest('.mr-atlas-list') !== null), true);
  await click('[data-act="map"]');

  assert.equal(await inspect(() => localStorage.getItem('galley:settings')), stored, 'preview controls do not persist settings');

  // ---- fixtures: dense, isolated and partly indexed projects
  await page.setViewport({ width: 1440, height: 1000 });
  await open('dense');
  assert.match(await text('.mr-atlas-status'), /309 of 309/);
  assert.ok((await places()).length <= 17, 'at most eight neighbours a side');
  assert.match(await text('[data-lane="incoming"] .mr-atlas-more'), /^Show \d+ more in List$/);
  await click('[data-lane="incoming"] .mr-atlas-more');
  assert.match(await text('.mr-atlas-filter'), /^306 documents connected to Architecture overview/, 'the rest of a lane is one click away in List');
  assert.equal(await within((s) => s.querySelectorAll('.mr-atlas-list .mr-atlas-place').length), 100);
  await click('[data-act="clear-near"]');
  await click('[data-act="list-more"]');
  await click('[data-act="list-more"]');
  await click('[data-act="list-more"]');
  assert.equal(await within((s) => s.querySelectorAll('.mr-atlas-list .mr-atlas-place').length), 309);
  await click('[data-act="map"]');
  await type('demo place');
  found = await popup();
  assert.equal(found.ids.length, 9, 'the popup shows the best eight');
  assert.equal(found.ids.at(-1), 'See all 300 in List', 'and offers the rest in List');
  await within((s) => s.querySelector('.mr-atlas-result-all').click());
  assert.deepEqual(
    await within((s) => [
      s.querySelector('.mr-root').dataset.view,
      s.querySelector('.mr-atlas-filter').textContent,
      s.querySelectorAll('.mr-atlas-list .mr-atlas-place').length,
    ]),
    ['list', 'Matching “demo place”', 100],
  );
  await click('[data-act="clear-query"]');
  assert.equal(await within((s) => s.querySelector('.mr-atlas-filter')), null);
  await open('sparse');
  await click('[data-act="list"]');
  await click('.mr-atlas-list [data-id="docs/synthetic/000.md"]');
  await click('#mr-atlas-tab-links');
  assert.deepEqual(
    await within((s) => [...s.querySelectorAll('.mr-atlas-link-group h3')].map((heading) => heading.textContent)),
    ['Linked from0', 'Links to0'],
    'isolated documents have no indexed links in either direction',
  );
  await click('.mr-atlas-detail [data-act="focus"]');
  assert.equal((await places()).length, 1);
  assert.deepEqual(await within((s) => [...s.querySelectorAll('.mr-atlas-lane-empty')].map((note) => note.textContent)), [
    'No indexed documents link here.',
    'No outgoing document links found.',
  ]);
  await open('partial');
  assert.match(await text('.mr-atlas-status'), /32 of 39/);
  await click('[data-act="list"]');
  assert.match(await text('.mr-atlas-list'), /unindexed documents may be incomplete/);
  await click(`.mr-atlas-list [data-id="${QUEUE}"]`);
  await click('#mr-atlas-tab-links');
  assert.match(await text('.mr-atlas-detail'), /outgoing links are unknown/);
  await click('[data-act="close"]');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype')), null);

  // ---- loading, closing early and failing to read
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
  assert.match(await text('.mr-atlas-status'), /could not be read/);
  assert.equal(await within((s) => s.querySelectorAll('.mr-atlas-place').length), 0);
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-map-prototype')), null);
  page.off('request', fail);

  // ---- record names stay text, and each type keeps its own shape
  let specimen;
  const record = (request) => {
    if (request.url().endsWith(`/samples/repo/${QUEUE}`))
      void request.respond({
        status: 200,
        contentType: 'text/plain',
        body: `---\ntitle: ${JSON.stringify(specimen.title)}\ntype: ${specimen.kind}\n---\n\n# ${specimen.title}`,
      });
    else void request.continue();
  };
  page.on('request', record);
  const icons = new Set();
  for (specimen of [
    { title: 'ADR 0003: Queue review jobs', label: 'ADR 0003', name: 'Queue review jobs', kind: 'decision' },
    { title: 'RFC 0042 — Reading-first reviews', label: 'RFC 0042', name: 'Reading-first reviews', kind: 'spec' },
    { title: 'rfc 12 – A proposal', label: 'RFC 12', name: 'A proposal', kind: 'guide' },
    { title: 'ADR 0003', label: 'Overview', name: 'ADR 0003', kind: 'overview' },
    { title: 'Understanding ADR 0003: Notes', label: 'Architecture', name: 'Understanding ADR 0003: Notes', kind: 'architecture' },
    { title: 'ADR 0003:', label: 'Runbook', name: 'ADR 0003:', kind: 'runbook' },
    { title: 'RFC 42: <img src=x onerror=alert(1)>', label: 'RFC 42', name: '<img src=x onerror=alert(1)>', kind: 'decision' },
  ]) {
    await open();
    const card = await within((s, id) => {
      const node = s.querySelector(`.mr-atlas-world [data-id="${id}"]`);
      return {
        label: node.querySelector('small').textContent,
        name: node.querySelector('strong').textContent,
        shape: node.querySelector('path').getAttribute('d'),
        images: node.querySelectorAll('img').length,
      };
    }, QUEUE);
    assert.equal(card.label, specimen.label);
    assert.equal(card.name, specimen.name);
    assert.equal(card.images, 0, 'record names remain text');
    icons.add(card.shape);
    await click(`.mr-atlas-world [data-id="${QUEUE}"]`);
    assert.equal(await text('.mr-atlas-detail h2'), specimen.name);
    await type('queue');
    assert.equal(await within((s) => s.querySelectorAll('.mr-atlas-results img').length), 0, 'search results stay text');
  }
  page.off('request', record);
  await page.setRequestInterception(false);
  await open('sparse');
  await click('[data-act="list"]');
  icons.add(await within((s) => s.querySelector('[data-id="docs/synthetic/000.md"] path').getAttribute('d')));
  assert.equal(icons.size, 7, 'all seven types have distinct visual shapes');
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  await page.close();
  await captureProjectMaps(browser, demoUrl, screenshots);
  console.log('Project map proposal: evidence, placement, push sheet, search, reading address, camera, list, phone sheet and 80 layouts passed.');
}

/** Matched source, size, palette and widths make the proposal's before/after captures reproducible. */
export async function captureProjectMaps(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() =>
    localStorage.setItem('galley:settings', JSON.stringify({ theme: 'sage', appearance: 'light', font: 'galley', density: 'comfortable', size: 2 })),
  );
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const click = (selector) => page.evaluate((selector) => document.querySelector('#galley-map-prototype').shadowRoot.querySelector(selector).click(), selector);
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
      await settle();
      await page.screenshot({ path: join(screenshots, `map-${kind}-${width}.png`) });
      if (kind === 'prototype') {
        await click('[data-act="list"]');
        await page.screenshot({ path: join(screenshots, `map-prototype-list-${width}.png`) });
        await click('[data-act="map"]');
        await click('[data-act="settings"]');
        await page.screenshot({ path: join(screenshots, `map-prototype-settings-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.keyboard.press('/');
        await page.keyboard.type('rev');
        await settle();
        await page.screenshot({ path: join(screenshots, `map-prototype-search-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelector('#galley-map-prototype').shadowRoot.activeElement?.blur());
        await click(`.mr-atlas-world [data-id="${QUEUE}"]`);
        await settle();
        await page.screenshot({ path: join(screenshots, width === 390 ? 'map-prototype-phone-details.png' : `map-prototype-details-${width}.png`) });
        await click('#mr-atlas-tab-links');
        await page.screenshot({ path: join(screenshots, `map-prototype-links-${width}.png`) });
        await click('.mr-atlas-detail [data-act="read"]');
        await settle();
        await page.screenshot({ path: join(screenshots, `map-prototype-reading-${width}.png`) });
      }
    }
  await page.close();
}
