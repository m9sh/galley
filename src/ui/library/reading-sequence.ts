import { button, chip, h } from '../components/dom.ts';
import { icons } from '../components/icons.ts';

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

function action(label: string, act: string, at: number, className = 'mr-chapter-button'): HTMLButtonElement {
  const b = button(label, act, className);
  b.dataset.at = String(at);
  return b;
}

/** A bundled icon before a control's words, or as the whole of an icon-only control. */
function withIcon(control: HTMLButtonElement, icon: string, at: 'afterbegin' | 'beforeend' = 'afterbegin'): HTMLButtonElement {
  // biome-ignore lint/plugin: a bundled icon constant, never document content.
  control.insertAdjacentHTML(at, icon);
  return control;
}

/** The reader's own path through the project: numbered stops in their order, each a click from being read. */
export function sequenceView(items: ReadingStop[], current: number, commit: string): HTMLElement {
  const view = h('section', 'mr-library-chapters');
  const actions = h('div', 'mr-seq-actions');
  if (items.length) actions.append(withIcon(action('Read chapter', 'sequence-open', 0, 'mr-btn mr-primary mr-seq-start'), icons.book));
  actions.append(button('Browse all documents', 'docs', 'mr-btn mr-outline'));
  const head = h('header', 'mr-seq-head');
  head.append(
    h('h1', 'mr-title', 'Library chapters'),
    h('p', 'mr-subtitle', 'Choose a path through the project. Add documents or headings, then put them in the order you want to read.'),
    actions,
  );
  const card = h('section', 'mr-seq-card');
  card.setAttribute('aria-label', 'Your reading sequence');
  const top = h('header', 'mr-seq-card-head');
  top.append(h('h2', '', 'Your reading sequence'), chip('own', 'Added by you'));
  card.append(top);
  if (items.length) {
    const list = h('ol', 'mr-seq-stops');
    items.forEach((item, at) => {
      const row = h('li', `mr-seq-stop${at === current ? ' is-current' : ''}`);
      const open = action('', 'sequence-open', at, 'mr-seq-open');
      const text = h('span', 'mr-seq-text');
      text.append(h('span', 'mr-sequence-title', item.title), h('small', '', `${item.path}${item.anchor ? ` · § ${item.anchor}` : ''}`));
      open.append(h('span', 'mr-seq-number', String(at + 1)), text);
      if (at === current) {
        open.setAttribute('aria-current', 'step');
        open.append(h('span', 'mr-seq-here', 'You are here'));
      }
      const controls = h('div', 'mr-seq-controls');
      for (const [label, act, icon, disabled] of [
        ['Earlier', 'sequence-earlier', icons.up, at === 0],
        ['Later', 'sequence-later', icons.down, at === items.length - 1],
        ['Remove', 'sequence-remove', icons.close, false],
      ] as const) {
        const b = withIcon(action('', act, at, 'mr-btn mr-icon-btn'), icon);
        b.disabled = disabled;
        b.title = label;
        b.setAttribute(
          'aria-label',
          `${label === 'Remove' ? 'Remove' : 'Move'} ${item.title}${label === 'Remove' ? ' from this chapter' : ` ${label.toLowerCase()}`}`,
        );
        controls.append(b);
      }
      row.append(open, controls);
      list.append(row);
    });
    card.append(list);
  } else {
    const empty = h('div', 'mr-seq-empty');
    empty.append(h('p', 'mr-seq-empty-title', 'No documents yet'), h('p', '', 'Use Add beside a document or a link, or Add to chapter while reading.'));
    card.append(empty);
  }
  view.append(
    head,
    card,
    h('p', 'mr-seq-note', `Only for this session at ${commit}. Reading does not mark anything Viewed. A newer commit clears this sequence.`),
  );
  return view;
}

/** While reading a stop: where it is in the sequence, the way back to it, and the stops either side. */
export function sequenceRoute(items: ReadingStop[], current: number): HTMLElement {
  const route = h('nav', 'mr-chapter-route');
  route.setAttribute('aria-label', 'Library chapter');
  route.hidden = current < 0;
  route.append(withIcon(button('Chapters', 'sequence', 'mr-chapter-button'), icons.book));
  if (current >= 0) {
    route.append(h('span', 'mr-chapter-route-text', `Your reading sequence · ${current + 1} of ${items.length}`));
    for (const [label, at, icon] of [
      ['Previous', current - 1, icons.chevronLeft],
      ['Next', current + 1, icons.chevronRight],
    ] as const) {
      const b = withIcon(action(label, 'sequence-open', at), icon, at < current ? 'afterbegin' : 'beforeend');
      b.disabled = at < 0 || at >= items.length;
      route.append(b);
    }
  }
  return route;
}
