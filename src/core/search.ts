/**
 * Review search (RFC 0045): exact phrases, any case, in text the reader already has. Pure and bounded,
 * so a long query or a large review keeps the reader responsive, and every limit can be reported.
 */
export const SEARCH_BUDGET = {
  /** Shorter queries match almost everything. */
  minQuery: 2,
  maxQuery: 200,
  /** Results listed at once; the count beyond it is still reported. */
  results: 200,
  /** Milliseconds of matching between pauses that let the reader respond. */
  slice: 8,
  /** Characters of context on each side of a match in an excerpt. */
  context: 48,
} as const;

export type Phrase = { pattern: RegExp } | { problem: 'short' | 'long' };

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** The exact phrase, in any case; a run of spaces matches any run of whitespace, as text wraps. */
export function phrase(query: string): Phrase {
  const text = query.trim();
  if (text.length < SEARCH_BUDGET.minQuery) return { problem: 'short' };
  if (text.length > SEARCH_BUDGET.maxQuery) return { problem: 'long' };
  return {
    pattern: new RegExp(
      text
        .split(/\s+/)
        .map((word) => word.replace(SPECIAL, '\\$&'))
        .join('\\s+'),
      'giu',
    ),
  };
}

/** Every occurrence, as [start, end) offsets. A pattern from `phrase()` never matches an empty string. */
export function occurrences(text: string, pattern: RegExp): Array<[number, number]> {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length]);
}

export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

const squash = (text: string) => text.replace(/\s+/g, ' ');

/** A match with a little context each side, cut at a word where it can be, and marked when cut. */
export function excerpt(text: string, start: number, end: number, room: number = SEARCH_BUDGET.context): Excerpt {
  let before = squash(text.slice(0, start)).trimStart();
  let after = squash(text.slice(end)).trimEnd();
  if (before.length > room) {
    const cut = before.slice(-room);
    const space = cut.indexOf(' ');
    before = `…${space > 0 && space < room / 2 ? cut.slice(space + 1) : cut}`;
  }
  const limit = room * 2;
  if (after.length > limit) {
    const cut = after.slice(0, limit);
    const space = cut.lastIndexOf(' ');
    after = `${space > limit / 2 ? cut.slice(0, space) : cut}…`;
  }
  return { before, match: squash(text.slice(start, end)), after };
}
