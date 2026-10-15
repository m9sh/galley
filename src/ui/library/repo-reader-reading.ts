import { chapterAttachment } from '../components/chapter-attachment.ts';
import { classify, fileTitle, folderTree, KIND_NAMES, KIND_SOURCES, type DocKind, type Edge, type FolderNode, type KindSource } from '../../core/docindex.ts';
import { highlightCode } from '../rendering/code.ts';
import { button, chip, h } from '../components/dom.ts';
import { renderDocument, type RenderedDoc } from '../rendering/render.ts';
import { external } from './repo-views.ts';
import { sequenceRoute, type ReadingStop, type SequenceLink } from './reading-sequence.ts';
import { OPEN_OUTLINE, type Place, TOP, WORDS_PER_MINUTE, plural, problem, safeDecode, shortSha } from './repo-reader-shared.ts';
import { RepoReaderSource } from './repo-reader-source.ts';

/** Reading a document: opening it, the article, the reading sequence, backlinks and contents, places and history, and the documents list. */
export abstract class RepoReaderReading extends RepoReaderSource {
  // ---------------------------------------------------------------- reading

  /** Open a document at the snapshot's commit; history remembers the paragraph the reader leaves. */
  protected async open(path: string, options: { anchor?: string; line?: number; push?: boolean; place?: Place } = {}): Promise<void> {
    if (options.push !== false) {
      this.remember();
      this.history = this.history.slice(0, this.at + 1);
      this.history.push({ path, block: -1, offset: 0, anchor: options.anchor });
      this.at = this.history.length - 1;
    }
    this.setView('read');
    this.path = path;
    this.readingAnchor = options.place?.anchor ?? options.anchor ?? '';
    this.updateSequence();
    this.rendered = null;
    this.q('.mr-file-name').textContent = fileTitle(path);
    this.q('.mr-doc').replaceChildren(this.skeleton());
    this.q('.mr-toc').replaceChildren();
    const source = this.source!;
    let text: string;
    try {
      text = await this.load(path);
    } catch (err) {
      if (this.closed || this.path !== path) return;
      const { title, hint } = problem(err);
      this.message(title, hint, [external(`Open on ${source.platform}`, source.links.blob(path), 'mr-btn mr-outline'), ...this.backButton()]);
      return;
    }
    if (this.closed || this.path !== path || this.source !== source) return;
    this.read.set(path, text);
    if (this.index && !this.index.docs.has(path)) this.index.add(this.indexed(path, text));
    let r: RenderedDoc;
    try {
      r = renderDocument(document, {
        path,
        status: 'modified',
        base: text,
        head: text,
        links: source.links,
        origin: location.origin,
        images: this.settings.images,
      });
    } catch (err) {
      const { title, hint } = problem(err);
      this.message(title, hint, [external(`Open on ${source.platform}`, source.links.blob(path), 'mr-btn mr-outline'), ...this.backButton()]);
      return;
    }
    this.rendered = r;
    this.q('.mr-file-name').textContent = r.title ?? fileTitle(path);
    this.q('.mr-doc').replaceChildren(this.article(path, r));
    // Chapters and Notes beside it follow the document: its links, its place in the path, what a note can be about.
    this.drawPanel();
    this.buildToc(r);
    this.drawDiagrams();
    void highlightCode(r.content);
    if (options.place) this.restore(options.place);
    else if (options.line) this.showLine(options.line);
    else if (options.anchor) this.showAnchor(options.anchor);
    else this.root.scrollTo({ top: 0 });
  }

  protected article(path: string, r: RenderedDoc): DocumentFragment {
    const source = this.source!;
    const frag = document.createDocumentFragment();
    const intro: HTMLElement[] = [];
    if (r.description) intro.push(h('p', 'mr-subtitle', r.description));
    const byline = h('div', 'mr-byline');
    const facts = h('span', 'mr-file-meta');
    facts.append(h('span', '', `${Math.max(1, Math.round(r.words / WORDS_PER_MINUTE))} min read`));
    const indexed = this.index?.docs.get(path);
    if (indexed) {
      const { kind, from } = classify(indexed, this.corrections);
      if (kind !== 'other') facts.append(this.kindChip(kind, from));
      if (indexed.status) facts.append(h('span', 'mr-repo-status', indexed.status));
    }
    if (this.changed.has(path)) facts.append(chip('modified', 'Changed in this review'));
    const at = h('span', 'mr-repo-at', `${path} · ${source.ref ?? 'default branch'} @ ${shortSha(source.commit)}`);
    at.title = `Read at commit ${source.commit}`;
    facts.append(at);
    if (r.heldImages) facts.append(button(`Load ${plural(r.heldImages, 'external image')}`, 'load-images', 'mr-btn mr-chip is-images'));
    const actions = h('span', 'mr-file-actions');
    actions.append(button('Add a note', 'note-here', 'mr-repo-note'), external(`Open on ${source.platform}`, source.links.blob(path), 'mr-repo-open'));
    byline.append(facts, actions);
    intro.push(byline);
    if (this.review?.context) {
      const review = this.review;
      const title = r.title ?? fileTitle(path);
      const attachment = chapterAttachment({
        chapters: review.chapters.map((chapter) => ({ id: chapter.id!, title: chapter.title })),
        current: review.entry?.chapter,
        headings: this.indexed(path, this.read.get(path)!).headings,
        add: (chapter, heading, label) => {
          review.context!.add({ chapter, commit: source.commit, path, heading, title: heading ? `${title} — ${label}` : title });
        },
      });
      intro.push(attachment);
    } else if (!this.review) {
      const title = r.title ?? fileTitle(path);
      intro.push(
        chapterAttachment({
          chapters: [{ id: 'library', title: 'Your reading sequence' }],
          headings: this.indexed(path, this.read.get(path)!).headings,
          scope: 'library',
          add: (_chapter, anchor, label) => this.addStop({ path, anchor, title: anchor ? `${title} — ${label}` : title }),
        }),
      );
    }
    if (r.lead) {
      const before: Element[] = [];
      for (let el = r.content.firstElementChild; el && el !== r.lead; el = el.nextElementSibling) before.push(el);
      r.lead.classList.add('mr-lead');
      r.lead.after(...intro, ...before);
    } else frag.append(h('h1', 'mr-title', r.title ?? fileTitle(path)), ...intro);
    frag.append(r.content, this.backlinks(path));
    return frag;
  }

  protected addStop(stop: ReadingStop): void {
    this.remember();
    const active = this.shadow.activeElement;
    // Where Add was: the documents list, or the sheet; it is drawn again there, and keeps focus.
    const within = active instanceof HTMLElement && active.dataset.act === 'sequence-add' ? active.closest<HTMLElement>('.mr-repo-docs, .mr-sheet') : null;
    const added = this.sequence.add(stop);
    this.updateSequence();
    this.buildOutline();
    if (this.panel === 'chapters') this.drawPanel();
    if (within)
      [...within.querySelectorAll<HTMLElement>('[data-act="sequence-add"]')]
        .find((el) => el.dataset.path === stop.path && el.dataset.anchor === stop.anchor)!
        .focus();
    const place = this.history[this.at];
    if (place && this.rendered && this.view === 'read') this.restore(place);
    this.toast(added ? 'Added to your reading sequence.' : 'Already in your reading sequence.');
  }

  protected updateSequence(): void {
    const route = sequenceRoute(this.sequence.items, this.sequence.current(this.path, this.readingAnchor));
    const old = this.shadow.querySelector('.mr-repo-read > .mr-chapter-route');
    if (old) old.replaceWith(route);
    else this.q('.mr-repo-read').prepend(route);
  }

  /** Links written in the document being read, to other documents: what Chapters offers to add. No index scan or folder inference. */
  protected sequenceLinks(): SequenceLink[] {
    const path = this.path;
    const text = path === null ? undefined : this.read.get(path);
    if (text === undefined) return [];
    return this.indexed(path!, text)
      .links.filter((link) => link.path && link.path !== path && /\.(md|markdown|mdown|mkd|mdx)$/i.test(link.path))
      .map((link) => ({
        path: link.path!,
        anchor: link.anchor,
        // A document already read goes by its own title; one not read yet by the words that link to it.
        title: this.index?.docs.get(link.path!)?.title ?? link.text,
        line: link.line,
        added: this.sequence.items.some((item) => item.path === link.path && item.anchor === link.anchor),
      }));
  }

  /** A document's type as a chip; one the reader set carries the accent, like everything else of theirs. */
  protected kindChip(kind: DocKind, from: KindSource): HTMLElement {
    const el = chip(from === 'reader' ? 'own' : null, KIND_NAMES[kind]);
    el.title = `${KIND_NAMES[kind]}, ${KIND_SOURCES[from]}`;
    return el;
  }

  /** The documents that link here, from the documents read so far, each with the links as evidence. */
  protected backlinks(path: string): HTMLElement {
    const box = h('aside', 'mr-repo-backlinks');
    box.setAttribute('aria-label', 'Linked from');
    box.append(h('h2', '', 'Linked from'));
    const index = this.index;
    if (!index || index.docs.size < index.listed.length) {
      const read = index ? index.docs.size : this.read.size;
      const total = index ? ` of ${plural(index.listed.length, 'document')}` : '';
      box.append(h('p', 'mr-repo-quiet', `Galley has read ${read.toLocaleString('en')}${total} in this repository.`));
    }
    const edges = index?.incoming(path) ?? [];
    if (edges.length) box.append(this.edgeList(edges));
    else if (index && index.docs.size >= index.listed.length) box.append(h('p', 'mr-repo-quiet', 'No other document links here.'));
    if (!index || index.docs.size < index.listed.length) box.append(button(this.indexing ? 'Reading documents…' : 'Find links to this document', 'index'));
    return box;
  }

  /** The documents that link here, each with every link that makes the connection; they have all been read. */
  protected edgeList(edges: Edge[]): HTMLElement {
    const list = h('ul', 'mr-repo-edges');
    for (const edge of edges) {
      const item = h('li', 'mr-repo-edge');
      const name = button(this.titleOf(edge.from), 'open', 'mr-repo-edge-doc');
      name.dataset.path = edge.from;
      name.title = edge.from;
      item.append(name);
      const { kind, from } = classify(this.index!.docs.get(edge.from)!, this.corrections);
      if (kind !== 'other') item.append(this.kindChip(kind, from));
      const evidence = h('ul', 'mr-repo-evidence');
      for (const link of edge.evidence) {
        const proof = button('', 'evidence', 'mr-repo-proof');
        proof.dataset.path = edge.from;
        proof.dataset.line = String(link.line);
        proof.append(h('q', '', link.text || link.href), ` ${link.section ? `in “${link.section}”, ` : ''}line ${link.line}`);
        proof.title = `Open ${edge.from} at line ${link.line}`;
        const li = h('li');
        li.append(proof);
        evidence.append(li);
      }
      item.append(evidence);
      list.append(item);
    }
    return list;
  }

  protected titleOf(path: string): string {
    return this.index?.docs.get(path)?.title ?? fileTitle(path);
  }

  protected buildToc(r: RenderedDoc): void {
    const toc = this.q('.mr-toc');
    const all = [...r.content.querySelectorAll<HTMLElement>('h1, h2, h3')].filter((el) => el !== r.lead);
    if (all.length < 3) return;
    const top = Math.min(...all.map((el) => Number(el.tagName[1])));
    const list = h('div', 'mr-toc-list');
    list.append(h('p', 'mr-toc-title', 'Contents'));
    for (const el of all) {
      const link = h('a', `lvl-${Math.min(3, Number(el.tagName[1]) - top + 1)}`);
      link.href = `#${el.id}`;
      link.dataset.act = 'heading';
      link.append(h('span', '', el.textContent!.trim()));
      list.append(link);
    }
    toc.append(list);
  }

  // ---------------------------------------------------------------- places

  /** The first paragraph in view (-1 for the top), so coming back lands on it at any window width. */
  protected remember(): void {
    const place = this.history[this.at];
    // The map hides the document; its place was taken when the map opened.
    if (!place || !this.rendered || place.path !== this.path || this.view !== 'read') return;
    const blocks = this.rendered.blocks;
    const i = this.root.scrollTop > 0 ? blocks.findIndex((block) => block.el.getBoundingClientRect().bottom > TOP) : -1;
    place.block = i;
    place.offset = i < 0 ? 0 : blocks[i].el.getBoundingClientRect().top;
    place.anchor = this.readingAnchor;
  }

  /** The sheet opens or closes beside the page: the page takes the width left, keeping the paragraph being read in place. */
  protected reflow(change: () => void): void {
    this.remember();
    change();
    this.fitWidth();
    const place = this.history[this.at];
    if (this.view === 'read' && place && this.rendered) this.restore(place);
  }

  /** Reflow the article around the paragraph in view, without moving a map or notes view. */
  protected arrangeLayout(): void {
    this.remember();
    this.applySettings();
    const place = this.history[this.at];
    if (this.view === 'read' && place && this.rendered) this.restore(place);
  }

  protected restore(place: Place): void {
    const block = this.rendered!.blocks[place.block];
    this.root.scrollTo({ top: block ? this.root.scrollTop + block.el.getBoundingClientRect().top - place.offset : 0 });
  }

  protected reveal(el: Element): void {
    this.root.scrollTo({ top: this.root.scrollTop + el.getBoundingClientRect().top - TOP });
    el.classList.add('mr-flash');
    setTimeout(() => el.classList.remove('mr-flash'), 1600);
  }

  /**
   * A link's evidence is a source line; show the paragraph that holds it. Every link sits in a block
   * that starts at or before its line, and a document read as it is has every block's source.
   */
  protected showLine(line: number): void {
    this.reveal(this.rendered!.blocks.findLast((b) => b.head!.lines[0] < line)!.el);
  }

  protected showAnchor(anchor: string): void {
    const content = this.rendered?.content;
    const target =
      content && [...content.querySelectorAll('[id]')].find((el) => el.id === anchor || el.id === `user-content-${anchor}` || el.id === anchor.toLowerCase());
    if (target) this.reveal(target);
    else this.toast(`“${anchor}” is not a section of this document; showing its beginning.`);
  }

  protected backButton(): HTMLElement[] {
    return this.at > 0 ? [button('Back', 'back')] : [];
  }

  protected go(step: -1 | 1): void {
    const next = this.history[this.at + step];
    if (!next) return;
    this.remember();
    this.at += step;
    void this.open(next.path, { push: false, place: next });
  }

  /** In-repository links open here at the same commit; everything else opens on the platform in a new tab. */
  protected follow(a: HTMLAnchorElement, e: MouseEvent): void {
    const target = a.dataset.mrPath!;
    const [file, hash = ''] = target.split('#');
    const path = file.replace(/\?.*$/, '');
    const anchor = safeDecode(hash);
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const doc = this.index?.documentAt(path) ?? (/\.(md|markdown|mdown|mkd|mdx)$/i.test(path) ? path : null);
    if (!doc) return;
    e.preventDefault();
    if (doc === this.path) {
      if (anchor) this.showAnchor(anchor);
      return;
    }
    void this.open(doc, { anchor });
  }

  // ---------------------------------------------------------------- documents list

  protected toggleDocs(open = this.q('.mr-repo-docs').hidden): void {
    this.closeMenus();
    if (!open || !this.source) return;
    this.q('.mr-repo-docs').hidden = false;
    this.q('[data-act="docs"]').setAttribute('aria-expanded', 'true');
    const listing = this.discover();
    this.buildOutline();
    this.q('.mr-repo-search').focus();
    listing.catch(() => this.buildOutline());
  }

  protected buildOutline(): void {
    const outline = this.q('.mr-repo-outline');
    const notes = this.q('.mr-repo-notes');
    if (!this.source || this.q('.mr-repo-docs').hidden) return;
    this.updateListMeta();
    notes.replaceChildren(...(this.listing?.limits ?? []).map((limit) => h('p', 'mr-repo-limit', limit)));
    if (!this.index) {
      outline.replaceChildren(
        ...(this.discovery
          ? [h('p', 'mr-repo-quiet', 'Listing documents…')]
          : [h('p', 'mr-repo-quiet', 'Galley could not list this repository.'), button('Try again', 'retry-list')]),
      );
      return;
    }
    if (!this.index.listed.length) {
      outline.replaceChildren(h('p', 'mr-repo-quiet', 'No Markdown documents at this commit.'));
      return;
    }
    if (this.search.trim()) {
      const found = this.index.search(this.search);
      const list = h('div', 'mr-repo-results');
      for (const match of found) {
        const item = this.docItem(match.path);
        if (match.heading) {
          item.dataset.anchor = match.heading.id;
          item.querySelector('.mr-path-dir')!.textContent = `§ ${match.heading.text}`;
        }
        const row = h('div', 'mr-repo-document-row');
        row.append(item);
        if (!this.review) row.append(this.addStopButton(match.path, match.heading?.id ?? '', match.heading?.text ?? this.titleOf(match.path)));
        list.append(row);
      }
      if (!found.length) list.append(h('p', 'mr-repo-quiet', 'No document or heading matches.'));
      if (this.index.docs.size < this.index.listed.length)
        list.append(h('p', 'mr-repo-quiet', `Headings are searched in the ${plural(this.index.docs.size, 'document')} Galley has read.`));
      outline.replaceChildren(list);
      return;
    }
    const tree = folderTree(this.index.listed);
    const openAll = this.index.listed.length <= OPEN_OUTLINE;
    const draw = (node: FolderNode, parent: HTMLElement) => {
      for (const path of node.docs) {
        const row = h('div', 'mr-repo-document-row');
        row.append(this.docItem(path));
        if (!this.review) row.append(this.addStopButton(path, '', this.titleOf(path)));
        parent.append(row);
      }
      for (const folder of node.folders) {
        const details = h('details', 'mr-repo-folder');
        details.open = openAll || this.path?.startsWith(`${folder.path}/`) === true;
        const summary = h('summary', '', `${folder.name}/`);
        details.append(summary);
        draw(folder, details);
        parent.append(details);
      }
    };
    outline.replaceChildren();
    draw(tree, outline);
  }

  protected docItem(path: string): HTMLButtonElement {
    const item = button('', 'open', 'mr-menu-item');
    item.dataset.path = path;
    const name = h('span', 'mr-menu-name');
    name.append(h('span', 'mr-path-name', this.titleOf(path)), h('span', 'mr-path-dir', path));
    item.append(name);
    const doc = this.index!.docs.get(path);
    if (doc) {
      const { kind, from } = classify(doc, this.corrections);
      if (kind !== 'other') item.append(this.kindChip(kind, from));
    }
    if (this.changed.has(path)) item.append(chip('modified', 'Changed'));
    if (path === this.path) item.setAttribute('aria-current', 'true');
    return item;
  }

  protected addStopButton(path: string, anchor: string, title: string): HTMLButtonElement {
    const add = button('Add', 'sequence-add', 'mr-chapter-button mr-sequence-add');
    add.dataset.path = path;
    add.dataset.anchor = anchor;
    add.dataset.title = title;
    add.setAttribute('aria-label', `Add ${title} to your reading sequence`);
    return add;
  }
}
