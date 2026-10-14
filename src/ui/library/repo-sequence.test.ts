import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../platforms/types.ts';
import { deferred } from '../../testing/reader.ts';
import { handbook, listing, repoHarness, repository } from '../../testing/repo.ts';

const ui = repoHarness();
const chapters = () => ui.click('[data-view="chapters"]');
const add = (path: string) => ui.click(`[data-act="sequence-add"][data-path="${path}"]`);

it('builds a chapter from explicit links or the outline, changes its order and reads each chosen heading', async () => {
  const source = repository();
  await ui.open(source);
  chapters();
  expect(ui.text('.mr-repo-chapters')).toContain('No documents yet');
  expect(ui.text('.mr-sequence-links')).toBe('Links from this document In README.md · 1 link the decision docs/adr/0001-use-markdown.md · line 3 Add');
  expect(ui.all('.mr-library-chapters [data-act="sequence-open"]')).toHaveLength(0);
  ui.click('[data-act="sequence-add"]');
  expect(ui.text('.mr-repo-chapters .mr-seq-stops')).toBe('1 the decision docs/adr/0001-use-markdown.md');
  // A link already in the sequence says so, and choosing it again changes nothing.
  expect(ui.text('.mr-seq-add')).toBe('Added');
  expect(ui.q('.mr-seq-add').getAttribute('aria-label')).toBe('the decision is in your reading sequence');
  ui.click('[data-act="sequence-add"]');
  expect(ui.text('.mr-toast')).toBe('Already in your reading sequence.');
  ui.click('.mr-repo-chapters [data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-outline [data-act="sequence-add"]')).toHaveLength(3));
  const opener = ui.q(`[data-act="sequence-add"][data-path="README.md"]`);
  opener.focus();
  opener.click();
  expect(ui.shadow().activeElement?.getAttribute('data-path')).toBe('README.md');
  ui.key('Escape');
  chapters();
  expect(source.load).toHaveBeenCalledTimes(1);
  ui.click('[data-act="sequence-later"][data-at="0"]');
  expect(ui.text('.mr-seq-stops')).toMatch(/^1 Handbook/);
  ui.click('[data-act="sequence-earlier"][data-at="1"]');
  expect(ui.text('.mr-seq-stops')).toMatch(/^1 the decision/);
  ui.click('.mr-repo-chapters [data-act="sequence-open"]');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('ADR 1: Use Markdown');
  expect(ui.text('.mr-chapter-route')).toContain('1 of 2');
  expect(ui.all('.mr-comment-btn, .mr-viewed')).toHaveLength(0);
  ui.click('.mr-chapter-attachment summary');
  ui.q<HTMLSelectElement>('.mr-chapter-attachment [aria-label="Section to add"]').value = 'context';
  ui.q('.mr-chapter-attachment form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(ui.text('.mr-chapter-attachment [role="status"]')).toContain('Added to Your reading sequence');
  ui.click('.mr-chapter-route [data-at="1"]');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Handbook');
  ui.click('.mr-chapter-route [data-at="2"]');
  await ui.settled();
  expect(ui.q('#user-content-context').classList.contains('mr-flash')).toBe(true);
  expect(ui.text('.mr-chapter-route')).toContain('3 of 3');
  ui.key('ArrowLeft', { altKey: true });
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Handbook');
  ui.key('ArrowRight', { altKey: true });
  await ui.settled();
  expect(ui.text('.mr-chapter-route')).toContain('3 of 3');
  ui.click('.mr-chapter-route [data-act="sequence"]');
  ui.click('[data-act="sequence-remove"][data-at="2"]');
  ui.click('[data-act="sequence-remove"][data-at="1"]');
  ui.click('[data-act="sequence-remove"][data-at="0"]');
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-repo-chapters [data-act="docs"]'));
  expect(ui.text('.mr-repo-chapters')).toContain('No documents yet');
  ui.close();
  await ui.open(source);
  chapters();
  expect(ui.text('.mr-repo-chapters')).toContain('No documents yet');
});

it('adds search matches including indexed headings, without loading the selected document or claiming a complete index', async () => {
  const source = repository(handbook, { discover: vi.fn(async () => listing(Object.keys(handbook), ['Only documentation folders are listed.'])) });
  await ui.open(source);
  ui.click('[data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-document-row')).toHaveLength(3));
  const search = ui.q<HTMLInputElement>('.mr-repo-search');
  search.value = 'markdown';
  search.dispatchEvent(new Event('input'));
  add('docs/adr/0001-use-markdown.md');
  expect(ui.text('.mr-repo-notes')).toContain('Only documentation folders');
  expect(source.load).toHaveBeenCalledTimes(1);
  ui.click('.mr-repo-results [data-act="open"]');
  await ui.settled();
  ui.click('[data-act="docs"]');
  search.value = 'Context';
  search.dispatchEvent(new Event('input'));
  expect(ui.q('[data-act="sequence-add"]').dataset.anchor).toBe('context');
  ui.q('[data-act="sequence-add"]').focus();
  ui.click('[data-act="sequence-add"]');
  ui.key('Escape');
  chapters();
  expect(ui.text('.mr-seq-stops')).toContain('Context');
  // A linked document already read goes by its title; one not read yet by the words that link to it.
  expect(ui.all('.mr-seq-link-title').map((title) => title.textContent)).toStrictEqual(['the spec', 'Handbook']);
  ui.click('[data-act="sequence-open"][data-at="1"]');
  await ui.settled();
  expect(ui.q('#user-content-context').classList.contains('mr-flash')).toBe(true);
});

it('retains the sequence when a chosen link is missing and keeps the platform, Back and Next paths available', async () => {
  await ui.open(repository({ 'README.md': '# Start\n\n[missing](missing.md#gone) [outside](https://example.com) [code](src/main.ts)' }));
  chapters();
  expect(ui.all('.mr-sequence-link')).toHaveLength(1);
  ui.q('[data-act="sequence-add"]').focus();
  ui.click('[data-act="sequence-add"]');
  expect(ui.shadow().activeElement?.getAttribute('data-act')).toBe('sequence-add');
  ui.click('.mr-repo-chapters [data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-outline [data-act="sequence-add"]')).toHaveLength(1));
  add('README.md');
  ui.key('Escape');
  chapters();
  ui.click('[data-act="sequence-open"]');
  await ui.settled();
  expect(ui.text('.mr-message')).toContain('not in the repository at this commit');
  expect(ui.q<HTMLAnchorElement>('.mr-message a').href).toContain('missing.md');
  ui.click('.mr-chapter-route [data-at="1"]');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Start');
  chapters();
  ui.click('.mr-sequence-links [data-act="evidence"]');
  await ui.settled();
  expect(ui.q('.mr-content .mr-flash').textContent).toContain('missing');
});

it('clears snapshot-bound choices only after a successful change of commit, including when chapters are open', async () => {
  const source = repository();
  await ui.open(source);
  ui.click('.mr-chapter-attachment form button');
  chapters();
  vi.mocked(source.refresh).mockRejectedValueOnce(new ReaderError('Offline', 'Try again'));
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.text('.mr-toast')).toBe('Offline'));
  expect(ui.text('.mr-seq-stops')).toContain('Handbook');
  const next = repository(handbook, { commit: 'newcommit' });
  vi.mocked(source.refresh).mockResolvedValue(next);
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.text('.mr-repo-chapters')).toContain('No documents yet'));
  expect(ui.text('.mr-toast')).toContain('cleared for the new commit');
  ui.click('[data-view="read"]');
  await ui.settled();
  expect(ui.text('.mr-repo-at')).toContain('newcomm');
});

it('allows opening chapters before the source settles and with no readable document, without inventing a reading route', async () => {
  const pending = deferred<ReturnType<typeof repository>>();
  const opening = ui.open(pending.promise);
  chapters();
  pending.resolve(repository({}));
  await opening;
  chapters();
  expect(ui.text('.mr-repo-chapters')).toContain('No documents yet');
  expect(ui.all('.mr-sequence-links')).toHaveLength(0);
  ui.close();
  await ui.open(repository({ 'README.md': '# Start' }));
  ui.key('C');
  expect(ui.all('.mr-sequence-links')).toHaveLength(0);
  ui.click('[data-view="read"]');
  ui.key('c');
  expect(ui.q('.mr-repo-chapters').hidden).toBe(false);
});

it('keeps standalone sequence controls out of the review library, including search results', async () => {
  await ui.open(repository(), { review: { title: 'Review', ref: 'main', chapters: [{ title: 'Changes', paths: ['README.md'] }] } });
  ui.click('[data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-outline .mr-menu-item')).toHaveLength(3));
  const search = ui.q<HTMLInputElement>('.mr-repo-search');
  search.value = 'markdown';
  search.dispatchEvent(new Event('input'));
  expect(ui.all('.mr-repo-results .mr-menu-item')).toHaveLength(1);
  expect(ui.all('[data-act="sequence-add"]')).toHaveLength(0);
  expect(ui.q('[data-view="chapters"]').hidden).toBe(true);
  ui.key('Escape');
  ui.key('c');
  expect(ui.q('.mr-repo-chapters').hidden).toBe(true);
});

it('Escape closes the article attachment form and returns focus to its disclosure before closing the library', async () => {
  await ui.open(repository());
  const attachment = ui.q<HTMLDetailsElement>('.mr-chapter-attachment');
  attachment.open = true;
  ui.q('.mr-chapter-attachment select').focus();
  ui.key('Escape');
  expect(attachment.open).toBe(false);
  expect(ui.shadow().activeElement).toBe(attachment.querySelector('summary'));
  expect(ui.q('.mr-root')).toBeTruthy();
  ui.key('Escape');
  expect(document.querySelector('#galley-repo-reader')).toBeNull();
});

it('a document opened on its own, before anything is listed, names its links by their words', async () => {
  await ui.open(repository(handbook, { start: { path: 'README.md', folder: false } }));
  chapters();
  expect(ui.text('.mr-seq-link-title')).toBe('the decision');
  expect(ui.q('.mr-seq-add').getAttribute('aria-label')).toBe('Add the decision to your reading sequence');
});
