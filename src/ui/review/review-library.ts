import { fileTitle } from '../../core/docindex.ts';
import type { ChapterContext, ReviewDocs, ReviewRelated } from '../../core/review-context.ts';
import type { RepositorySource } from '../../platforms/types.ts';
import { h, glyph } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { kbd, sheetRow, sheetSection, type SheetContent, type SheetLayer } from '../components/sheet.ts';
import { highlightCode } from '../rendering/code.ts';
import type { DiagramPalette } from '../rendering/diagram-palette.ts';
import { renderDiagrams } from '../rendering/diagrams.ts';
import { renderDocument, type RenderedDoc } from '../rendering/render.ts';

/**
 * The project library inside the review's sheet (RFC 0049): search, the docs that link to what the review changes,
 * then every document by folder. A document opens on top of the list, as the reader renders it, and its links open
 * theirs on top of it; Back or Esc returns, one at a time. Reviewers find the context of a change without leaving it;
 * the full library (map, notes) is one action away.
 */

/** A document to show, and where to start in it; from a chapter, the chapter and the control that opened it. */
export interface DocOpening {
  path: string;
  anchor?: string;
  chapter?: string;
  key?: string;
  /** From a chapter with a file the review shows, the full library can carry on with it. */
  canContinue?: boolean;
}

interface ReviewLibraryHost {
  /** The review reader's root, which holds the sheet. */
  root: HTMLElement;
  /** Show the library on the first sheet, under the Chapters | Library switch. */
  show(content: SheetContent): void;
  /** Open a sheet on top. */
  push(content: SheetContent): SheetLayer;
  /** The repository read for this review, made when first needed. */
  docs(): ReviewDocs;
  source(): RepositorySource;
  /** The branch and commit the review leaves the repository at. */
  head: { ref: string; commit: string };
  context: ChapterContext;
  images(): 'ask' | 'load';
  dark(): boolean;
  palette(): DiagramPalette | undefined;
  /** The whole library over the review, at this document; focus comes back to `opener`. */
  full(opener: HTMLElement, at?: DocOpening): void;
}

/** Long lists show this many documents, then Show more. */
const PAGE = 100;
const KEYS: Array<[string[], string]> = [
  [['/'], 'Search'],
  [['↑', '↓'], 'Move'],
  [['↵'], 'Open'],
];

const control = (label: string, className: string, action: () => void) => {
  const el = h('button', className, label);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
};
const icon = (svg: string) => {
  const box = h('span', 'mr-sheet-icon');
  box.replaceChildren(glyph(svg));
  return box;
};
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const name = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const flagName = (related: ReviewRelated) => (related.flag === 'changed' ? 'Changed in this review' : 'Worth checking');

/** A document shown in a sheet: where it was scrolled to show a line, kept there while diagrams above it draw. */
class Reading {
  rendered: RenderedDoc | null = null;
  private landed: { el: Element; top: number } | null = null;

  /** A link's evidence is a source line: show the paragraph that holds it. */
  showLine(line: number): void {
    const block = this.rendered?.blocks.findLast((b) => b.head!.lines[0] < line);
    if (block) this.reveal(block.el);
  }

  showAnchor(anchor: string): void {
    const target = [...this.rendered!.content.querySelectorAll('[id]')].find((el) => el.id === anchor || el.id === `user-content-${anchor}`);
    if (target) this.reveal(target);
  }

  /** A diagram finished drawing and moved what was shown: it is shown again, unless the reader has scrolled since. */
  settle(): void {
    const landed = this.landed;
    if (!landed?.el.isConnected) return;
    if (landed.el.closest<HTMLElement>('.mr-sheet-body')!.scrollTop === landed.top) this.align(landed.el);
  }

  private reveal(el: Element): void {
    this.align(el);
    el.classList.add('mr-flash');
    el.addEventListener('animationend', () => el.classList.remove('mr-flash'), { once: true });
  }

  private align(el: Element): void {
    const body = el.closest<HTMLElement>('.mr-sheet-body')!;
    body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 16;
    this.landed = { el, top: body.scrollTop };
  }
}

export class ReviewLibrary {
  private query = '';
  private limit = PAGE;
  /** Is the library on the first sheet? */
  private listed = false;
  private readonly results = h('div', 'mr-docs-results');

  constructor(private readonly host: ReviewLibraryHost) {}

  /** The chapters took the first sheet. */
  atChapters(): void {
    this.listed = false;
  }

  /** Is there something to read, or being read? A chapter shows the status until everything has been read. */
  more(): boolean {
    const docs = this.host.docs();
    return docs.state !== 'read' || !docs.complete;
  }

  /** What has been read, how much, and the way to read (more): in the Library, and in a chapter until all is read. */
  status(): HTMLElement {
    const docs = this.host.docs();
    const snapshot = this.host.context.snapshot;
    const block = h('div', 'mr-docs-status');
    const line = h('p', 'mr-docs-line');
    line.setAttribute('role', 'status');
    line.tabIndex = -1;
    block.append(line);
    const action = (title: string, meta: string) => {
      const row = sheetRow({ title, meta, lead: icon(icons.search), action: () => this.read(row) });
      row.classList.add('mr-docs-find');
      block.append(row);
    };
    const index = docs.index;
    if (docs.state === 'reading') line.textContent = 'Reading the docs…';
    else if (docs.state === 'failed') {
      line.textContent = docs.error;
      action('Try again', 'Read the repository’s docs again');
    } else if (snapshot && !docs.complete) {
      // Read in part: how far, and the way to read the rest.
      line.textContent = snapshot.status;
      const left = index!.listed.length - index!.docs.size;
      action('Read more', `${left.toLocaleString('en')} ${left === 1 ? 'document' : 'documents'} not read yet`);
    } else if (snapshot) {
      // Everything read: the Library's lists say so, with what could not be read at their foot.
      block.hidden = true;
    } else {
      line.hidden = true;
      action('Find linked docs', 'Galley reads the repository only when you ask');
    }
    return block;
  }

  /**
   * Reading started or ended: every status shown says so, focus stays on it (on its sheet once everything is read and
   * it has nothing more to say), and the Library's lists follow.
   */
  refresh(): void {
    for (const old of this.host.root.querySelectorAll<HTMLElement>('.mr-docs-status')) {
      const focused = old.contains((old.getRootNode() as ShadowRoot | Document).activeElement);
      const sheet = old.closest<HTMLElement>('.mr-sheet-layer')!;
      const next = this.status();
      old.replaceWith(next);
      if (focused) (next.hidden ? sheet : next.querySelector<HTMLElement>('.mr-docs-line')!).focus({ preventScroll: true });
    }
    if (this.listed) this.drawResults();
  }

  /** Find linked docs, Read more and Try again: focus waits in the status, which says when reading ends. */
  private read(from: HTMLElement): void {
    from.focus({ preventScroll: true });
    void this.host.docs().read();
  }

  /** The Library on the first sheet: search, the docs linked to this review, then every document by folder. */
  showList(): void {
    this.listed = true;
    const field = h('label', 'mr-sheet-search');
    const search = h('input');
    search.type = 'search';
    search.placeholder = 'Search the docs';
    search.setAttribute('aria-label', 'Search the docs');
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.limit = PAGE;
      this.drawResults();
    });
    field.append(icon(icons.search), search, kbd('/'));
    const full = this.fullButton('Open the full library, with its map and notes', () => this.host.full(full));
    this.host.show({
      label: 'Library',
      actions: [full],
      description: `As this change leaves them · ${this.host.head.ref} @ ${this.host.head.commit.slice(0, 7)}`,
      extra: [field],
      body: [this.status(), this.results],
      keys: KEYS,
    });
    this.drawResults();
    // Opening the Library is asking for it: the repository is read once, a batch at a time.
    if (this.host.docs().state === 'idle') void this.host.docs().read();
  }

  private fullButton(title: string, action: () => void): HTMLButtonElement {
    const full = control('', 'mr-btn mr-icon-btn mr-docs-full', action);
    full.replaceChildren(glyph(icons.expand));
    full.setAttribute('aria-label', title.replace(/,.*$/, ''));
    full.title = title;
    return full;
  }

  private drawResults(): void {
    const index = this.host.docs().index;
    this.results.replaceChildren();
    if (!index) return;
    const row = (path: string, meta: string) => {
      const item = sheetRow({
        title: index.docs.get(path)?.title ?? fileTitle(path),
        meta,
        lead: icon(icons.book),
        opens: true,
        action: () => this.showDoc({ path }),
      });
      item.dataset.path = path;
      return item;
    };
    const query = this.query.trim();
    if (query) {
      const found = index.search(query);
      this.results.append(
        sheetSection(
          'Results',
          found.length
            ? found.map(({ path, heading }) => row(path, heading ? `${path} · “${heading.text}”` : path))
            : [h('p', 'mr-sheet-note', `No document matches “${query}”.`)],
          { count: found.length },
        ),
      );
      return;
    }
    const linked = this.linked();
    if (linked.size)
      this.results.append(
        sheetSection(
          'Linked to this review',
          [...linked].map(([path, { related, files }]) =>
            row(path, [related.kind, flagName(related), files > 1 ? `links to ${files} files` : ''].filter(Boolean).join(' · ')),
          ),
          { count: linked.size },
        ),
      );
    const rows: Node[] = [];
    let folder: string | null = null;
    for (const path of index.listed.slice(0, this.limit)) {
      if (folderOf(path) !== folder) {
        folder = folderOf(path);
        rows.push(h('h4', 'mr-sheet-subhead', folder || 'Top folder'));
      }
      rows.push(row(path, name(path)));
    }
    const left = index.listed.length - this.limit;
    if (left > 0)
      rows.push(
        control(`Show ${Math.min(PAGE, left)} more of ${index.listed.length}`, 'mr-sheet-link mr-docs-more', () => {
          this.limit += PAGE;
          this.drawResults();
        }),
      );
    this.results.append(sheetSection('All documents', rows, { count: index.listed.length }));
    // Everything read: how much, and anything that could not be, at the foot of the list.
    const snapshot = this.host.context.snapshot;
    if (snapshot && this.host.docs().complete) this.results.append(h('p', 'mr-docs-footnote', snapshot.status));
  }

  /** Each document that links to a file the review changes, once, with how many of those files it links to. */
  private linked(): Map<string, { related: ReviewRelated; files: number }> {
    const linked = new Map<string, { related: ReviewRelated; files: number }>();
    for (const list of this.host.context.snapshot?.related.values() ?? [])
      for (const related of list) {
        const entry = linked.get(related.path) ?? { related, files: 0 };
        entry.files++;
        linked.set(related.path, entry);
      }
    return linked;
  }

  /** A document on top: the links that tie it to the review, then the document; its links open theirs on top again. */
  showDoc(at: DocOpening): void {
    const docs = this.host.docs();
    const source = this.host.source();
    const reading = new Reading();
    const full = this.fullButton('Read it in the full library, with its map and notes', () => this.host.full(full, at));
    // Listed because it links to files the review changes: each link, shown in the document below when chosen.
    const evidence: Node[] = [];
    let about: ReviewRelated | undefined;
    for (const [file, list] of this.host.context.snapshot?.related ?? []) {
      const related = list.find((item) => item.path === at.path);
      if (!related) continue;
      about = related;
      for (const link of related.evidence)
        evidence.push(
          sheetRow({
            title: `“${link.text}”`,
            meta: `Links to ${name(file)}`,
            end: `Line ${link.line}`,
            lead: icon(icons.link),
            action: () => reading.showLine(link.line),
          }),
        );
    }
    const box = h('div', 'mr-pm-preview mr-docs-doc');
    box.append(h('p', 'mr-pm-note', 'Opening the document…'));
    box.addEventListener('click', (e) => this.follow(e, reading));
    // Still shown: not gone back from (a sheet sliding away is hidden at once), replaced by another, or closed.
    const shown = () => box.isConnected && !box.closest('[hidden]');
    this.host.push({
      label: 'Document',
      actions: [full],
      kicker: about ? [about.kind, flagName(about)].filter(Boolean).join(' · ') : undefined,
      title: docs.index?.docs.get(at.path)?.title ?? fileTitle(at.path),
      description: `${at.path} · ${source.commit.slice(0, 7)}`,
      body: [...(evidence.length ? [sheetSection('Links to this review', evidence, { count: evidence.length })] : []), box],
      kind: 'document',
    });
    void docs.load(at.path).then(
      (text) => {
        // Gone back before it arrived: nothing to draw.
        if (!shown()) return;
        let r: RenderedDoc;
        try {
          r = renderDocument(document, {
            path: at.path,
            status: 'modified',
            base: text,
            head: text,
            links: source.links,
            origin: location.origin,
            images: this.host.images(),
          });
        } catch (err) {
          this.unreadable(box, at.path, err);
          return;
        }
        // The sheet's header names the document; its front matter is for reading in full.
        r.lead?.remove();
        r.content.querySelector('details.mr-meta')?.remove();
        reading.rendered = r;
        box.replaceChildren(r.content);
        renderDiagrams(r.diagrams, this.host.dark(), () => reading.settle(), this.host.palette());
        void highlightCode(r.content);
        if (at.anchor) reading.showAnchor(at.anchor);
      },
      (err) => {
        if (shown()) this.unreadable(box, at.path, err);
      },
    );
  }

  private unreadable(box: HTMLElement, path: string, err: unknown): void {
    const source = this.host.source();
    const link = h('a', 'mr-btn mr-outline', `Open on ${source.platform}`);
    link.href = source.links.blob(path);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    box.replaceChildren(h('p', 'mr-pm-note', (err as Error).message), link);
  }

  /** A link to another listed document opens it on top; a section link scrolls to it; anything else opens as usual. */
  private follow(e: MouseEvent, reading: Reading): void {
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const href = link.getAttribute('href')!;
    if (href.startsWith('#')) {
      e.preventDefault();
      reading.showAnchor(decodeURIComponent(href.slice(1)));
      return;
    }
    const [path, anchor] = (link.dataset.mrPath ?? '').split('#');
    const target = path ? this.host.docs().index?.documentAt(path.replace(/\?.*$/, '')) : null;
    if (!target) return;
    e.preventDefault();
    this.showDoc({ path: target, anchor });
  }
}
