import { readStored, writeStored } from '../preferences/settings.ts';
import { fingerprint } from './fingerprint.ts';

const KEY = 'galley:revisions';
/** Only the most recent reviews are remembered. */
const LIMIT = 50;
/** A commit id: SHA-1 or SHA-256, in hex. Anything else found in storage is ignored. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * What Galley remembers, on this device, about the revisions of one review (RFC 0039, ADR 0034): the head the
 * reviewer marked as reviewed, and the last two heads the reader was opened at. Commit ids only, under a
 * fingerprint of the review's address; never a document or a path.
 */
export interface Revisions {
  reviewed: string | null;
  seen: string[];
}

/** The earlier head to compare a review with: the one marked as reviewed, or else the one last opened. */
export interface Baseline {
  commit: string;
  kind: 'reviewed' | 'opened';
}

type Saved = Record<string, { reviewed?: string; seen: string[]; at: number }>;

async function all(): Promise<Saved> {
  const saved = await readStored<Saved>(KEY);
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

const valid = (value: unknown): value is string => typeof value === 'string' && COMMIT.test(value);

export async function loadRevisions(review: string): Promise<Revisions> {
  const saved = (await all())[await fingerprint(review)];
  if (!saved) return { reviewed: null, seen: [] };
  return { reviewed: valid(saved.reviewed) ? saved.reviewed : null, seen: Array.isArray(saved.seen) ? saved.seen.filter(valid).slice(0, 2) : [] };
}

async function save(review: string, change: (current: Revisions) => Revisions): Promise<void> {
  const key = await fingerprint(review);
  const everything = await all();
  const next = change(await loadRevisions(review));
  const { [key]: _old, ...others } = everything;
  const saved = { ...others, [key]: { ...(next.reviewed ? { reviewed: next.reviewed } : {}), seen: next.seen, at: Date.now() } };
  const recent = Object.entries(saved)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, LIMIT);
  await writeStored(KEY, Object.fromEntries(recent));
}

/** The reader was opened at this head. Opening it again at the same head changes nothing. */
export function rememberSeen(review: string, head: string): Promise<void> {
  return save(review, (current) => ({ reviewed: current.reviewed, seen: current.seen[0] === head ? current.seen : [head, ...current.seen].slice(0, 2) }));
}

/** The reviewer says they have reviewed the review as it is at this head. */
export function markReviewed(review: string, head: string): Promise<void> {
  return save(review, (current) => ({ reviewed: head, seen: current.seen }));
}

/** The reviewer takes the mark back. The heads the reader was opened at stay, so the last one is still suggested. */
export function unmarkReviewed(review: string): Promise<void> {
  return save(review, (current) => ({ reviewed: null, seen: current.seen }));
}

/** What to compare `head` with: the revision marked as reviewed, or else the last one opened; nothing when there is no earlier one. */
export function baselineFor(revisions: Revisions, head: string): Baseline | null {
  if (revisions.reviewed) return revisions.reviewed === head ? null : { commit: revisions.reviewed, kind: 'reviewed' };
  const earlier = revisions.seen.find((commit) => commit !== head);
  return earlier ? { commit: earlier, kind: 'opened' } : null;
}
