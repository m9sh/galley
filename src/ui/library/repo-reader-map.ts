import { classify, DOC_KINDS, indexCoverage, KIND_NAMES, KIND_SOURCES, readForIndex, type DocKind, type KindSource } from '../../core/docindex.ts';
import { highlightCode } from '../rendering/code.ts';
import { button, h, option, selectField, setRow, switchButton } from '../components/dom.ts';
import { renderDocument, type RenderedDoc } from '../rendering/render.ts';
import { lensSwitch } from './repo-views.ts';
import { recallOutlines, rememberOutlines, touchOutlines, type Remembered } from './outline-cache.ts';
import { documentMap } from '../../core/project-map.ts';
import { DocumentMap } from './map-view.ts';
import { type View, folderOf, problem } from './repo-reader-shared.ts';
import { RepoReaderReading } from './repo-reader-reading.ts';

/** The Documents map: switching views, the pass that reads documents for the index, and the map with its details. */
export abstract class RepoReaderMap extends RepoReaderReading {
  // ---------------------------------------------------------------- map

  protected setView(view: View): void {
    if (view !== this.view) this.remember();
    this.view = view;
    this.q('.mr-repo-read').hidden = view !== 'read';
    this.q('.mr-repo-map').hidden = view !== 'map';
    this.q('.mr-repo-thinking').hidden = view !== 'notes';
    this.q('.mr-repo-review').hidden = view !== 'review';
    this.q('.mr-repo-chapters').hidden = view !== 'chapters';
    // Each map's sheet keeps its place for the return to it; the map space is the two maps'.
    if (view !== 'review') this.reviewMap?.park();
    if (view !== 'map') this.mapView?.park();
    if (view !== 'map' && view !== 'review') this.root.classList.remove('is-map-space');
    // Focus never stays in a view that is hidden: it goes back to the reader.
    if (this.shadow.activeElement?.closest('[hidden]')) this.root.focus({ preventScroll: true });
    this.q('.mr-toc').hidden = view !== 'read';
    for (const b of this.shadow.querySelectorAll<HTMLElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    // One control names the view and opens the others.
    const current = this.q(`.mr-repo-views [data-view="${view}"]`);
    this.q('.mr-views-label').textContent = current.textContent;
    this.q('.mr-views-icon').replaceChildren(current.querySelector('svg')!.cloneNode(true));
  }

  protected async showMap(focus = this.focus ?? this.path): Promise<void> {
    if (!this.source) return;
    this.closeMenus();
    this.setView('map');
    // Once listed, the map is drawn at once.
    if (!this.index && !(await this.listed('map', this.q('.mr-repo-map'), 'map'))) return;
    const index = this.index!;
    this.focus = focus && index.documentAt(focus) ? index.documentAt(focus) : (index.documentAt('') ?? index.listed[0] ?? null);
    this.drawMap();
    this.autoIndex();
  }

  /** The listing, for a view that needs it: a skeleton meanwhile, and a way to try again when it fails. */
  protected async listed(view: View, pane: HTMLElement, retry: string): Promise<boolean> {
    pane.replaceChildren(this.skeleton());
    try {
      await this.discover();
    } catch (err) {
      if (this.view === view) {
        const { title, hint } = problem(err);
        const box = h('div', 'mr-message');
        box.append(h('h2', '', title), h('p', '', hint), button('Try again', retry));
        pane.replaceChildren(box);
      }
      return false;
    }
    return !this.closed && this.view === view;
  }

  /** The map and the review view read a first batch of documents by themselves, once per snapshot. */
  protected autoIndex(): void {
    if (!this.indexing && this.index!.unread().length && !this.indexedOnce) void this.indexMore();
  }

  /** Read the next batch of documents for the map; the reader can stop it at any time. */
  protected async indexMore(): Promise<void> {
    if (this.indexing) return;
    const index = this.index!;
    const signal = { cancelled: false };
    this.indexing = signal;
    this.indexedOnce = true;
    this.refreshIndexViews();
    const sizes = new Map(this.listing!.docs.flatMap((doc) => (doc.size === undefined ? [] : [[doc.path, doc.size] as [string, number]])));
    const remembered = await this.recall();
    let recalled = 0;
    let last = 0;
    // Documents read for the map also count for suggestions in the architecture views.
    const load = async (path: string) => {
      const text = await this.load(path);
      if (!signal.cancelled) this.read.set(path, text);
      return text;
    };
    const result = await readForIndex(index, load, {
      sizes,
      signal,
      // A document whose content hash is the one remembered is not read again.
      known: (path) => {
        const item = remembered.get(path);
        if (item === undefined || item.blob !== this.blobOf.get(path)) return undefined;
        recalled++;
        return item.doc;
      },
      parse: (path, text) => this.indexed(path, text),
      progress: () => {
        if (Date.now() - last < 250) return;
        last = Date.now();
        this.updateIndexStatus();
      },
    });
    if (this.indexing !== signal) return;
    this.indexing = null;
    for (const path of result.failed) this.unreadable.failed.add(path);
    for (const path of result.skipped) this.unreadable.skipped.add(path);
    if (!this.closed) this.refreshIndexViews();
    if (this.settings.rememberOutlines) this.saveOutlines(remembered, result.read > recalled);
  }

  protected recall(): Promise<Map<string, Remembered>> {
    this.remembered ??= this.settings.rememberOutlines ? recallOutlines(this.source!.id) : Promise.resolve(new Map());
    return this.remembered;
  }

  /**
   * Keep what the map learned, with what was remembered before and is still the same content, on this device. Nothing
   * new to keep only marks the project as used, so it is forgotten a week after the last visit, not the last change.
   */
  protected saveOutlines(before: Map<string, Remembered>, changed: boolean): void {
    const source = this.source!;
    if (!changed) return void touchOutlines(source.id);
    const docs = new Map<string, Remembered>();
    for (const [path, item] of before) if (item.blob === this.blobOf.get(path)) docs.set(path, item);
    for (const doc of this.index!.docs.values()) {
      const blob = this.blobOf.get(doc.path);
      if (blob !== undefined && !doc.unread) docs.set(doc.path, { blob, doc });
    }
    void rememberOutlines(
      source.id,
      new URL(source.url).origin,
      [...docs].map(([path, item]) => ({ path, ...item })),
    );
  }

  /** Only offered while a pass runs: the status is redrawn as soon as one starts or ends. */
  protected stopIndexing(): void {
    this.indexing!.cancelled = true;
    this.indexing = null;
    this.refreshIndexViews();
  }

  /** After the index changes: the map, the list's kinds and the current document's backlinks. */
  protected refreshIndexViews(): void {
    if (this.review?.context && this.view !== 'review') this.publishContext();
    if (this.view === 'map') this.drawMap();
    else if (this.view === 'review') this.drawReview();
    else this.updateIndexStatus();
    this.buildOutline();
    this.updateBacklinks();
  }

  protected updateBacklinks(): void {
    const old = this.shadow.querySelector('.mr-repo-backlinks');
    if (old && this.path) old.replaceWith(this.backlinks(this.path));
  }

  protected updateIndexStatus(): void {
    const status = this.shadow.querySelector('.mr-map-status');
    if (status) status.replaceWith(this.indexStatus());
  }

  protected indexStatus(): HTMLElement {
    const index = this.index!;
    const status = h('div', 'mr-map-status');
    status.setAttribute('role', 'status');
    const [built, ...notes] = indexCoverage(index, this.source!.commit, {
      limits: this.listing!.limits,
      failed: this.unreadable.failed.size,
      skipped: this.unreadable.skipped.size,
    });
    status.append(h('p', '', built));
    if (this.indexing) status.append(button('Stop reading', 'stop-index'));
    else if (index.docs.size < index.listed.length) status.append(button('Index more', 'index'));
    for (const note of notes) status.append(h('p', 'mr-repo-limit', note));
    return status;
  }

  protected mapHead(): HTMLElement {
    const head = h('header', 'mr-map-head');
    head.append(h('h1', 'mr-title', 'Project map'), lensSwitch(this.lens), this.indexStatus());
    return head;
  }

  protected drawMap(): void {
    const spatial = this.lens === 'documents' && this.focus !== null;
    this.root.classList.toggle('is-map-space', spatial);
    if (!spatial) this.mapView?.park();
    if (this.lens !== 'documents') {
      this.drawLens(this.lens);
      return;
    }
    const map = this.q('.mr-repo-map');
    const head = this.mapHead();
    const since = this.sinceRefresh();
    if (since) head.append(since);
    if (!spatial) {
      map.replaceChildren(head, h('p', 'mr-repo-quiet', 'No Markdown documents at this commit.'));
      return;
    }
    this.mapView ??= new DocumentMap({
      preview: (path) => this.preview(path),
      details: (path) => this.mapDetails(path),
      problems: (path) => this.mapProblems(path),
      refocus: (path) => {
        this.focus = path;
      },
      sheet: this.mapSheet,
      commit: this.source!.commit,
    });
    head.querySelector('.mr-lens-switch')!.after(this.mapView.tools);
    map.replaceChildren(head, this.mapView.element);
    this.mapView.draw({ model: documentMap(this.index!, this.corrections), focus: this.focus!, here: this.path, changed: this.changed });
  }

  /** A document in the map's sheet, rendered as the reader would, with diagrams as their source. */
  protected async preview(path: string): Promise<HTMLElement | null> {
    const source = this.source!;
    let r: RenderedDoc;
    try {
      const text = await this.load(path);
      r = renderDocument(document, {
        path,
        status: 'modified',
        base: text,
        head: text,
        links: source.links,
        origin: location.origin,
        images: this.settings.images,
      });
    } catch {
      return null;
    }
    for (const diagram of r.diagrams)
      for (const version of diagram.versions) {
        version.view.hidden = true;
        version.sourceDetails.open = true;
      }
    // The sheet's header already names the document; its front matter is for reading in full.
    r.lead?.remove();
    r.content.querySelector('details.mr-meta')?.remove();
    void highlightCode(r.content);
    const box = h('div', 'mr-pm-preview');
    box.append(r.content);
    return box;
  }

  /** A read document's type, where it came from, its status, and the reader's way to correct the type. */
  protected mapDetails(path: string): HTMLElement[] {
    const doc = this.index!.docs.get(path);
    if (!doc) return [];
    const { kind, from } = classify(doc, this.corrections);
    const facts = h('p', 'mr-map-facts');
    facts.append(this.kindChip(kind, from));
    if (doc.status) facts.append(h('span', 'mr-repo-status', doc.status));
    if (doc.unread) facts.append(h('span', 'mr-repo-limit', doc.unread === 'failed' ? 'Could not be read' : 'Too large to read'));
    return [facts, this.kindEditor(path, kind, from)];
  }

  /** Links a document makes that the map cannot follow, each with the link that makes it. */
  protected mapProblems(path: string): HTMLElement | null {
    const problems = this.index!.problems.filter((p) => p.from === path);
    if (!problems.length) return null;
    const box = h('section', 'mr-map-problems');
    box.setAttribute('aria-label', 'Links the map cannot follow');
    box.append(h('h3', '', 'Links the map cannot follow'));
    const list = h('ul');
    for (const p of problems) {
      const item = h('li');
      const proof = button('', 'evidence', 'mr-repo-proof');
      proof.dataset.path = path;
      proof.dataset.line = String(p.link.line);
      proof.append(h('q', '', p.link.text || p.link.href), ` line ${p.link.line}`);
      item.append(
        proof,
        p.kind === 'missing-doc'
          ? `: ${p.link.path} is not among the listed documents${this.listing!.limits.length ? ', which are incomplete' : ''}.`
          : `: “${p.link.anchor}” is not a section of ${p.link.path}.`,
      );
      list.append(item);
    }
    box.append(list);
    return box;
  }

  /** The reader can correct a type, as a settings row; Galley says where every type came from. */
  protected kindEditor(path: string, kind: DocKind, from: KindSource): HTMLElement {
    const box = h('div', 'mr-map-kind');
    const select = h('select');
    select.dataset.act = 'kind';
    select.dataset.path = path;
    for (const value of DOC_KINDS) select.append(option(value, KIND_NAMES[value], value === kind));
    box.append(
      setRow(
        'Type',
        selectField(select),
        from === 'reader' ? 'Set by you. Kept with your notes when you save them.' : `${KIND_NAMES[kind]}, ${KIND_SOURCES[from]}.`,
      ),
    );
    const folder = folderOf(path);
    if (folder)
      box.append(
        setRow(
          `Everything in ${folder}/`,
          switchButton('kind-folder', this.corrections.folders.has(folder) && !this.corrections.docs.has(path)),
          'The same type for the whole folder',
        ),
      );
    return box;
  }

  /** A type the reader sets is part of their notes: kept when they save, both types visible on the map. */
  protected setKind(path: string, kind: DocKind, folderWide: boolean): void {
    const folder = folderOf(path);
    this.notes!.change((thinking) => {
      thinking.docKinds = thinking.docKinds.filter(([doc]) => doc !== path);
      if (folderWide && folder) thinking.folderKinds = [...thinking.folderKinds.filter(([at]) => at !== folder), [folder, kind]];
      else {
        thinking.folderKinds = thinking.folderKinds.filter(([at]) => at !== folder);
        thinking.docKinds.push([path, kind]);
      }
    });
    this.applyCorrections();
    this.drawMap();
    this.buildOutline();
  }

  /** The types the reader set, from their notes. */
  protected applyCorrections(): void {
    const thinking = this.notes!.thinking;
    this.corrections.docs = new Map(thinking.docKinds);
    this.corrections.folders = new Map(thinking.folderKinds);
  }
}
