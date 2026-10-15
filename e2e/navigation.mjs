// Moving around GitHub without loading a page (a click from the pull request list to a pull request) in the shipped extension.
// The browser keeps telling the background worker the address the page was loaded at, so the worker has to ask the tab where it is now.
// GitHub's API is answered from the worker's own network, so nothing real is read.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

export async function checkNavigation(executablePath) {
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, enableExtensions: [resolve('dist/chrome')], args: ['--no-sandbox'] });
  try {
    const workerTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'));
    const worker = await workerTarget.createCDPSession();
    const asked = [];
    // GitHub's API allows cross-origin reads, and the worker is subject to the same rule as a page: without this header its fetch fails.
    const cors = { name: 'access-control-allow-origin', value: '*' };
    const json = (body) => ({
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }, cors],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    });
    worker.on('Fetch.requestPaused', ({ requestId, request }) => {
      const { pathname } = new URL(request.url);
      asked.push(pathname);
      const sha = (letter) => letter.repeat(40);
      let answer = { responseCode: 404, responseHeaders: [cors], body: '' };
      if (/\/pulls\/\d+$/.test(pathname))
        answer = json({ title: 'Update the guide', body: '', user: { login: 'dana' }, base: { sha: sha('a') }, head: { sha: sha('b'), ref: 'guide' } });
      else if (/\/pulls\/\d+\/files$/.test(pathname))
        answer = json([
          {
            filename: 'README.md',
            status: 'modified',
            changes: 2,
            patch: '@@ -1 +1 @@\n-Old\n+New',
            raw_url: `https://github.com/acme/docs/raw/${sha('b')}/README.md`,
          },
        ]);
      void worker.send('Fetch.fulfillRequest', { requestId, ...answer });
    });
    await worker.send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] });

    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return void request.continue();
      if (request.isNavigationRequest())
        return void request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>acme/docs</title><h1>acme/docs</h1>' });
      void request.respond({ status: 404, body: '' });
    });
    const launcher = () =>
      page.evaluate(() => {
        const button = document.querySelector('#galley-launcher')?.shadowRoot.querySelector('.launch');
        return button ? { error: button.classList.contains('is-error'), count: button.querySelector('.count')?.textContent } : null;
      });
    const reader = () => page.evaluate(() => document.querySelector('#galley-reader')?.shadowRoot.querySelector('.mr-message')?.textContent ?? null);

    // A list page first: nothing to read there, so the extension is quiet and the worker has seen no request.
    await page.goto('https://github.com/acme/docs/pulls', { waitUntil: 'networkidle0' });
    assert.equal(await launcher(), null);
    assert.deepEqual(asked, []);

    // Then the way GitHub moves between its pages: the address changes, no page loads.
    await page.evaluate(() => history.pushState({}, '', '/acme/docs/pull/13'));
    await page.waitForFunction(() => document.querySelector('#galley-launcher')?.shadowRoot.querySelector('.count')?.textContent !== undefined, {
      timeout: 10_000,
    });
    await page
      .waitForFunction(() => document.querySelector('#galley-launcher')?.shadowRoot.querySelector('.count')?.textContent === '1', { timeout: 10_000 })
      .catch(() => {});
    const state = await launcher();
    assert.deepEqual(
      state,
      { error: false, count: '1' },
      `Read must count the file of the pull request the tab moved to, not report an error: ${JSON.stringify(state)} after ${asked.join(', ')}`,
    );
    assert.ok(asked.includes('/repos/acme/docs/pulls/13'), `The worker was asked about pull request 13: ${asked.join(', ')}`);
    assert.equal(await reader(), null);

    // And on to another pull request, still without a page load. The button from the last one is on screen, so wait on the worker.
    await page.evaluate(() => history.pushState({}, '', '/acme/docs/pull/14'));
    for (let waited = 0; !asked.includes('/repos/acme/docs/pulls/14/files') && waited < 10_000; waited += 100)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(asked.includes('/repos/acme/docs/pulls/14/files'), `The worker was asked about pull request 14: ${asked.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(await launcher(), { error: false, count: '1' });
    assert.deepEqual(errors, []);
    console.log('Navigation: moving from a list to a pull request, and to another, reads each one with no page load.');
  } finally {
    await browser.close();
  }
}
