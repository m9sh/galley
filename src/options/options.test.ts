import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { indexDocument } from '../core/docindex.ts';
import { rememberOutlines } from '../ui/library/outline-cache.ts';

const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const html = readFileSync('src/options/options.html', 'utf8');

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.innerHTML = html;
});
afterEach(() => document.body.replaceChildren());

async function open() {
  await import('./options.ts');
  await vi.waitFor(() => expect(q<HTMLInputElement>('#read-button').disabled).toBe(false));
}

it('keeps the existing button by default, saves only the opening choice, and announces its state', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ font: 'mono' }));
  await open();
  const control = q<HTMLInputElement>('#read-button');
  expect(control.checked).toBe(true);
  expect(control.getAttribute('role')).toBe('switch');
  expect(control.getAttribute('aria-checked')).toBe('true');
  control.click();
  await vi.waitFor(() => expect(q('#status').textContent).toContain('button is off'));
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(JSON.parse(localStorage.getItem('galley:settings')!)).toMatchObject({ font: 'mono', readButton: false });
  control.click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('The Read button is on.'));
});

it('keeps the saved choice when writing fails, and can read settings again after a read failure', async () => {
  localStorage.setItem('galley:settings', '{bad');
  await import('./options.ts');
  await vi.waitFor(() => expect(q('#retry').hidden).toBe(false));
  expect(q<HTMLInputElement>('#read-button').disabled).toBe(true);
  expect(q('#status').textContent).toContain('could not be read');
  localStorage.setItem('galley:settings', JSON.stringify({ readButton: false }));
  q('#retry').click();
  await vi.waitFor(() => expect(q<HTMLInputElement>('#read-button').disabled).toBe(false));
  const control = q<HTMLInputElement>('#read-button');
  expect(control.checked).toBe(false);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  control.click();
  await vi.waitFor(() => expect(q('#status').textContent).toContain('not saved'));
  expect(control.checked).toBe(false);
  expect(control.disabled).toBe(false);
});

const outline = (path: string) => ({ path, blob: `blob-${path}`, doc: indexDocument(path, `# ${path}`) });
const remembered = () => q('#remembered').textContent;

it('remembering project outlines is off until it is turned on, and says what is kept', async () => {
  await open();
  const control = q<HTMLInputElement>('#remember-outlines');
  expect(control.checked).toBe(false);
  expect(control.getAttribute('role')).toBe('switch');
  expect(remembered()).toBe('Nothing is remembered now.');
  expect(q<HTMLButtonElement>('#forget-outlines').disabled).toBe(true);
  control.click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('Galley will remember project outlines on this device.'));
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(JSON.parse(localStorage.getItem('galley:settings')!)).toMatchObject({ rememberOutlines: true, readButton: true });
  expect(control.disabled).toBe(false);
});

it('shows what is remembered and forgets it on request, without touching anything else', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ rememberOutlines: true, theme: 'nord' }));
  await rememberOutlines('github:https://github.com/acme/one', 'https://github.com', [outline('README.md')]);
  await open();
  expect(remembered()).toMatch(/^Remembered now: 1 project, about 1 KB\.$/);
  await rememberOutlines('github:https://github.com/acme/two', 'https://github.com', [outline('README.md')]);
  q('#retry').click();
  await vi.waitFor(() => expect(remembered()).toMatch(/^Remembered now: 2 projects, about 1 KB\.$/));
  const forget = q<HTMLButtonElement>('#forget-outlines');
  expect(forget.disabled).toBe(false);
  forget.click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('Galley forgot the project outlines it kept.'));
  expect(remembered()).toBe('Nothing is remembered now.');
  expect(forget.disabled).toBe(true);
  expect(Object.keys(localStorage)).toStrictEqual(['galley:settings']);
  expect(q<HTMLInputElement>('#remember-outlines').checked).toBe(true);
});

it('turning remembering off forgets what was kept', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ rememberOutlines: true }));
  await rememberOutlines('github:https://github.com/acme/one', 'https://github.com', [outline('README.md')]);
  await open();
  q<HTMLInputElement>('#remember-outlines').click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('Galley no longer remembers project outlines, and forgot the ones it kept.'));
  expect(remembered()).toBe('Nothing is remembered now.');
  expect(JSON.parse(localStorage.getItem('galley:settings')!)).toMatchObject({ rememberOutlines: false });
  expect(Object.keys(localStorage)).toStrictEqual(['galley:settings']);
});

it('keeps the switch where it was when the choice cannot be saved, and says when forgetting fails', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ rememberOutlines: false }));
  await rememberOutlines('github:https://github.com/acme/one', 'https://github.com', [outline('README.md')]);
  await open();
  const control = q<HTMLInputElement>('#remember-outlines');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('Full');
  });
  control.click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('Your change was not saved. Try again.'));
  expect(control.checked).toBe(false);
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(control.disabled).toBe(false);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
    throw new Error('Unavailable');
  });
  const forget = q<HTMLButtonElement>('#forget-outlines');
  forget.click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('Galley could not forget them. Try again.'));
  expect(forget.disabled).toBe(false);
  forget.click();
  await vi.waitFor(() => expect(q('#status').textContent).toBe('Galley forgot the project outlines it kept.'));
});
