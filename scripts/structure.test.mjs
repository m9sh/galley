import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  areaOf,
  BASELINE,
  checkExports,
  checkFolders,
  checkLayers,
  checkRoot,
  checkSize,
  checkStyleImports,
  checkTestProjects,
  importsOf,
  LAYERS,
  LIMIT,
  lineCount,
  MAX_FILES_PER_FOLDER,
  oversized,
  ROOT,
  run,
} from './structure.mjs';

test('names the area of the source a file belongs to, and counts lines the way an editor does', () => {
  assert.equal(areaOf('src/core/docindex.ts'), 'core');
  assert.equal(areaOf('src/ui/library/repo-reader.ts'), 'ui/library');
  assert.equal(areaOf('src/popup/popup.ts'), 'popup');
  assert.equal(areaOf('demo/main.ts'), 'demo');
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount(''), 0);
});

test('reads the modules a file imports, in every form, and which of them name only types', () => {
  const text = `
import { a } from './a.ts';
import type { B } from '../b.ts';
import {
  c,
  type D,
} from './folder/c.ts';
export { e } from './e.ts';
export type { F } from './f.ts';
export * from './g.ts';
import './side-effect.css';
import foo from 'a-package';
const lazy = () => import('./lazy.ts');
const note = "import { nope } from './not-code.ts'";
`;
  assert.deepEqual(importsOf(text), [
    { specifier: './a.ts', type: false },
    { specifier: '../b.ts', type: true },
    { specifier: './folder/c.ts', type: false },
    { specifier: './e.ts', type: false },
    { specifier: './f.ts', type: true },
    { specifier: './g.ts', type: false },
    { specifier: './side-effect.css', type: false },
    { specifier: './lazy.ts', type: false },
  ]);
});

test('a folder may import only from the folders its layer allows, and type-only imports are not counted', () => {
  assert.ok(LAYERS.core.length === 0 && LAYERS.platforms.includes('core'));
  const problems = checkLayers({
    'src/core/notes.ts': "import { chip } from '../ui/components/dom.ts';\nimport type { DocRef } from '../platforms/types.ts';",
    'src/platforms/github.ts': "import { classify } from '../core/docindex.ts';\nimport { h } from '../ui/components/dom.ts';",
    'src/ui/components/dom.ts': "import { x } from './icons.ts';\nimport { LAYOUTS } from '../preferences/settings.ts';",
    'src/ui/library/repo-reader.ts': "import { openReader } from '../review/reader.ts';",
    'src/background/worker.ts': "import { x } from '../ui/library/outline-cache.ts';",
    'src/testing/repo.ts': "import { x } from '../ui/library/repo-reader.ts';",
    'demo/main.ts': "import { x } from '../src/ui/review/reader.ts';",
    'src/newarea/thing.ts': "import { x } from '../core/notes.ts';",
  });
  assert.deepEqual(problems, [
    'src/core/notes.ts imports from ui/components/ (../ui/components/dom.ts); core/ may import only from core',
    'src/platforms/github.ts imports from ui/components/ (../ui/components/dom.ts); platforms/ may import only from platforms, core',
    'src/ui/library/repo-reader.ts imports from ui/review/ (../review/reader.ts); ui/library/ may import only from ui/library, core, platforms, ui/components, ui/preferences, ui/rendering, ui/sandbox',
    'src/background/worker.ts imports from ui/library/ (../ui/library/outline-cache.ts); background/ may import only from background, core, platforms',
    'src/newarea/thing.ts: newarea/ has no entry in LAYERS (scripts/structure.mjs); say which areas it may import from',
  ]);
});

test('a file over the limit may not grow, a new one may not appear, and the limits only go down', () => {
  const files = {
    'src/a.ts': LIMIT,
    'src/big.ts': 1210,
    'src/grew.ts': 1260,
    'src/shrunk.ts': 900,
    'src/slightly.ts': 1180,
    'src/under.ts': 500,
    'src/new.ts': 900,
  };
  const baseline = { 'src/big.ts': 1250, 'src/grew.ts': 1250, 'src/shrunk.ts': 1500, 'src/slightly.ts': 1200, 'src/under.ts': 1000, 'src/gone.ts': 900 };
  assert.deepEqual(checkSize(files, baseline), [
    'src/grew.ts grew to 1260 lines, over its limit of 1250; split it instead of growing it',
    `src/shrunk.ts is down to 900 lines; lower its limit in ${BASELINE} to 900 (npm run structure -- --update)`,
    `src/new.ts has 900 lines; keep a file under ${LIMIT}, or split it by what it does`,
    `src/under.ts is under ${LIMIT} lines now; remove it from ${BASELINE}`,
    `${BASELINE} lists src/gone.ts, which does not exist; remove it`,
  ]);
  assert.deepEqual(oversized(files), { 'src/big.ts': 1250, 'src/grew.ts': 1300, 'src/shrunk.ts': 900, 'src/slightly.ts': 1200, 'src/new.ts': 900 });
});

test('something is exported only when another file uses it; tests and the demo count, comments do not', () => {
  const sources = {
    'src/core/a.ts':
      'export function used() {}\nexport const onlyHere = 1;\nexport interface Shape {}\nexport type OnlyInTests = string;\nexport default 3;\nconst x = onlyHere;',
    'src/core/b.ts':
      '// onlyHere is described here, and Shape too\n/** Shape */\nimport { used } from "./a.ts";\nexport class Unused {}\nexport async function* gen() {}\nused();',
  };
  const others = { 'src/core/a.test.ts': 'const t: OnlyInTests = "x";', 'demo/main.ts': 'gen();' };
  assert.deepEqual(checkExports(sources, others), [
    'src/core/a.ts: onlyHere is exported but no other file uses it; remove the export',
    'src/core/a.ts: Shape is exported but no other file uses it; remove the export',
    'src/core/b.ts: Unused is exported but no other file uses it; remove the export',
  ]);
});

test('a folder holds a bounded number of source files, and tests, samples and styles do not count towards it', () => {
  const many = Array.from({ length: MAX_FILES_PER_FOLDER + 1 }, (_, i) => `src/ui/rendering/file-${i}.ts`);
  const fine = Array.from({ length: MAX_FILES_PER_FOLDER }, (_, i) => `src/core/file-${i}.ts`);
  const ignored = ['src/core/a.test.ts', 'src/core/types.d.ts', 'demo/samples/head/src/x.ts', 'src/core/styles.css'];
  assert.deepEqual(checkFolders([...many, ...fine, ...ignored]), [
    `src/ui/rendering/ holds ${MAX_FILES_PER_FOLDER + 1} source files; more than ${MAX_FILES_PER_FOLDER} wants a subfolder`,
  ]);
});

test('every folder with tests is a Vitest project, or its tests never run', () => {
  const config = "projects: [folder('core', {}), folder('ui', {}), folder('dev-tools', {})]";
  const paths = ['src/core/a.test.ts', 'src/ui/library/b.test.ts', 'src/newarea/c.test.ts', 'src/popup/d.dev.test.ts', 'src/dev-tools/e.test.ts'];
  assert.deepEqual(checkTestProjects(paths, config), ["src/newarea/ has tests but no Vitest project; add folder('newarea', …) to vitest.config.ts"]);
});

test('a stylesheet that code imports has to exist', () => {
  const sources = {
    'src/ui/components/reader-styles.ts':
      "import a from './styles/01-a.css';\nimport b from './styles/02-b.css';\nimport c from '../library/styles/01-frame.css';",
  };
  assert.deepEqual(checkStyleImports(sources, ['src/ui/components/styles/01-a.css', 'src/ui/library/styles/01-frame.css']), [
    'src/ui/components/reader-styles.ts imports ./styles/02-b.css, which does not exist',
  ]);
});

test('the repository root holds only what is listed', () => {
  assert.ok(ROOT.includes('src') && ROOT.includes('package.json'));
  assert.deepEqual(checkRoot(['package.json', 'src/a.ts', 'notes.txt', 'scratch/x.md', 'docs/a.md', 'notes.txt']), [
    'notes.txt is not allowed at the repository root; put it in a folder, or add it to ROOT in scripts/structure.mjs if it belongs there',
    'scratch is not allowed at the repository root; put it in a folder, or add it to ROOT in scripts/structure.mjs if it belongs there',
  ]);
});

async function repository(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'galley-structure-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

test('checks a whole repository, writes its size limits on request, and leaves untracked scratch files at the root alone', async (t) => {
  const big = `${'const x = 1;\n'.repeat(LIMIT + 10)}`;
  const root = await repository(t, {
    'package.json': '{}',
    'vitest.config.ts': "folder('core', {})",
    'src/core/a.ts': "import { b } from './b.ts';\nexport const a = b;",
    'src/core/b.ts': 'export const b = 1;',
    'src/core/a.test.ts': "import { a } from './a.ts';",
    'src/ui/components/dom.ts': "import { a } from '../../core/a.ts';\nexport const h = a;",
    'src/ui/components/big.ts': big,
    'src/ui/components/reader-styles.ts': "import css from './missing.css';",
  });
  await writeFile(join(root, 'scratch-notes.md'), 'untracked');
  assert.deepEqual(run(root), [
    `src/ui/components/big.ts has ${LIMIT + 10} lines; keep a file under ${LIMIT}, or split it by what it does`,
    'src/ui/components/dom.ts: h is exported but no other file uses it; remove the export',
    'src/ui/components/reader-styles.ts imports ./missing.css, which does not exist',
  ]);
  assert.deepEqual(run(root, { update: true }), []);
  assert.deepEqual(run(root), [
    'src/ui/components/dom.ts: h is exported but no other file uses it; remove the export',
    'src/ui/components/reader-styles.ts imports ./missing.css, which does not exist',
  ]);
});
