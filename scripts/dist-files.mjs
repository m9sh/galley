// Keeps dist/ from collecting a zip for every version that was ever built.
import { readdir, rm } from 'node:fs/promises';

/**
 * After writing `current` (for example galley-chrome-0.19.0.zip), remove the zips of other versions of the
 * same package. The dev zips (galley-chrome-dev-…) are a different package and are left to their own script.
 */
export async function removeSupersededZips(dir, current) {
  const match = /^(.+)-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.zip$/.exec(current);
  if (!match) return [];
  const sameKind = new RegExp(`^${match[1]}-\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?\\.zip$`);
  const removed = [];
  for (const name of await readdir(dir)) {
    if (name === current || !sameKind.test(name)) continue;
    await rm(`${dir}/${name}`, { force: true });
    removed.push(name);
  }
  return removed;
}
