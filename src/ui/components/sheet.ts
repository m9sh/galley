import { h } from './dom.ts';
import { icons } from './icons.ts';
import { slideWith } from './motion.ts';

/**
 * The one sheet every page uses for details beside what it shows: Review chapters and the project library, the
 * map's selected document, and a document chosen in This review. On wide screens it sits on the right edge and the
 * page narrows to make room, its parts sliding along; on phones it rises from the bottom over the page, which waits
 * behind it.
 *
 * A sheet is a stack. What a page opens from a list (a chapter, a document, a link in it) slides in on top; the
 * sheets beneath wait as edges, which go back to them, and Back or Esc goes down one at a time, then closes. Every
 * sheet is laid out the same way: a header (a way back or a switch, its actions, Close), one scrolling body of
 * sections and rows, and on screens with a keyboard the keys that work there. styles/14-sheet.css draws it (`.mr-sheet`).
 */

export interface SheetOptions {
  /** The reader's root: it narrows by `--sheet-width` while the sheet is open on a wide screen. */
  root: HTMLElement;
  /** The sheet's own class, for what it holds. */
  className: string;
  /** What Close and the backdrop are called. */
  closeLabel: string;
  /** What slides aside as the page narrows or widens. */
  parts(): Iterable<HTMLElement>;
  /** What waits, inert, while the sheet covers the page on a phone. */
  background(): Iterable<HTMLElement>;
  /** Close, the backdrop or Esc on the first sheet: the page closes it with `hide()` and puts focus back. */
  dismiss(): void;
  /** Change the page's width, keeping the reader's place in it; the change alone when not given. */
  reflow?(change: () => void): void;
}

export interface SheetContent {
  /** Its name for assistive technology, and on the Back of the sheet above it when it has no title. */
  label: string;
  /** Before the actions: a switch, badges or a status. */
  lead?: Node[];
  /** Its own actions, such as Read; Close always comes last. */
  actions?: Node[];
  kicker?: string;
  title?: string;
  description?: string;
  /** Under the title: a search field, the main action, tabs or tools. */
  extra?: Node[];
  body: Node[];
  /** Keys that work here, at its foot on screens with a keyboard, each with what it does; Esc is always there. */
  keys?: Array<[string[], string]>;
  /** What it shows, such as a chapter or a document, for its look and its keys. */
  kind?: string;
}

/** A key, as the reader presses it; the words beside it say what it does. */
export function kbd(key: string): HTMLElement {
  const el = h('kbd', '', key);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

interface SheetRow {
  title: string;
  meta?: string;
  /** A mark before the title (a dot, a ring, an icon); decorative, so the words say the same. */
  lead?: Node;
  /** A short value after it, such as 1/3. */
  end?: string;
  /** It opens another sheet on top: a chevron says so. */
  opens?: boolean;
  /** A page elsewhere, opened in a new tab, instead of an action here. */
  href?: string;
  action?: () => void;
}

/** One row of a list in a sheet; every list is made of these, and ↑ ↓ move between them. */
export function sheetRow(row: SheetRow): HTMLElement {
  const el = row.href === undefined ? h('button', 'mr-sheet-row') : h('a', 'mr-sheet-row');
  if (el instanceof HTMLButtonElement) el.type = 'button';
  else {
    if (row.href) el.href = row.href;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
  }
  if (row.action) el.addEventListener('click', row.action);
  const lead = h('span', 'mr-sheet-row-lead');
  lead.setAttribute('aria-hidden', 'true');
  if (row.lead) lead.append(row.lead);
  const text = h('span', 'mr-sheet-row-text');
  text.append(h('span', 'mr-sheet-row-title', row.title));
  if (row.meta) text.append(h('span', 'mr-sheet-row-meta', row.meta));
  el.append(lead, text, h('span', 'mr-sheet-row-end', row.end ?? ''));
  if (row.opens) {
    el.classList.add('is-push');
    const go = h('span', 'mr-sheet-row-go');
    go.setAttribute('aria-hidden', 'true');
    // biome-ignore lint/plugin: a bundled icon constant, never document content.
    go.innerHTML = icons.chevronRight;
    el.append(go);
  }
  return el;
}

/** A titled group of rows, with how many there are and its own quiet actions. */
export function sheetSection(title: string, children: Node[], options: { count?: number; actions?: Node[] } = {}): HTMLElement {
  const section = h('section', 'mr-sheet-section');
  section.setAttribute('aria-label', title);
  const head = h('div', 'mr-sheet-section-head');
  head.append(h('h3', 'mr-sheet-section-title', title));
  if (options.count !== undefined) head.append(h('span', 'mr-sheet-count', options.count.toLocaleString('en')));
  head.append(...(options.actions ?? []));
  section.append(head, ...children);
  return section;
}

/** The control drawn in place of one that was replaced, in `scope`: the same element with the same data; none for one without data. */
export function twin(scope: ParentNode, gone: HTMLElement): HTMLElement | undefined {
  const keys = Object.keys(gone.dataset);
  if (!keys.length) return undefined;
  return [...scope.querySelectorAll<HTMLElement>(gone.localName)].find((el) => keys.every((key) => el.dataset[key] === gone.dataset[key]));
}

/** One sheet of the stack: its header, its body and its keys. */
export class SheetLayer {
  readonly element = h('section', 'mr-sheet-layer');
  readonly body = h('div', 'mr-sheet-body');
  readonly close = h('button', 'mr-btn mr-icon-btn mr-sheet-close');
  /** What it is called on the Back of the sheet above it. */
  name = '';
  /** What it shows (`SheetContent.kind`). */
  kind?: string;
  private readonly header = h('header', 'mr-sheet-header');
  private readonly top = h('div', 'mr-sheet-top');
  private readonly lead = h('div', 'mr-sheet-lead');
  private readonly actions = h('div', 'mr-sheet-actions');
  private readonly keys = h('footer', 'mr-sheet-keys');

  constructor(
    /** What Close is called; Esc does the same on the first sheet. */
    private readonly closeLabel: string,
    dismiss: () => void,
    /** Back to the sheet beneath, on every sheet but the first. */
    readonly back: HTMLButtonElement | null,
    /** What had focus when it opened, for when it closes. */
    readonly opener: HTMLElement | null,
  ) {
    this.close.type = 'button';
    // biome-ignore lint/plugin: a bundled icon constant, never document content.
    this.close.innerHTML = icons.close;
    this.close.append(h('span', 'mr-visually-hidden', closeLabel));
    this.close.title = back ? closeLabel : `${closeLabel} (Esc)`;
    this.close.addEventListener('click', dismiss);
    this.body.tabIndex = 0;
    this.actions.append(this.close);
    this.top.append(this.lead, this.actions);
    this.header.append(this.top);
    this.keys.setAttribute('aria-hidden', 'true');
    // The sheet itself takes focus when it opens, named by its label; ↓ goes into its list.
    this.element.tabIndex = -1;
    this.element.append(this.header, this.body, this.keys);
  }

  /** Fill it anew, where it is; Back and Close stay put, focus and all. */
  fill(content: SheetContent): void {
    this.name = content.title ?? content.label;
    this.kind = content.kind;
    this.element.setAttribute('aria-label', content.label);
    // What it shows, for its look: a document's title is set as the document's.
    if (content.kind) this.element.dataset.kind = content.kind;
    else delete this.element.dataset.kind;
    this.lead.replaceChildren(...(this.back ? [this.back] : []), ...(content.lead ?? []));
    for (const el of [...this.actions.children]) if (el !== this.close) el.remove();
    this.actions.prepend(...(content.actions ?? []));
    while (this.top.nextSibling) this.top.nextSibling.remove();
    if (content.kicker) this.header.append(h('p', 'mr-sheet-kicker', content.kicker));
    if (content.title) this.header.append(h('h2', 'mr-sheet-title', content.title));
    if (content.description) this.header.append(h('p', 'mr-sheet-description', content.description));
    this.header.append(...(content.extra ?? []));
    this.body.replaceChildren(...content.body);
    // Its own keys, then the one every sheet has: Esc goes back to the sheet beneath, or closes the first.
    this.keys.replaceChildren();
    for (const [combo, what] of [...(content.keys ?? []), [['Esc'], this.back ? 'Back' : this.closeLabel] as const]) {
      const key = h('span', 'mr-sheet-key');
      key.append(...combo.map(kbd), ` ${what}`);
      this.keys.append(key);
    }
  }
}

export class Sheet {
  readonly element: HTMLElement;
  readonly backdrop = h('button', 'mr-sheet-backdrop');
  private readonly layers: SheetLayer[] = [];
  /** The edges of the sheets beneath the top one: choosing one goes back to it. */
  private readonly edges = h('div', 'mr-sheet-edges');
  private readonly phone = matchMedia('(max-width: 760px)');
  private modal = false;

  constructor(private readonly options: SheetOptions) {
    this.element = h('aside', `mr-sheet ${options.className}`);
    this.backdrop.classList.add(`${options.className}-backdrop`);
    this.element.hidden = this.backdrop.hidden = true;
    this.backdrop.type = 'button';
    this.backdrop.tabIndex = -1;
    this.backdrop.setAttribute('aria-label', options.closeLabel);
    this.backdrop.addEventListener('click', () => options.dismiss());
    this.edges.setAttribute('aria-hidden', 'true');
    this.layers.push(new SheetLayer(options.closeLabel, () => options.dismiss(), null, null));
    this.element.append(this.root.element, this.edges);
    // Closed at once for keys and focus, it is drawn, out of reach, until it has slid away.
    for (const el of [this.element, this.backdrop])
      el.addEventListener('animationend', (event) => {
        if (event.target === el && el.hidden) el.classList.remove('is-closing');
      });
    options.root.append(this.backdrop, this.element);
  }

  /** The first sheet, which the page opens. */
  get root(): SheetLayer {
    return this.layers[0];
  }

  /** The sheet on top, which has the keys. */
  get top(): SheetLayer {
    return this.layers[this.layers.length - 1];
  }

  /** How many sheets are open on top of the first. */
  get depth(): number {
    return this.layers.length - 1;
  }

  /** The first sheet's body, and its Close. */
  get body(): HTMLElement {
    return this.root.body;
  }

  get close(): HTMLButtonElement {
    return this.root.close;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Is it covering the page, as on a phone? */
  get isModal(): boolean {
    return this.isOpen && this.modal;
  }

  /** Fill the first sheet anew; any open on top of it go at once. */
  fill(content: SheetContent): void {
    for (const layer of this.layers.splice(1)) layer.element.remove();
    this.element.setAttribute('aria-label', content.label);
    this.root.fill(content);
    this.arrange();
  }

  /**
   * Open a sheet on top, named on its Back by the sheet beneath; it takes focus, which comes back when it closes. A
   * document opened from a document stacks too, so Esc goes back through what the reader came from.
   */
  push(content: SheetContent): SheetLayer {
    for (const gone of this.element.querySelectorAll('.mr-sheet-layer.is-leaving')) gone.remove();
    // What had focus; the page's body is nothing to come back to.
    const active = (this.element.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const opener = active === document.body ? null : active;
    const name = this.top.name;
    const back = h('button', 'mr-btn mr-sheet-back');
    back.type = 'button';
    // biome-ignore lint/plugin: a bundled icon constant, never document content.
    back.innerHTML = icons.chevronLeft;
    back.append(h('span', 'mr-sheet-back-label', name));
    back.setAttribute('aria-label', `Back to ${name}`);
    back.title = 'Back (Esc)';
    back.addEventListener('click', () => this.pop());
    const layer = new SheetLayer(this.options.closeLabel, () => this.options.dismiss(), back, opener);
    layer.fill(content);
    this.layers.push(layer);
    this.element.insertBefore(layer.element, this.edges);
    this.arrange();
    layer.element.focus({ preventScroll: true });
    return layer;
  }

  /**
   * Step to a sibling of the sheet on top, such as the next chapter: it takes the sheet's place, keeping its way back,
   * and focus stays on the control that stepped while that can still be used.
   */
  replace(content: SheetContent): SheetLayer {
    const top = this.top;
    const acting = top.element.querySelector<HTMLElement>('.mr-sheet-actions :focus');
    top.fill(content);
    top.body.scrollTop = 0;
    this.arrange();
    const again = acting && twin(top.element.querySelector('.mr-sheet-actions')!, acting);
    (again && !again.matches(':disabled') ? again : top.element).focus({ preventScroll: true });
    return top;
  }

  /** Back to the sheet beneath, with focus on what opened this one. False on the first sheet. */
  pop(): boolean {
    if (!this.depth) return false;
    this.popTo(this.depth - 1);
    return true;
  }

  /** Back to the sheet at `index`, closing every one above it. */
  popTo(index: number): void {
    const leaving = this.layers.splice(index + 1);
    // Closed at once for keys and focus, each is drawn, out of reach, until it has slid away.
    for (const layer of leaving) {
      layer.element.classList.add('is-leaving');
      layer.element.inert = true;
      layer.element.hidden = true;
      layer.element.addEventListener('animationend', () => layer.element.remove(), { once: true });
    }
    this.arrange();
    const opener = leaving[0].opener;
    // What opened it, or what was drawn in its place since; else the sheet now on top.
    const target = opener?.isConnected ? opener : opener && twin(this.top.element, opener);
    (target || this.top.element).focus({ preventScroll: true });
  }

  /** Open it beside the page, or over it on a phone; open already, it only checks which of the two it should be. */
  show(): void {
    const opening = !this.isOpen;
    if (opening) {
      this.element.classList.remove('is-closing');
      this.element.inert = false;
      this.element.hidden = false;
    }
    this.modal = this.phone.matches;
    if (this.modal) {
      this.element.setAttribute('role', 'dialog');
      this.element.setAttribute('aria-modal', 'true');
    } else this.plain();
    this.backdrop.classList.remove('is-closing');
    this.backdrop.hidden = !this.modal;
    for (const el of this.options.background()) el.inert = this.modal;
    if (opening) this.resize(true);
  }

  /** Close it, sliding away. False when it was not open. */
  hide(): boolean {
    if (!this.isOpen) return false;
    this.element.classList.add('is-closing');
    this.element.inert = true;
    this.element.hidden = true;
    // The scrim fades with it.
    this.backdrop.classList.toggle('is-closing', this.modal);
    this.backdrop.hidden = true;
    this.plain();
    for (const el of this.options.background()) el.inert = false;
    this.resize(false);
    return true;
  }

  /**
   * The sheet's keys. Esc goes back a sheet, or asks the page to close the first; with focus in the sheet, ↑ ↓ Home
   * and End move between its rows and / goes to its search; while it covers the page, Tab stays inside it. True when
   * the key was the sheet's.
   */
  onKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!this.pop()) this.options.dismiss();
      return true;
    }
    const active = (this.element.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const layer = this.top.element;
    if (active && layer.contains(active)) {
      const search = layer.querySelector<HTMLElement>('.mr-sheet-search input');
      const typing = active.matches('input, textarea, select');
      if (e.key === '/' && search && !typing) return this.focus(e, search);
      const rows = [...layer.querySelectorAll<HTMLElement>('.mr-sheet-row')].filter((row) => !row.matches(':disabled') && row.getClientRects().length);
      const at = rows.indexOf(active);
      const next: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 };
      // Between rows; and into the list from the header, the body or the search field, never out of other fields.
      const into = at < 0 && e.key === 'ArrowDown' && (!typing || active === search);
      if (Object.hasOwn(next, e.key) && rows.length && (at >= 0 || into))
        return this.focus(e, rows[into ? 0 : Math.max(0, Math.min(rows.length - 1, next[e.key]))]);
    }
    if (e.key !== 'Tab' || !this.modal) return false;
    const controls = [...layer.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex="0"]')].filter(
      (el) => !el.matches(':disabled') && el.getClientRects().length,
    );
    const [first, last] = [controls[0], controls[controls.length - 1]];
    const wrap = e.shiftKey ? (active === first ? last : null) : active === last ? first : null;
    if (wrap) {
      e.preventDefault();
      wrap.focus();
    }
    return true;
  }

  private focus(e: KeyboardEvent, target: HTMLElement): boolean {
    e.preventDefault();
    target.focus();
    return true;
  }

  /** Each sheet knows its place: the top one in reach, those beneath inert, their edges a way back. */
  private arrange(): void {
    const depth = this.depth;
    this.layers.forEach((layer, index) => {
      // How far in it sits, and how far beneath the top: the deeper, the smaller, like a deck of cards.
      layer.element.style.setProperty('--at', String(Math.min(index, 2)));
      layer.element.style.setProperty('--under', String(Math.min(depth - index, 2)));
      layer.element.classList.toggle('is-under', index < depth);
      layer.element.inert = index < depth;
    });
    this.edges.replaceChildren(
      ...this.layers.slice(0, Math.min(depth, 2)).map((layer, index) => {
        const edge = h('button', 'mr-sheet-edge');
        edge.type = 'button';
        edge.tabIndex = -1;
        edge.title = `Back to ${layer.name}`;
        edge.style.setProperty('--at', String(index));
        edge.addEventListener('click', () => this.popTo(index));
        return edge;
      }),
    );
  }

  /** Beside the page it is no dialog. */
  private plain(): void {
    this.element.removeAttribute('role');
    this.element.removeAttribute('aria-modal');
  }

  /** The page takes the width the sheet leaves, sliding with it; on a phone nothing narrows behind it (styles/17-sheet-motion.css). */
  private resize(open: boolean): void {
    const change = () => this.options.root.classList.toggle('has-sheet', open);
    slideWith(this.options.parts(), () => {
      if (this.options.reflow) this.options.reflow(change);
      else change();
      return open;
    });
  }
}
