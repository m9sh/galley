import type { DocRef, ReviewSince, SinceFile } from './types.ts';

/**
 * A comparison with an earlier head, from the files the platform says differ and a way to read a path at that head.
 * A document the platform did not list is read as it was, so `read` is right for any document it is asked about.
 */
export function sinceChanges(commit: string, files: SinceFile[], readAt: (path: string) => Promise<string>): ReviewSince {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    state: 'changes',
    commit,
    files,
    read(doc: DocRef) {
      const file = byPath.get(doc.path);
      return file?.status === 'added' ? Promise.resolve('') : readAt(file?.oldPath ?? doc.path);
    },
  };
}
