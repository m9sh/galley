import { beforeEach, expect, it, vi } from 'vitest';
import { deferred, readerHarness, review } from '../../testing/reader.ts';
import { connectFrame } from '../../testing/sandbox.ts';
import { serveSpecs } from '../sandbox/spec-frame.ts';
import { serveHighlights } from '../sandbox/highlight-frame.ts';
import type { DocContents, DocRef, Thread } from '../../platforms/types.ts';

const ui = readerHarness();
beforeEach(() => {
  // jsdom lays nothing out; the results list asks to keep the chosen result in view.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
});
const doc = (path: string, status: DocRef['status'] = 'modified'): DocRef => ({ path, oldPath: path, status });
const code = (path: string, status: DocRef['status'] = 'modified'): DocRef => ({ path, oldPath: path, status, kind: 'code' });
const guide = doc('docs/guide.md');
const guideText: DocContents = {
  base: '# Guide\n\nUnchanged context.\n\nThe limit is 10 euros.\n\nThis paragraph goes away.\n',
  head: '# Guide\n\nUnchanged context.\n\nThe limit is 20 euros.\n\nA new paragraph about quotas.\n',
};
const field = () => ui.q<HTMLInputElement>('.mr-search-field');
const results = () => [...ui.shadow().querySelectorAll('.mr-search-result')].map((el) => el.textContent);
const scope = () => [...ui.shadow().querySelectorAll('.mr-search-scope p')].map((el) => el.textContent);
const status = () => ui.q('.mr-search-status').textContent;
/** Opens search from the top bar and types; waits for the results. */
async function find(query: string) {
  if (ui.q('.mr-search').hidden) ui.click('[data-act="search"]');
  expect(ui.q('.mr-search').hidden).toBe(false);
  field().value = query;
  field().dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(status()).not.toMatch(/^Type at least|^Searching/));
}
/** Chooses a result by its position, as the arrow keys and Enter would. */
async function choose(index: number) {
  for (let i = 0; i < index; i++) ui.key('ArrowDown');
  ui.key('Enter');
  expect(ui.q('.mr-search').hidden).toBe(true);
  expect(ui.q('.mr-search-bar').hidden).toBe(false);
  await ui.tick();
}
const marked = () => (CSS.highlights as unknown as Map<string, { ranges: Range[] }>).get('galley-search')?.ranges[0]?.toString();
class Highlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

it('finds text Changed parts hides, shows it in place, and goes back to where the reader was', async () => {
  vi.stubGlobal('Highlight', Highlight);
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText) }));
  const hidden = [...ui.shadow().querySelectorAll<HTMLElement>('.mr-content p')].find((p) => p.textContent === 'Unchanged context.')!;
  expect(hidden.hidden).toBe(true);
  expect(ui.q('[data-act="search"]').hidden).toBe(false);
  ui.q('.mr-root').scrollTop = 120;
  const before = ui.q<HTMLElement>('[data-act="fold-file"]');
  before.focus();
  ui.click('[data-act="search"]');
  expect(ui.q('.mr-search').hidden).toBe(false);
  expect(ui.q('[data-act="search"]').getAttribute('aria-expanded')).toBe('true');
  ui.click('[data-act="search"]');
  expect(ui.q('.mr-search').hidden).toBe(true);
  before.focus();
  await find('unchanged context');
  expect(results()).toEqual(['DocumentGuideUnchanged context.']);
  expect(scope()).toEqual(['Searches 1 file, including folded parts.']);
  await choose(0);
  expect(hidden.hidden).toBe(false);
  expect(ui.shadow().activeElement).toBe(hidden);
  expect(hidden.classList.contains('mr-flash')).toBe(true);
  expect(marked()).toBe('Unchanged context');
  expect(ui.q('.mr-search-bar-text').textContent).toBe('“unchanged context” · 1 of 1');
  ui.click('.mr-search-back');
  expect(ui.q('.mr-search-bar').hidden).toBe(true);
  expect(ui.shadow().activeElement).toBe(before);
  expect(marked()).toBeUndefined();
});

it('says which version a match is in, and turns change marks on to show old text', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ mode: 'clean' }));
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText) }));
  await find('limit is');
  // Text both versions share is found once, in the new version.
  expect(results()).toEqual(['DocumentGuideNew versionThe limit is 20 euros.']);
  await find('10 euros');
  expect(results()).toEqual(['DocumentGuideOld versionThe limit is 10 euros.']);
  await find('paragraph');
  expect(results()).toEqual(['DocumentGuideOld versionThis paragraph goes away.', 'DocumentGuideNew versionA new paragraph about quotas.']);
  await choose(0);
  expect(ui.q('.mr-root').classList.contains('mode-changes')).toBe(true);
  expect(ui.q('.mr-toast').textContent).toBe('Change marks are on, to show the old version');
  expect(ui.shadow().activeElement?.textContent?.trim()).toBe('This paragraph goes away.');
});

it('reads a deleted document as it was, without changing the change marks', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ mode: 'clean' }));
  const gone = doc('docs/old.md', 'removed');
  await ui.open(review({ docs: [gone], load: vi.fn(async () => ({ base: '# Old\n\nA retired limit.\n', head: '' })) }));
  await find('retired');
  expect(results()).toEqual(['DocumentOldOld versionA retired limit.']);
  await choose(0);
  expect(ui.q('.mr-root').classList.contains('mode-clean')).toBe(true);
});

it('searches folded files without opening them, then opens one to show a result, never marking it viewed', async () => {
  vi.stubGlobal('Highlight', Highlight);
  localStorage.setItem('galley:settings', JSON.stringify({ codeFiles: true }));
  const lock = code('package-lock.json');
  const renamed: DocRef = { path: 'docs/limits.md', oldPath: 'docs/rate-limits.md', status: 'renamed' };
  const moved: DocRef = { path: 'docs/quotas.md', oldPath: 'docs/old-quotas.md', status: 'renamed' };
  const same = (text: string) => ({ base: text, head: text });
  const files = new Map<DocRef, DocContents>([
    [lock, { base: '{\n  "ms": "2.1.2",\n  "limit": "1.0.0"\n}\n', head: '{\n  "ms": "2.1.3",\n  "limit": "1.0.0"\n}\n' }],
    [renamed, same('# Rate limits\n\nSee the docs for **the limit**.\n')],
    [moved, same('# Quotas\n\nSee `src/quotas` for the rest.\n')],
  ]);
  const set = vi.fn(async () => {});
  await ui.open(review({ docs: [renamed, moved], codeDocs: [lock], load: async (d) => files.get(d)!, viewed: { label: 'GitHub', load: async () => [], set } }));
  expect(ui.shadow().querySelectorAll('.mr-quiet')).toHaveLength(3);
  await find('"ms"');
  expect(results()).toEqual(['Codeline 2New version"ms": "2.1.3",', 'Codeold line 2Old version"ms": "2.1.2",']);
  await choose(0);
  await vi.waitFor(() => expect(ui.shadow().activeElement?.querySelector('.mr-code-text')?.textContent).toBe('  "ms": "2.1.3",'));
  expect(ui.shadow().querySelectorAll('.mr-quiet')).toHaveLength(2);
  // The results bar steps on through the file the first result opened.
  ui.click('.mr-search-step:not(:disabled)');
  await vi.waitFor(() => expect(ui.shadow().activeElement?.querySelector('.mr-code-text')?.textContent).toBe('  "ms": "2.1.2",'));
  await find('"limit"');
  expect(results()).toEqual(['Codeline 3"limit": "1.0.0"']);
  await choose(0);
  expect(ui.shadow().activeElement?.querySelector('.mr-code-text')?.textContent).toBe('  "limit": "1.0.0"');
  expect(marked()).toBe('"limit"');
  expect(set).not.toHaveBeenCalled();
  expect(ui.q('.mr-viewed').getAttribute('aria-pressed')).toBe('false');
  // A folded document is searched in its source, and shown rendered: the words are found again when they read the same.
  await find('the limit');
  expect(results()).toEqual(['Documentline 3See the docs for **the limit**.']);
  await choose(0);
  await vi.waitFor(() => expect(ui.shadow().activeElement?.textContent?.trim()).toBe('See the docs for the limit.'));
  expect(ui.shadow().querySelectorAll('.mr-quiet')).toHaveLength(1);
  expect(marked()).toBe('the limit');
  ui.click('.mr-search-close');
  // Markup the source has and the page does not: the paragraph is shown, without marking.
  await find('`src/quotas`');
  await choose(0);
  await vi.waitFor(() => expect(ui.shadow().activeElement?.textContent?.trim()).toBe('See src/quotas for the rest.'));
  expect(ui.shadow().querySelectorAll('.mr-quiet')).toHaveLength(0);
  expect(marked()).toBeUndefined();
});

it('finds a folded line no block shows, and stops when a folded file cannot be shown after all', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ codeFiles: true }));
  const renamed: DocRef = { path: 'docs/limits.md', oldPath: 'docs/rate-limits.md', status: 'renamed' };
  const huge = code('yarn.lock');
  const text = '# Rate limits\n\n<!-- limit notes -->\n';
  const big = `limit: 1\n${'x'.repeat(600_000)}\n`;
  const files = new Map<DocRef, DocContents>([
    [renamed, { base: text, head: text }],
    [huge, { base: big.replace('1', '0'), head: big }],
  ]);
  await ui.open(review({ docs: [renamed], codeDocs: [huge], load: async (d) => files.get(d)! }));
  await find('limit notes');
  await choose(0);
  await vi.waitFor(() => expect(ui.shadow().activeElement).toBe(ui.q('.mr-document')));
  await find('limit: 1');
  await choose(0);
  await vi.waitFor(() => expect(ui.shadow().activeElement?.querySelector('.mr-message')?.textContent).toContain('too large'));
});

it('finds comments and the reviewer’s own drafts, and shows them where they are', async () => {
  vi.stubGlobal('Highlight', Highlight);
  const replies = ['First note on the limit.', 'A folded reply about quotas.', 'Another reply.', 'Last word on it.'];
  const threads: Thread[] = [
    {
      doc: guide,
      side: 'head',
      line: 5,
      url: '#t1',
      reply: async () => ({ url: '#r' }),
      comments: replies.map((body, i) => ({ author: i ? 'Bo' : 'Ada', body, createdAt: new Date().toISOString(), url: `#c${i}` })),
    },
    {
      doc: guide,
      side: 'base',
      line: null,
      url: '#t2',
      comments: [{ author: 'Cy', body: 'On the whole file: quotas.', createdAt: new Date().toISOString(), url: '#t2' }],
    },
  ];
  await ui.open(
    review({
      docs: [guide],
      load: vi.fn(async () => guideText),
      loadThreads: async () => threads,
      prepareComment: async () => ({ kind: 'inline', label: 'Inline comment', post: async () => ({ url: '#posted' }) }),
    }),
  );
  await vi.waitFor(() => expect(ui.shadow().querySelectorAll('.mr-thread')).toHaveLength(2));
  await find('quotas');
  expect(results()).toEqual([
    'DocumentGuideNew versionA new paragraph about quotas.',
    'CommentCy · on the fileOn the whole file: quotas.',
    'CommentBo · line 5A folded reply about quotas.',
  ]);
  expect(scope()).toEqual(['Searches 1 file and 5 comments, including folded parts.']);
  await choose(2);
  const card = ui.shadow().activeElement as HTMLElement;
  expect(card.classList.contains('mr-thread')).toBe(true);
  expect(card.classList.contains('is-expanded')).toBe(true);
  expect(marked()).toBe('quotas');
  await find('on the whole file');
  await choose(0);
  expect(ui.shadow().activeElement?.closest('.mr-file-threads')).toBeTruthy();

  // Drafts are only the reviewer's, and say so.
  const composer = await ui.commentOn();
  ui.input('Is this limit too low?');
  ui.q<HTMLElement>('.mr-reply-to').click();
  ui.input('Agreed, a draft reply.', '.mr-reply textarea');
  // The reply box takes focus a moment after it opens.
  await ui.tick();
  await find('draft reply');
  expect(results()).toEqual(['Your draftYour replyOnly you can see itAgreed, a draft reply.']);
  await find('too low');
  expect(results()).toEqual(['Your draftYour comment · line 5Only you can see itIs this limit too low?']);
  expect(scope()).toEqual(['Searches 1 file, 5 comments and 2 drafts, including folded parts.']);
  await choose(0);
  const textarea = composer.querySelector('textarea')!;
  expect(ui.shadow().activeElement).toBe(textarea);
  expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('too low');
});

it('finds the request’s description when the reader shows it', async () => {
  vi.stubGlobal('Highlight', Highlight);
  localStorage.setItem('galley:settings', JSON.stringify({ overview: true }));
  const overview = { kind: 'Merge request' as const, title: 'Raise limits', description: 'This raises the **limit** for everyone.', author: 'Ada', url: '#mr' };
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText), overview }));
  ui.q<HTMLDetailsElement>('.mr-overview-body').open = false;
  await find('the limit for');
  expect(results()).toEqual(['DescriptionThis raises the limit for everyone.']);
  await choose(0);
  expect(ui.q<HTMLDetailsElement>('.mr-overview-body').open).toBe(true);
  expect(ui.shadow().activeElement?.classList.contains('mr-content')).toBe(true);
  expect(marked()).toBe('the limit for');
  ui.click('[data-act="overview"]');
  await find('the limit for');
  expect(status()).toBe('No matches for “the limit for”.');
});

it('leaves out an empty description', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ overview: true }));
  const overview = { kind: 'Merge request' as const, title: 'Raise limits', description: ' ', author: 'Ada', url: '#mr' };
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText), overview }));
  await find('description');
  expect(status()).toBe('No matches for “description”.');
});

it('says what it could not search, and searches code files once the reviewer turns them on', async () => {
  const limits = code('src/limits.ts');
  const loading = doc('docs/later.md');
  const broken = doc('docs/broken.md');
  const later = deferred<DocContents>();
  const contents = new Map<DocRef, Promise<DocContents>>([
    [guide, Promise.resolve(guideText)],
    [limits, Promise.resolve({ base: 'export const limit = 10;\n', head: 'export const limit = 20;\n' })],
    [loading, later.promise],
    [broken, Promise.reject(new Error('Not found'))],
  ]);
  await ui.open(review({ docs: [guide, loading, broken], codeDocs: [limits], load: (d) => contents.get(d)! }), { start: 0 }).catch(() => {});
  await vi.waitFor(() => expect(ui.q('.mr-message')).toBeTruthy());
  await find('const limit');
  expect(status()).toBe('No matches for “const limit”.');
  expect(scope()).toEqual([
    'Searches 1 file, including folded parts.',
    '1 code file not searched while Code files is off.Turn on Code files',
    '1 file still loading; results update when they arrive.',
    '1 file could not be loaded and was not searched.',
  ]);
  ui.click('.mr-search-code');
  expect(ui.q('[data-act="code-files"]').getAttribute('aria-checked')).toBe('true');
  // The popup stays open while the code files load, and lists them as they arrive.
  await vi.waitFor(() => expect(results()).toEqual(['Codeold line 1Old versionexport const limit = 10;', 'Codeline 1New versionexport const limit = 20;']));
  later.resolve({ base: 'A later limit.\n', head: 'A later limit.\n' });
  await find('later limit');
  await vi.waitFor(() => expect(results()).toEqual(['DocumentA later limit.']));
});

it('searches again when comments arrive while results are showing', async () => {
  const arrived = deferred<Thread[]>();
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText), loadThreads: () => arrived.promise }));
  await find('budget');
  expect(status()).toBe('No matches for “budget”.');
  arrived.resolve([
    { doc: guide, side: 'head', line: 5, url: '#t', comments: [{ author: 'Ada', body: 'Mind the budget.', createdAt: new Date().toISOString(), url: '#t' }] },
  ]);
  await vi.waitFor(() => expect(results()).toEqual(['CommentAda · line 5Mind the budget.']));
});

it('opens a file the reviewer folded, without changing whether it is viewed', async () => {
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText) }));
  ui.click('[data-act="fold-file"]');
  expect(ui.q('.mr-document').classList.contains('is-folded')).toBe(true);
  await find('quotas');
  await choose(0);
  expect(ui.q('.mr-document').classList.contains('is-folded')).toBe(false);
  expect(ui.q('.mr-file-viewed').getAttribute('aria-checked')).toBe('false');
});

it('shows a found line a test plan leaves out, opening its suite', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ codeFiles: true }));
  const spec = code('src/upload.test.ts');
  const base = 'import { limit } from "./limit";\n\ndescribe("Uploads", () => {\n  it("accepts", () => {\n    expect(limit).toBe(10);\n  });\n});\n';
  await ui.open(review({ docs: [], codeDocs: [spec], load: async () => ({ base, head: base.replace('toBe(10)', 'toBe(100)') }) }));
  await connectFrame('spec-frame.html', serveSpecs, ui.shadow());
  await vi.waitFor(() => expect(ui.q('.mr-spec-file')).toBeTruthy());
  // Unchanged setup starts folded in the plan.
  const setup = ui.q('.mr-spec-support-toggle').closest('.mr-spec-section')!;
  expect(setup.classList.contains('is-collapsed')).toBe(true);
  await find('import { limit }');
  await choose(0);
  expect(setup.classList.contains('is-collapsed')).toBe(false);
  expect(ui.shadow().activeElement?.hasAttribute('data-mr-found')).toBe(true);
  const toggle = ui.q('.mr-spec-toggle:not(.mr-spec-support-toggle)');
  const test = toggle.closest('.mr-spec-section')!;
  toggle.click();
  expect(test.classList.contains('is-collapsed')).toBe(true);
  await find('expect(limit)');
  expect(results()).toEqual(['Testold line 5Old versionexpect(limit).toBe(10);', 'Testline 5New versionexpect(limit).toBe(100);']);
  await choose(1);
  expect(test.classList.contains('is-collapsed')).toBe(false);
  expect(ui.shadow().querySelectorAll('[data-mr-found]')).toHaveLength(1);
  expect(ui.shadow().activeElement?.hasAttribute('data-mr-found')).toBe(true);
});

it('reads code comments once, in the view Review settings shows', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ codeFiles: true }));
  const file = code('src/limits.ts');
  const base = '/**\n * One shared limit.\n */\nexport const limit = 10;\n';
  await ui.open(review({ docs: [], codeDocs: [file], load: async () => ({ base, head: base.replace('One shared', 'A **fair**') }) }));
  await connectFrame('highlight-frame.html', serveHighlights, ui.shadow());
  await vi.waitFor(() => expect(ui.q('.mr-source-comment')).toBeTruthy());
  await find('limit');
  expect(results().filter((text) => text!.includes('fair'))).toHaveLength(1);
});

it('keeps the keyboard where it was: Escape closes the popup, then the results, and / needs something to search', async () => {
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText) }));
  ui.key('/');
  expect(ui.q('.mr-search').hidden).toBe(false);
  await find('limit');
  ui.key('Escape');
  expect(ui.q('.mr-search').hidden).toBe(true);
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-root'));
  await find('limit');
  await choose(0);
  const focused = ui.shadow().activeElement as HTMLElement;
  ui.key('Escape');
  expect(ui.q('.mr-search-bar').hidden).toBe(true);
  expect(ui.shadow().activeElement).toBe(focused);
  expect(document.querySelector('#galley-reader')).toBeTruthy();
  // Back to where you were, when what had focus is gone: the reader itself.
  ui.q<HTMLElement>('[data-act="fold-file"]').focus();
  await find('limit');
  await choose(0);
  ui.q('[data-act="fold-file"]').remove();
  ui.click('.mr-search-back');
  expect(ui.shadow().activeElement).toBe(ui.q('.mr-root'));
  ui.close();
  await ui.open(review({ docs: [] }));
  ui.key('/');
  expect(ui.q('.mr-search').hidden).toBe(true);
});

it('opens from the files menu, where narrow phones find it, and gives focus back to the file name', async () => {
  await ui.open(review({ docs: [guide], load: vi.fn(async () => guideText) }));
  ui.click('[data-act="files"]');
  expect(ui.q('.mr-files').hidden).toBe(false);
  expect(ui.q('.mr-files-search').textContent).toBe('Search this review');
  ui.click('.mr-files-search');
  expect(ui.q('.mr-files').hidden).toBe(true);
  expect(ui.q('.mr-search').hidden).toBe(false);
  expect(ui.shadow().activeElement).toBe(field());
  ui.key('Escape');
  expect(ui.q('.mr-search').hidden).toBe(true);
  expect(ui.shadow().activeElement).toBe(ui.q('[data-act="files"]'));
});

it('keeps the found words marked when syntax colours redraw the line, until the results close', async () => {
  vi.stubGlobal('Highlight', Highlight);
  localStorage.setItem('galley:settings', JSON.stringify({ codeFiles: true }));
  const file = code('src/limits.ts');
  await ui.open(review({ docs: [], codeDocs: [file], load: async () => ({ base: 'export const limit = 10;\n', head: 'export const limit = 20;\n' }) }));
  await find('limit = 20');
  await choose(0);
  expect(marked()).toBe('limit = 20');
  const text = ui.shadow().activeElement!.querySelector('.mr-code-text')!;
  // Colouring replaces the line's text with tokens, which the first mark pointed into.
  const redraw = (line: Element) => {
    const keyword = document.createElement('span');
    keyword.textContent = 'export const ';
    line.replaceChildren(keyword, 'limit = 20;');
  };
  redraw(text);
  await ui.tick();
  expect(marked()).toBe('limit = 20');
  ui.click('.mr-search-close');
  expect(marked()).toBeUndefined();
  redraw(text);
  await ui.tick();
  expect(marked()).toBeUndefined();
});
