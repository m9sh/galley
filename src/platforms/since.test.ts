import { expect, it } from 'vitest';
import { directApi } from '../testing/github.ts';
import { jsonResponse as response, mockFetch } from '../testing/http.ts';
import { loadGitHub } from './github.ts';
import { loadGitLab } from './gitlab.ts';
import { sinceChanges } from './since.ts';
import type { DocRef } from './types.ts';

const OLD = 'a'.repeat(40);
const HEAD = 'h'.repeat(40);
const github = {
  platform: 'github' as const,
  key: '',
  origin: 'https://github.com',
  apiBase: 'https://api.github.com',
  owner: 'acme',
  repo: 'docs',
  number: 1,
  title: 'Docs',
};
const gitlab = { platform: 'gitlab' as const, key: '', origin: 'https://git.example.com', prefix: '', projectPath: 'a/b', projectId: '10', iid: 7 };
const guide: DocRef = { path: 'guide.md', oldPath: 'guide.md', status: 'modified' };
const renamed: DocRef = { path: 'new.md', oldPath: 'old.md', status: 'renamed' };
const added: DocRef = { path: 'added.md', oldPath: 'added.md', status: 'added' };

/** A pull request at HEAD with one file, answering its comparison with OLD as `compare` says. */
function pull(compare: (url: string) => Response | Promise<Response>, requests: string[] = []) {
  mockFetch(async (url) => {
    requests.push(url);
    if (url.includes('/compare/')) return compare(url);
    if (url.includes('/files?')) return response([{ filename: 'guide.md', status: 'modified', changes: 1, raw_url: 'https://github.com/x' }]);
    if (url.includes('/raw/')) return new Response(`text at ${url.split('/raw/')[1]}`);
    return response({ head: { sha: HEAD }, base: { sha: 'b'.repeat(40) }, title: 'Docs' });
  });
  return loadGitHub(
    github,
    directApi('https://github.com', async () => null),
  );
}

it('a GitHub review compares its head with an earlier one in a single request, reading documents as they were', async () => {
  const requests: string[] = [];
  const source = await pull(
    () =>
      response({
        status: 'ahead',
        files: [
          { filename: 'guide.md', status: 'modified' },
          { filename: 'new.md', previous_filename: 'old.md', status: 'renamed' },
          { filename: 'added.md', status: 'added' },
        ],
      }),
    requests,
  );
  expect(source.history!.head).toBe(HEAD);
  const since = await source.history!.since(OLD);
  expect(requests.filter((url) => url.includes('/compare/'))).toStrictEqual([`https://api.github.com/repos/acme/docs/compare/${OLD}...${HEAD}?per_page=1`]);
  if (since.state !== 'changes') throw new Error(`expected a comparison, got ${since.state}`);
  expect(since.commit).toBe(OLD);
  expect(since.files).toStrictEqual([
    { path: 'guide.md', oldPath: 'guide.md', status: 'modified' },
    { path: 'new.md', oldPath: 'old.md', status: 'renamed' },
    { path: 'added.md', oldPath: 'added.md', status: 'added' },
  ]);
  // A moved file is read where it was, and a new one was not there yet, so nothing is requested for it.
  expect(await since.read(guide)).toBe(`text at ${OLD}/guide.md`);
  expect(await since.read(renamed)).toBe(`text at ${OLD}/old.md`);
  expect(await since.read(added)).toBe('');
  expect(requests.filter((url) => url.includes('/raw/'))).toHaveLength(2);
});

it('a GitHub head with the same files as the earlier one is a comparison with nothing in it, not a failure', async () => {
  const since = await (await pull(() => response({ status: 'identical', files: [] }))).history!.since(OLD);
  expect(since).toMatchObject({ state: 'changes', files: [] });
});

it('a GitHub comparison says so when the branch was rewritten, the commit is gone or the list may be cut short', async () => {
  for (const status of ['diverged', 'behind']) {
    expect(await (await pull(() => response({ status, files: [{ filename: 'guide.md', status: 'modified' }] }))).history!.since(OLD)).toStrictEqual({
      state: 'rewritten',
      commit: OLD,
    });
  }
  expect(await (await pull(() => response({ message: 'Not Found' }, 404))).history!.since(OLD)).toStrictEqual({ state: 'unavailable', commit: OLD });
  // GitHub lists 300 files at most: a full list may be only part of the difference.
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md`, status: 'modified' }));
  expect(await (await pull(() => response({ status: 'ahead', files }))).history!.since(OLD)).toStrictEqual({ state: 'incomplete', commit: OLD });
  // A comparison with no list of files is an empty one.
  expect(await (await pull(() => response({ status: 'ahead' }))).history!.since(OLD)).toMatchObject({ state: 'changes', files: [] });
});

it('a GitHub comparison that fails for another reason fails, with what to do about it', async () => {
  const source = await pull(() => response({ message: 'Bad Request' }, 400));
  await expect(source.history!.since(OLD)).rejects.toThrow(/GitHub returned an error \(400\)/);
});

/** A merge request at HEAD, answering the merge base and the comparison as given. */
function merge(parts: { base?: () => Response; compare?: () => Response }, requests: string[] = []) {
  mockFetch(async (url) => {
    requests.push(url);
    if (url.includes('/repository/merge_base?')) return parts.base!();
    if (url.includes('/repository/compare?')) return parts.compare!();
    if (url.includes('/repository/files/'))
      return new Response(`text at ${new URL(url).searchParams.get('ref')} of ${decodeURIComponent(url.split('/files/')[1].split('/raw')[0])}`);
    if (url.includes('/diffs?')) return response([{ new_path: 'guide.md', old_path: 'guide.md', diff: '' }]);
    return response({ title: 'Docs', diff_refs: { base_sha: 'b', head_sha: HEAD, start_sha: 's' } });
  });
  return loadGitLab(gitlab);
}

it('a GitLab review compares its head with an earlier one when that head is part of its history', async () => {
  const requests: string[] = [];
  const source = await merge(
    {
      base: () => response({ id: OLD }),
      compare: () =>
        response({
          diffs: [
            { new_path: 'guide.md', old_path: 'guide.md' },
            { new_path: 'new.md', old_path: 'old.md', renamed_file: true },
            { new_path: 'added.md', old_path: 'added.md', new_file: true },
            { new_path: 'gone.md', old_path: 'gone.md', deleted_file: true },
          ],
        }),
    },
    requests,
  );
  expect(source.history!.head).toBe(HEAD);
  const since = await source.history!.since(OLD);
  expect(requests.filter((url) => url.includes('/repository/'))).toStrictEqual([
    `https://git.example.com/api/v4/projects/10/repository/merge_base?refs[]=${OLD}&refs[]=${HEAD}`,
    `https://git.example.com/api/v4/projects/10/repository/compare?from=${OLD}&to=${HEAD}&straight=true`,
  ]);
  if (since.state !== 'changes') throw new Error(`expected a comparison, got ${since.state}`);
  expect(since.files.map((file) => [file.path, file.status])).toStrictEqual([
    ['guide.md', 'modified'],
    ['new.md', 'renamed'],
    ['added.md', 'added'],
    ['gone.md', 'removed'],
  ]);
  expect(await since.read(renamed)).toBe(`text at ${OLD} of old.md`);
  expect(await since.read(added)).toBe('');
});

it('a GitLab comparison says so when the branch was rewritten, the commit is gone or the list was cut short', async () => {
  const ok = () => response({ id: OLD });
  expect(await (await merge({ base: () => response({ id: 'c'.repeat(40) }) })).history!.since(OLD)).toStrictEqual({ state: 'rewritten', commit: OLD });
  expect(await (await merge({ base: () => response({ message: '404 Not Found' }, 404) })).history!.since(OLD)).toStrictEqual({
    state: 'unavailable',
    commit: OLD,
  });
  expect(await (await merge({ base: ok, compare: () => response({ message: '404 Not Found' }, 404) })).history!.since(OLD)).toStrictEqual({
    state: 'unavailable',
    commit: OLD,
  });
  expect(await (await merge({ base: ok, compare: () => response({ diffs: [], compare_timeout: true }) })).history!.since(OLD)).toStrictEqual({
    state: 'incomplete',
    commit: OLD,
  });
  await expect((await merge({ base: () => response({}, 500) })).history!.since(OLD)).rejects.toThrow(/GitLab returned an error \(500\)/);
});

it('documents the platform did not list are read as they were, at the same path', async () => {
  const read: string[] = [];
  const since = sinceChanges(OLD, [{ path: 'new.md', oldPath: 'old.md', status: 'renamed' }], async (path) => {
    read.push(path);
    return path;
  });
  expect(since).toMatchObject({ state: 'changes', commit: OLD });
  if (since.state !== 'changes') throw new Error('expected a comparison');
  expect(await since.read(guide)).toBe('guide.md');
  expect(await since.read(renamed)).toBe('old.md');
  expect(read).toStrictEqual(['guide.md', 'old.md']);
});
