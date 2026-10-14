import { expect, it, vi } from 'vitest';
import type { DocRef, ReviewSince, Thread } from '../../platforms/types.ts';
import { contents, deferred, guide, readerHarness, review } from '../../testing/reader.ts';
import { openReader, type ReaderHandle } from './reader.ts';
import { loadRevisions, markReviewed, rememberSeen } from './revisions.ts';

const ui = readerHarness();

const OLD = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const second: DocRef = { ...guide, path: 'docs/second.md', oldPath: 'docs/second.md' };
const code: DocRef = { path: 'src/main.ts', oldPath: 'src/main.ts', status: 'modified', kind: 'code' };
/** What the guide said at the earlier head: between the review's base and its head. */
const EARLIER = '# Guide\n\nUnchanged context.\n\nOld paragraph.\n\nThe limit is 15 euros.\n';
const changed = (...paths: string[]): ReviewSince => ({
  state: 'changes',
  commit: OLD,
  files: paths.map((path) => ({ path, oldPath: path, status: 'modified' as const })),
  read: vi.fn(async () => EARLIER),
});
/** Every file that is shown has been drawn. */
const settled = () => vi.waitFor(() => expect([...ui.shadow().querySelectorAll('.mr-skeleton')].filter((el) => !el.closest('[hidden]'))).toHaveLength(0));
const bar = () => ui.q('.mr-since');
const foot = () => ui.q('.mr-reviewed');

/** A review of two documents whose history answers `since` as given, opened after the reader was last at OLD. */
async function opened(since: ReviewSince | Error | Promise<ReviewSince>, patch: Parameters<typeof review>[0] = {}, seen: string | null = OLD) {
  const source = review({ docs: [guide, second], ...patch });
  if (seen) await rememberSeen(source.diffUrl, seen);
  const ask = vi.fn(async () => {
    if (since instanceof Error) throw since;
    return since;
  });
  source.history = { head: HEAD, since: ask };
  await ui.open(source);
  await vi.waitFor(() => expect(foot().textContent).not.toBe(''));
  return { source, ask };
}

it('offers what changed since the reader was last opened, and says which files', async () => {
  const { ask } = await opened(changed(guide.path));
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  expect(ask).toHaveBeenCalledWith(OLD);
  expect(bar().querySelector('.mr-since-title')!.textContent).toBe('New changes since you last opened this');
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('1 of 2 files changed since aaaaaaa.');
  // The changed file says so on its byline and in the files menu; the other does not.
  const chips = ui.shadow().querySelectorAll('.mr-chip.is-updated');
  expect(chips).toHaveLength(1);
  expect(chips[0].textContent).toBe('Updated since aaaaaaa');
  expect(chips[0].closest('.mr-document')!.getAttribute('aria-label')).toBe(guide.path);
  ui.click('[data-act="files"]');
  expect(ui.shadow().querySelectorAll('.mr-menu-quiet.is-updated')).toHaveLength(1);
  // This open is remembered, and the older one is kept to compare with next time.
  expect((await loadRevisions(ui.q('.mr-root') ? 'https://gitlab.com/team/project/-/merge_requests/7/diffs' : '')).seen).toEqual([HEAD, OLD]);
});

it('shows only what changed since, each file against its earlier version, and the whole review again', async () => {
  const { source } = await opened(changed(guide.path));
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  const whole = ui.q('.mr-document').textContent;
  expect(whole).toContain('10');
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-title')!.textContent).toBe('Showing what changed since aaaaaaa'));
  await vi.waitFor(() => expect([...ui.shadow().querySelectorAll('.mr-skeleton')].filter((el) => !el.closest('[hidden]'))).toHaveLength(0));
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('1 of 2 files, aaaaaaa → bbbbbbb. To comment on removed text, show the whole review.');
  // The file that did not change is out of the way; the one that did reads from its earlier version to its head.
  expect(ui.q('[data-document="1"]').hidden).toBe(true);
  expect(ui.q('.mr-count').textContent).toBe('');
  const text = ui.q('[data-document="0"]').textContent!;
  expect(text).toContain('15');
  expect(text).toContain('20');
  expect(text).not.toContain('10');
  expect(ui.shadow().querySelector('.mr-chip.is-updated')).toBeNull();
  // Progress is kept for the review's own file, so Viewed is the same in either view.
  expect(source.load).toHaveBeenCalledTimes(2);
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(ui.q('[data-document="1"]').hidden).toBe(false));
  await vi.waitFor(() => expect(ui.q('[data-document="0"]').textContent).toContain('10'));
  expect(bar().querySelector('.mr-since-title')!.textContent).toBe('New changes since you last opened this');
});

it('reads each earlier version once, and U switches between the two views', async () => {
  const since = changed(guide.path);
  await opened(since);
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  for (const [hidden, shows] of [
    [true, '15'],
    [false, '10'],
    [true, '15'],
  ] as const) {
    ui.key('u');
    await vi.waitFor(() => expect(ui.q('[data-document="1"]').hidden).toBe(hidden));
    await settled();
    expect(ui.q('[data-document="0"]').textContent).toContain(shows);
  }
  if (since.state === 'changes') expect(since.read).toHaveBeenCalledTimes(1);
});

it('does not offer the comparison when none of the files shown changed, and says what did', async () => {
  await opened(changed());
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('The files are the same as at aaaaaaa.');
  expect(bar().querySelector('[data-act="since"]')).toBeNull();
  ui.key('u');
  expect(ui.q('[data-document="1"]').hidden).toBe(false);
  await opened(changed('assets/logo.png'));
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('None of the files Galley shows changed. Other files did.'));
  expect(bar().querySelector('[data-act="since"]')).toBeNull();
});

it('never mistakes a comparison it could not make for no new changes', async () => {
  await opened({ state: 'rewritten', commit: OLD });
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  expect(bar().querySelector('.mr-since-title')!.textContent).toBe('The branch was rewritten since you last opened this');
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('Galley cannot tell which parts are new, so the whole review is shown.');
  expect(bar().querySelector('[data-act="since"]')).toBeNull();
  expect(ui.shadow().querySelector('.mr-chip.is-updated')).toBeNull();
  await opened({ state: 'unavailable', commit: OLD });
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-title')!.textContent).toBe('The earlier version is no longer available'));
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('It was at aaaaaaa. The whole review is shown.');
  await opened({ state: 'incomplete', commit: OLD });
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-title')!.textContent).toBe('Too many files changed to compare'));
  expect(bar().querySelector('.mr-since-meta')!.textContent).toContain('cannot list every file that changed since aaaaaaa');
});

it('says when the comparison failed and tries again on request', async () => {
  const ask = vi.fn().mockRejectedValueOnce(new Error('Rate limit')).mockResolvedValue(changed(guide.path));
  const source = review({ docs: [guide, second] });
  await rememberSeen(source.diffUrl, OLD);
  source.history = { head: HEAD, since: ask };
  await ui.open(source);
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-title')?.textContent).toBe('Could not compare with the earlier version'));
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('Rate limit');
  ui.click('[data-act="retry-since"]');
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-title')!.textContent).toBe('New changes since you last opened this'));
  expect(ask).toHaveBeenCalledTimes(2);
});

it('compares with the version marked as reviewed, and marking this one moves the comparison on', async () => {
  const source = review({ docs: [guide, second] });
  await rememberSeen(source.diffUrl, OLD);
  await markReviewed(source.diffUrl, OLD);
  const ask = vi.fn(async () => changed(guide.path));
  source.history = { head: HEAD, since: ask };
  await ui.open(source);
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  expect(bar().querySelector('.mr-since-title')!.textContent).toBe('New changes since you marked this reviewed');
  expect(foot().textContent).toContain('Mark this version as reviewed to see what changes after it.');
  expect(foot().textContent).toContain('does not approve the review or mark files Viewed');
  ui.click('.mr-reviewed [data-act="mark-reviewed"]');
  await vi.waitFor(() => expect(bar().hidden).toBe(true));
  expect(foot().querySelector('.mr-reviewed-text')!.textContent).toBe('Marked as reviewed at bbbbbbb.');
  expect(ui.q('.mr-toast').textContent).toContain('Marked as reviewed');
  expect(ui.shadow().querySelector('.mr-chip.is-updated')).toBeNull();
  expect((await loadRevisions(source.diffUrl)).reviewed).toBe(HEAD);
  // Taking the mark back brings back the comparison with the head the reader was opened at before.
  ui.click('[data-act="unmark-reviewed"]');
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  expect(bar().querySelector('.mr-since-title')!.textContent).toBe('New changes since you last opened this');
  expect(foot().querySelector('.mr-reviewed-text')!.textContent).toBe('Mark this version as reviewed to see what changes after it.');
  expect((await loadRevisions(source.diffUrl)).reviewed).toBeNull();
});

it('leaves what changed since when the version is marked reviewed, and ignores an answer that arrives late', async () => {
  const late = deferred<ReviewSince>();
  const source = review({ docs: [guide, second] });
  await rememberSeen(source.diffUrl, OLD);
  source.history = { head: HEAD, since: vi.fn(() => late.promise) };
  await ui.open(source);
  await vi.waitFor(() => expect(foot().textContent).not.toBe(''));
  ui.click('.mr-reviewed [data-act="mark-reviewed"]');
  await vi.waitFor(() => expect(foot().querySelector('.mr-reviewed-text')!.textContent).toBe('Marked as reviewed at bbbbbbb.'));
  late.resolve(changed(guide.path));
  await late.promise;
  await ui.tick();
  expect(bar().hidden).toBe(true);
  expect(ui.shadow().querySelector('.mr-chip.is-updated')).toBeNull();
});

it('marks the version reviewed from the since view and goes back to the whole review', async () => {
  await opened(changed(guide.path));
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(ui.q('[data-document="1"]').hidden).toBe(true));
  ui.click('.mr-since [data-act="mark-reviewed"]');
  await vi.waitFor(() => expect(foot().querySelector('.mr-reviewed-text')!.textContent).toBe('Marked as reviewed at bbbbbbb.'));
  expect(ui.q('[data-document="1"]').hidden).toBe(false);
  expect(bar().hidden).toBe(true);
});

it('offers only the mark when there is nothing earlier to compare with', async () => {
  const { ask } = await opened(changed(guide.path), {}, null);
  expect(bar().hidden).toBe(true);
  expect(ask).not.toHaveBeenCalled();
  expect(foot().querySelector('[data-act="mark-reviewed"]')!.textContent).toBe('Mark as reviewed');
  ui.key('u');
  expect(ui.q('[data-document="1"]').hidden).toBe(false);
});

it('does nothing about earlier heads for a review whose platform keeps none', async () => {
  await ui.open(review({ docs: [guide] }));
  expect(ui.shadow().querySelector('.mr-since')).toBeNull();
  expect(ui.shadow().querySelector('.mr-reviewed')).toBeNull();
});

it('keeps unsent comments where they are written instead of redrawing the files under them', async () => {
  await opened(changed(guide.path));
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  ui.click('[data-act="since"]');
  await settled();
  await ui.commentOn();
  ui.click('.mr-since [data-act="mark-reviewed"]');
  expect(ui.q('.mr-toast').textContent).toBe('Post or discard your new comments first, then change the view.');
  expect(foot().querySelector('.mr-reviewed-text')!.textContent).toContain('Mark this version');
  ui.q('.mr-toast').hidden = true;
  ui.click('.mr-since [data-act="since"]');
  expect(ui.q('.mr-toast').hidden).toBe(false);
  expect(ui.q('[data-document="1"]').hidden).toBe(true);
  expect(bar().querySelector('.mr-since-title')!.textContent).toBe('Showing what changed since aaaaaaa');
});

it('marks the version reviewed even with an unsent comment, when the whole review is shown', async () => {
  await opened(changed(guide.path));
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  await ui.commentOn();
  ui.click('.mr-reviewed [data-act="mark-reviewed"]');
  await vi.waitFor(() => expect(foot().querySelector('.mr-reviewed-text')!.textContent).toBe('Marked as reviewed at bbbbbbb.'));
  expect(ui.shadow().querySelector('.mr-composer')).toBeTruthy();
});

it('does not post a comment on text from an earlier version, and places old-side threads on the file', async () => {
  const thread: Thread = {
    doc: guide,
    side: 'base',
    line: 5,
    url: 'https://gitlab.com/t',
    comments: [{ author: 'Dana', body: 'Why 10?', createdAt: '2026-10-01T10:00:00Z', url: 'https://gitlab.com/n' }],
  };
  await opened(changed(guide.path), { loadThreads: async () => [thread] });
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  await vi.waitFor(() => expect(ui.shadow().querySelector('[data-mr-threads]')).toBeTruthy());
  expect(ui.shadow().querySelector('.mr-file-threads')).toBeNull();
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(ui.shadow().querySelector('.mr-file-threads')).toBeTruthy());
  expect(ui.shadow().querySelector('[data-mr-threads]')).toBeNull();
  ui.q('.mr-content [data-mr-change="removed"]').dispatchEvent(new Event('pointerover', { bubbles: true }));
  ui.click('[data-act="comment-block"]');
  expect(ui.q('.mr-toast').textContent).toBe('That text is from an earlier version. Show the whole review to comment on it.');
  expect(ui.shadow().querySelector('.mr-composer')).toBeNull();
});

it('draws a file again when the view changes while it is being read', async () => {
  const slow = deferred<string>();
  const since = changed(guide.path);
  if (since.state === 'changes') since.read = vi.fn(() => slow.promise);
  await opened(since);
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(since.state === 'changes' && since.read).toHaveBeenCalled());
  ui.click('[data-act="since"]');
  slow.resolve(EARLIER);
  await vi.waitFor(() => expect(ui.q('[data-document="0"]').textContent).toContain('10'));
  expect(ui.q('[data-document="1"]').hidden).toBe(false);
  expect(ui.q('[data-document="0"]').textContent).not.toContain('15');
});

it('says so on the file when its earlier version cannot be read, and tries again', async () => {
  const since = changed(guide.path);
  if (since.state === 'changes') since.read = vi.fn().mockRejectedValueOnce(new Error('Rate limit')).mockResolvedValue(EARLIER);
  await opened(since);
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(ui.q('[data-document="0"] .mr-message')?.textContent).toContain('Rate limit'));
  ui.click('[data-act="retry-doc"]');
  await vi.waitFor(() => expect(ui.q('[data-document="0"]').textContent).toContain('15'));
});

it('counts the code files only when they are shown, and keeps unchanged ones out of the since view', async () => {
  const other: DocRef = { ...code, path: 'src/other.ts', oldPath: 'src/other.ts' };
  await opened(changed(guide.path, code.path), {
    docs: [guide, second],
    codeDocs: [code, other],
    load: vi.fn(async (doc: DocRef) => (doc.kind === 'code' ? { base: 'const a = 1;\n', head: 'const a = 2;\n' } : contents)),
  });
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('1 of 2 files changed since aaaaaaa.');
  ui.click('[data-act="settings"]');
  ui.click('[data-act="code-files"]');
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('2 of 4 files changed since aaaaaaa.'));
  ui.click('[data-act="close-settings"]');
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(ui.q('[data-document="3"]').hidden).toBe(true));
  expect(ui.q('[data-document="2"]').hidden).toBe(false);
  // Turning code files off and on again keeps the unchanged one out.
  ui.click('[data-act="settings"]');
  ui.click('[data-act="code-files"]');
  ui.click('[data-act="code-files"]');
  expect(ui.q('[data-document="3"]').hidden).toBe(true);
  expect(ui.q('[data-document="2"]').hidden).toBe(false);
});

it('marks the files that changed in the Files layout list', async () => {
  localStorage.setItem('galley:settings', JSON.stringify({ layout: 'files' }));
  await opened(changed(guide.path));
  await vi.waitFor(() => expect(ui.shadow().querySelectorAll('.mr-file-updated')).toHaveLength(1));
  expect(ui.q('.mr-file-updated').getAttribute('aria-label')).toBe('Updated since you last looked');
});

it('asks nothing about earlier heads once the reader has been closed', async () => {
  const source = review({ docs: [guide] });
  const ask = vi.fn();
  let reads = 0;
  let reader: ReaderHandle | undefined;
  // The reader reads the history to see whether there is one, then again to start: it is closed in between.
  Object.defineProperty(source, 'history', {
    get() {
      if (++reads === 2) reader?.close();
      return { head: HEAD, since: ask };
    },
  });
  await rememberSeen(source.diffUrl, OLD);
  reader = openReader(source);
  await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
  await ui.tick();
  expect(document.querySelector('#galley-reader')).toBeNull();
  expect(ask).not.toHaveBeenCalled();
});

it('draws a file that was renamed, deleted or added since as exactly that, against its earlier version', async () => {
  const third: DocRef = { ...guide, path: 'docs/third.md', oldPath: 'docs/third.md', status: 'added' };
  const read = vi.fn(async (doc: DocRef) => (doc.path === third.path ? '' : EARLIER));
  const since: ReviewSince = {
    state: 'changes',
    commit: OLD,
    files: [
      { path: guide.path, oldPath: 'docs/old-guide.md', status: 'renamed' },
      { path: second.path, oldPath: second.path, status: 'removed' },
      { path: third.path, oldPath: third.path, status: 'added' },
    ],
    read,
  };
  await opened(since, {
    docs: [guide, second, third],
    load: vi.fn(async (doc: DocRef) => (doc === second ? { base: contents.base, head: '' } : doc === third ? { base: '', head: contents.head } : contents)),
  });
  await vi.waitFor(() => expect(bar().querySelector('.mr-since-meta')!.textContent).toBe('3 of 3 files changed since aaaaaaa.'));
  ui.click('[data-act="since"]');
  await vi.waitFor(() => expect(ui.q('[data-document="1"] .mr-chip.is-removed')?.textContent).toBe('Deleted document'));
  await settled();
  expect(ui.q('[data-document="2"] .mr-chip.is-added').textContent).toBe('New document');
  expect(ui.q('[data-document="0"]').textContent).toContain('15');
  expect(read.mock.calls.map(([doc]) => doc.path).sort()).toEqual([guide.path, second.path, third.path].sort());
});

it('leaves the platform’s own Viewed state alone when a version is marked reviewed', async () => {
  const set = vi.fn(async () => undefined);
  await opened(changed(guide.path), { viewed: { label: 'Viewed on GitHub', load: async () => [], set } });
  await vi.waitFor(() => expect(bar().hidden).toBe(false));
  ui.click('.mr-reviewed [data-act="mark-reviewed"]');
  await vi.waitFor(() => expect(foot().querySelector('.mr-reviewed-text')!.textContent).toBe('Marked as reviewed at bbbbbbb.'));
  ui.click('.mr-reviewed [data-act="unmark-reviewed"]');
  await vi.waitFor(() => expect(foot().querySelector('.mr-reviewed-text')!.textContent).toContain('Mark this version'));
  expect(set).not.toHaveBeenCalled();
  expect(ui.shadow().querySelectorAll('.mr-file-viewed[aria-checked="true"]')).toHaveLength(0);
});
