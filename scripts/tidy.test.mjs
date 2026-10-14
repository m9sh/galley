import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { sortBranches } from './branches.mjs';
import { clean, GENERATED } from './clean.mjs';
import { removeSupersededZips } from './dist-files.mjs';

async function tree(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'galley-tidy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

test('clean removes what the scripts generate, says how much each held, and leaves everything else', async (t) => {
  const root = await tree(t, {
    'dist/chrome/content.js': 'x'.repeat(100),
    'dist/galley-chrome-0.1.0.zip': 'x'.repeat(50),
    'coverage/lcov.info': 'x',
    'reports/e2e/shot.png': 'xx',
    'demo/build/index.html': 'x',
    'demo/samples/repo/README.md': 'kept',
    'node_modules/pkg/index.js': 'kept',
    'src/main.ts': 'kept',
  });
  assert.deepEqual(GENERATED, ['dist', 'coverage', 'reports', 'demo/build']);
  assert.deepEqual(await clean(root, { dryRun: true }), [
    { name: 'dist', bytes: 150 },
    { name: 'coverage', bytes: 1 },
    { name: 'reports', bytes: 2 },
    { name: 'demo/build', bytes: 1 },
  ]);
  assert.equal(await exists(join(root, 'dist')), true, 'a dry run removes nothing');
  assert.equal((await clean(root)).length, 4);
  for (const name of GENERATED) assert.equal(await exists(join(root, name)), false, name);
  for (const kept of ['demo/samples/repo/README.md', 'node_modules/pkg/index.js', 'src/main.ts']) assert.equal(await exists(join(root, kept)), true, kept);
  assert.deepEqual(await clean(root), [], 'cleaning a clean copy finds nothing');
});

test('a new zip replaces the zips of other versions of the same package only', async (t) => {
  const root = await tree(t, {
    'dist/galley-chrome-0.2.0.zip': '',
    'dist/galley-chrome-0.19.0.zip': '',
    'dist/galley-firefox-0.2.0.zip': '',
    'dist/galley-chrome-dev-0.11.0.zip': '',
    'dist/galley-chrome-0.20.0-beta.1.zip': '',
    'dist/notes.txt': '',
  });
  const dist = join(root, 'dist');
  assert.deepEqual((await removeSupersededZips(dist, 'galley-chrome-0.19.0.zip')).sort(), ['galley-chrome-0.2.0.zip', 'galley-chrome-0.20.0-beta.1.zip']);
  assert.deepEqual((await readdir(dist)).sort(), ['galley-chrome-0.19.0.zip', 'galley-chrome-dev-0.11.0.zip', 'galley-firefox-0.2.0.zip', 'notes.txt']);
  // The dev zips are their own package.
  await writeFile(join(dist, 'galley-chrome-dev-0.12.0.zip'), '');
  assert.deepEqual(await removeSupersededZips(dist, 'galley-chrome-dev-0.12.0.zip'), ['galley-chrome-dev-0.11.0.zip']);
  assert.deepEqual(await removeSupersededZips(dist, 'readme.zip'), []);
});

test('a branch is listed for removal only when its pull request was merged and it has nothing newer', () => {
  const merged = new Map([
    ['feat/done', new Set(['aaa'])],
    ['feat/reused-name', new Set(['old', 'older'])],
    ['feat/current', new Set(['ccc'])],
    ['feat/elsewhere', new Set(['eee'])],
  ]);
  const branches = [
    { name: 'main', tip: 'mmm', worktree: false },
    { name: 'feat/done', tip: 'aaa', worktree: false },
    { name: 'feat/reused-name', tip: 'new', worktree: false },
    { name: 'feat/unmerged', tip: 'uuu', worktree: false },
    { name: 'feat/current', tip: 'ccc', worktree: false },
    { name: 'feat/elsewhere', tip: 'eee', worktree: true },
  ];
  assert.deepEqual(sortBranches({ branches, current: 'feat/current', base: 'main', merged }), {
    prunable: ['feat/done'],
    kept: [
      { name: 'feat/reused-name', reason: 'has commits the merged pull request did not' },
      { name: 'feat/unmerged', reason: 'no merged pull request' },
      { name: 'feat/current', reason: 'checked out' },
      { name: 'feat/elsewhere', reason: 'checked out' },
    ],
  });
});
