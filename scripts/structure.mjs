// Keeps the repository organised: what Biome cannot see across files and folders.
//   npm run structure             check
//   npm run structure -- --update lower the size limits in scripts/structure-baseline.json to today's sizes
//
// The rules, and why each exists, are in docs/architecture/README.md (Structure rules) and ADR 0032:
//   1. Layers: a folder imports only from the folders below it, so core logic stays free of the page and the platforms.
//   2. Size: a source file stays under LIMIT lines. A file already over it may not grow, and its limit only goes down.
//   3. Exports: something is exported only if another file uses it.
//   4. Folders: a folder holds at most MAX_FILES_PER_FOLDER source files.
//   5. Tests: a test file lives in a folder that has a Vitest project, or it would never run.
//   6. Styles: a stylesheet that code imports exists.
//   7. Root: the repository root holds only what is listed here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIMIT = 800;
export const MAX_FILES_PER_FOLDER = 30;
export const BASELINE = 'scripts/structure-baseline.json';

/** Everything that may sit at the repository root. A new file or folder here is a decision, so it is added on purpose. */
export const ROOT = [
  '.agents',
  '.claude',
  '.githooks',
  '.github',
  '.gitignore',
  '.nvmrc',
  '.release-please-manifest.json',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'PRIVACY.md',
  'PUBLISHING.md',
  'README.md',
  'SECURITY.md',
  'biome.jsonc',
  'codecov.yml',
  'demo',
  'docs',
  'e2e',
  'lint',
  'package-lock.json',
  'package.json',
  'release-please-config.json',
  'scripts',
  'site',
  'src',
  'store',
  'tsconfig.json',
  'tsconfig.scripts.json',
  'vitest.config.ts',
];

const UI = ['ui/components', 'ui/library', 'ui/opening', 'ui/preferences', 'ui/rendering', 'ui/review', 'ui/sandbox'];

/**
 * For each area of the source, the areas its code may import from (itself is always allowed). Reading it from the
 * top: shared logic (core) knows nothing of the page or the platforms; platforms know core; the interface knows both;
 * the entry points (content, popup, options, background) assemble them. Imports that only name types are not checked.
 */
export const LAYERS = {
  core: [],
  platforms: ['core'],
  'ui/preferences': ['core'],
  'ui/components': ['core', 'ui/preferences'],
  'ui/sandbox': ['core', 'ui/rendering'],
  'ui/rendering': ['core', 'platforms', 'ui/components', 'ui/sandbox'],
  'ui/opening': ['core', 'platforms', 'ui/components'],
  'ui/library': ['core', 'platforms', 'ui/components', 'ui/preferences', 'ui/rendering', 'ui/sandbox'],
  'ui/review': ['core', 'platforms', 'ui/components', 'ui/library', 'ui/preferences', 'ui/rendering'],
  background: ['core', 'platforms'],
  content: ['core', 'platforms', ...UI],
  options: ['core', 'platforms', 'ui/preferences'],
  popup: ['core', 'platforms', 'ui/preferences'],
  // The development build reloads the extension through its own copy of the worker.
  dev: ['background'],
  // Helpers for tests and the demo page may reach anything.
  testing: ['*'],
  demo: ['*'],
};

const isTest = (file) => /\.test\.ts$/.test(file);
const isSource = (file) => /^(?:src|demo)\/.+\.ts$/.test(file) && !isTest(file) && !file.endsWith('.d.ts') && !file.startsWith('demo/samples/');
const isStyle = (file) => /^(?:src|demo)\/.+\.css$/.test(file) && !file.startsWith('demo/samples/') && !file.startsWith('demo/build/');

/** The area of the source a file belongs to: `ui/library`, `core`, `demo`, … */
export function areaOf(file) {
  const parts = file.split('/');
  if (parts[0] === 'demo') return 'demo';
  return parts[1] === 'ui' && parts.length > 3 ? `ui/${parts[2]}` : parts[1];
}

/** Lines in a file, the way an editor counts them. */
export const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
const roundUp = (lines) => Math.ceil(lines / 50) * 50;

// ---------------------------------------------------------------- size

/** `files` maps a path to its number of lines; `baseline` maps an oversized path to its limit. */
export function checkSize(files, baseline) {
  const problems = [];
  for (const [file, lines] of Object.entries(files)) {
    const limit = baseline[file];
    if (lines <= LIMIT) continue;
    if (limit === undefined) problems.push(`${file} has ${lines} lines; keep a file under ${LIMIT}, or split it by what it does`);
    else if (lines > limit) problems.push(`${file} grew to ${lines} lines, over its limit of ${limit}; split it instead of growing it`);
    else if (limit - lines >= 100)
      problems.push(`${file} is down to ${lines} lines; lower its limit in ${BASELINE} to ${roundUp(lines)} (npm run structure -- --update)`);
  }
  for (const file of Object.keys(baseline)) {
    if (!(file in files)) problems.push(`${BASELINE} lists ${file}, which does not exist; remove it`);
    else if (files[file] <= LIMIT) problems.push(`${file} is under ${LIMIT} lines now; remove it from ${BASELINE}`);
  }
  return problems;
}

export const oversized = (files) =>
  Object.fromEntries(
    Object.entries(files)
      .filter(([, lines]) => lines > LIMIT)
      .map(([file, lines]) => [file, roundUp(lines)]),
  );

// ---------------------------------------------------------------- layers

const STATEMENT =
  /(?:^|\n)[ \t]*(import|export)(\s+type)?(?=[\s{*])[^'";]*?\sfrom\s+['"]([^'"]+)['"]|(?:^|\n)[ \t]*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The relative modules a source file imports: `{ specifier, type }`, where `type` is true for imports that name only types. */
export function importsOf(text) {
  const found = [];
  for (const match of text.matchAll(STATEMENT)) {
    const specifier = match[3] ?? match[4] ?? match[5];
    if (specifier?.startsWith('.')) found.push({ specifier, type: Boolean(match[2]) });
  }
  return found;
}

export function checkLayers(sources) {
  const problems = [];
  for (const [file, text] of Object.entries(sources)) {
    const area = areaOf(file);
    const allowed = LAYERS[area];
    if (!allowed) {
      problems.push(`${file}: ${area}/ has no entry in LAYERS (scripts/structure.mjs); say which areas it may import from`);
      continue;
    }
    if (allowed.includes('*')) continue;
    for (const { specifier, type } of importsOf(text)) {
      if (type) continue;
      const target = areaOf(normalize(join(dirname(file), specifier)));
      if (target !== area && !allowed.includes(target) && target in LAYERS)
        problems.push(`${file} imports from ${target}/ (${specifier}); ${area}/ may import only from ${[area, ...allowed].join(', ')}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- exports

const EXPORT = /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const WORD = /[A-Za-z_$][\w$]*/g;

/** Source with the comments that only describe things taken out, so a name in a comment does not count as a use. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** `sources` and `others` (tests, the demo and test helpers) map a path to its text. */
export function checkExports(sources, others) {
  const usedIn = new Map();
  const note = (file, text) => {
    for (const word of new Set(withoutComments(text).match(WORD) ?? [])) usedIn.set(word, (usedIn.get(word) ?? new Set()).add(file));
  };
  for (const [file, text] of Object.entries(sources)) note(file, text);
  for (const [file, text] of Object.entries(others)) note(file, text);
  const problems = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const [, name] of text.matchAll(EXPORT)) {
      const users = usedIn.get(name) ?? new Set();
      if (![...users].some((user) => user !== file)) problems.push(`${file}: ${name} is exported but no other file uses it; remove the export`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- folders, tests, styles, root

export function checkFolders(paths) {
  const counts = new Map();
  for (const file of paths.filter(isSource)) counts.set(dirname(file), (counts.get(dirname(file)) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > MAX_FILES_PER_FOLDER)
    .map(([folder, count]) => `${folder}/ holds ${count} source files; more than ${MAX_FILES_PER_FOLDER} wants a subfolder`);
}

/** Every `src/<folder>` that has tests is a Vitest project in vitest.config.ts: otherwise its tests never run. */
export function checkTestProjects(paths, vitestConfig) {
  const projects = new Set([...vitestConfig.matchAll(/folder\('([\w-]+)'/g)].map((match) => match[1]));
  const folders = new Set(paths.filter((file) => /^src\/[\w-]+\/.*\.test\.ts$/.test(file) && !/\.dev\.test\.ts$/.test(file)).map((file) => file.split('/')[1]));
  return [...folders]
    .filter((folder) => !projects.has(folder))
    .map((folder) => `src/${folder}/ has tests but no Vitest project; add folder('${folder}', …) to vitest.config.ts`);
}

export function checkStyleImports(sources, paths) {
  const known = new Set(paths);
  const problems = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const [, specifier] of text.matchAll(/\sfrom\s+['"](\.[^'"]+\.css)['"]/g)) {
      if (!known.has(normalize(join(dirname(file), specifier)))) problems.push(`${file} imports ${specifier}, which does not exist`);
    }
  }
  return problems;
}

export function checkRoot(paths) {
  const names = new Set(paths.map((file) => file.split('/')[0]));
  return [...names]
    .filter((name) => !ROOT.includes(name))
    .sort()
    .map((name) => `${name} is not allowed at the repository root; put it in a folder, or add it to ROOT in scripts/structure.mjs if it belongs there`);
}

// ---------------------------------------------------------------- run

/** Tracked files, plus new ones git would add unless `tracked` says to leave them out, that exist. */
export function repositoryFiles(root, { tracked = false } = {}) {
  const out = execFileSync('git', ['ls-files', '--cached', ...(tracked ? [] : ['--others', '--exclude-standard']), '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return out.split('\0').filter((file) => file && existsSync(join(root, file)));
}

export function run(root, { update = false } = {}) {
  const paths = repositoryFiles(root);
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const pick = (test) => Object.fromEntries(paths.filter(test).map((file) => [file, read(file)]));
  const sources = pick(isSource);
  const sizes = Object.fromEntries([...paths.filter((file) => isSource(file) || isStyle(file))].map((file) => [file, lineCount(read(file))]));
  if (update) {
    mkdirSync(dirname(join(root, BASELINE)), { recursive: true });
    writeFileSync(join(root, BASELINE), `${JSON.stringify(oversized(sizes), null, 2)}\n`);
    return [];
  }
  const baseline = existsSync(join(root, BASELINE)) ? JSON.parse(read(BASELINE)) : {};
  const others = pick((file) => isTest(file) || file.startsWith('src/testing/') || file.startsWith('demo/'));
  const production = Object.fromEntries(Object.entries(sources).filter(([file]) => !file.startsWith('src/testing/') && !file.startsWith('demo/')));
  return [
    ...checkSize(sizes, baseline),
    ...checkLayers(Object.fromEntries(Object.entries(sources).filter(([file]) => file.startsWith('src/')))),
    ...checkExports(production, { ...Object.fromEntries(Object.entries(sources).filter(([file]) => !(file in production))), ...others }),
    ...checkFolders(paths),
    ...checkTestProjects(paths, existsSync(join(root, 'vitest.config.ts')) ? read('vitest.config.ts') : ''),
    ...checkStyleImports(sources, paths),
    // A scratch file in the working copy is not the repository's to judge; only what is tracked counts.
    ...checkRoot(repositoryFiles(root, { tracked: true })),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const update = process.argv.includes('--update');
  const problems = run(root, { update });
  if (update) console.log(`${BASELINE} updated.`);
  else if (problems.length) {
    console.error(`Structure problems:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    process.exit(1);
  } else console.log('Structure: layers, sizes, exports, folders, tests, styles and the root are in order.');
}
