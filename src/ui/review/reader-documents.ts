import { ReaderError, type DocContents, type DocRef, type ReviewSource } from '../../platforms/types.ts';
import { highlightCode, languageName, languageOf } from '../rendering/code.ts';
import { renderCodeFile } from '../rendering/code-files.ts';
import { quietFile } from '../../core/quiet.ts';
import { readingOrder } from '../../core/order.ts';
import type { ChapterFileState } from './chapters.ts';
import { loadPosition, savePosition } from './positions.ts';
import { showMove } from './moves.ts';
import { enhanceSymbols, refreshSymbols } from '../rendering/symbols.ts';
import { enhanceSpecs } from '../rendering/specs.ts';
import { renderSourceComments } from '../rendering/source-comments.ts';
import { renderDiagrams } from '../rendering/diagrams.ts';
import { chip, h, glyph } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { renderDocument, type RenderedDoc } from '../rendering/render.ts';
import { filterDocument } from '../rendering/reading.ts';
import { type View, WORDS_PER_MINUTE, actionButton, baseName, prettyName, session, textWithoutDeletions } from './reader-shared.ts';
import { ReaderBase } from './reader-base.ts';

/** Loading a review and building its documents: the files, their contents, folding, the file list and Viewed. */
export abstract class ReaderDocuments extends ReaderBase {
  setSource(source: ReviewSource, start: number): void {
    if (this.closed) return;
    this.source = source;
    this.shadow.querySelector<HTMLElement>('[data-act="code-files"]')!.title = `${source.codeDocs?.length ?? 0} supported code files`;
    const all = [...source.docs, ...(source.codeDocs ?? [])];
    if (!all.length) {
      this.chapters.setSource([], source.otherFiles ?? [], Boolean(source.project));
      this.showMessage('No readable changes here', 'This change set does not touch any supported document or text source files.');
      return;
    }
    this.index = Math.min(Math.max(start, 0), all.length - 1);
    this.shadow.querySelector<HTMLElement>('[data-act="search"]')!.hidden = false;
    this.views = all.map((doc, i) => {
      const section = h(
        'section',
        `mr-document${doc.status === 'removed' || doc.status === 'added' ? ` doc-${doc.status}` : ''}${doc.kind === 'code' ? ' is-code' : ''}`,
      );
      section.setAttribute('aria-label', doc.path);
      section.dataset.document = String(i);
      section.hidden = doc.kind === 'code' && !this.settings.codeFiles;
      section.append(this.skeleton());
      return { doc, section, rendered: null };
    });
    for (const view of this.views) this.viewByDoc.set(view.doc, view);
    for (const doc of all) this.viewed.set(doc, { value: false, ready: false, busy: false });
    if (source.viewed) void this.initNativeViewed();
    this.overview = source.overview ? this.renderOverview(source.overview) : null;
    this.el.doc.replaceChildren(...(this.overview ? [this.overview] : []), ...this.views.map((view) => view.section));
    this.listed = all;
    this.orderViews();
    // Opened at its start, a review starts at the first file in reading order.
    if (!start) this.index = 0;
    this.chapters.setSource(all, source.otherFiles ?? [], Boolean(source.project));
    this.updateFileButton();
    // A review opened at its start, and read over several sittings, offers to continue where the reader was.
    void this.loadAll(this.index).then(() => {
      if (!start) void this.offerResume();
    });
    void this.loadThreads();
    if (source.history) void this.initRevisions();
  }

  close(): void {
    if (this.closed) return;
    // A scroll just before closing is the place to come back to.
    if (this.positionTimer) {
      clearTimeout(this.positionTimer);
      this.rememberPosition();
    }
    this.closed = true;
    this.layer?.close();
    this.reviewDocs?.stop();
    this.chapters.close();
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    for (const type of ['keydown', 'keyup', 'keypress']) window.removeEventListener(type, this.shield, true);
    this.dark.removeEventListener('change', this.onSchemeChange);
    document.removeEventListener('selectionchange', this.onSelectionChange);
    clearTimeout(this.toastTimer);
    this.search.destroy();
    this.unmark();
    CSS.highlights?.delete('galley-quote');
    this.host.remove();
    document.documentElement.style.overflow = this.prevOverflow;
    if (this.prevFocus instanceof HTMLElement) this.prevFocus.focus({ preventScroll: true });
    session.reader = null;
    this.onClose?.();
  }

  showError(err: unknown): void {
    if (this.closed) return;
    const e = err instanceof ReaderError ? err : new ReaderError('Galley could not load this review.', err instanceof Error ? err.message : String(err));
    const extra: Node[] = [];
    if (e.needsToken) {
      const p = h('p');
      const a = h('a', '', 'Create a fine-grained token');
      a.href = 'https://github.com/settings/personal-access-tokens/new';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      p.append(a, ' with read-only access to Contents and Pull requests, then click the Galley icon in your browser toolbar to save it.');
      extra.push(p);
    }
    this.showMessage(e.message, e.hint, extra);
  }

  // ---------------------------------------------------------------- documents

  protected load(doc: DocRef): Promise<DocContents> {
    let p = this.cache.get(doc);
    if (!p) {
      p = this.source!.load(doc);
      this.cache.set(doc, p);
      p.catch(() => this.cache.delete(doc));
    }
    return p;
  }

  protected async loadAll(start: number): Promise<void> {
    // Keep source order and limit requests to three documents at once.
    let cursor = 0;
    const worker = async () => {
      while (cursor < this.views.length && !this.closed) {
        const index = cursor++;
        const view = this.views[index];
        if (!view.section.hidden && !view.rendered && !view.quiet) await this.loadView(index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, this.views.length) }, worker));
    if (!this.closed && start) this.show(start);
  }

  protected async loadView(index: number): Promise<void> {
    const view = this.views[index];
    if (this.loading.has(view.doc)) return;
    this.loading.add(view.doc);
    view.failed = false;
    const since = this.sinceActive();
    try {
      const contents = await this.load(view.doc);
      const shown = await this.shown(view, contents);
      // Switching between the whole review and what changed since, while this file was read, leaves it to be drawn again.
      if (this.closed || since !== this.sinceActive()) return;
      this.contentsOf.set(view.doc, shown.contents);
      // Files most reviewers skip start folded, one click away. A file with a discussion on it never does.
      const quiet = view.open || !this.settings.fold || this.threads.some((thread) => thread.doc === view.doc) ? null : quietFile(shown.doc, shown.contents);
      if (quiet) {
        view.quiet = quiet;
        view.section.classList.add('is-quiet');
        view.section.replaceChildren(this.quietCard(view));
        this.schedule(true);
        this.search.refresh();
        // Release the loading slot before progress storage resolves: a newly arrived discussion
        // may need to open this folded file immediately. Viewed is kept for the review's own contents, whichever is drawn.
        if (!this.source!.viewed) void this.initLocalViewed(view.doc, contents);
        else this.updateViewed();
        return;
      }
      const r =
        view.doc.kind === 'code'
          ? renderCodeFile(document, shown.doc, shown.contents)
          : renderDocument(document, {
              path: shown.doc.status === 'removed' ? shown.doc.oldPath : shown.doc.path,
              status: shown.doc.status,
              ...shown.contents,
              links: this.source!.links(view.doc),
              origin: location.origin,
              images: this.settings.images,
            });
      view.rendered = r;
      view.section.replaceChildren(this.buildArticle(shown.doc, r));
      this.markUpdated(view);
      for (const block of r.blocks) this.blockOf.set(block.el, { view, block });
      if (r.isCode) await enhanceSpecs(r, shown.doc, shown.contents);
      if (this.closed) return;
      if (r.isCode) {
        this.applyCodeView(view);
        this.showMoves(view);
        void enhanceSymbols(r, shown.doc, shown.contents).then(() => this.schedule(true));
      }
      for (const img of r.content.querySelectorAll('img')) img.addEventListener('load', () => this.schedule(true), { once: true });
      this.attachThreads(view);
      filterDocument(r, this.settings.scope === 'changed');
      const drawDiagrams = () => renderDiagrams(r.diagrams, this.root.classList.contains('is-dark'), () => this.schedule(true), this.palette());
      drawDiagrams();
      void highlightCode(r.content).then(() => {
        if (
          r.isCode &&
          !this.closed &&
          renderSourceComments(r, {
            path: shown.doc.status === 'removed' ? shown.doc.oldPath : shown.doc.path,
            status: shown.doc.status,
            ...shown.contents,
            links: this.source!.links(view.doc),
            origin: location.origin,
            images: this.settings.images,
          })
        ) {
          for (const block of r.blocks) this.blockOf.set(block.el, { view, block });
          // The notes start formatted; show them as the setting says.
          delete r.content.dataset.mrView;
          this.applyCodeView(view);
          drawDiagrams();
          void highlightCode(r.content).then(() => this.schedule(true));
        }
        this.schedule(true);
      });
      if (index === this.index) {
        this.rendered = r;
        this.buildToc(r);
      }
      this.schedule(true);
      this.search.refresh();
      if (!this.source!.viewed) await this.initLocalViewed(view.doc, contents);
      else {
        this.updateViewed();
        this.foldIfViewed(view);
      }
    } catch (err) {
      if (this.closed) return;
      const box = h('div', 'mr-message');
      box.append(h('h2', '', view.doc.path), h('p', '', err instanceof Error ? err.message : String(err)));
      const platform = h('a', 'mr-outline', 'Open platform diff');
      platform.href = this.source!.diffUrl;
      platform.target = '_blank';
      platform.rel = 'noopener noreferrer';
      box.append(platform);
      box.append(actionButton('Try again', 'retry-doc', 'mr-outline'));
      view.section.replaceChildren(box);
      view.failed = true;
      this.search.refresh();
      this.chapters.update();
      this.schedule(true);
    } finally {
      this.loading.delete(view.doc);
      if (!this.closed && since !== this.sinceActive()) void this.loadView(this.views.indexOf(view));
    }
  }

  /** Code moved within or between source files reads as moved, not as removed here and added there. */
  protected showMoves(view: View): void {
    const moves = this.moves.add(view.doc, view.rendered!);
    for (const move of moves) showMove(move);
    const touched = new Set(moves.flatMap((move) => [move.from.ref, move.to.ref]));
    for (const other of this.views) {
      if (!touched.has(other.doc)) continue;
      const moved = other.rendered!.blocks.filter((block) => 'mrMoved' in block.el.dataset).length;
      const byline = other.section.querySelector('.mr-byline')!;
      byline.querySelector('.is-moved')?.remove();
      // Alongside the file's other counts.
      byline.querySelector('.mr-file-meta')!.append(chip('moved', `${moved} moved`));
      refreshSymbols(other.rendered!);
    }
    this.schedule(true);
  }

  /** One line for a folded file: what it is, why it is folded (Galley's reason, or the reviewer's), and how much changed. */
  protected quietCard(view: View): HTMLElement {
    const { doc, quiet } = view;
    const card = h('div', 'mr-quiet');
    const name = h('p', 'mr-quiet-name');
    const slash = doc.path.lastIndexOf('/');
    if (slash > 0) name.append(h('span', 'mr-code-dir', doc.path.slice(0, slash + 1)));
    name.append(doc.path.slice(slash + 1));
    const meta = h('p', 'mr-quiet-meta');
    meta.append(h('span', 'mr-quiet-label', quiet?.label ?? 'Folded'));
    if (quiet) meta.append(h('span', 'mr-quiet-reason', quiet.reason));
    const counts = quiet ?? { ...view.rendered!.stats };
    if ('modified' in counts && counts.modified) meta.append(chip('modified', `${counts.modified.toLocaleString('en-US')} edited`));
    if (counts.added) meta.append(chip('added', `${counts.added.toLocaleString('en-US')} added`));
    if (counts.removed) meta.append(chip('removed', `${counts.removed.toLocaleString('en-US')} removed`));
    const show = actionButton('', 'show-quiet', 'mr-quiet-show');
    const icon = h('span', 'mr-file-action-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.replaceChildren(glyph(icons.down));
    show.append(h('span', '', 'Show changes'), icon);
    show.setAttribute('aria-label', `Show changes in ${doc.path}`);
    const text = h('div', 'mr-quiet-text');
    text.append(name, meta);
    const actions = h('div', 'mr-quiet-actions');
    actions.append(this.viewedToggle(doc), show);
    card.append(text, actions);
    return card;
  }

  /** Put the files in the order the File order setting asks for, keeping the current file current. */
  protected orderViews(): void {
    const order = this.chapterOrder ?? (this.settings.order === 'suggested' ? readingOrder(this.listed) : this.listed);
    const rank = new Map(order.map((doc, i) => [doc, i]));
    const current = this.views[this.index];
    this.views.sort((a, b) => rank.get(a.doc)! - rank.get(b.doc)!);
    this.views.forEach((view, i) => {
      view.section.dataset.document = String(i);
    });
    this.el.doc.append(...this.views.map((view) => view.section));
    this.index = this.views.indexOf(current);
    this.orderedBy = this.settings.order;
  }

  protected chapterState(doc: DocRef): ChapterFileState {
    const view = this.viewByDoc.get(doc);
    return {
      viewed: this.viewed.get(doc)?.value ?? false,
      folded: Boolean(view?.folded || (view?.quiet && !view.open)),
      hidden: Boolean(view?.section.hidden),
      unavailable: Boolean(view?.failed),
      current: Boolean(view && this.views[this.index] === view),
      unsupported: !view,
    };
  }

  protected showChapterFile(doc: DocRef): void {
    const view = this.viewByDoc.get(doc)!;
    if (view.section.hidden) this.update({ codeFiles: true });
    this.show(this.views.indexOf(view));
    this.root.focus({ preventScroll: true });
  }

  /** Move existing sections, retaining their editors, folded state and the current reading position. */
  protected reorderChapters(order: DocRef[] | null): void {
    if (!this.views.length) return;
    const current = this.views[this.index];
    const top = current.section.getBoundingClientRect().top;
    this.chapterOrder = order;
    this.orderViews();
    this.updateFileButton();
    this.root.scrollTop += current.section.getBoundingClientRect().top - top;
    this.schedule(true);
  }

  protected async offerResume(): Promise<void> {
    const visible = this.views.filter((view) => !view.section.hidden);
    const saved = await loadPosition(
      this.source!.diffUrl,
      visible.map((view) => view.doc.path),
    );
    if (!saved || this.closed || this.root.scrollTop > 200) return;
    const view = visible.find((view) => view.doc.path === saved.path)!;
    // Near the very top there is nothing to pick up.
    if (view === visible[0] && saved.offset < 600) return;
    this.resumeAt = { view, offset: saved.offset };
    this.el.resume.querySelector('.mr-resume-text')!.textContent = `Pick up where you left off: ${baseName(saved.path)}`;
    this.el.resume.hidden = false;
  }

  protected continueReading(): void {
    const { view, offset } = this.resumeAt!;
    this.el.resume.hidden = true;
    this.root.scrollTop += view.section.getBoundingClientRect().top - this.root.getBoundingClientRect().top + Math.min(offset, view.section.offsetHeight);
  }

  /** Remembered per review, in this browser: which file the reader is in, and how far into it. */
  protected rememberPosition(): void {
    // Before the review loads, or in one with nothing to read, there is no place to remember.
    const view = this.views[this.index];
    if (!view) return;
    const offset = Math.max(0, Math.round(this.root.getBoundingClientRect().top - view.section.getBoundingClientRect().top));
    void savePosition(this.source!.diffUrl, view.doc.path, offset);
  }

  /** Any file folds to one line, and opens again as it was: drafts, discussions and moves stay with it. */
  protected foldView(view: View): void {
    view.folded = true;
    view.section.classList.add('is-quiet', 'is-folded');
    view.section.prepend(this.quietCard(view));
    // Folding the file being read keeps its card in view instead of leaving the reader further down.
    if (view.section.getBoundingClientRect().top < this.root.getBoundingClientRect().top) this.scrollToEl(view.section, 0.12, false);
    this.updateViewed();
    this.schedule(true);
  }

  protected unfoldView(view: View): void {
    view.folded = false;
    view.section.classList.remove('is-quiet', 'is-folded');
    view.section.firstElementChild!.remove();
    this.updateViewed();
    this.schedule(true);
  }

  protected openQuiet(index: number): Promise<void> {
    const view = this.views[index];
    view.open = true;
    view.section.classList.remove('is-quiet');
    view.section.replaceChildren(this.skeleton());
    return this.loadView(index);
  }

  protected show(index: number): void {
    // Callers only offer visible documents: the menu, stepDoc and the starting index all skip hidden ones.
    const view = this.views[index];
    this.index = index;
    this.rendered = view.rendered;
    this.closeMenus();
    this.updateFileButton();
    this.buildToc(view.rendered);
    this.scrollToEl(view.section, 0.12, false);
  }

  protected buildArticle(doc: DocRef, r: RenderedDoc): DocumentFragment {
    const frag = document.createDocumentFragment();
    const intro: HTMLElement[] = [];
    if (r.description) intro.push(h('p', 'mr-subtitle', r.description));
    intro.push(this.byline(doc, r));

    if (r.lead) {
      // Title first, like an article: front matter (or its removed version) moves below the byline.
      const before: Element[] = [];
      for (let el = r.content.firstElementChild; el && el !== r.lead; el = el.nextElementSibling) before.push(el);
      r.lead.classList.add('mr-lead');
      r.lead.after(...intro, ...before);
    } else if (doc.kind === 'code') {
      // Source files are titled by their path, in the code face, not as an article.
      const title = h('h1', 'mr-title mr-code-title');
      const slash = doc.path.lastIndexOf('/');
      if (slash > 0) title.append(h('span', 'mr-code-dir', doc.path.slice(0, slash + 1)));
      title.append(doc.path.slice(slash + 1));
      frag.append(title, ...intro);
    } else {
      frag.append(h('h1', 'mr-title', r.title ?? prettyName(doc.path)), ...intro);
    }
    frag.append(r.content);
    if (!r.blocks.some((block) => block.kind !== 'same'))
      frag.append(h('p', 'mr-empty-changes', 'No visible text changes. Choose Whole files in Reading settings → Review → Context to read this file.'));
    return frag;
  }

  protected byline(doc: DocRef, r: RenderedDoc): HTMLElement {
    const line = h('div', 'mr-byline');
    line.append(
      h(
        'span',
        '',
        doc.kind === 'code' ? (languageName(languageOf(doc.path)) ?? 'Source file') : `${Math.max(1, Math.round(r.words / WORDS_PER_MINUTE))} min read`,
      ),
    );
    // A whole new or deleted file is said once, here, beside what kind of file it is.
    const noun = doc.kind === 'code' ? 'file' : 'document';
    if (doc.status === 'added') line.append(chip('added', `New ${noun}`));
    if (doc.status === 'removed') line.append(chip('removed', `Deleted ${noun}`), h('span', 'mr-byline-note', 'You are reading its last version'));
    if (doc.status !== 'added' && doc.status !== 'removed') {
      const { added, modified, removed } = r.stats;
      if (!added && !modified && !removed) line.append(h('span', '', doc.status === 'renamed' ? 'Moved, text unchanged' : 'No visible text changes'));
      if (modified) line.append(chip('modified', `${modified} edited`));
      if (added) line.append(chip('added', `${added} added`));
      if (removed) line.append(chip('removed', `${removed} removed`));
    }
    if (r.hiddenLines) {
      // Comments, link definitions and unbalanced HTML render nowhere; say so instead of implying no change.
      const hidden = h('a', 'mr-chip is-hidden', `${r.hiddenLines} line${r.hiddenLines === 1 ? '' : 's'} not shown`);
      hidden.href = this.source!.diffUrl;
      hidden.target = '_blank';
      hidden.rel = 'noopener noreferrer';
      hidden.title = 'Changed source lines this view cannot show, such as HTML comments, link definitions or raw HTML. Opens the platform diff.';
      line.append(hidden);
    }
    if (r.heldImages) {
      const load = actionButton(`Load ${r.heldImages} external image${r.heldImages === 1 ? '' : 's'}`, 'load-images', 'mr-chip is-images');
      load.title =
        'Images hosted outside this site were not loaded, so their hosts cannot see that you are reading. To load them automatically, choose Load in Reading settings → Review → External images.';
      line.append(load);
    }
    // The file's own controls end the byline: Viewed beside Fold, so finishing a file and putting it away sit together.
    const actions = h('span', 'mr-file-actions');
    const fold = actionButton('', 'fold-file', 'mr-fold-file');
    const icon = h('span', 'mr-file-action-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.replaceChildren(glyph(icons.up));
    fold.append(icon, h('span', 'mr-file-action-label', 'Fold'));
    fold.title = 'Fold this file to one line';
    fold.setAttribute('aria-label', `Fold ${doc.path}`);
    actions.append(this.viewedToggle(doc), fold);
    const facts = h('span', 'mr-file-meta');
    facts.append(...line.childNodes);
    line.append(facts, actions);
    return line;
  }

  /** Every file of the review, as the margin of the Files layout lists them: status, folded, viewed. */
  protected fileList(): HTMLElement {
    const list = h('nav', 'mr-toc-list mr-file-list');
    list.setAttribute('aria-label', 'Files in this review');
    const visible = this.views.filter((view) => !view.section.hidden);
    list.append(h('p', 'mr-toc-title', `${visible.length} file${visible.length === 1 ? '' : 's'}`));
    for (const view of visible) {
      const index = this.views.indexOf(view);
      const link = h('button', 'mr-file-link');
      link.type = 'button';
      link.dataset.act = 'doc';
      link.dataset.doc = String(index);
      link.title = view.doc.path;
      if (index === this.index) {
        link.classList.add('is-current');
        link.setAttribute('aria-current', 'true');
      }
      if ((view.quiet && !view.open) || view.folded) link.classList.add('is-folded');
      const dot = h('span', `mr-status-dot is-${view.doc.status}`);
      dot.setAttribute('aria-hidden', 'true');
      link.append(dot, h('span', 'mr-file-link-name', baseName(view.doc.path)));
      if (this.updatedSince(view.doc)) {
        const mark = h('span', 'mr-file-updated');
        mark.setAttribute('role', 'img');
        mark.setAttribute('aria-label', 'Updated since you last looked');
        link.append(mark);
      }
      if (this.viewed.get(view.doc)!.value) {
        const check = h('span', 'mr-file-check');
        check.replaceChildren(glyph(icons.check));
        check.setAttribute('aria-label', 'Viewed');
        link.append(check);
      }
      list.append(link);
      if (index === this.index) list.append(h('div', 'mr-file-headings'));
    }
    return list;
  }

  /** A file's own Viewed check, in its byline or folded card, kept in step with the one in the top bar. */
  protected viewedToggle(doc: DocRef): HTMLButtonElement {
    const toggle = actionButton('', 'viewed-file', 'mr-file-viewed');
    toggle.append(h('span', 'mr-file-viewed-box'), h('span', 'mr-file-action-label', 'Viewed'));
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', 'false');
    toggle.setAttribute('aria-label', `Viewed: ${doc.path}`);
    return toggle;
  }

  protected buildToc(r: RenderedDoc | null): void {
    this.headings = [];
    const toc = this.el.toc;
    toc.replaceChildren();
    // The Files layout lists every file of the review here; the current one opens to its headings.
    const files = this.settings.layout === 'files' ? this.fileList() : null;
    if (files) toc.append(files);
    if (!r || r.isCode) return;
    const all = [...r.content.querySelectorAll<HTMLElement>('h1, h2, h3')].filter((el) => el !== r.lead && !el.closest('.mr-ghost') && !el.hidden);
    if (all.length < 3) return;
    const top = Math.min(...all.map((el) => Number(el.tagName[1])));
    let list = files?.querySelector<HTMLElement>('.mr-file-headings');
    if (!list) {
      list = h('div', 'mr-toc-list');
      list.append(h('p', 'mr-toc-title', 'Contents'));
      toc.append(list);
    }
    all.forEach((el, i) => {
      const link = h('a', `lvl-${Math.min(3, Number(el.tagName[1]) - top + 1)}`);
      link.href = '#';
      link.dataset.act = 'heading';
      link.dataset.i = String(i);
      link.append(h('span', '', textWithoutDeletions(el)));
      list.append(link);
      this.headings.push({ el, link });
    });
    // Mark sections that contain changes.
    for (const changed of r.content.querySelectorAll('[data-mr-change]')) {
      let owner: { el: HTMLElement; link: HTMLElement } | null = null;
      for (const hd of this.headings) {
        if (hd.el === changed || hd.el.compareDocumentPosition(changed) & Node.DOCUMENT_POSITION_FOLLOWING) owner = hd;
        else break;
      }
      if (owner && !owner.link.querySelector('.mr-dot')) owner.link.append(h('span', 'mr-dot'));
    }
  }
}
