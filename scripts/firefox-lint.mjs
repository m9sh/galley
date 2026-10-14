// Runs Mozilla's add-on validator on the built Firefox add-on, as addons.mozilla.org does on upload, and compares
// what it reports with store/firefox-warnings.json.
//   npm run build && npm run lint:firefox
// Galley's own code must add no warning. The ones that remain come from unmodified third-party code in the bundles
// (DOMPurify, highlight.js, Mermaid and its dependencies), and store/FIREFOX.md explains each. A new warning, or a
// changed count, fails; so does one that went away, so the list only gets shorter on purpose.
// The validator is MPL-2.0, so it is run with npx at a pinned version and is not a dependency of this project.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED = 'store/firefox-warnings.json';

/** Counts of the validator's warnings by file and rule: `{ 'content.js': { UNSAFE_VAR_ASSIGNMENT: 1 } }`. */
export function countWarnings(report) {
  const counts = {};
  for (const { file, code } of report.warnings ?? []) {
    counts[file] ??= {};
    counts[file][code] = (counts[file][code] ?? 0) + 1;
  }
  return counts;
}

/** What differs between the validator's report and the recorded warnings, in plain words. */
export function compareWarnings(report, allowed) {
  const problems = (report.errors ?? []).map(({ code, file, message }) => `error ${code}${file ? ` in ${file}` : ''}: ${message}`);
  const found = countWarnings(report);
  for (const file of [...new Set([...Object.keys(found), ...Object.keys(allowed)])].sort()) {
    for (const code of [...new Set([...Object.keys(found[file] ?? {}), ...Object.keys(allowed[file] ?? {})])].sort()) {
      const now = found[file]?.[code] ?? 0;
      const before = allowed[file]?.[code] ?? 0;
      if (now > before) problems.push(`${file}: ${now - before} new ${code} warning${now - before === 1 ? '' : 's'} (${now} reported, ${before} recorded)`);
      else if (now < before)
        problems.push(
          `${file}: ${before - now} fewer ${code} warning${before - now === 1 ? '' : 's'} (${now} reported, ${before} recorded); lower the count in ${ALLOWED}`,
        );
    }
  }
  return problems;
}

function validate(root, version) {
  let out;
  try {
    out = execFileSync('npx', ['--yes', `addons-linter@${version}`, 'dist/firefox', '--output', 'json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // The validator exits non-zero when it finds an error, and still prints its report.
    if (!err.stdout) throw err;
    out = err.stdout;
  }
  return JSON.parse(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { linter, warnings } = JSON.parse(readFileSync(`${root}${ALLOWED}`, 'utf8'));
  const report = validate(root, linter);
  const problems = compareWarnings(report, warnings);
  if (problems.length) {
    console.error(`Firefox validator (addons-linter ${linter}) differs from ${ALLOWED}:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Firefox validator (addons-linter ${linter}): no errors, and ${report.summary.warnings} warnings, all in third-party code, as recorded.`);
}
