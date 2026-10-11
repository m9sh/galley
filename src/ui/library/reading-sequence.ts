import { button, h } from '../components/dom.ts';

export interface ReadingStop {
  path: string;
  anchor: string;
  title: string;
}

/** A reader-chosen chapter at one snapshot. No progress or repository content is saved. */
export class ReadingSequence {
  readonly items: ReadingStop[] = [];

  add(item: ReadingStop): boolean {
    if (this.items.some((stop) => stop.path === item.path && stop.anchor === item.anchor)) return false;
    this.items.push(item);
    return true;
  }

  remove(at: number): void {
    this.items.splice(at, 1);
  }

  move(at: number, step: -1 | 1): void {
    [this.items[at], this.items[at + step]] = [this.items[at + step], this.items[at]];
  }

  current(path: string | null, anchor: string): number {
    return this.items.findIndex((item) => item.path === path && item.anchor === anchor);
  }

  clear(): void {
    this.items.length = 0;
  }
}

function action(label: string, act: string, at: number): HTMLButtonElement {
  const b = button(label, act, 'mr-chapter-button');
  b.dataset.at = String(at);
  return b;
}

/** Reuse the chapter disclosure and file-list presentation; library chapters count choices, never Viewed. */
export function sequenceView(items: ReadingStop[], current: number, commit: string): HTMLElement {
  const view = h('section', 'mr-library-chapters');
  view.append(
    h('h1', 'mr-title', 'Library chapters'),
    h('p', 'mr-subtitle', 'Choose a path through the project. Add documents or headings, then put them in the order you want to read.'),
    h('p', 'mr-repo-quiet', `Only for this session at ${commit}. Reading does not mark anything Viewed. A newer commit clears this sequence.`),
    button('Browse all documents', 'docs', 'mr-btn mr-outline'),
  );
  const chapter = h('details', 'mr-chapter');
  chapter.open = true;
  const summary = h('summary');
  summary.append(h('span', 'mr-chapter-title', 'Your reading sequence'), h('span', 'mr-chapter-progress', `${items.length} selected · Added by you`));
  const body = h('div', 'mr-chapter-body');
  const list = h('ol', 'mr-chapter-files');
  items.forEach((item, at) => {
    const row = h('li', `mr-chapter-file${at === current ? ' is-current' : ''}`);
    const open = action(item.title, 'sequence-open', at);
    open.className = 'mr-chapter-file-link';
    open.replaceChildren(h('span', 'mr-sequence-title', item.title), h('small', '', `${item.path}${item.anchor ? ` · § ${item.anchor}` : ''}`));
    if (at === current) open.setAttribute('aria-current', 'step');
    const controls = h('div', 'mr-chapter-edit-order');
    for (const [label, act, disabled] of [
      ['Earlier', 'sequence-earlier', at === 0],
      ['Later', 'sequence-later', at === items.length - 1],
      ['Remove', 'sequence-remove', false],
    ] as const) {
      const b = action(label, act, at);
      b.disabled = disabled;
      b.setAttribute(
        'aria-label',
        `${label === 'Remove' ? 'Remove' : 'Move'} ${item.title}${label === 'Remove' ? ' from this chapter' : ` ${label.toLowerCase()}`}`,
      );
      controls.append(b);
    }
    row.append(open, controls);
    list.append(row);
  });
  body.append(list);
  if (!items.length) body.append(h('p', 'mr-chapter-reason', 'No documents yet. Browse the library or use Add to chapter while reading.'));
  const start = action('Read chapter', 'sequence-open', 0);
  start.disabled = !items.length;
  body.append(start);
  chapter.append(summary, body);
  view.append(chapter);
  return view;
}

/** The existing quiet chapter route, with explicit steps and no completion count. */
export function sequenceRoute(items: ReadingStop[], current: number): HTMLElement {
  const route = h('nav', 'mr-chapter-route');
  route.setAttribute('aria-label', 'Library chapter');
  route.hidden = current < 0;
  route.append(button('Chapters', 'sequence', 'mr-chapter-button'));
  if (current >= 0) {
    route.append(h('span', 'mr-chapter-route-text', `Your reading sequence · ${current + 1} of ${items.length}`));
    for (const [label, at] of [
      ['Previous', current - 1],
      ['Next', current + 1],
    ] as const) {
      const b = action(label, 'sequence-open', at);
      b.disabled = at < 0 || at >= items.length;
      route.append(b);
    }
  }
  return route;
}
