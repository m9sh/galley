import { expect, it, vi } from 'vitest';
import { INDEX_BATCH } from '../../core/docindex.ts';
import { handbook, repoHarness, repository } from '../../testing/repo.ts';

vi.mock('../rendering/diagrams.ts', async (original) => ({ ...(await original<typeof import('../rendering/diagrams.ts')>()), renderDiagrams: vi.fn() }));
vi.mock('../rendering/code.ts', async (original) => ({ ...(await original<typeof import('../rendering/code.ts')>()), highlightCode: vi.fn(async () => {}) }));

const ui = repoHarness();
const showMap = async () => {
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.q('.mr-map-status').textContent).toMatch(/^Built from all/));
};
const BEEF = 'beef0000beef0000beef0000beef0000beef0000';
const settings = (rememberOutlines: boolean) => localStorage.setItem('galley:settings', JSON.stringify({ rememberOutlines }));
/** A short hash of a text: the same text gives the same hash, as a platform's blob hash does. */
const hash = (text: string) => `h${[...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16)}`;
/** A repository whose listing gives each document's content hash, as GitHub and GitLab do. */
const hashed = (files: Record<string, string>, patch: Partial<ReturnType<typeof repository>> = {}) =>
  repository(files, {
    discover: vi.fn(async () => ({
      docs: Object.entries(files).map(([path, text]) => ({ path, blob: hash(text) })),
      limits: [],
      configs: { files: [], limits: [] },
    })),
    ...patch,
  });
const readPaths = (source: ReturnType<typeof repository>) => vi.mocked(source.load).mock.calls.map(([path]) => path);
const remembered = () => JSON.parse(localStorage.getItem('galley:outlines') ?? '{}') as Record<string, { used: number }>;

const before: Record<string, string> = {
  'README.md': '# Handbook\n\n[Guide](guide.md) and [Old](old.md).',
  'guide.md': '# Guide',
  'old.md': '# Old',
  'broken.md': '# Never read\n\nA secret sentence in the body.',
};

it('after a refresh to a newer commit, only the documents whose content changed are read again', async () => {
  const after: Record<string, string> = { ...before, 'old.md': '# Old, revised' };
  const next = hashed(after, { commit: BEEF });
  const source = hashed(before, { refresh: vi.fn(async () => next) });
  const load = source.load;
  // A document that cannot be read is read again too, as nothing was kept of it.
  source.load = vi.fn((path: string) => (path === 'broken.md' ? Promise.reject(new Error('500')) : load(path)));
  vi.mocked(next.load).mockImplementation(async (path) => (path === 'broken.md' ? Promise.reject(new Error('500')) : after[path]));
  await ui.open(source);
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.q('.mr-map-status').textContent).toMatch(/^Built from all/));
  expect(readPaths(source).sort()).toStrictEqual(['README.md', 'broken.md', 'guide.md', 'old.md']);
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.q('.mr-map-status').textContent).toMatch(/^Built from all .* at beef000/));
  expect(readPaths(next).sort()).toStrictEqual(['broken.md', 'old.md']);
  // The map is the same as one built by reading everything.
  expect(ui.text('.mr-map-status')).toContain('1 document could not be read.');
  ui.key('m');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Handbook');
  // Reading a document again, or going back to it, never reads it twice at one commit.
  ui.press('Old');
  await ui.settled();
  expect(ui.text('.mr-lead')).toBe('Old, revised');
  expect(readPaths(next).filter((path) => path === 'old.md')).toHaveLength(1);
});

it('a document moved to another path is not read again', async () => {
  const moved = { 'README.md': before['README.md'], 'docs/guide.md': '# Guide', 'old.md': '# Old' };
  const next = hashed(moved, { commit: BEEF });
  const source = hashed({ 'README.md': before['README.md'], 'guide.md': '# Guide', 'old.md': '# Old' }, { refresh: vi.fn(async () => next) });
  await ui.open(source);
  await showMap();
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.q('.mr-map-status').textContent).toMatch(/^Built from all .* at beef000/));
  expect(readPaths(next)).toStrictEqual([]);
  expect(ui.text('.mr-map-status')).toContain('Built from all 3 documents at beef000.');
});

it('repositories whose listing gives no content hashes are read as they always were', async () => {
  const next = repository(handbook, { commit: BEEF });
  const source = repository(handbook, { refresh: vi.fn(async () => next) });
  await ui.open(source);
  await showMap();
  ui.click('[data-act="refresh"]');
  await vi.waitFor(() => expect(ui.q('.mr-map-status').textContent).toMatch(/^Built from all .* at beef000/));
  expect(readPaths(next).sort()).toStrictEqual(Object.keys(handbook).sort());
});

it('nothing is kept on the device unless the reader turns it on', async () => {
  await ui.open(hashed(before));
  await showMap();
  expect(localStorage.getItem('galley:outlines')).toBeNull();
  expect(localStorage.length).toBe(0);
});

it('a project read again opens its map from what the device remembers, and reads only documents whose content changed', async () => {
  settings(true);
  const first = hashed(before);
  await ui.open(first);
  await showMap();
  await vi.waitFor(() => expect(Object.keys(remembered())).toHaveLength(1));
  // The device holds titles, headings and links, not the text.
  expect(JSON.stringify(Object.entries(localStorage))).toContain('Never read');
  expect(JSON.stringify(Object.entries(localStorage))).not.toContain('secret sentence');
  const keys = localStorage.length;
  ui.close();

  const second = hashed(before);
  await ui.open(second);
  await showMap();
  expect(ui.text('.mr-map-status')).toBe('Built from all 4 documents at c0ffee1.');
  // Only the document the reader opened was read, and nothing new was written.
  expect(readPaths(second)).toStrictEqual(['README.md']);
  expect(localStorage.length).toBe(keys);
  ui.close();

  const third = hashed({ ...before, 'guide.md': '# Guide, revised' });
  const used = Object.values(remembered())[0].used;
  await ui.open(third);
  await showMap();
  expect(readPaths(third).sort()).toStrictEqual(['README.md', 'guide.md']);
  // Used again, so the week starts over; the revised document replaced the old one.
  await vi.waitFor(() => expect(Object.values(remembered())[0].used).toBeGreaterThanOrEqual(used));
  ui.close();

  const fourth = hashed({ ...before, 'guide.md': '# Guide, revised' });
  await ui.open(fourth);
  await showMap();
  expect(readPaths(fourth)).toStrictEqual(['README.md']);
});

it('a pass that reads only part of a large project keeps what was remembered of the rest', async () => {
  settings(true);
  const files: Record<string, string> = { 'README.md': '# Top' };
  for (let i = 0; i < INDEX_BATCH + 2; i++) files[`d${String(i).padStart(3, '0')}.md`] = `# Doc ${i}`;
  // The first visit reads everything, in two passes.
  await ui.open(hashed(files));
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.text('.mr-map-status')).toContain('Index more'));
  ui.press('Index more');
  await vi.waitFor(() => expect(ui.text('.mr-map-status')).toMatch(/^Built from all/));
  await vi.waitFor(() => expect(Object.keys(remembered())).toHaveLength(1));
  ui.close();
  // The next visit reads its first pass from the device, with one document changed...
  const revised = { ...files, 'd000.md': '# Doc zero, revised' };
  const second = hashed(revised);
  await ui.open(second);
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.text('.mr-map-status')).toContain('Index more'));
  expect(readPaths(second).sort()).toStrictEqual(['README.md', 'd000.md']);
  ui.close();
  // ...and the documents beyond that pass were not forgotten for it.
  const third = hashed(revised);
  await ui.open(third);
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.text('.mr-map-status')).toContain('Index more'));
  ui.press('Index more');
  await vi.waitFor(() => expect(ui.text('.mr-map-status')).toMatch(/^Built from all/));
  expect(readPaths(third)).toStrictEqual(['README.md']);
});

it('keeps nothing from a private window, and uses nothing remembered there', async () => {
  settings(true);
  await ui.open(hashed(before));
  await showMap();
  await vi.waitFor(() => expect(Object.keys(remembered())).toHaveLength(1));
  ui.close();
  const stored = localStorage.length;
  vi.stubGlobal('chrome', { extension: { inIncognitoContext: true } });
  const source = hashed({ ...before, 'old.md': '# Old, revised' });
  await ui.open(source);
  await showMap();
  expect(readPaths(source).sort()).toStrictEqual(['README.md', 'broken.md', 'guide.md', 'old.md']);
  expect(localStorage.length).toBe(stored);
});

it('a document that could not be read, or whose listing gave no content hash, is not remembered', async () => {
  settings(true);
  const source = hashed(before, {
    discover: vi.fn(async () => ({
      docs: [...['README.md', 'guide.md', 'broken.md'].map((path) => ({ path, blob: hash(before[path]) })), { path: 'old.md' }],
      limits: [],
      configs: { files: [], limits: [] },
    })),
  });
  const load = source.load;
  source.load = vi.fn((path: string) => (path === 'broken.md' ? Promise.reject(new Error('500')) : load(path)));
  await ui.open(source);
  ui.click('[data-act="back-to-map"]');
  await vi.waitFor(() => expect(ui.text('.mr-map-status')).toContain('1 document could not be read.'));
  await vi.waitFor(() => expect(Object.keys(localStorage).some((key) => key.startsWith('galley:outlines:'))).toBe(true));
  const record = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('galley:outlines:'))!)!);
  expect(Object.keys(record.docs)).toStrictEqual(['README.md', 'guide.md']);
});
