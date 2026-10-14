// Lists local branches whose pull request was merged, and deletes them on request.
//   npm run branches:prune               list what could go
//   npm run branches:prune -- --delete   delete the listed branches
// A squash merge leaves nothing in a branch's history, so git cannot tell that it was merged. GitHub can:
// a branch is listed only when its latest commit is the one the merged pull request ended on, so anything
// committed afterwards keeps the branch. The branch you are on, the base branch and branches checked out in
// another worktree are never listed.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Sort local branches into those that can go and those that stay, with the reason.
 * `merged` maps a branch name to the commits its merged pull requests ended on.
 */
export function sortBranches({ branches, current, base, merged }) {
  const prunable = [];
  const kept = [];
  for (const { name, tip, worktree } of branches) {
    if (name === base) continue;
    if (name === current || worktree) kept.push({ name, reason: 'checked out' });
    else if (!merged.has(name)) kept.push({ name, reason: 'no merged pull request' });
    else if (!merged.get(name).has(tip)) kept.push({ name, reason: 'has commits the merged pull request did not' });
    else prunable.push(name);
  }
  return { prunable, kept };
}

const run = (command, ...args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function localBranches() {
  return run('git', 'for-each-ref', '--format=%(refname:short)\t%(objectname)\t%(worktreepath)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, tip, worktree] = line.split('\t');
      return { name, tip, worktree: Boolean(worktree) };
    });
}

function mergedPullRequests() {
  const merged = new Map();
  for (const { headRefName, headRefOid } of JSON.parse(run('gh', 'pr', 'list', '--state', 'merged', '--limit', '1000', '--json', 'headRefName,headRefOid'))) {
    merged.set(headRefName, (merged.get(headRefName) ?? new Set()).add(headRefOid));
  }
  return merged;
}

function baseBranch() {
  try {
    return run('git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, '');
  } catch {
    return 'main';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { prunable, kept } = sortBranches({
    branches: localBranches(),
    current: run('git', 'branch', '--show-current'),
    base: baseBranch(),
    merged: mergedPullRequests(),
  });
  const remove = process.argv.includes('--delete');
  if (!prunable.length) console.log('No merged branches to remove.');
  for (const name of prunable) {
    if (remove) run('git', 'branch', '-D', name);
    console.log(`${remove ? 'Deleted' : 'Merged'}: ${name}`);
  }
  for (const { name, reason } of kept.filter(({ reason }) => reason !== 'no merged pull request')) console.log(`Kept: ${name} (${reason})`);
  if (prunable.length && !remove) console.log('\nRun again with --delete to remove them.');
}
