// Removes what builds, tests and screenshot scripts generate, so a working copy goes back to what git tracks.
//   npm run clean                  remove dist/, coverage/, reports/ and demo/build/
//   npm run clean -- --dry-run     only list them, with their sizes
// node_modules stays: delete it yourself to reinstall from scratch.
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Everything below is ignored by git and rebuilt by a script. */
export const GENERATED = ['dist', 'coverage', 'reports', 'demo/build'];

async function sizeOf(path) {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(path)) total += await sizeOf(join(path, name));
  return total;
}

/** Remove the generated folders that exist (or only report them), and say how much each held. */
export async function clean(root, { dryRun = false } = {}) {
  const found = [];
  for (const name of GENERATED) {
    const path = join(root, name);
    let bytes;
    try {
      bytes = await sizeOf(path);
    } catch {
      continue;
    }
    if (!dryRun) await rm(path, { recursive: true, force: true });
    found.push({ name, bytes });
  }
  return found;
}

const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const found = await clean(fileURLToPath(new URL('..', import.meta.url)), { dryRun });
  if (!found.length) console.log('Nothing to clean.');
  for (const { name, bytes } of found) console.log(`${dryRun ? 'Would remove' : 'Removed'} ${name}/ (${megabytes(bytes)})`);
}
