import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOWED, compareWarnings, countWarnings } from './firefox-lint.mjs';

const warn = (file, code) => ({ file, code });
const allowed = { 'content.js': { UNSAFE_VAR_ASSIGNMENT: 1 }, 'diagram-frame.js': { DANGEROUS_EVAL: 2, UNSAFE_VAR_ASSIGNMENT: 3 } };

test('counts the validator’s warnings by file and rule', () => {
  const report = { warnings: [warn('a.js', 'X'), warn('a.js', 'X'), warn('a.js', 'Y'), warn('b.js', 'X')] };
  assert.deepEqual(countWarnings(report), { 'a.js': { X: 2, Y: 1 }, 'b.js': { X: 1 } });
  assert.deepEqual(countWarnings({}), {});
});

test('accepts exactly the recorded warnings, wherever in the file they are', () => {
  const report = {
    warnings: [
      warn('diagram-frame.js', 'DANGEROUS_EVAL'),
      warn('content.js', 'UNSAFE_VAR_ASSIGNMENT'),
      ...Array(3).fill(warn('diagram-frame.js', 'UNSAFE_VAR_ASSIGNMENT')),
      warn('diagram-frame.js', 'DANGEROUS_EVAL'),
    ],
    errors: [],
  };
  assert.deepEqual(compareWarnings(report, allowed), []);
});

test('fails on a new warning, in a new file or an old one, on a warning that went away, and on any error', () => {
  const report = {
    warnings: [
      warn('content.js', 'UNSAFE_VAR_ASSIGNMENT'),
      warn('content.js', 'UNSAFE_VAR_ASSIGNMENT'),
      warn('launcher.js', 'UNSAFE_VAR_ASSIGNMENT'),
      warn('diagram-frame.js', 'DANGEROUS_EVAL'),
      ...Array(3).fill(warn('diagram-frame.js', 'UNSAFE_VAR_ASSIGNMENT')),
    ],
    errors: [{ code: 'MANIFEST_FIELD_REQUIRED', file: 'manifest.json', message: 'name is required' }],
  };
  assert.deepEqual(compareWarnings(report, allowed), [
    'error MANIFEST_FIELD_REQUIRED in manifest.json: name is required',
    'content.js: 1 new UNSAFE_VAR_ASSIGNMENT warning (2 reported, 1 recorded)',
    `diagram-frame.js: 1 fewer DANGEROUS_EVAL warning (1 reported, 2 recorded); lower the count in ${ALLOWED}`,
    'launcher.js: 1 new UNSAFE_VAR_ASSIGNMENT warning (1 reported, 0 recorded)',
  ]);
});
