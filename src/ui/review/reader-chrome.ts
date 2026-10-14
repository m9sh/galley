import { ReviewDocs } from '../../core/review-context.ts';
import type { DocContents, DocRef, RepositorySource } from '../../platforms/types.ts';
import type { DocOpening } from './review-library.ts';
import { showCommentSource } from '../rendering/source-comments.ts';
import { isPalette, PALETTE_KEYS, type DiagramPalette } from '../rendering/diagram-palette.ts';
import { renderDiagrams } from '../rendering/diagrams.ts';
import { h } from '../components/dom.ts';
import { openRepository } from '../library/repo-reader.ts';
import { viewedKey, loadViewed, saveViewed } from './viewed.ts';
import { icons } from '../components/icons.ts';
import { loadImage } from '../rendering/render.ts';
import { filterDocument } from '../rendering/reading.ts';
import { DEFAULT_SETTINGS, TEXT_SIZES, updateSettings, type Settings } from '../preferences/settings.ts';
import { applyReadingControls, selectTab } from '../components/settings-sheet.ts';
import { STATUS_LABEL, type SettingsTab, type View, ZOOM_BAR, ZOOM_MARGIN, actionButton, baseName } from './reader-shared.ts';
import { ReaderDocuments } from './reader-documents.ts';

/** The reader's chrome: menus, Viewed, settings and the diagram lightbox. */
export abstract class ReaderChrome extends ReaderDocuments {
  // ---------------------------------------------------------------- chrome

  protected updateFileButton(): void {
    const visible = this.views.filter((view) => !view.section.hidden);
    const docs = visible.map((view) => view.doc);
    // Each file's slug says where it is in the review: "File 3 of 8" (styles/08-small-screens-and-motion.css).
    this.el.doc.style.setProperty('--files', String(visible.length));
    this.el.doc.dataset.files = String(visible.length);
    this.el.empty.hidden = visible.length > 0;
    if (!visible.length) {
      this.chapters.update();
      this.el.fileBtn.hidden = this.el.viewed.hidden = true;
      this.el.viewedFeedback.hidden = true;
      return;
    }
    if (this.views[this.index].section.hidden) this.index = this.views.indexOf(visible[0]);
    this.chapters.update();
    this.rendered = this.views[this.index].rendered;
    this.el.fileBtn.hidden = false;
    const doc = this.views[this.index].doc;
    const position = docs.indexOf(doc);
    // The bar shows only the file name; the full path, status and the PR live in the documents menu.
    this.el.fileBtn.dataset.path = doc.path;
    this.el.fileCount.textContent = docs.length > 1 ? `${position + 1} of ${docs.length}` : '';
    this.el.fileBtn.title = `${STATUS_LABEL[doc.status]}: ${doc.status === 'renamed' ? `${doc.oldPath} → ` : ''}${doc.path}`;
    this.el.fileBtn.setAttribute('aria-label', `Browse files: ${STATUS_LABEL[doc.status].toLowerCase()} ${doc.path}, ${position + 1} of ${docs.length}`);
    this.el.fileStatus.className = `mr-status-dot is-${doc.status}`;
    this.el.fileName.textContent = baseName(doc.path);
    const menu = this.el.files;
    menu.replaceChildren();
    const head = h('div', 'mr-files-head');
    head.setAttribute('role', 'presentation');
    head.append(h('p', 'mr-files-title', this.source!.title));
    const meta = h('p', 'mr-files-meta');
    if (this.source!.subtitle) meta.append(h('span', 'mr-files-source', this.source!.subtitle));
    meta.append(h('span', 'mr-files-progress', `${docs.filter((doc) => this.viewed.get(doc)?.value).length} of ${docs.length} viewed`));
    const folded = this.views.filter((view) => !view.section.hidden && ((view.quiet && !view.open) || view.folded)).length;
    if (folded) meta.append(h('span', 'mr-files-folded', `${folded} folded`));
    head.append(meta);
    // Narrow phones have no room for search in the top bar; it opens from here instead (styles/13-documents-menu.css).
    const find = h('button', 'mr-menu-item mr-files-search');
    find.type = 'button';
    find.setAttribute('role', 'menuitem');
    find.dataset.act = 'search';
    // biome-ignore lint/plugin: a bundled icon constant.
    find.innerHTML = icons.search;
    find.append(h('span', 'mr-menu-name', 'Search this review'));
    menu.append(head, find);
    docs.forEach((d) => {
      const i = this.views.findIndex((view) => view.doc === d);
      const item = h('button', 'mr-menu-item');
      item.setAttribute('role', 'menuitem');
      item.dataset.act = 'doc';
      item.dataset.doc = String(i);
      item.title = `${STATUS_LABEL[d.status]}: ${d.path}`;
      if (i === this.index) item.setAttribute('aria-current', 'true');
      const dot = h('span', `mr-status-dot is-${d.status}`);
      dot.setAttribute('aria-hidden', 'true');
      const name = h('span', 'mr-menu-name');
      const dir = d.path.slice(0, d.path.length - baseName(d.path).length);
      name.append(h('span', 'mr-path-name', baseName(d.path)));
      if (dir) name.append(h('span', 'mr-path-dir', dir));
      item.append(dot, name);
      const { quiet, open, folded } = this.views[i];
      if ((quiet && !open) || folded) item.append(h('span', 'mr-menu-quiet', quiet?.label ?? 'Folded'));
      item.append(h('span', 'mr-menu-status', STATUS_LABEL[d.status]));
      if (this.viewed.get(d)?.value) {
        const check = h('span', 'mr-file-check');
        // biome-ignore lint/plugin: a bundled icon constant.
        check.innerHTML = icons.check;
        check.setAttribute('aria-label', 'Viewed');
        item.append(check);
      }
      menu.append(item);
    });
    this.updateActiveViewed();
    if (this.settings.layout === 'files') this.buildToc(this.rendered);
  }

  protected skeleton(): HTMLElement {
    const s = h('div', 'mr-skeleton');
    // biome-ignore lint/plugin: fixed placeholder markup.
    s.innerHTML = '<i class="h"></i><i></i><i></i><i class="s"></i><i></i><i></i><i></i><i class="s"></i>';
    return s;
  }

  protected showMessage(title: string, body: string, extra: Node[] = []): void {
    this.rendered = null;
    this.el.toc.replaceChildren();
    this.el.gutter.replaceChildren();
    this.el.pill.hidden = true;
    const box = h('div', 'mr-message');
    box.append(h('h2', '', title));
    if (body) box.append(h('p', '', body));
    box.append(...extra);
    const actions = h('div', 'mr-actions');
    actions.append(actionButton('Back to the diff', 'close', 'mr-outline'));
    box.append(actions);
    this.el.doc.replaceChildren(box);
  }

  protected toggleMenu(menu: HTMLElement, button: HTMLElement | null): void {
    const open = menu.hidden;
    this.closeMenus();
    menu.hidden = !open;
    button?.setAttribute('aria-expanded', String(open));
    if (menu === this.el.files && open && button) {
      const anchor = button.getBoundingClientRect();
      const width = menu.offsetWidth;
      // Wide screens align the name with the document, and the menu with the name.
      const start = this.root.clientWidth >= 1280 ? anchor.left : anchor.left + anchor.width / 2 - width / 2;
      menu.style.left = `${Math.max(12, Math.min(start, innerWidth - width - 12))}px`;
    }
    if (menu === this.el.settings && open) {
      this.drawerFocus = button;
      for (const el of this.root.querySelectorAll<HTMLElement>('.mr-topbar, .mr-main, .mr-toc')) el.inert = true;
      this.root.classList.add('settings-open');
      this.el.settings.querySelector<HTMLElement>('button[data-act="close-settings"]')!.focus();
    }
  }

  /** The repository behind the review, opened once at its head: the sheet and the full library read the same one. */
  protected repo(): RepositorySource {
    this.repository ??= this.source!.project!.open();
    return this.repository;
  }

  /** What has been read of it for the sheet; reading starts only when the reviewer asks. */
  protected docs(): ReviewDocs {
    // The repository is opened only when something is read from it.
    const repo = () => this.repo();
    this.reviewDocs ??= new ReviewDocs(
      {
        get commit() {
          return repo().commit;
        },
        discover: () => repo().discover(),
        load: (path) => repo().load(path),
      },
      this.projectContext,
      () => new Set(this.chapters.outline().flatMap((chapter) => chapter.paths)),
      () => {
        this.library.refresh();
        if (this.reviewDocs!.state !== 'reading') this.chapters.redraw();
      },
    );
    return this.reviewDocs;
  }

  /**
   * The full Project library over the review, as the change leaves the repository (RFC 0049), for its map and notes;
   * the review and its sheet wait as they were. Opened at a document from a chapter, it can carry on with that chapter.
   */
  protected openProject(opener: HTMLElement, target?: DocOpening): void {
    const source = this.source!;
    const entry = target && { ...target, key: target.key ?? 'doc', canContinue: target.canContinue ?? false };
    this.layer = openRepository(this.repo(), {
      review: { title: source.title, ref: source.project!.head.ref, chapters: this.chapters.outline(), context: this.projectContext, entry },
      onClose: (action) => {
        this.layer = null;
        if (this.closed) return;
        // What the library read is the sheet's too.
        this.library.refresh();
        this.chapters.redraw();
        if (action === 'continue') this.chapters.continueChapter(target!.chapter!);
        else opener.focus({ preventScroll: true });
      },
    });
  }

  protected closeMenus(): boolean {
    const drawerOpen = !this.el.settings.hidden;
    const searchOpen = this.search.close();
    const wasOpen = drawerOpen || searchOpen || !this.el.files.hidden;
    this.el.files.hidden = this.el.settings.hidden = true;
    for (const b of this.shadow.querySelectorAll('.mr-topbar [aria-expanded]')) b.setAttribute('aria-expanded', 'false');
    if (drawerOpen) {
      for (const el of this.root.querySelectorAll<HTMLElement>('.mr-topbar, .mr-main, .mr-toc')) el.inert = false;
      this.root.classList.remove('settings-open');
      this.drawerFocus?.focus({ preventScroll: true });
      this.drawerFocus = null;
    }
    return wasOpen;
  }

  protected selectSettingsTab(name: SettingsTab, focus = false): void {
    selectTab(this.el.settings, name, focus);
  }

  // Viewed status is optional; failures never remove the document or imply a successful save.
  protected async initLocalViewed(doc: DocRef, contents: DocContents): Promise<void> {
    const state = this.viewed.get(doc)!;
    state.busy = true;
    state.error = undefined;
    this.updateViewed();
    try {
      state.key = await viewedKey(this.source!.diffUrl, doc, contents);
      state.value = await loadViewed(state.key);
      state.ready = true;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.busy = false;
      if (!this.closed) {
        this.updateViewed();
        this.foldIfViewed(this.views.find((view) => view.doc === doc)!);
      }
    }
  }

  /** Busy documents ignore the Viewed control, so only one load is ever in flight. */
  protected async initNativeViewed(): Promise<void> {
    for (const state of this.viewed.values()) state.busy = true;
    this.updateViewed();
    try {
      const paths = await this.source!.viewed!.load();
      for (const [doc, state] of this.viewed) {
        state.value = paths.includes(doc.path);
        state.ready = true;
        state.error = undefined;
      }
    } catch (err) {
      for (const state of this.viewed.values()) state.error = err instanceof Error ? err.message : String(err);
    } finally {
      for (const state of this.viewed.values()) state.busy = false;
      if (!this.closed) {
        this.updateViewed();
        for (const view of this.views) this.foldIfViewed(view);
      }
    }
  }

  /** Viewed files fold, as on GitHub, when their state is first known, unless the reviewer opened them. */
  protected foldIfViewed(view: View): void {
    if (view.rendered && !view.open && !view.folded && this.viewed.get(view.doc)!.value) this.foldView(view);
  }

  protected updateViewed(): void {
    this.updateFileButton();
    for (const view of this.views) {
      const state = this.viewed.get(view.doc)!;
      for (const toggle of view.section.querySelectorAll<HTMLButtonElement>('.mr-file-viewed')) {
        toggle.setAttribute('aria-checked', String(state.value));
        toggle.disabled = state.busy || (!state.ready && !state.error);
      }
    }
  }

  protected updateActiveViewed(): void {
    const view = this.views[this.index];
    const state = this.viewed.get(view.doc)!;
    const button = this.el.viewed as HTMLButtonElement;
    button.hidden = false;
    button.dataset.doc = String(this.index);
    button.disabled = !(view.rendered || view.quiet) || state.busy || (!state.ready && !state.error);
    button.setAttribute('aria-pressed', String(state.value));
    button.setAttribute('aria-label', `${state.value ? 'Unmark' : 'Mark'} ${view.doc.path} as viewed`);
    const label = state.busy
      ? state.ready
        ? 'Saving…'
        : 'Loading…'
      : !state.ready && state.error
        ? 'Retry loading viewed state'
        : state.value
          ? 'Viewed (V to unmark)'
          : 'Mark as viewed (V)';
    button.title = `${label}\n${state.error ?? this.source!.viewed?.label ?? 'Saved in this browser; resets when this file changes'}`;
    button.classList.toggle('is-busy', state.busy);
    button.classList.toggle('is-error', Boolean(state.error));
    this.el.viewedFeedback.hidden = !state.error;
    this.el.viewedFeedback.textContent = state.error ?? '';
  }

  protected async toggleViewed(index: number): Promise<void> {
    const view = this.views[index];
    const state = this.viewed.get(view.doc)!;
    if (state.busy) return;
    if (!state.ready) {
      if (this.source!.viewed) await this.initNativeViewed();
      else await this.initLocalViewed(view.doc, await this.load(view.doc));
      return;
    }
    const value = !state.value;
    state.busy = true;
    state.error = undefined;
    this.updateViewed();
    try {
      if (this.source!.viewed) await this.source!.viewed.set(view.doc, value);
      else await saveViewed(state.key!, value);
      state.value = value;
      // Checking a file puts it away; unchecking opens it again.
      if (value && view.rendered && !view.folded) this.foldView(view);
      if (!value && view.folded) this.unfoldView(view);
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.busy = false;
      if (!this.closed) this.updateViewed();
    }
  }

  protected update(patch: Partial<Settings>): void {
    if (patch.order) {
      this.chapterOrder = null;
      this.orderedBy = null;
    }
    this.settings = { ...this.settings, ...patch };
    this.applySettings();
    if (patch.images === 'load') this.loadImages(this.root);
    void updateSettings(patch);
  }

  /** Load held external images inside `scope`, after an explicit click or the Always setting. */
  protected loadImages(scope: ParentNode): void {
    for (const img of scope.querySelectorAll<HTMLImageElement>('img[data-mr-src]')) {
      img.addEventListener('load', () => this.schedule(true), { once: true });
      loadImage(img);
    }
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-act="load-images"]')) {
      if (!button.closest('.mr-document')?.querySelector('img[data-mr-src]')) button.remove();
    }
    this.schedule(true);
  }

  protected applySettings(): void {
    const s = this.settings;
    const r = this.root;
    for (const view of this.views) if (view.rendered) filterDocument(view.rendered, s.scope === 'changed');
    if (this.rendered) this.buildToc(this.rendered);
    const overviewToggle = this.shadow.querySelector<HTMLElement>('[data-act="overview"]')!;
    overviewToggle.setAttribute('aria-checked', String(s.overview));
    overviewToggle.closest<HTMLElement>('.mr-set-row')!.hidden = Boolean(this.source) && !this.source?.overview;
    if (this.overview) this.overview.hidden = !s.overview;
    this.shadow.querySelector('[data-act="signs"]')!.setAttribute('aria-checked', String(s.signs));
    r.classList.toggle('no-top-glow', !s.topGlow);
    this.shadow.querySelector('[data-act="fold"]')!.setAttribute('aria-checked', String(s.fold));
    // Turning folding off opens every folded file; turned on, it folds files as they load.
    if (!s.fold)
      this.views.forEach((view, index) => {
        if (view.quiet && !view.open) void this.openQuiet(index);
      });
    if (this.source && s.order !== this.orderedBy) this.orderViews();
    r.classList.toggle('no-signs', !s.signs);
    const codeToggle = this.shadow.querySelector<HTMLElement>('[data-act="code-files"]')!;
    codeToggle.setAttribute('aria-checked', String(s.codeFiles));
    codeToggle.title = `${this.source?.codeDocs?.length ?? 0} supported code files`;
    let loadCode = false;
    for (const view of this.views)
      if (view.doc.kind === 'code') {
        view.section.hidden = !s.codeFiles;
        loadCode ||= s.codeFiles && !view.rendered;
      }
    if (this.source) {
      this.updateFileButton();
      this.buildToc(this.rendered);
    }
    if (loadCode) void this.loadAll(0);
    for (const b of this.shadow.querySelectorAll<HTMLElement>('[data-scope]')) b.setAttribute('aria-pressed', String(b.dataset.scope === s.scope));
    r.classList.toggle('mode-changes', s.mode === 'changes');
    r.classList.toggle('mode-clean', s.mode === 'clean');
    r.dataset.font = s.font;
    r.dataset.theme = s.theme;
    r.dataset.layout = s.layout;
    r.dataset.density = s.density;
    r.classList.toggle('is-dark', s.appearance === 'dark' || (s.appearance === 'auto' && this.dark.matches));
    this.applyFit();
    applyReadingControls(this.shadow, s);
    for (const b of this.shadow.querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode));
    for (const view of this.views) if (view.rendered?.isCode) this.applyCodeView(view);
    const palette = this.palette();
    for (const view of this.views)
      if (view.rendered) renderDiagrams(view.rendered.diagrams, r.classList.contains('is-dark'), () => this.schedule(true), palette);
    this.schedule(true);
  }

  /** Test files and code comments as Reading settings → Review asks: a test plan and notes, or the source. */
  protected applyCodeView(view: View): void {
    const r = view.rendered!;
    for (const button of r.content.querySelectorAll<HTMLElement>('.mr-spec-view-options [data-value]'))
      button.setAttribute('aria-pressed', String(button.dataset.value === this.settings.tests));
    const tests = r.content.classList.contains('mr-spec-file') && this.settings.tests === 'source';
    const comments = tests || this.settings.codeComments === 'source';
    const state = `${tests} ${comments}`;
    if (r.content.dataset.mrView === state) return;
    r.content.dataset.mrView = state;
    r.content.classList.toggle('is-spec-source', tests);
    showCommentSource(r, comments);
  }

  /**
   * Text size for the whole reading surface, and for Fit to screen the scale of the whole composition:
   * the balanced layout as drawn for a 1440px window, grown with wider windows up to one and a half times.
   */
  protected applyFit(): void {
    const { layout, size } = this.settings;
    const fit = layout === 'fit' ? Math.round(Math.min(1.5, Math.max(1, this.root.clientWidth / 1440)) * 100) / 100 : 1;
    const text = TEXT_SIZES[size] ?? 20;
    this.root.style.setProperty('--fit', String(fit));
    // The chosen size against the default: titles, bylines, contents and comments grow with the text.
    this.root.style.setProperty('--text-scale', String(Math.round((text / TEXT_SIZES[DEFAULT_SETTINGS.size]) * 1000) / 1000));
    this.root.style.setProperty('--body-size', `${Math.round(text * fit * 10) / 10}px`);
  }

  /** The reading palette as plain colours, so diagrams are drawn in the page's own style. */
  protected palette(): DiagramPalette | undefined {
    const style = getComputedStyle(this.root);
    const palette = Object.fromEntries(PALETTE_KEYS.map((key) => [key, style.getPropertyValue(key === 'code' ? '--code-bg' : `--${key}`).trim()]));
    return isPalette(palette) ? palette : undefined;
  }

  /**
   * A diagram over the whole window: first all of it, as large as the window allows (up to twice the
   * size it was laid out at), then as close as the reader wants to look.
   */
  protected openLightbox(button: HTMLElement): void {
    const source = button.querySelector('img');
    if (!source) return;
    const image = this.el.lightbox.querySelector('img')!;
    image.src = source.src;
    image.alt = source.alt;
    this.diagramView.width = source.width || source.naturalWidth || 600;
    this.diagramView.height = source.height || source.naturalHeight || 400;
    this.el.lightbox.hidden = false;
    this.zoomFrom = button;
    this.fitDiagram();
    this.el.lightbox.querySelector<HTMLElement>('.mr-lightbox-close')!.focus({ preventScroll: true });
  }

  protected stage(): HTMLElement {
    return this.el.lightbox.querySelector<HTMLElement>('.mr-lightbox-stage')!;
  }

  /** The space the diagram can use: the stage, less a margin and the zoom bar along its bottom. */
  protected stageRoom(): { width: number; height: number } {
    const stage = this.stage();
    return { width: stage.clientWidth, height: stage.clientHeight - ZOOM_BAR };
  }

  /** Smallest and largest scale: never smaller than the whole diagram in view, and up to four times its size. */
  protected zoomLimits(): [number, number] {
    const fit = this.diagramView.fit;
    return [Math.min(fit, 1), Math.max(4, fit * 2)];
  }

  protected fitDiagram(): void {
    const view = this.diagramView;
    const room = this.stageRoom();
    view.fit = Math.min((room.width - 2 * ZOOM_MARGIN) / view.width, (room.height - 2 * ZOOM_MARGIN) / view.height, 2);
    this.showDiagram(view.fit, 0, 0);
  }

  /** Draw the diagram at `scale` with its corner at (x, y): centred on an axis where it fits, kept in reach where it does not. */
  protected showDiagram(scale: number, x: number, y: number): void {
    const view = this.diagramView;
    const room = this.stageRoom();
    const width = view.width * scale,
      height = view.height * scale;
    const place = (offset: number, size: number, space: number) =>
      size + 2 * ZOOM_MARGIN <= space ? (space - size) / 2 : Math.min(ZOOM_MARGIN, Math.max(space - size - ZOOM_MARGIN, offset));
    Object.assign(view, { scale, x: place(x, width, room.width), y: place(y, height, room.height) });
    // Sizing the image, not scaling it, keeps the drawing sharp at every zoom.
    const image = this.el.lightbox.querySelector('img')!;
    image.style.width = `${Math.round(width)}px`;
    image.style.height = `${Math.round(height)}px`;
    image.style.transform = `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px)`;
    const [min, max] = this.zoomLimits();
    this.el.lightbox.querySelector('.mr-zoom-level')!.textContent = `${Math.round(scale * 100)}%`;
    this.el.lightbox.querySelector<HTMLButtonElement>('[data-act="zoom-out"]')!.disabled = scale <= min + 0.001;
    this.el.lightbox.querySelector<HTMLButtonElement>('[data-act="zoom-in"]')!.disabled = scale >= max - 0.001;
    this.stage().classList.toggle('is-movable', width + 2 * ZOOM_MARGIN > room.width || height + 2 * ZOOM_MARGIN > room.height);
  }

  /** Zoom by `factor`, keeping the point under (px, py) in place: the pointer, or the middle of the stage. */
  protected zoomDiagram(factor: number, px = this.stageRoom().width / 2, py = this.stageRoom().height / 2): void {
    const view = this.diagramView;
    const [min, max] = this.zoomLimits();
    const scale = Math.min(max, Math.max(min, view.scale * factor));
    const k = scale / view.scale;
    this.showDiagram(scale, px - (px - view.x) * k, py - (py - view.y) * k);
  }

  protected moveDiagram(dx: number, dy: number): void {
    const view = this.diagramView;
    this.showDiagram(view.scale, view.x + dx, view.y + dy);
  }

  protected closeLightbox(): boolean {
    if (this.el.lightbox.hidden) return false;
    this.el.lightbox.hidden = true;
    this.pointers.clear();
    this.el.lightbox.querySelector('img')!.removeAttribute('src');
    this.zoomFrom?.focus({ preventScroll: true });
    this.zoomFrom = null;
    return true;
  }
}
