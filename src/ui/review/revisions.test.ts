import { beforeEach, expect, it, vi } from 'vitest';
import { baselineFor, loadRevisions, markReviewed, rememberSeen, unmarkReviewed } from './revisions.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

beforeEach(() => localStorage.clear());

it('remembers the last two heads a review was opened at, and what the reviewer marked as reviewed', async () => {
  expect(await loadRevisions('review')).toEqual({ reviewed: null, seen: [] });
  await rememberSeen('review', A);
  await rememberSeen('review', A);
  expect(await loadRevisions('review')).toEqual({ reviewed: null, seen: [A] });
  await rememberSeen('review', B);
  await rememberSeen('review', C);
  expect(await loadRevisions('review')).toEqual({ reviewed: null, seen: [C, B] });
  await markReviewed('review', B);
  await rememberSeen('review', C);
  expect(await loadRevisions('review')).toEqual({ reviewed: B, seen: [C, B] });
  expect(await loadRevisions('another')).toEqual({ reviewed: null, seen: [] });
});

it('compares with the revision marked as reviewed, or else the one opened last, and with nothing when there is no earlier one', () => {
  expect(baselineFor({ reviewed: null, seen: [] }, A)).toBeNull();
  expect(baselineFor({ reviewed: null, seen: [A] }, A)).toBeNull();
  expect(baselineFor({ reviewed: null, seen: [B, A] }, B)).toEqual({ commit: A, kind: 'opened' });
  expect(baselineFor({ reviewed: null, seen: [B, A] }, C)).toEqual({ commit: B, kind: 'opened' });
  expect(baselineFor({ reviewed: A, seen: [C, B] }, C)).toEqual({ commit: A, kind: 'reviewed' });
  // Everything at this head is reviewed: nothing new to show.
  expect(baselineFor({ reviewed: C, seen: [C, B] }, C)).toBeNull();
});

it('takes the mark back but keeps the heads it was opened at, and keeps the 50 most recent reviews', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1);
  await rememberSeen('first', B);
  await markReviewed('first', A);
  await unmarkReviewed('first');
  expect(await loadRevisions('first')).toEqual({ reviewed: null, seen: [B] });
  await markReviewed('first', A);
  for (let i = 0; i < 50; i++) {
    now.mockReturnValue(100 + i);
    await rememberSeen(`review ${i}`, B);
  }
  expect(await loadRevisions('first')).toEqual({ reviewed: null, seen: [] });
  expect(await loadRevisions('review 49')).toEqual({ reviewed: null, seen: [B] });
  now.mockRestore();
});

it('keeps commit ids under a fingerprint of the review, never its address, and nothing else', async () => {
  await markReviewed('https://github.com/acme/secret/pull/7/files', A);
  const stored = localStorage.getItem('galley:revisions')!;
  expect(stored).not.toContain('secret');
  expect(stored).toMatch(/^\{"[0-9a-f]{64}":\{"reviewed":"a{40}","seen":\[\],"at":\d+\}\}$/);
});

it('ignores anything in storage that is not a commit id or not shaped like what it saves', async () => {
  await rememberSeen('review', A);
  const key = Object.keys(JSON.parse(localStorage.getItem('galley:revisions')!))[0];
  const read = async (value: string) => {
    localStorage.setItem('galley:revisions', value);
    return loadRevisions('review');
  };
  expect(await read('"text"')).toEqual({ reviewed: null, seen: [] });
  expect(await read('[1, 2]')).toEqual({ reviewed: null, seen: [] });
  expect(await read(`{"${key}": {"reviewed": "main", "seen": "A", "at": 1}}`)).toEqual({ reviewed: null, seen: [] });
  expect(await read(`{"${key}": {"reviewed": "${A}", "seen": ["${B}", "HEAD", 7, "${C}", "${A}"], "at": 1}}`)).toEqual({ reviewed: A, seen: [B, C] });
  localStorage.setItem('galley:revisions', '"text"');
  await rememberSeen('review', B);
  expect(await loadRevisions('review')).toEqual({ reviewed: null, seen: [B] });
});
