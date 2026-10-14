import type { RepositorySource } from '../platforms/types.ts';
import { classify, indexCoverage, KIND_NAMES, ProjectIndex, readForIndex, type Corrections } from './docindex.ts';

export interface ReviewRelated {
  path: string;
  title: string;
  kind: string | null;
  flag: 'changed' | 'worth-checking';
  evidence: Array<{ path: string; line: number; text: string }>;
}

/** Shared by chapter context and This review: only explicit Markdown links count as evidence. */
export function relatedDocuments(index: ProjectIndex, path: string, changed: Set<string>, corrections: Corrections): ReviewRelated[] {
  const found = new Map<string, ReviewRelated>();
  for (const doc of index.docs.values()) {
    if (doc.path === path) continue;
    for (const link of doc.links) {
      if (link.path === null || (link.path !== path && index.documentAt(link.path) !== path)) continue;
      const { kind } = classify(doc, corrections);
      const entry = found.get(doc.path) ?? {
        path: doc.path,
        title: doc.title,
        kind: kind === 'other' ? null : KIND_NAMES[kind],
        flag: changed.has(doc.path) ? ('changed' as const) : ('worth-checking' as const),
        evidence: [],
      };
      entry.evidence.push({ path: doc.path, line: link.line, text: link.text || link.href });
      found.set(doc.path, entry);
    }
  }
  return [...found.values()].sort((a, b) => Number(a.flag > b.flag) - Number(a.flag < b.flag) || a.title.localeCompare(b.title, 'en', { numeric: true }));
}

export interface ChapterAttachment {
  chapter: string;
  commit: string;
  path: string;
  heading: string;
  title: string;
}
export interface ContextSnapshot {
  commit: string;
  status: string;
  related: Map<string, ReviewRelated[]>;
}

/** Evidence and explicit attachments belong to this open review, never to persistent notes or Viewed. */
export class ChapterContext {
  /** What the library last found, at the review's head. */
  snapshot: ContextSnapshot | null = null;
  private attachments: ChapterAttachment[] = [];

  add(attachment: ChapterAttachment): void {
    this.remove(attachment);
    this.attachments.push(attachment);
  }

  remove(attachment: ChapterAttachment): void {
    this.attachments = this.attachments.filter(
      (item) => item.chapter !== attachment.chapter || item.path !== attachment.path || item.heading !== attachment.heading,
    );
  }

  forChapter(chapter: string): ChapterAttachment[] {
    return this.attachments.filter((item) => item.chapter === chapter);
  }
}

/**
 * The docs behind a review, read for Review chapters when the reviewer asks (RFC 0049): the listing, then a batch of
 * documents at the review's head, a few at a time. Only explicit Markdown links count; nothing is stored. The
 * library reads the same repository for itself, and fills the same snapshot, with the reader's corrections, when it opens.
 */
export class ReviewDocs {
  /** Nothing asked yet, reading, read, or a listing that failed and can be tried again. */
  state: 'idle' | 'reading' | 'read' | 'failed' = 'idle';
  error = '';
  private listed: ProjectIndex | null = null;
  private readonly texts = new Map<string, Promise<string>>();
  private limits: string[] = [];
  private sizes = new Map<string, number>();
  private unread = { failed: 0, skipped: 0 };
  private readonly signal = { cancelled: false };

  constructor(
    private readonly source: Pick<RepositorySource, 'commit' | 'discover' | 'load'>,
    private readonly context: ChapterContext,
    /** Every file the review changes. */
    private readonly changed: () => Set<string>,
    /** Reading started or ended: the chapters show it. */
    private readonly changes: () => void,
  ) {}

  /** What has been listed and read so far; null before the listing. */
  get index(): ProjectIndex | null {
    return this.listed;
  }

  /** Has every listed document been read? */
  get complete(): boolean {
    return this.listed !== null && this.listed.docs.size >= this.listed.listed.length;
  }

  /** One document at the head, fetched once for the index and for reading; a failed read can be tried again. */
  load(path: string): Promise<string> {
    let text = this.texts.get(path);
    if (!text) {
      text = this.source.load(path);
      this.texts.set(path, text);
      text.catch(() => this.texts.delete(path));
    }
    return text;
  }

  /** List the repository once, then read the next batch, and say what links to the review's files. */
  async read(): Promise<void> {
    if (this.state === 'reading') return;
    this.state = 'reading';
    this.changes();
    try {
      if (!this.listed) {
        const found = await this.source.discover();
        this.listed = new ProjectIndex(found.docs.map((doc) => doc.path));
        this.limits = found.limits;
        this.sizes = new Map(found.docs.flatMap((doc) => (doc.size === undefined ? [] : [[doc.path, doc.size] as [string, number]])));
      }
      const result = await readForIndex(this.listed, (path) => this.load(path), { sizes: this.sizes, signal: this.signal });
      this.unread.failed += result.failed.length;
      this.unread.skipped += result.skipped.length;
      this.state = 'read';
      this.publish(this.listed);
    } catch (err) {
      this.state = 'failed';
      this.error = err instanceof Error ? err.message : String(err);
    }
    if (!this.signal.cancelled) this.changes();
  }

  /** The review closed: reads still under way are dropped. */
  stop(): void {
    this.signal.cancelled = true;
  }

  private publish(index: ProjectIndex): void {
    const changed = this.changed();
    const corrections: Corrections = { docs: new Map(), folders: new Map() };
    this.context.snapshot = {
      commit: this.source.commit,
      status: indexCoverage(index, this.source.commit, { limits: this.limits, ...this.unread }).join(' '),
      related: new Map([...changed].map((path) => [path, relatedDocuments(index, path, changed, corrections)])),
    };
  }
}
