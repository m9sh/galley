import assert from 'node:assert/strict';
import { join } from 'node:path';

/**
 * The repository reader on the demo handbook (?repo): reading at one commit, following links and coming
 * back to the same paragraph, the documents list, the project map with its evidence, configuration read
 * on request for the architecture view, the reader's notes, and phone layouts.
 */
export async function checkRepository(browser, demoUrl, screenshots) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const inspect = (fn, ...args) => page.evaluate(fn, ...args);
  const click = (selector, text) =>
    inspect(
      (selector, text) => {
        const s = document.querySelector('#galley-repo-reader').shadowRoot;
        const el = [...s.querySelectorAll(selector)].find((candidate) => !text || candidate.textContent.includes(text));
        el.click();
      },
      selector,
      text,
    );
  const settled = () =>
    page.waitForFunction(() => {
      const s = document.querySelector('#galley-repo-reader')?.shadowRoot;
      return s && !s.querySelector('.mr-doc .mr-skeleton');
    });
  const title = () =>
    inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-read:not([hidden]) .mr-lead')?.textContent);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: 'light' },
  ]);
  await page.goto(`${demoUrl}/?closed&repo`, { waitUntil: 'networkidle0' });
  await inspect(() => localStorage.setItem('galley:settings', JSON.stringify({ theme: 'sage', appearance: 'light' })));
  // A repository page offers Read the project, with no count: nothing is fetched until it is chosen.
  const launcher = await inspect(() => {
    const s = document.querySelector('#galley-launcher').shadowRoot;
    return { label: s.querySelector('.label').textContent, count: getComputedStyle(s.querySelector('.count')).display };
  });
  assert.deepEqual(launcher, { label: 'Read the project', count: 'none' });
  await inspect(() => document.querySelector('#galley-launcher').shadowRoot.querySelector('.launch').click());
  // It opens on the map, around the README, which is previewed in the sheet beside the map.
  await page.waitForFunction(() => document.querySelector('#galley-repo-reader')?.shadowRoot.querySelector('.mr-pm-sheet .mr-pm-preview'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const front = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const sheet = s.querySelector('.mr-pm-sheet').getBoundingClientRect();
    const canvas = s.querySelector('.mr-pm-canvas').getBoundingClientRect();
    return {
      middle: s.querySelector('.mr-pm-place[data-lane="here"] strong').textContent,
      title: s.querySelector('.mr-pm-sheet .mr-sheet-title').textContent,
      squeezed: Math.round(canvas.right) <= Math.round(sheet.left),
      top: [...s.querySelectorAll('.mr-tb-right > button:not([hidden])')].map((b) => b.getAttribute('aria-label')),
      back: s.querySelector('[data-act="back-to-map"]').hidden,
      overflow: s.querySelector('.mr-root').scrollWidth > innerWidth,
    };
  });
  assert.deepEqual(front, {
    middle: 'Acme Handbook',
    title: 'Acme Handbook',
    squeezed: true,
    top: ['Chapters', 'Notes', 'Reading main at 4f2c9e1. Check for a newer commit', 'Reading settings'],
    back: true,
    overflow: false,
  });
  await page.screenshot({ path: join(screenshots, 'repo-start-desktop.png') });
  // Read opens it in full, with Back to map as the top bar's way back.
  await click('.mr-pm-sheet [data-act="open"]');
  await settled();
  assert.equal(await title(), 'Acme Handbook');
  const snapshot = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    return {
      at: s.querySelector('.mr-repo-at').textContent,
      commit: s.querySelector('.mr-repo-commit-label').textContent,
      marks: s.querySelectorAll('[data-mr-change], .mr-comment-btn').length,
      overflow: document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').scrollWidth > innerWidth,
    };
  });
  assert.deepEqual(snapshot, { at: 'README.md · main @ 4f2c9e1', commit: '4f2c9e1', marks: 0, overflow: false });

  // A relative link opens the document here, at the same commit, with its contents and its diagram.
  await click('.mr-content p a', 'architecture overview');
  await settled();
  assert.equal(await title(), 'Architecture overview');
  await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-diagram-view')?.dataset.state === 'ready');
  // Focus is a centred article; layouts arrange the library without reserving discussion space.
  const geometry = () =>
    inspect(() => {
      const s = document.querySelector('#galley-repo-reader').shadowRoot;
      const article = s.querySelector('.mr-article').getBoundingClientRect();
      return {
        layout: s.querySelector('.mr-root').dataset.layout,
        width: article.width,
        centre: (article.left + article.right) / 2,
        toc: getComputedStyle(s.querySelector('.mr-toc')).display,
        overflow: s.querySelector('.mr-root').scrollWidth > innerWidth,
      };
    });
  const chooseLayout = async (layout) => {
    await click('[data-act="settings"]');
    await click('[data-settings-tab="layout"]');
    await click(`[data-setting="layout"] [data-value="${layout}"]`);
    await click('.mr-settings-heading [data-act="close-settings"]');
  };
  assert.deepEqual(await geometry(), { layout: 'focus', width: 680, centre: 720, toc: 'none', overflow: false });
  await page.screenshot({ path: join(screenshots, 'repo-focus-desktop.png') });
  await click('[data-act="settings"]');
  await click('[data-settings-tab="layout"]');
  await page.screenshot({ path: join(screenshots, 'repo-layout-settings-desktop.png') });
  await click('.mr-settings-heading [data-act="close-settings"]');
  for (const appearance of ['light', 'dark']) {
    await click('[data-act="settings"]');
    await click('[data-settings-tab="reading"]');
    await click(`[data-setting="appearance"] [data-value="${appearance}"]`);
    if (appearance === 'dark') await click('[data-act="larger"]');
    await click('[data-settings-tab="layout"]');
    await click(`[data-setting="density"] [data-value="${appearance === 'dark' ? 'compact' : 'comfortable'}"]`);
    await click('.mr-settings-heading [data-act="close-settings"]');
    for (const width of [1440, 1280, 390, 320]) {
      await page.setViewport({ width, height: width < 760 ? 844 : 1000 });
      await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').scrollTo({ top: 0 }));
      for (const layout of ['focus', 'balanced', 'wide']) {
        await chooseLayout(layout);
        const measured = await geometry();
        assert.equal(measured.overflow, false, `${layout} at ${width}px (${appearance}) must stay within the window`);
        assert.ok(Math.abs(measured.centre - width / 2) < 1, `${layout} at ${width}px must centre the article: ${JSON.stringify(measured)}`);
        assert.equal(measured.toc, width >= 1280 && layout !== 'focus' ? 'block' : 'none');
        if (width === 1440) assert.equal(measured.width, layout === 'wide' ? 880 : 680);
        if (width === 1440 || (layout === 'focus' && width < 760)) {
          await page.screenshot({ path: join(screenshots, `repo-${layout}-${width}-${appearance}.png`) });
        }
      }
      if (width === 390) {
        await click('[data-act="settings"]');
        await click('[data-settings-tab="layout"]');
        await page.screenshot({ path: join(screenshots, `repo-layout-settings-mobile-${appearance}.png`) });
        await click('.mr-settings-heading [data-act="close-settings"]');
      }
    }
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await click('[data-act="settings"]');
  await click('[data-settings-tab="reading"]');
  await click('[data-setting="appearance"] [data-value="light"]');
  await click('[data-act="smaller"]');
  await click('[data-settings-tab="layout"]');
  await click('[data-setting="density"] [data-value="comfortable"]');
  await click('.mr-settings-heading [data-act="close-settings"]');
  await chooseLayout('balanced');
  const overview = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const toc = s.querySelector('.mr-toc').getBoundingClientRect();
    const article = s.querySelector('.mr-article').getBoundingClientRect();
    return {
      toc: [...s.querySelectorAll('.mr-toc a')].map((a) => a.textContent),
      tocLeftOfText: toc.right <= article.left,
      back: !s.querySelector('[data-act="back-to-map"]').hidden,
    };
  });
  assert.deepEqual(overview, { toc: ['Receiving changes', 'Rendering', 'Operating it'], tocLeftOfText: true, back: true });
  await page.screenshot({ path: join(screenshots, 'repo-read-desktop.png') });

  // A shorter window leaves room below the bookmark: a document's end can clamp any scroll position.
  await page.setViewport({ width: 1440, height: 600 });
  // Back returns to the paragraph the reader left, not to the top.
  await click('.mr-content a', 'RFC 0042');
  await settled();
  let left = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const root = s.querySelector('.mr-root');
    const design = [...s.querySelectorAll('.mr-content p')].find((p) => p.textContent.startsWith('Documents are rendered'));
    root.scrollTo({ top: root.scrollTop + design.getBoundingClientRect().top - 300 });
    return design.getBoundingClientRect().top;
  });
  const bookmark = await inspect(() => {
    const blocks = [...document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-content [data-mr-u]')];
    const first = blocks.find((block) => block.getBoundingClientRect().bottom > 72);
    return { id: first.dataset.mrU, top: first.getBoundingClientRect().top };
  });
  await chooseLayout('wide');
  const afterLayout = await inspect(
    (bookmark) =>
      [...document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-content [data-mr-u]')]
        .find((block) => block.dataset.mrU === bookmark.id)
        .getBoundingClientRect().top,
    bookmark,
  );
  assert.ok(Math.abs(afterLayout - bookmark.top) < 4, `Layout should preserve the first visible block at ${bookmark.top}px, found ${afterLayout}px`);
  await chooseLayout('balanced');
  // Later paragraphs can reflow; Back must restore where this paragraph is when its link is followed.
  left = await inspect(
    () =>
      [...document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-content p')]
        .find((p) => p.textContent.startsWith('Documents are rendered'))
        .getBoundingClientRect().top,
  );
  await click('.mr-content a', 'ADR 0007');
  await settled();
  assert.equal(await title(), 'ADR 0007: Render Markdown in the browser');
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Alt');
  await settled();
  const back = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    return [...s.querySelectorAll('.mr-content p')].find((p) => p.textContent.startsWith('Documents are rendered')).getBoundingClientRect().top;
  });
  assert.ok(Math.abs(back - left) < 4, `Back should restore the paragraph at ${left}px, found it at ${back}px`);

  // The documents list: an outline of folders, searchable from the keyboard.
  await page.keyboard.press('/');
  const list = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    return {
      focused: s.activeElement === s.querySelector('.mr-repo-search'),
      folders: [...s.querySelectorAll('.mr-repo-folder > summary')].map((el) => el.textContent),
      meta: s.querySelector('.mr-files-meta').textContent,
    };
  });
  assert.deepEqual(list, {
    focused: true,
    folders: ['docs/', 'adr/', 'architecture/', 'guides/', 'rfcs/', 'runbooks/'],
    meta: 'main · 4f2c9e1 · 9 documents',
  });
  await page.keyboard.type('deploy');
  await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-repo-results .mr-menu-item').length === 1);
  await click('.mr-repo-results .mr-menu-item');
  await settled();
  assert.equal(await title(), 'Deploying the service');

  // The map: the document in the middle, what links to it and what it links to, with the evidence.
  await page.keyboard.press('m');
  await page.waitForFunction(() =>
    /^Built from all 9/.test(document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-map-status')?.textContent ?? ''),
  );
  // Choosing a place opens its preview beside the map; Show its connections makes it the middle.
  await click('.mr-pm-place[data-id="docs/architecture/overview.md"]');
  await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-pm-preview'));
  await click('.mr-pm-sheet [data-act="pm-focus"]');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const map = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const lane = (name) => s.querySelector(`.mr-pm-lane[data-lane="${name}"]`).getBoundingClientRect();
    const sheet = s.querySelector('.mr-pm-sheet').getBoundingClientRect();
    const canvas = s.querySelector('.mr-pm-canvas').getBoundingClientRect();
    return {
      title: s.querySelector('.mr-pm-place[data-lane="here"] strong').textContent,
      heads: [...s.querySelectorAll('.mr-pm-lane-head')].map((head) => head.textContent),
      lanes: lane('incoming').right <= lane('here').left && lane('here').right <= lane('outgoing').left,
      lines: s.querySelectorAll('.mr-pm-edge').length,
      squeezed: Math.round(canvas.right) <= Math.round(sheet.left),
      space: s.querySelector('.mr-root').classList.contains('is-map-space'),
      overflow: s.querySelector('.mr-root').scrollWidth > innerWidth,
    };
  });
  assert.equal(map.title, 'Architecture overview');
  // RFC 0042 links here only to a section that does not exist: a problem in its sheet, never a line.
  assert.equal(map.heads[0], 'Linked from4');
  assert.equal(map.lanes, true, 'Linked from, in focus and links to read left to right');
  assert.ok(map.lines >= 5, `Each neighbour has a line: ${map.lines}`);
  assert.equal(map.squeezed, true, 'The details sheet narrows the map instead of covering it');
  assert.deepEqual([map.space, map.overflow], [true, false]);
  await page.screenshot({ path: join(screenshots, 'repo-map-desktop.png') });
  // Evidence opens the paragraph that holds the link.
  await click('.mr-pm-place[data-id="docs/runbooks/deploy.md"]');
  await click('.mr-pm-tab[data-tab="links"]');
  await click('.mr-pm-why [data-act="evidence"]');
  await settled();
  assert.equal(await title(), 'Architecture overview');
  const flashed = await inspect(() =>
    [...document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-content p')].some(
      (p) => p.classList.contains('mr-flash') && p.textContent.includes('deploy runbook'),
    ),
  );
  assert.ok(flashed, 'Evidence opens the paragraph that holds the link');

  // A link to a document or section that does not exist is named in the sheet, never drawn.
  await click('.mr-repo-backlinks .mr-repo-edge-doc', 'RFC 0042');
  await settled();
  await page.keyboard.press('m');
  // The map kept its place while the reader read; Back to my place puts the document being read in the middle.
  assert.equal(
    await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-pm-place[data-lane="here"] strong').textContent),
    'Architecture overview',
  );
  await click('[data-act="pm-home"]');
  await click('.mr-pm-sheet .mr-pm-tab[data-tab="links"]');
  const problems = await inspect(() =>
    [...document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('.mr-pm-sheet .mr-map-problems li')].map((li) => li.textContent),
  );
  assert.deepEqual(problems, [
    'RFC 0041 line 15: docs/rfcs/0041-diff-annotations.md is not among the listed documents.',
    'architecture overview line 19: “rendering-pipeline” is not a section of docs/architecture/overview.md.',
  ]);
  await click('.mr-pm-sheet .mr-sheet-close');

  // Phones: one column read top to bottom, details in a bottom sheet, and nothing scrolls sideways.
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const phone = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const root = s.querySelector('.mr-root');
    const lane = (name) => s.querySelector(`.mr-pm-lane[data-lane="${name}"]`).getBoundingClientRect();
    return {
      overflow: root.scrollWidth > innerWidth,
      stacked: s.querySelector('.mr-pm').classList.contains('is-stacked'),
      order: lane('incoming').bottom <= lane('here').top && lane('here').bottom <= lane('outgoing').top,
      name: s.querySelector('.mr-file-name').getBoundingClientRect().width,
      // Chapters and Notes are their icons on a phone, each a full touch target.
      panels: [...s.querySelectorAll('.mr-repo-panel')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)),
    };
  });
  assert.equal(phone.overflow, false);
  assert.equal(phone.stacked, true);
  assert.equal(phone.order, true);
  assert.ok(phone.name > 60, `The document name needs room on a phone, had ${phone.name}px`);
  assert.ok(
    phone.panels.every((size) => size >= 44),
    `Chapters and Notes need 44px targets: ${phone.panels}`,
  );
  await page.screenshot({ path: join(screenshots, 'repo-map-mobile.png') });
  await click('.mr-pm-place[data-lane="here"]');
  const sheet = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const panel = s.querySelector('.mr-pm-sheet');
    const box = panel.getBoundingClientRect();
    return {
      modal: panel.getAttribute('aria-modal'),
      fits: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight + 1,
      targets: [...panel.querySelectorAll('button')].filter((b) => b.getClientRects().length).every((b) => b.getBoundingClientRect().height >= 44),
    };
  });
  assert.deepEqual(sheet, { modal: 'true', fits: true, targets: true });
  await page.screenshot({ path: join(screenshots, 'repo-map-mobile-sheet.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await settled();
  assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-root').scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(screenshots, 'repo-read-mobile.png') });

  // Architecture: configuration is read only when asked, in its own sandboxed frame, and never called running.
  await page.setViewport({ width: 1440, height: 1000 });
  await page.keyboard.press('m');
  await click('[data-act="lens"]', 'Architecture');
  await click('[data-act="read-configs"]');
  await page.waitForFunction(() =>
    /^Read 4 of 4/.test(document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-lens-configs p')?.textContent ?? ''),
  );
  const lens = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    return {
      services: [...s.querySelectorAll('.mr-lens-list .mr-lens-entity')]
        .filter((b) => b.querySelector('.mr-chip').textContent === 'Declared in configuration')
        .map((b) => b.querySelector('.mr-path-name').textContent),
      caveat: s.querySelector('.mr-lens-caveat').textContent,
      frame: s.querySelector('iframe[src*="config-frame"]')?.getAttribute('sandbox'),
    };
  });
  assert.deepEqual(lens, {
    services: ['queue', 'renderer', 'store', 'webhook'],
    caveat: 'Declared means what these files ask for at 4f2c9e1, not what is running.',
    frame: 'allow-scripts',
  });
  await page.screenshot({ path: join(screenshots, 'repo-architecture-desktop.png') });

  // Notes: in the sheet beside the map, kept only when saved, and shown as the reader's own.
  await page.keyboard.press('n');
  assert.equal(
    await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-pm-sheet .mr-sheet-layer').getAttribute('aria-label')),
    'Notes',
  );
  await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('form[data-act="add-note"] textarea').focus());
  await page.keyboard.type('Why a queue and not direct calls?');
  await click('form[data-act="add-note"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelectorAll('aside.mr-note').length === 1);
  await click('[data-act="save-notes"]');
  await page.waitForFunction(() =>
    /^Saved /.test(document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-notes-state')?.textContent ?? ''),
  );
  await page.screenshot({ path: join(screenshots, 'repo-notes-desktop.png') });
  await page.setViewport({ width: 390, height: 844 });
  const notesPhone = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    return {
      // Anything past the right edge, named, so a failure says what to fix.
      wide: [...s.querySelectorAll('.mr-root *')]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .map((el) => `${el.tagName} ${el.className}`),
      name: s.querySelector('.mr-file-name').getBoundingClientRect().width,
    };
  });
  assert.deepEqual(notesPhone.wide, []);
  assert.ok(notesPhone.name > 60, `The document name needs room on a phone, had ${notesPhone.name}px`);
  await page.screenshot({ path: join(screenshots, 'repo-notes-mobile.png') });

  // Export is a sheet like the settings: a switch for each note, and it fits a phone.
  await click('[data-act="export"]');
  await click('[data-act="choose-note"]');
  const exportPhone = await inspect(() => {
    const s = document.querySelector('#galley-repo-reader').shadowRoot;
    const panel = s.querySelector('.mr-repo-export .mr-settings-panel').getBoundingClientRect();
    return {
      open: !s.querySelector('.mr-repo-export').hidden,
      fits: panel.left >= 0 && panel.right <= innerWidth,
      included: s.querySelector('[data-act="choose-note"]').getAttribute('aria-checked'),
      preview: s.querySelector('.mr-export-preview').textContent.includes('Why a queue and not direct calls?'),
    };
  });
  assert.deepEqual(exportPhone, { open: true, fits: true, included: 'true', preview: true });
  await page.screenshot({ path: join(screenshots, 'repo-export-mobile.png') });
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-repo-export').hidden), true);

  // Esc closes the notes, then, on the map, the reader.
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-repo-reader').shadowRoot.querySelector('.mr-pm-sheet').hidden), true);
  await page.keyboard.press('Escape');
  assert.equal(await inspect(() => document.querySelector('#galley-repo-reader')), null);
  assert.deepEqual(errors, []);
  await page.close();
}
