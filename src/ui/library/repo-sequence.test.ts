import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../platforms/types.ts';
import { deferred } from '../../testing/reader.ts';
import { handbook, listing, repoHarness, repository } from '../../testing/repo.ts';

const ui = repoHarness();
/** Opens Chapters in the sheet, unless it shows them already. */
const chapters = () => {
  if (ui.q('.mr-tb-right [data-panel="chapters"]').getAttribute('aria-expanded') !== 'true') ui.click('.mr-tb-right [data-panel="chapters"]');
};
const add = (path: string) => ui.click(`[data-act="sequence-add"][data-path="${path}"]`);
/** What Chapters shows: the whole sheet, its path of stops, and the links of the document being read. */
const sheet = () => ui.text('.mr-pm-sheet .mr-sheet-layer');
const stops = () => ui.text('.mr-pm-sheet .mr-path');
const links = () => ui.all('.mr-pm-sheet [aria-label="Links from this document"] .mr-sheet-row');

it('builds a chapter from explicit links or the outline, changes its order and reads each chosen heading', async () => {
  const source = repository();
  await ui.open(source);
  chapters();
  expect(ui.q('.mr-pm-sheet').hidden).toBe(false);
  expect(ui.q('.mr-tb-right [data-panel="chapters"]').getAttribute('aria-expanded')).toBe('true');
  expect(ui.q('.mr-pm-sheet .mr-sheet-tab[data-panel="chapters"]').getAttribute('aria-pressed')).toBe('true');
  expect(sheet()).toContain('No documents yet');
  expect(ui.text('.mr-pm-sheet [aria-label="Links from this document"]')).toBe(
    'Links from this document 1 In README.md ADR 1: Use Markdown docs/adr/0001-use-markdown.md · line 3 Add',
  );
  expect(ui.all('.mr-pm-sheet .mr-path [data-act="sequence-open"]')).toHaveLength(0);
  ui.click('[data-act="sequence-add"]');
  expect(stops()).toBe('1 ADR 1: Use Markdown docs/adr/0001-use-markdown.md');
  // A link already in the sequence says so, and choosing it again changes nothing.
  expect(ui.text('.mr-seq-add')).toBe('Added');
  expect(ui.q('.mr-seq-add').getAttribute('aria-label')).toBe('ADR 1: Use Markdown is in your reading sequence');
  ui.click('[data-act="sequence-add"]');
  expect(ui.text('.mr-toast')).toBe('Already in your reading sequence.');
  const loads = vi.mocked(source.load).mock.calls.length;
  ui.click('.mr-pm-sheet [data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-outline [data-act="sequence-add"]')).toHaveLength(3));
  const opener = ui.q(`.mr-repo-outline [data-act="sequence-add"][data-path="README.md"]`);
  opener.focus();
  opener.click();
  expect(ui.shadow().activeElement).toBe(ui.q(`.mr-repo-outline [data-act="sequence-add"][data-path="README.md"]`));
  ui.key('Escape');
  // Choosing from the outline reads nothing.
  expect(source.load).toHaveBeenCalledTimes(loads);
  ui.click('[data-act="sequence-later"][data-at="0"]');
  expect(stops()).toMatch(/^1 Handbook/);
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-pm-sheet [data-act="sequence-open"][data-at="1"]'));
  ui.click('[data-act="sequence-earlier"][data-at="1"]');
  expect(stops()).toMatch(/^1 ADR 1: Use Markdown/);
  // A stop is read in full: Chapters give way to it, and the route above it leads on.
  ui.click('.mr-pm-sheet .mr-path [data-act="sequence-open"]');
  await ui.settled();
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
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
  // The route's Chapters opens them beside the stop being read, which they mark.
  ui.click('.mr-chapter-route [data-act="sequence"]');
  expect(ui.text('.mr-pm-sheet .mr-chapters-status')).toBe('Stop 3 of 3 Read chapter');
  expect(ui.q('.mr-pm-sheet [aria-current="step"]').dataset.at).toBe('2');
  ui.click('[data-act="sequence-remove"][data-at="2"]');
  ui.click('[data-act="sequence-remove"][data-at="1"]');
  ui.click('[data-act="sequence-remove"][data-at="0"]');
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-pm-sheet .mr-sheet-layer'));
  expect(sheet()).toContain('No documents yet');
  ui.close();
  await ui.open(source);
  chapters();
  expect(sheet()).toContain('No documents yet');
});

it('adds search matches including indexed headings, without loading the selected document or claiming a complete index', async () => {
  // The spec is not listed, so it is never read: its link goes by its words.
  const source = repository(handbook, {
    discover: vi.fn(async () => listing(['README.md', 'docs/adr/0001-use-markdown.md'], ['Only documentation folders are listed.'])),
  });
  await ui.open(source);
  const loads = vi.mocked(source.load).mock.calls.length;
  ui.click('[data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-document-row')).toHaveLength(2));
  const search = ui.q<HTMLInputElement>('.mr-repo-search');
  search.value = 'markdown';
  search.dispatchEvent(new Event('input'));
  add('docs/adr/0001-use-markdown.md');
  expect(ui.text('.mr-repo-notes')).toContain('Only documentation folders');
  expect(source.load).toHaveBeenCalledTimes(loads);
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
  expect(stops()).toContain('Context');
  // A linked document already read goes by its title; one not read yet by the words that link to it.
  expect(links().map((row) => row.querySelector('.mr-sheet-row-title')!.textContent)).toStrictEqual(['the spec', 'Handbook']);
  ui.click('[data-act="sequence-open"][data-at="1"]');
  await ui.settled();
  expect(ui.q('#user-content-context').classList.contains('mr-flash')).toBe(true);
});

it('retains the sequence when a chosen link is missing and keeps the platform, Back and Next paths available', async () => {
  await ui.open(repository({ 'README.md': '# Start\n\n[missing](missing.md#gone) [outside](https://example.com) [code](src/main.ts)' }));
  chapters();
  expect(links()).toHaveLength(1);
  ui.q('[data-act="sequence-add"]').focus();
  ui.click('[data-act="sequence-add"]');
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-pm-sheet [data-act="sequence-add"]'));
  ui.click('.mr-pm-sheet [data-act="docs"]');
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
  // A link in Chapters is read in full too, as a stop is.
  chapters();
  ui.click('.mr-pm-sheet [aria-label="Links from this document"] .mr-sheet-row');
  await ui.settled();
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  expect(ui.text('.mr-message')).toContain('not in the repository at this commit');
});

it('clears snapshot-bound choices only after a successful change of commit, including when chapters are open', async () => {
  const source = repository();
  await ui.open(source);
  ui.click('.mr-chapter-attachment form button');
  chapters();
  vi.mocked(source.refresh).mockRejectedValueOnce(new ReaderError('Offline', 'Try again'));
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.text('.mr-toast')).toBe('Offline'));
  expect(stops()).toContain('Handbook');
  const next = repository(handbook, { commit: 'newcommit' });
  vi.mocked(source.refresh).mockResolvedValue(next);
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(sheet()).toContain('No documents yet'));
  expect(ui.text('.mr-toast')).toContain('cleared for the new commit');
  await ui.settled();
  expect(ui.text('.mr-repo-at')).toContain('newcomm');
});

it('allows opening chapters before the source settles and with no readable document, without inventing a reading route', async () => {
  const pending = deferred<ReturnType<typeof repository>>();
  const opening = ui.open(pending.promise);
  chapters();
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  pending.resolve(repository({}));
  await opening;
  chapters();
  expect(sheet()).toContain('No documents yet');
  expect(links()).toHaveLength(0);
  ui.close();
  await ui.open(repository({ 'README.md': '# Start' }));
  ui.key('C');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(false);
  expect(links()).toHaveLength(0);
  // C and the top bar's Chapters close what they opened.
  ui.key('c');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  ui.click('.mr-tb-right [data-panel="chapters"]');
  ui.click('.mr-tb-right [data-panel="chapters"]');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
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
  expect(ui.q('.mr-tb-right [data-panel="chapters"]').hidden).toBe(true);
  ui.key('Escape');
  ui.key('c');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
});

it('Escape closes the article attachment form and returns focus to its disclosure before going back to the map', async () => {
  await ui.open(repository());
  const attachment = ui.q<HTMLDetailsElement>('.mr-chapter-attachment');
  attachment.open = true;
  ui.q('.mr-chapter-attachment select').focus();
  ui.key('Escape');
  expect(attachment.open).toBe(false);
  expect(ui.shadow().activeElement).toBe(attachment.querySelector('summary'));
  expect(ui.q('.mr-repo-read').hidden).toBe(false);
  ui.key('Escape');
  expect(ui.q('.mr-repo-map').hidden).toBe(false);
});

it('a link to a document not read yet is named by its words', async () => {
  await ui.open(repository(handbook, { start: { path: 'README.md', folder: false }, discover: vi.fn(async () => listing(['README.md'])) }));
  chapters();
  expect(links()[0].querySelector('.mr-sheet-row-title')!.textContent).toBe('the decision');
  expect(ui.q('.mr-seq-add').getAttribute('aria-label')).toBe('Add the decision to your reading sequence');
});

it('the switch at the head of the sheet goes between Chapters and Notes, and closing gives focus back', async () => {
  await ui.open(repository());
  const opener = ui.q('.mr-tb-right [data-panel="chapters"]');
  opener.focus();
  opener.click();
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-pm-sheet .mr-sheet-layer'));
  // The switch keeps focus as the sheet changes under it, and the top bar says which is open.
  const notesTab = ui.q('.mr-pm-sheet .mr-sheet-tab[data-panel="notes"]');
  notesTab.focus();
  notesTab.click();
  expect(ui.q('.mr-pm-sheet .mr-sheet-layer').getAttribute('aria-label')).toBe('Notes');
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-pm-sheet .mr-sheet-tab[data-panel="notes"]'));
  expect(ui.q('.mr-pm-sheet .mr-sheet-tab[data-panel="notes"]').getAttribute('aria-pressed')).toBe('true');
  expect(ui.q('.mr-tb-right [data-panel="notes"]').getAttribute('aria-expanded')).toBe('true');
  expect(ui.q('.mr-tb-right [data-panel="chapters"]').getAttribute('aria-expanded')).toBe('false');
  ui.click('.mr-pm-sheet .mr-sheet-tab[data-panel="chapters"]');
  expect(ui.q('.mr-pm-sheet .mr-sheet-layer').getAttribute('aria-label')).toBe('Chapters');
  // Close gives focus back to what opened them.
  ui.click('.mr-pm-sheet .mr-sheet-close');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  expect(ui.shadow().activeElement).toBe(opener);
  // Opened from a byline that is drawn anew when another document is read, closing gives focus to the reader.
  const note = ui.all('.mr-byline button').find((button) => button.textContent === 'Add a note')!;
  note.focus();
  note.click();
  ui.press('the decision', '.mr-content a');
  await ui.settled();
  ui.key('Escape');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-root'));
});

it('a document added from the list while the map is shown leaves the map where it is', async () => {
  await ui.openMap(repository());
  ui.click('[data-act="docs"]');
  await vi.waitFor(() => expect(ui.all('.mr-repo-outline [data-act="sequence-add"]')).toHaveLength(3));
  ui.scroll.mockClear();
  add('docs/specs/reading.md');
  expect(ui.text('.mr-toast')).toBe('Added to your reading sequence.');
  expect(ui.q('.mr-repo-map').hidden).toBe(false);
  expect(ui.scroll).not.toHaveBeenCalled();
});

it('on a phone, All documents gives the list the page the sheet was covering', async () => {
  await ui.open(repository());
  Object.defineProperty(ui.media, 'matches', { value: true, configurable: true });
  chapters();
  expect(ui.q('.mr-pm-sheet').getAttribute('aria-modal')).toBe('true');
  ui.click('.mr-pm-sheet [data-act="docs"]');
  expect(ui.q('.mr-pm-sheet').hidden).toBe(true);
  expect(ui.q('.mr-repo-docs').hidden).toBe(false);
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-repo-search'));
});
