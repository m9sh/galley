import type { ChapterAttachment, ChapterContext, ReviewRelated } from '../../core/review-context.ts';
import { button, h } from './dom.ts';
import { icons } from './icons.ts';
import { sheetRow, sheetSection } from './sheet.ts';

export interface ContextOpening {
  /** The review chapter it was opened from; none from the review's Library. */
  chapter?: string;
  path: string;
  anchor?: string;
  key: string;
  canContinue: boolean;
}

const name = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const icon = (svg: string) => {
  const box = h('span', 'mr-sheet-icon');
  // biome-ignore lint/plugin: a bundled icon constant, never document content.
  box.innerHTML = svg;
  return box;
};

/**
 * A chapter's docs, under its files: each document that links to them, once, and what the reader added. Each opens
 * on top, in the review's sheet. They come from what has been read so far (Find linked docs, the Library or the full
 * library); `status` says how far that is and offers to read, and no reads happen here.
 */
export function chapterContext(options: {
  chapter: { id: string; paths: string[] };
  canContinue: boolean;
  context: ChapterContext;
  /** What has been read, and the way to read (more); null once everything is read. */
  status: HTMLElement | null;
  open(target: ContextOpening): void;
  remove(attachment: ChapterAttachment): void;
}): HTMLElement[] {
  const { chapter, context } = options;
  const open = (path: string, key: string, anchor?: string) => () => options.open({ chapter: chapter.id, path, anchor, key, canContinue: options.canContinue });
  // Each document once, with every file of this chapter it links to.
  const linking = new Map<string, { related: ReviewRelated; files: string[] }>();
  for (const path of chapter.paths)
    for (const related of context.snapshot?.related.get(path) ?? []) {
      const entry = linking.get(related.path) ?? { related, files: [] };
      entry.files.push(path);
      linking.set(related.path, entry);
    }
  const docs: Node[] = [];
  // Which of the chapter's files a document links to says something only when there is more than one.
  const where = (files: string[]) =>
    chapter.paths.length < 2 ? '' : files.length > 1 ? `links to ${files.length} of these files` : `links to ${name(files[0])}`;
  for (const { related, files } of linking.values()) {
    const row = sheetRow({
      title: related.title,
      meta: [related.kind, related.flag === 'changed' ? 'Changed in this review' : 'Worth checking', where(files)].filter(Boolean).join(' · '),
      lead: icon(icons.book),
      opens: true,
      action: open(related.path, `doc:${related.path}`),
    });
    row.dataset.contextKey = `doc:${related.path}`;
    docs.push(row);
  }
  if (context.snapshot && !linking.size) docs.push(h('p', 'mr-sheet-note', 'No document read so far links to these files.'));
  if (options.status) docs.push(options.status);
  const sections = [sheetSection('Docs that link here', docs, linking.size ? { count: linking.size } : {})];
  const attachments = context.forChapter(chapter.id);
  if (attachments.length) {
    const rows = attachments.map((attachment) => {
      const item = h('div', 'mr-sheet-row-with');
      const row = sheetRow({
        title: attachment.title,
        meta: `Added by you · ${attachment.commit.slice(0, 7)}`,
        lead: icon(icons.book),
        opens: true,
        action: open(attachment.path, `attached:${attachment.path}:${attachment.heading}`, attachment.heading),
      });
      row.dataset.contextKey = `attached:${attachment.path}:${attachment.heading}`;
      const remove = button('Remove', '', 'mr-sheet-link');
      remove.setAttribute('aria-label', `Remove ${attachment.title} from this chapter`);
      remove.addEventListener('click', () => options.remove(attachment));
      item.append(row, remove);
      return item;
    });
    sections.push(sheetSection('Added by you', rows, { count: attachments.length }));
  }
  return sections;
}
