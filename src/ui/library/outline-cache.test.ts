import { beforeEach, expect, it, vi } from 'vitest';
import { indexDocument, OUTLINE_FORMAT, type IndexedDoc } from '../../core/docindex.ts';
import { recallOutlines, rememberOutlines, touchOutlines } from './outline-cache.ts';
import { forgetOutlines, OUTLINE_CHARS, OUTLINE_LIFETIME, OUTLINE_PROJECT_CHARS, outlineUse, pruneOutlines } from './outline-store.ts';
import { digestText } from './project-store.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 13);
const PROJECT = 'github:https://github.com/acme/handbook';
const SITE = 'https://github.com';

const doc = (path: string, text = `# ${path}\n\nSee [guide](guide.md).`) => indexDocument(path, text);
const entry = (path: string, blob = `blob-${path}`, reading: IndexedDoc = doc(path)) => ({ path, blob, doc: reading });
/** A reading that takes about `chars` characters to keep. */
const big = (path: string, chars: number) => entry(path, `blob-${path}`, { ...doc(path), title: 'x'.repeat(chars) });

/** Extension storage in memory: values are copied in and out, as the browser does. */
function extensionStorage(incognito = false, version = '1.0.0') {
  const data = new Map<string, unknown>();
  const copy = (value: unknown) => JSON.parse(JSON.stringify(value));
  const local = {
    get: vi.fn(async (keys: string[] | null) =>
      Object.fromEntries([...data].filter(([key]) => keys === null || keys.includes(key)).map(([key, value]) => [key, copy(value)])),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, copy(value));
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) data.delete(key);
    }),
  };
  vi.stubGlobal('chrome', { storage: { local }, extension: { inIncognitoContext: incognito }, runtime: { getManifest: () => ({ version }) } });
  return { data, local };
}

beforeEach(() => localStorage.clear());

it('remembers each document’s reading with the hash of its content, so a project read again can skip them, and keeps nothing readable in its keys', async () => {
  const { data } = extensionStorage();
  await rememberOutlines(PROJECT, SITE, [entry('README.md'), entry('docs/a.md')], NOW);
  const recalled = await recallOutlines(PROJECT, NOW + DAY);
  expect([...recalled.keys()]).toStrictEqual(['README.md', 'docs/a.md']);
  expect(recalled.get('docs/a.md')).toStrictEqual({ blob: 'blob-docs/a.md', doc: doc('docs/a.md') });
  expect(await recallOutlines('github:https://github.com/acme/other', NOW)).toStrictEqual(new Map());
  const fingerprint = await digestText(PROJECT);
  expect([...data.keys()].sort()).toStrictEqual(['galley:outlines', `galley:outlines:${fingerprint}`]);
  // Titles, headings and links are kept; the text of a document is not.
  expect(JSON.stringify([...data.values()])).not.toContain('See [guide]');
  expect(await outlineUse()).toStrictEqual({ projects: 1, chars: expect.any(Number) });
});

it('keeps the same in the page’s localStorage when there is no extension storage, as in the demo', async () => {
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  expect((await recallOutlines(PROJECT, NOW)).get('README.md')).toStrictEqual({ blob: 'blob-README.md', doc: doc('README.md') });
  expect(localStorage.length).toBe(2);
  await forgetOutlines();
  expect(localStorage.length).toBe(0);
});

it('forgets a project a week after it was last used, and using it again starts the week over', async () => {
  extensionStorage();
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  expect((await recallOutlines(PROJECT, NOW + OUTLINE_LIFETIME)).size).toBe(1);
  expect((await recallOutlines(PROJECT, NOW + OUTLINE_LIFETIME + 1)).size).toBe(0);
  await touchOutlines(PROJECT, NOW + 6 * DAY);
  expect((await recallOutlines(PROJECT, NOW + 12 * DAY)).size).toBe(1);
  // A project never remembered is not made up by being touched.
  await touchOutlines('github:https://github.com/acme/other', NOW);
  expect((await outlineUse()).projects).toBe(1);
});

it('reads nothing back from a version it does not know, or from storage that is damaged or unavailable', async () => {
  const { data, local } = extensionStorage();
  await rememberOutlines(PROJECT, SITE, [entry('README.md'), entry('docs/a.md'), entry('docs/b.md'), entry('docs/c.md')], NOW);
  const key = `galley:outlines:${await digestText(PROJECT)}`;
  const record = data.get(key) as { v: number; docs: Record<string, { blob: unknown; doc: unknown }> };
  // One reading for another path, one without a content hash and one that is not a reading at all: only the sound ones come back.
  record.docs['README.md'].doc = record.docs['docs/a.md'].doc;
  record.docs['docs/b.md'].blob = 7;
  record.docs['docs/c.md'] = null as never;
  data.set(key, record);
  expect([...(await recallOutlines(PROJECT, NOW)).keys()]).toStrictEqual(['docs/a.md']);
  data.set(key, { ...record, v: OUTLINE_FORMAT + 1 });
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(0);
  data.set(key, { v: OUTLINE_FORMAT, app: '1.0.0' });
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(0);
  data.delete(key);
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(0);
  local.get.mockRejectedValueOnce(new Error('Storage is unavailable'));
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(0);
});

it('keeps as many of a project’s readings as its share allows, and leaves out one that does not fit without stopping', async () => {
  const { data } = extensionStorage();
  await rememberOutlines(PROJECT, SITE, [big('a.md', 600_000), big('b.md', 600_000), big('huge.md', OUTLINE_PROJECT_CHARS), entry('c.md')], NOW);
  expect([...(await recallOutlines(PROJECT, NOW)).keys()]).toStrictEqual(['a.md', 'c.md']);
  expect((await outlineUse()).chars).toBeLessThanOrEqual(OUTLINE_PROJECT_CHARS);
  expect(data.size).toBe(2);
});

it('lets go of projects not used for a week, then the least recently used ones, so everything kept stays within its size', async () => {
  const { data } = extensionStorage();
  const projects = ['one', 'two', 'three', 'four'].map((name) => `github:https://github.com/acme/${name}`);
  for (const [at, project] of projects.entries()) await rememberOutlines(project, SITE, [big('a.md', 980_000)], NOW + at * 60_000);
  expect((await outlineUse()).projects).toBe(4);
  expect((await outlineUse()).chars).toBeLessThan(OUTLINE_CHARS);
  // The fifth does not fit beside the other four: the one used longest ago goes, with its documents.
  await rememberOutlines('github:https://github.com/acme/five', SITE, [big('a.md', 980_000)], NOW + 5 * 60_000);
  expect(await outlineUse()).toMatchObject({ projects: 4 });
  expect((await recallOutlines(projects[0], NOW + 6 * 60_000)).size).toBe(0);
  expect((await recallOutlines(projects[1], NOW + 6 * 60_000)).size).toBe(1);
  expect(data.size).toBe(5);
  // Projects past a week go whenever anything is saved, even when there is room.
  await rememberOutlines('github:https://github.com/acme/six', SITE, [entry('a.md')], NOW + 8 * DAY);
  expect(await outlineUse()).toMatchObject({ projects: 1 });
  expect(data.size).toBe(2);
});

it('keeps nothing from a private window, and reads nothing for it', async () => {
  const { data, local } = extensionStorage();
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  local.get.mockClear();
  local.set.mockClear();
  vi.stubGlobal('chrome', { storage: { local }, extension: { inIncognitoContext: true } });
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(0);
  await rememberOutlines('github:https://github.com/acme/private', SITE, [entry('README.md')], NOW);
  await touchOutlines(PROJECT, NOW + DAY);
  expect(local.get).not.toHaveBeenCalled();
  expect(local.set).not.toHaveBeenCalled();
  expect(data.size).toBe(2);
  // Forgetting is always allowed.
  await forgetOutlines();
  expect(data.size).toBe(0);
});

it('forgets everything it kept and nothing else, or only what was kept for one site', async () => {
  const { data } = extensionStorage();
  data.set('galley:settings', { theme: 'sage' });
  data.set('galley:project:abc', { saved: null, draft: null });
  const other = 'gitlab:https://git.example.com/team/docs';
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  await rememberOutlines(other, 'https://git.example.com', [entry('README.md')], NOW);
  await rememberOutlines('github:https://github.com/acme/second', SITE, [entry('README.md')], NOW);
  expect(data.size).toBe(2 + 1 + 3);
  await forgetOutlines(SITE);
  expect(await outlineUse()).toMatchObject({ projects: 1 });
  expect((await recallOutlines(other, NOW)).size).toBe(1);
  expect(data.size).toBe(2 + 1 + 1);
  await forgetOutlines();
  expect([...data.keys()]).toStrictEqual(['galley:settings', 'galley:project:abc']);
  expect(await outlineUse()).toStrictEqual({ projects: 0, chars: 0 });
});

it('a store that is full or unavailable never gets in the reader’s way when remembering, and is reported when forgetting', async () => {
  const { local } = extensionStorage();
  local.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
  await expect(rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW)).resolves.toBeUndefined();
  local.get.mockRejectedValueOnce(new Error('Storage is unavailable'));
  await expect(touchOutlines(PROJECT, NOW)).resolves.toBeUndefined();
  // A failure does not stop the writes behind it.
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(1);
  local.remove.mockRejectedValueOnce(new Error('Storage is unavailable'));
  await expect(forgetOutlines()).rejects.toThrow('Storage is unavailable');
  await expect(forgetOutlines()).resolves.toBeUndefined();
});

it('starts over when Galley has been updated, since a new version may read documents differently', async () => {
  extensionStorage(false, '1.0.0');
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(1);
  const installed = globalThis.chrome;
  vi.stubGlobal('chrome', { ...installed, runtime: { getManifest: () => ({ version: '1.1.0' }) } });
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(0);
  // Saving again replaces the old version's readings.
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW);
  expect((await recallOutlines(PROJECT, NOW)).size).toBe(1);
});

it('forgets projects not used for a week without anything being saved, and writes nothing when none has expired', async () => {
  const { data, local } = extensionStorage();
  const old = 'github:https://github.com/acme/old';
  await rememberOutlines(old, SITE, [entry('README.md')], NOW);
  await rememberOutlines(PROJECT, SITE, [entry('README.md')], NOW + 6 * DAY);
  expect(data.size).toBe(3);
  local.set.mockClear();
  local.remove.mockClear();
  await pruneOutlines(NOW + 6 * DAY);
  expect(local.set).not.toHaveBeenCalled();
  expect(local.remove).not.toHaveBeenCalled();
  await pruneOutlines(NOW + 8 * DAY);
  expect(data.size).toBe(2);
  expect((await recallOutlines(old, NOW + 8 * DAY)).size).toBe(0);
  expect((await recallOutlines(PROJECT, NOW + 8 * DAY)).size).toBe(1);
  await pruneOutlines(NOW + 14 * DAY);
  expect(await outlineUse()).toStrictEqual({ projects: 0, chars: 0 });
  expect(data.size).toBe(1);
});
