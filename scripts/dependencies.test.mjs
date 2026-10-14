import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';

const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const major = (version) => Number(/\d+/.exec(version)[0]);

/**
 * Packages that must stay on the same major version, and why. Dependabot proposes a runtime dependency and a development one
 * in different pull requests, so a pair that spans both can arrive half upgraded: each half then fails the type check in a
 * way that says nothing about the cause.
 */
const PAIRS = [
  {
    runtime: '@babel/parser',
    types: '@babel/types',
    why: 'src/ui/sandbox/spec-frame.ts types the parser’s syntax tree with @babel/types, which has to be the version the parser builds',
  },
];

test('a package and the types it is typed with stay on the same major version', async () => {
  const pkg = await read('package.json');
  for (const { runtime, types, why } of PAIRS) {
    const direct = { ...pkg.devDependencies, ...pkg.dependencies }[types];
    // What the installed package is built against, not what package.json asks for: both have to agree.
    const built = (await read(`node_modules/${runtime}/package.json`)).dependencies[types];
    const installed = (await read(`node_modules/${types}/package.json`)).version;
    assert.equal(
      major(direct),
      major(built),
      `${runtime} is built against ${types} ${built}, but package.json has ${types} ${direct}. Upgrade them in one change: ${why}.`,
    );
    assert.equal(major(installed), major(built), `${types} ${installed} is installed, but ${runtime} is built against ${built}. Run npm ci.`);
  }
});

test('Dependabot proposes each pair as one pull request, before the group that would split it', async () => {
  const { updates } = parse(await readFile('.github/dependabot.yml', 'utf8'));
  const groups = Object.entries(updates.find((update) => update['package-ecosystem'] === 'npm').groups);
  for (const { runtime, types } of PAIRS) {
    const scope = runtime.slice(0, runtime.indexOf('/') + 1);
    const together = groups.findIndex(([, group]) => group.patterns?.includes(`${scope}*`));
    assert.notEqual(together, -1, `${runtime} and ${types} need a Dependabot group with the pattern ${scope}* so they arrive together`);
    // A package joins the first group it matches, so every broader group has to come after this one.
    const broader = groups.findIndex(([, group]) => group['dependency-type'] === 'development' || group['dependency-type'] === 'production');
    assert.ok(
      broader === -1 || together < broader,
      `the ${scope}* group has to be listed before the groups that match by dependency type, which would take its packages first`,
    );
  }
});
