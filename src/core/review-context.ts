import { classify, KIND_NAMES, type Corrections, type ProjectIndex } from './docindex.ts';

export type ReviewRevision = 'base' | 'head';
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
  revision: ReviewRevision;
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
  readonly snapshots = new Map<ReviewRevision, ContextSnapshot>();
  private attachments: ChapterAttachment[] = [];

  add(attachment: ChapterAttachment): void {
    this.remove(attachment);
    this.attachments.push(attachment);
  }

  remove(attachment: ChapterAttachment): void {
    this.attachments = this.attachments.filter(
      (item) =>
        item.chapter !== attachment.chapter || item.revision !== attachment.revision || item.path !== attachment.path || item.heading !== attachment.heading,
    );
  }

  forChapter(chapter: string, revision: ReviewRevision): ChapterAttachment[] {
    return this.attachments.filter((item) => item.chapter === chapter && item.revision === revision);
  }
}
