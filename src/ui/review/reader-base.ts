import { ChapterContext, type ReviewDocs } from '../../core/review-context.ts';
import { chapterContext } from '../components/chapter-context.ts';
import type { DocContents, DocRef, RepositorySource, ReviewOverview, ReviewSource, CommentTarget, Thread } from '../../platforms/types.ts';
import { ChapterMap, type ChapterFileState } from './chapters.ts';
import { ReviewLibrary, type DocOpening } from './review-library.ts';
import { MoveFinder } from './moves.ts';
import type { DiagramPalette } from '../rendering/diagram-palette.ts';
import { h, glyph, markup } from '../components/dom.ts';
import type { RepoReaderHandle } from '../library/repo-reader.ts';
import { icons } from '../components/icons.ts';
import css from '../components/reader-styles.ts';
import { loadReaderFonts } from '../components/fonts.ts';
import type { RenderedBlock, RenderedDoc } from '../rendering/render.ts';
import { ReviewSearch, type SearchMatch, type SearchScope, type SearchTarget } from './search.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../preferences/settings.ts';
import { PaletteCarousel } from '../components/settings-sheet.ts';
import { type ChipTarget, type Draft, type Editor, type Hit, type ReplyEditor, type SearchAt, TEMPLATE, type View } from './reader-shared.ts';

/** The review reader's state: every field, and the constructor. The layers above it (reader-documents.ts up to reader.ts) add the behaviour, one responsibility each; a method of a higher layer that this one calls is declared abstract at the end. */
export abstract class ReaderBase {
  protected readonly host = document.createElement('div');
  protected readonly shadow = this.host.attachShadow({ mode: 'open' });
  protected readonly root: HTMLElement;
  protected readonly chapters: ChapterMap;
  protected readonly projectContext = new ChapterContext();
  /** The repository behind the review, as the change leaves it, and what has been read of it for the sheet. */
  protected repository: RepositorySource | null = null;
  protected reviewDocs: ReviewDocs | null = null;
  /** The project library in the review's sheet, beside Chapters. */
  protected readonly library: ReviewLibrary;
  protected readonly palettes = new PaletteCarousel(this.shadow);
  protected chapterOrder: DocRef[] | null = null;
  protected readonly el: Record<
    | 'progress'
    | 'topbar'
    | 'fileBtn'
    | 'fileName'
    | 'fileStatus'
    | 'viewed'
    | 'viewedFeedback'
    | 'fileCount'
    | 'files'
    | 'settings'
    | 'toc'
    | 'article'
    | 'gutter'
    | 'doc'
    | 'pill'
    | 'pillLabel'
    | 'chip'
    | 'toast'
    | 'resume'
    | 'empty'
    | 'lightbox',
    HTMLElement
  >;
  protected settings: Settings = { ...DEFAULT_SETTINGS };
  protected source: ReviewSource | null = null;
  protected index = 0;
  protected readonly loading = new Set<DocRef>();
  protected readonly cache = new Map<DocRef, Promise<DocContents>>();
  /** Both versions of each loaded file: search reads files folded before they render. */
  protected readonly contentsOf = new Map<DocRef, DocContents>();
  protected readonly search: ReviewSearch<SearchAt>;
  /** Watches the element holding the marked search result, to mark it again when its text is redrawn. */
  protected found: MutationObserver | null = null;
  protected rendered: RenderedDoc | null = null;
  protected headings: Array<{ el: HTMLElement; link: HTMLElement }> = [];
  protected markTargets: HTMLElement[] = [];
  /** The pull or merge request's description, the first document when the reader asks for it. */
  protected overview: HTMLElement | null = null;
  protected lastStep: { el: HTMLElement; at: number } | null = null;
  protected views: View[] = [];
  protected readonly viewByDoc = new Map<DocRef, View>();
  protected readonly viewed = new Map<DocRef, { value: boolean; ready: boolean; busy: boolean; key?: string; error?: string }>();
  protected drawerFocus: HTMLElement | null = null;
  protected zoomFrom: HTMLElement | null = null;
  /** The enlarged diagram: its laid-out size, the scale that fits the window, and what is in view. */
  protected readonly diagramView = { width: 0, height: 0, fit: 1, scale: 1, x: 0, y: 0 };
  /** Pointers on the enlarged diagram: one drags it, two pinch it. */
  protected readonly pointers = new Map<number, { x: number; y: number }>();
  protected dragged = false;
  protected readonly blockOf = new WeakMap<Element, { view: View; block: RenderedBlock }>();
  protected hover: Hit | null = null;
  /** Where the pointer last was on the hovered block: the corner of the path to its comment control. */
  protected aim: { x: number; y: number } | null = null;
  protected aimTimer = 0;
  /** Text marked because the pointer is on its card or on the comment control. */
  protected linked: HTMLElement | null = null;
  protected readonly commentBtn = h('button', 'mr-comment-btn');
  protected chipTarget: ChipTarget | null = null;
  protected threads: Thread[] = [];
  protected readonly ownThreads = new WeakSet<Thread>();
  protected readonly threadByCard = new WeakMap<Element, Thread>();
  protected readonly replyEditors = new Map<Thread, ReplyEditor>();
  protected readonly editorOf = new WeakMap<Element, Editor>();
  protected drafts: Draft[] = [];
  protected readonly moves = new MoveFinder();
  /** The files in the platform's order; `views` follow the File order setting. */
  protected listed: DocRef[] = [];
  protected orderedBy: Settings['order'] | null = null;
  protected resumeAt: { view: View; offset: number } | null = null;
  protected positionTimer = 0;
  /** The card the comments column is arranged around: the one being written in, or the last one used. */
  protected active: HTMLElement | null = null;
  protected threadEls: Array<{ view: View; card: HTMLElement; anchor: HTMLElement }> = [];
  protected readonly rail = h('div', 'mr-threads');
  protected toastTimer = 0;
  protected editorCount = 0;
  protected frame = 0;
  protected needLayout = false;
  protected closed = false;
  /** The repository's docs, opened over the review from Project library; the review waits underneath, as it was. */
  protected layer: RepoReaderHandle | null = null;
  protected readonly dark = matchMedia('(prefers-color-scheme: dark)');
  protected readonly resize = new ResizeObserver(() => {
    this.fitWidth();
    this.schedule(true);
  });
  protected readonly prevOverflow: string;
  protected readonly prevFocus: Element | null;

  constructor(protected readonly onClose?: () => void) {
    loadReaderFonts(document);
    this.host.id = __GALLEY_DEV__ ? 'galley-reader-dev' : 'galley-reader';
    this.shadow.replaceChildren(markup(`<style>${css}</style>${TEMPLATE}`));
    const q = (sel: string) => this.shadow.querySelector<HTMLElement>(sel)!;
    this.root = q('.mr-root');
    this.el = {
      progress: q('.mr-progress > div'),
      topbar: q('.mr-topbar'),
      fileBtn: q('.mr-file-btn'),
      fileName: q('.mr-file-btn .mr-file-name'),
      fileStatus: q('.mr-file-btn .mr-status-dot'),
      viewed: q('.mr-viewed'),
      viewedFeedback: q('.mr-viewed-feedback'),
      fileCount: q('.mr-file-btn .mr-count'),
      files: q('.mr-files'),
      settings: q('.mr-settings'),
      toc: q('.mr-toc'),
      article: q('.mr-article'),
      gutter: q('.mr-gutter'),
      doc: q('.mr-doc'),
      pill: q('.mr-pill'),
      pillLabel: q('.mr-pill-label'),
      chip: q('.mr-select-chip'),
      toast: q('.mr-toast'),
      resume: q('.mr-resume'),
      empty: q('.mr-empty-reader'),
      lightbox: q('.mr-lightbox'),
    };
    this.chapters = new ChapterMap({
      root: this.root,
      toggle: q('.mr-chapters-toggle') as HTMLButtonElement,
      mount: this.el.doc,
      beforeOpen: () => this.closeMenus(),
      // The text, its contents and the top bar slide with the sheet instead of jumping to their new places.
      parts: () => this.root.querySelectorAll<HTMLElement>('.mr-article, .mr-toc, .mr-tb-center, .mr-tb-right'),
      reflow: (change) => this.reflow(change),
      navigate: (doc) => this.showChapterFile(doc),
      resume: () => this.root.focus({ preventScroll: true }),
      reorder: (docs) => this.reorderChapters(docs),
      state: (doc) => this.chapterState(doc),
      diffUrl: () => this.source!.diffUrl,
      library: () => this.library.showList(),
      shown: () => this.library.atChapters(),
      projectContext: (chapter) => {
        if (!this.source?.project) return null;
        return chapterContext({
          chapter: { id: chapter.id, paths: chapter.files.map((doc) => doc.path) },
          context: this.projectContext,
          canContinue: chapter.files.some((doc) => !this.chapterState(doc).unsupported),
          status: this.library.more() ? this.library.status() : null,
          // Each document opens on top, beside the review; Back or Esc returns to the chapter.
          open: (target) => this.library.showDoc(target),
          remove: (attachment) => {
            this.projectContext.remove(attachment);
            this.chapters.redraw();
          },
        });
      },
      linked: (chapter) => {
        const snapshot = this.projectContext.snapshot;
        if (!snapshot) return null;
        return new Set(chapter.files.flatMap((doc) => snapshot.related.get(doc.path)!.map((related) => related.path))).size;
      },
    });
    const head = () => this.source!.project!.head;
    this.library = new ReviewLibrary({
      root: this.root,
      show: (content) => this.chapters.showPage(content),
      push: (content) => this.chapters.push(content),
      docs: () => this.docs(),
      source: () => this.repo(),
      get head() {
        return head();
      },
      context: this.projectContext,
      images: () => this.settings.images,
      dark: () => this.root.classList.contains('is-dark'),
      palette: () => this.palette(),
      full: (opener, at) => this.openProject(opener, at),
    });
    this.search = new ReviewSearch<SearchAt>({
      root: this.root,
      toggle: q('[data-act="search"]') as HTMLButtonElement,
      beforeOpen: () => this.closeMenus(),
      targets: () => this.searchTargets(),
      scope: () => this.searchScope(),
      reveal: (match) => this.revealMatch(match),
      remember: () => this.rememberPlace(),
      forget: () => this.unmark(),
      showCode: () => this.update({ codeFiles: true }),
    });
    this.commentBtn.type = 'button';
    this.commentBtn.dataset.act = 'comment-block';
    this.commentBtn.replaceChildren(glyph(icons.comment));
    this.commentBtn.append(h('span', 'mr-comment-btn-label', 'Comment'));
    this.commentBtn.hidden = true;
    this.rail.setAttribute('aria-label', 'Review comments');
    this.el.article.prepend(this.rail, this.commentBtn);
    q('.mr-tb-right').prepend(this.el.pill);
    this.root.addEventListener('mouseup', (e) => this.captureSelection(e));
    this.el.doc.addEventListener('pointerover', (e) => this.onHover(e.target as Element, e));
    this.el.doc.addEventListener('focusin', (e) => this.onHover(e.target as Element));
    this.root.addEventListener('pointermove', (e) => this.trackPointer(e), { passive: true });
    this.root.addEventListener('pointerleave', () => this.clearHover());
    this.root.addEventListener('pointerover', (e) => this.linkCard(e.target as Element));
    this.root.addEventListener('focusin', (e) => this.onFocusIn(e.target as Element));
    this.el.doc.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') {
        // Shadow DOM retargets the event after dispatch; retain the actual paragraph for the deferred tap.
        const node = e.target as Element;
        setTimeout(() => this.onTap(e, node), 0);
      }
    });
    document.addEventListener('selectionchange', this.onSelectionChange);
    this.el.doc.replaceChildren(this.skeleton());

    this.prevOverflow = document.documentElement.style.overflow;
    this.prevFocus = document.activeElement;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.append(this.host);
    this.root.focus({ preventScroll: true });

    this.root.addEventListener('click', (e) => this.onClick(e));
    const stage = this.stage();
    stage.addEventListener('wheel', this.onStageWheel, { passive: false });
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) stage.addEventListener(type, this.onStagePointer);
    // A drag that ends on the backdrop is not a click on it.
    stage.addEventListener(
      'click',
      (e) => {
        if (this.dragged) e.stopPropagation();
        this.dragged = false;
      },
      true,
    );
    stage.querySelector('img')!.addEventListener('dblclick', (e) => {
      const box = stage.getBoundingClientRect();
      this.zoomDiagram(2, e.clientX - box.left, e.clientY - box.top);
    });
    this.shadow.querySelector('.mr-palette-track')!.addEventListener('scroll', () => this.palettes.update(), { passive: true });
    this.shadow.querySelector<HTMLSelectElement>('#mr-typeface')!.addEventListener('change', (e) => {
      this.update({ font: (e.target as HTMLSelectElement).value as Settings['font'] });
    });
    this.root.addEventListener('galley:context', () => {
      if (this.rendered) this.buildToc(this.rendered);
      this.schedule(true);
    });
    this.root.addEventListener('galley:code-view', (event) => {
      const view = this.views.find((view) => view.rendered?.content === event.target);
      if (view?.rendered?.content.querySelector('.mr-source-comment')) this.reanchorCodeComments(view);
      this.schedule(true);
    });
    this.root.addEventListener(
      'scroll',
      () => {
        if (!this.el.chip.hidden && !this.chipTarget?.range) this.hideChip();
        this.schedule(false);
        // Only scrolling moves the reader on, so only scrolling is remembered (not layout passes).
        clearTimeout(this.positionTimer);
        this.positionTimer = window.setTimeout(() => {
          this.positionTimer = 0;
          this.rememberPosition();
        }, 800);
      },
      { passive: true },
    );
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, this.shield, true);
    this.dark.addEventListener('change', this.onSchemeChange);
    this.resize.observe(this.root);
    this.resize.observe(this.el.doc);

    this.applySettings();
    void loadSettings().then((s) => {
      this.settings = s;
      this.applySettings();
    });
  }

  protected readonly onSchemeChange = () => this.applySettings();

  /** Wheel and trackpad: scrolling moves the diagram; pinching (or ⌘/Ctrl + scroll) zooms where the pointer is. */
  protected readonly onStageWheel = (e: WheelEvent) => {
    e.preventDefault();
    const box = this.stage().getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) this.zoomDiagram(Math.exp(-e.deltaY / 100), e.clientX - box.left, e.clientY - box.top);
    else this.moveDiagram(-e.deltaX, -e.deltaY);
  };

  protected readonly onStagePointer = (e: PointerEvent) => {
    const stage = this.stage();
    if (e.type === 'pointerdown') {
      stage.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragged = false;
      return;
    }
    if (e.type !== 'pointermove') {
      this.pointers.delete(e.pointerId);
      stage.classList.remove('is-dragging');
      return;
    }
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const next = { x: e.clientX, y: e.clientY };
    const other = [...this.pointers].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      // Two fingers: zoom by how far they moved apart, around the point between them.
      const box = stage.getBoundingClientRect();
      const before = Math.max(1, Math.hypot(last.x - other.x, last.y - other.y));
      this.zoomDiagram(Math.hypot(next.x - other.x, next.y - other.y) / before, (next.x + other.x) / 2 - box.left, (next.y + other.y) / 2 - box.top);
    } else this.moveDiagram(next.x - last.x, next.y - last.y);
    // A press that moved is a drag, not a click on the backdrop.
    if (Math.abs(next.x - last.x) + Math.abs(next.y - last.y) > 2) {
      this.dragged = true;
      stage.classList.add('is-dragging');
    }
    this.pointers.set(e.pointerId, next);
  };

  // ---------------------------------------------------------------- events

  /** Keep the page's own keyboard shortcuts from firing while the reader is open. */
  protected readonly shield = (e: Event) => {
    // The reader is modal: keys reach it when focus is inside it, or when focus fell back to the page body.
    // While the project's docs are open over it, they have the keys.
    const origin = e.target;
    if (this.layer || (origin !== this.host && origin !== document.body && origin !== document.documentElement)) return;
    if (e.type === 'keydown') this.onKey(e as KeyboardEvent);
    if (e.type === 'keyup' && (e as KeyboardEvent).key === 'Shift') {
      const target = e.composedPath()[0];
      if (!(target instanceof Element && target.closest('.mr-composer, .mr-thread'))) this.captureSelection();
    }
    e.stopPropagation();
  };

  protected readonly onSelectionChange = () => {
    if (this.chipTarget?.range && this.shadowSelection()?.isCollapsed) this.hideChip();
  };
  // Methods of the layers above, called from here.
  protected abstract fitWidth(): void;
  protected abstract schedule(layout: boolean): void;
  protected abstract closeMenus(): boolean;
  protected abstract reflow(change: () => void): void;
  protected abstract showChapterFile(doc: DocRef): void;
  protected abstract reorderChapters(order: DocRef[] | null): void;
  protected abstract chapterState(doc: DocRef): ChapterFileState;
  protected abstract docs(): ReviewDocs;
  protected abstract repo(): RepositorySource;
  protected abstract palette(): DiagramPalette | undefined;
  protected abstract openProject(opener: HTMLElement, target?: DocOpening): void;
  protected abstract searchTargets(): Generator<SearchTarget<SearchAt>>;
  protected abstract searchScope(): SearchScope;
  protected abstract revealMatch({ target, start, end }: SearchMatch<SearchAt>): Promise<void>;
  protected abstract rememberPlace(): () => void;
  protected abstract unmark(): void;
  protected abstract update(patch: Partial<Settings>): void;
  protected abstract captureSelection(event?: MouseEvent): void;
  protected abstract onHover(node: Element, e?: Event): void;
  protected abstract trackPointer(e: PointerEvent): void;
  protected abstract clearHover(): void;
  protected abstract linkCard(node: Element): void;
  protected abstract onFocusIn(node: Element): void;
  protected abstract onTap(e: PointerEvent, node: Element): void;
  protected abstract skeleton(): HTMLElement;
  protected abstract onClick(e: MouseEvent): void;
  protected abstract stage(): HTMLElement;
  protected abstract zoomDiagram(factor: number, px?: number, py?: number): void;
  protected abstract buildToc(r: RenderedDoc | null): void;
  protected abstract reanchorCodeComments(view: View): void;
  protected abstract hideChip(): void;
  protected abstract rememberPosition(): void;
  protected abstract applySettings(): void;
  protected abstract showMessage(title: string, body: string, extra?: Node[]): void;
  protected abstract initNativeViewed(): Promise<void>;
  protected abstract renderOverview(overview: ReviewOverview): HTMLElement;
  protected abstract updateFileButton(): void;
  protected abstract loadThreads(): Promise<void>;
  protected abstract initLocalViewed(doc: DocRef, contents: DocContents): Promise<void>;
  protected abstract updateViewed(): void;
  protected abstract applyCodeView(view: View): void;
  protected abstract attachThreads(view: View): void;
  protected abstract foldIfViewed(view: View): void;
  protected abstract scrollToEl(el: Element, line?: number, flash?: boolean, glide?: boolean): void;
  protected abstract moveDiagram(dx: number, dy: number): void;
  protected abstract toast(text: string, url?: string): void;
  protected abstract focusEditor(editor: Editor): void;
  protected abstract onKey(e: KeyboardEvent): void;
  protected abstract editorAt(node: EventTarget | null): Editor | undefined;
  protected abstract closeReply(thread: Thread): void;
  protected abstract closeDraft(draft: Draft): void;
  protected abstract commentHere(): void;
  protected abstract commentOn(hit: Hit): void;
  protected abstract startComment(target: CommentTarget, elements: HTMLElement[], range?: Range): void;
  protected abstract openReply(thread: Thread, index: number): void;
  protected abstract shadowSelection(): Selection | null;
  protected abstract layoutThreads(): void;
  protected abstract cardOf(thread: Thread): HTMLElement | undefined;
}
