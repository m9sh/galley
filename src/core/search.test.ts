import { expect, it } from 'vitest';
import { excerpt, occurrences, phrase, SEARCH_BUDGET } from './search.ts';

const pattern = (query: string) => {
  const result = phrase(query);
  if (!('pattern' in result)) throw new Error(result.problem);
  return result.pattern;
};

it('asks for at least two characters and at most two hundred', () => {
  expect(phrase('')).toEqual({ problem: 'short' });
  expect(phrase('  a  ')).toEqual({ problem: 'short' });
  expect(phrase('x'.repeat(SEARCH_BUDGET.maxQuery + 1))).toEqual({ problem: 'long' });
  expect('pattern' in phrase('x'.repeat(SEARCH_BUDGET.maxQuery))).toBe(true);
});

it('finds the exact phrase in any case, across line breaks and repeated spaces', () => {
  const text = 'The Rate\n  limit is 20 euros. The rate limit resets hourly.';
  expect(occurrences(text, pattern('rate limit'))).toEqual([
    [4, 16],
    [34, 44],
  ]);
  expect(occurrences('Ölçü and ÖLÇÜ', pattern('ölçü'))).toEqual([
    [0, 4],
    [9, 13],
  ]);
  expect(occurrences('limit', pattern('rate limit'))).toEqual([]);
});

it('treats every character of the query as text, never as a pattern', () => {
  expect(occurrences('call quota.check(user) [x] $5 a+b', pattern('quota.check(user)'))).toEqual([[5, 22]]);
  expect(occurrences('quotaXcheck', pattern('quota.check'))).toEqual([]);
  expect(occurrences('[x] $5 a+b ^c|d \\e {1}', pattern('[x] $5 a+b ^c|d \\e {1}'))).toEqual([[0, 22]]);
});

it('starts again from the beginning each time a pattern is reused', () => {
  const reused = pattern('ab');
  expect(occurrences('ab ab', reused)).toHaveLength(2);
  reused.lastIndex = 4;
  expect(occurrences('ab ab', reused)).toHaveLength(2);
});

it('shows a match with its context, on one line', () => {
  expect(excerpt('Before\nthe  limit\tafter it.', 12, 17)).toEqual({ before: 'Before the ', match: 'limit', after: ' after it.' });
});

it('cuts long context at a word, and says it was cut', () => {
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho';
  const at = words.indexOf('theta');
  const short = excerpt(words, at, at + 5, 16);
  expect(short.before).toBe('…zeta eta ');
  expect(short.match).toBe('theta');
  expect(short.after).toBe(' iota kappa lambda mu nu xi…');
  // With no space near the cut, the context is cut mid-word rather than lost.
  const solid = 'x'.repeat(60);
  expect(excerpt(`${solid}match${solid}`, 60, 65, 10)).toEqual({ before: `…${'x'.repeat(10)}`, match: 'match', after: `${'x'.repeat(20)}…` });
});
