import type { ChapterAttachment, ChapterContext, ReviewRevision } from '../../core/review-context.ts';
import { button, h } from './dom.ts';

export interface ContextOpening {
  chapter: string;
  revision: ReviewRevision;
  path?: string;
  anchor?: string;
  line?: number;
  key: string;
  canContinue: boolean;
}

/** Context stays subordinate to the chapter's changed files; no reads happen while this is built. */
export function chapterContext(options: {
  chapter: { id: string; paths: string[] };
  revision: ReviewRevision;
  ref: string;
  commit: string;
  canContinue: boolean;
  context: ChapterContext;
  select(revision: ReviewRevision): void;
  open(target: ContextOpening): void;
  remove(attachment: ChapterAttachment): void;
}): HTMLElement {
  const { chapter, revision, context } = options;
  const section = h('section', 'mr-chapter-context');
  section.setAttribute('aria-label', 'Project context');
  section.append(h('h3', '', 'Project context'));
  const label = h('label', '', 'Read at ');
  const select = h('select');
  select.setAttribute('aria-label', 'Project context revision');
  select.dataset.contextKey = 'revision';
  for (const side of ['head', 'base'] as const) {
    const option = h('option', '', side === 'head' ? 'After this change (head)' : 'Before this change (base)');
    option.value = side;
    select.append(option);
  }
  select.value = revision;
  select.addEventListener('change', () => options.select(select.value as ReviewRevision));
  label.append(select);
  section.append(label, h('p', 'mr-chapter-context-status', `${options.ref} @ ${options.commit.slice(0, 7)}`));
  const snapshot = context.snapshots.get(revision);
  section.append(
    h(
      'p',
      'mr-chapter-context-status',
      snapshot?.status ?? 'No project context read yet. Open the library to find documents that link to these changed files.',
    ),
  );
  const open = (title: string, key: string, target: Omit<ContextOpening, 'chapter' | 'revision' | 'key' | 'canContinue'>) => {
    const control = button(title, '', 'mr-chapter-button');
    control.dataset.contextKey = key;
    control.addEventListener('click', () => options.open({ ...target, chapter: chapter.id, revision, key, canContinue: options.canContinue }));
    return control;
  };
  const list = h('ul', 'mr-chapter-context-list');
  for (const attachment of context.forChapter(chapter.id, revision)) {
    const item = h('li');
    item.append(
      open(attachment.title, `attached:${attachment.path}:${attachment.heading}`, { path: attachment.path, anchor: attachment.heading }),
      h('small', '', `Added by you · ${attachment.commit.slice(0, 7)}`),
    );
    const remove = button('Remove', '', 'mr-chapter-button');
    remove.setAttribute('aria-label', `Remove ${attachment.title} from this chapter`);
    remove.addEventListener('click', () => options.remove(attachment));
    item.append(remove);
    list.append(item);
  }
  for (const path of chapter.paths) {
    for (const related of snapshot?.related.get(path) ?? []) {
      const item = h('li');
      item.append(open(related.title, `${path}:${related.path}`, { path: related.path }), h('small', '', `Links to ${path}`));
      for (const proof of related.evidence)
        item.append(open(`“${proof.text}” · line ${proof.line}`, `${path}:${related.path}:${proof.line}`, { path: related.path, line: proof.line }));
      list.append(item);
    }
  }
  section.append(list, open('Find project context', 'find', {}));
  return section;
}
