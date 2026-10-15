import { button, h, glyph } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { sheetRow, sheetSection, type SheetContent } from '../components/sheet.ts';

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
  control[at === 'afterbegin' ? 'prepend' : 'append'](glyph(icon));
  return control;
}

/** A link written in the document being read, which Chapters offers to add. */
export interface SequenceLink {
  path: string;
  anchor: string;
  title: string;
  line: number;
  /** Already a stop: it says so, and choosing it again only says it is there. */
  added: boolean;
}

/** A row's mark, decorative: the words say the same. */
function mark(svg: string): HTMLElement {
  const box = h('span', 'mr-sheet-icon');
  box.replaceChildren(glyph(svg));
  return box;
}

/**
 * Chapters, in the reader's sheet, shown as the review's chapters are: the way in, the stops as a numbered path, each a
 * click from being read with its order beside it, then the links of the document being read, each Add away.
 */
export function sequenceSheet(options: {
  items: ReadingStop[];
  current: number;
  commit: string;
  /** The document being read, whose links are offered; null before one is read. */
  from: string | null;
  links: SequenceLink[];
}): Pick<SheetContent, 'description' | 'extra' | 'body' | 'keys'> {
  const { items, current } = options;
  // Where the reader is along the path, and the way in; an empty path says so in its section instead.
  const status = h('div', 'mr-chapters-status');
  status.append(
    h('p', 'mr-chapters-progress', current < 0 ? `${items.length} ${items.length === 1 ? 'stop' : 'stops'}` : `Stop ${current + 1} of ${items.length}`),
    withIcon(action('Read chapter', 'sequence-open', 0, 'mr-chapter-button mr-chapters-start'), icons.book),
  );
  const stops = h('div', 'mr-sheet-rows mr-path');
  items.forEach((item, at) => {
    const row = sheetRow({
      title: item.title,
      meta: `${item.path}${item.anchor ? ` · § ${item.anchor}` : ''}`,
      lead: h('span', 'mr-sheet-num', String(at + 1)),
      end: at === current ? 'You are here' : '',
    });
    row.dataset.act = 'sequence-open';
    row.dataset.at = String(at);
    if (at === current) {
      row.setAttribute('aria-current', 'step');
      row.classList.add('is-current');
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
    const stop = h('div', 'mr-sheet-row-with mr-seq-stop');
    stop.append(row, controls);
    stops.append(stop);
  });
  const all = button('All documents', 'docs', 'mr-sheet-link');
  const body: Node[] = [
    sheetSection(
      'Your reading sequence',
      items.length ? [stops] : [h('p', 'mr-sheet-note', 'No documents yet. Use Add beside a document or a link, or Add to chapter while reading.')],
      { ...(items.length ? { count: items.length } : {}), actions: [all] },
    ),
  ];
  if (options.links.length) {
    const rows = options.links.map((link) => {
      const row = sheetRow({ title: link.title, meta: `${link.path}${link.anchor ? `#${link.anchor}` : ''} · line ${link.line}`, lead: mark(icons.link) });
      row.dataset.act = 'open';
      row.dataset.path = link.path;
      if (link.anchor) row.dataset.anchor = link.anchor;
      const add = withIcon(
        button(link.added ? 'Added' : 'Add', 'sequence-add', `mr-sheet-link mr-seq-add${link.added ? ' is-added' : ''}`),
        link.added ? icons.check : icons.plus,
      );
      add.dataset.path = link.path;
      add.dataset.anchor = link.anchor;
      add.dataset.title = link.title;
      add.setAttribute('aria-label', link.added ? `${link.title} is in your reading sequence` : `Add ${link.title} to your reading sequence`);
      const item = h('div', 'mr-sheet-row-with');
      item.append(row, add);
      return item;
    });
    body.push(sheetSection('Links from this document', [h('p', 'mr-sheet-note', `In ${options.from}`), ...rows], { count: rows.length }));
  }
  body.push(
    h(
      'p',
      'mr-sheet-note mr-seq-note',
      `Only for this session at ${options.commit}. Reading does not mark anything Viewed. A newer commit clears this sequence.`,
    ),
  );
  return {
    description: 'Choose a path through the project. Add documents or headings, then put them in the order you want to read.',
    extra: items.length ? [status] : [],
    body,
    keys: [
      [['↑', '↓'], 'Move'],
      [['↵'], 'Open'],
    ],
  };
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
