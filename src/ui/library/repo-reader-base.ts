import { BlobCache } from '../../core/blob-cache.ts';
import type { ConfigReading, LensName } from '../../core/architecture.ts';
import type { RepoDiscovery } from '../../core/discovery.ts';
import type { ProjectIndex, Corrections } from '../../core/docindex.ts';
import type { AnchorState } from '../../core/notes.ts';
import type { RepositorySource } from '../../platforms/types.ts';
import { loadReaderFonts } from '../components/fonts.ts';
import { button, h, glyph, markup } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { LibraryLayout } from '../components/layout-controls.ts';
import css from '../components/reader-styles.ts';
import type { ProjectNotes } from './project-store.ts';
import type { RenderedDoc } from '../rendering/render.ts';
import type { ConfigState } from './repo-views.ts';
import repoCss from './repo-styles.ts';
import type { Remembered } from './outline-cache.ts';
import { ReadingSequence } from './reading-sequence.ts';
import type { DocumentMap } from './map-view.ts';
import { Sheet } from '../components/sheet.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../preferences/settings.ts';
import { PaletteCarousel } from '../components/settings-sheet.ts';
import { type Place, type ReviewContext, TEMPLATE, type View } from './repo-reader-shared.ts';

/** The repository reader's state: every field, and the constructor. The layers above it (repo-reader-source.ts up to repo-reader.ts) add the behaviour, one responsibility each; a method of a higher layer that this one calls is declared abstract at the end. */
export abstract class RepoReaderBase {
  protected readonly host = document.createElement('div');
  protected readonly shadow = this.host.attachShadow({ mode: 'open' });
  protected readonly root: HTMLElement;
  protected readonly q = <T extends HTMLElement = HTMLElement>(selector: string) => this.shadow.querySelector<T>(selector)!;
  protected settings: Settings = { ...DEFAULT_SETTINGS };
  protected readonly layouts = new LibraryLayout();
  protected readonly sequence = new ReadingSequence();
  protected readingAnchor = '';
  protected source: RepositorySource | null = null;
  protected discovery: Promise<RepoDiscovery> | null = null;
  protected listing: RepoDiscovery | null = null;
  protected index: ProjectIndex | null = null;
  protected readonly corrections: Corrections = { docs: new Map(), folders: new Map() };
  protected readonly cache = new Map<string, Promise<string>>();
  /** Documents read so far by the hash of their content, kept across a refresh: a newer commit reads only what changed (RFC 0074). */
  protected readonly blobs = new BlobCache();
  /** The listing's hash for each document at this snapshot's commit. */
  protected readonly blobOf = new Map<string, string>();
  /** What this device remembers of the project's documents, asked for once and only when the reader allows it (outline-cache.ts). */
  protected remembered: Promise<Map<string, Remembered>> | null = null;
  /** Documents read in this snapshot; those read before the listing arrived join the map as soon as it exists. */
  protected readonly read = new Map<string, string>();
  /** The pass reading documents for the map, while it runs. */
  protected indexing: { cancelled: boolean } | null = null;
  protected readonly unreadable = { failed: new Set<string>(), skipped: new Set<string>() };
  protected history: Place[] = [];
  protected at = -1;
  protected path: string | null = null;
  protected rendered: RenderedDoc | null = null;
  protected view: View = 'read';
  /** The middle of the Documents map: kept while the reader goes off to read, moved only on purpose (ADR 0030). */
  protected focus: string | null = null;
  /** The Documents map, with its own camera and selection; drawn anew for a new commit. */
  protected mapView: DocumentMap | null = null;
  /** The reader's sheets (components/sheet.ts): a place chosen on the Documents map, and one chosen in This review. */
  protected readonly mapSheet: Sheet;
  protected readonly docSheet: Sheet;
  /** This review on the same map, around what the review changes, with its own camera, selection and sheet. */
  protected reviewMap: DocumentMap | null = null;
  /** The map's lens: documents and their links, or what configuration and decision records state. */
  protected lens: 'documents' | LensName = 'documents';
  protected entityFocus: string | null = null;
  /** Configuration read at this snapshot's commit, by path; read only when the reader asks. */
  protected readonly configs = new Map<string, ConfigReading>();
  protected config: { state: ConfigState['state']; read: number; notes: string[]; run: { cancelled: boolean } | null } = {
    state: 'idle',
    read: 0,
    notes: [],
    run: null,
  };
  protected notes: ProjectNotes | null = null;
  /** Notes chosen for export: this session only. */
  protected readonly chosen = new Set<string>();
  protected editing: string | null = null;
  /** The note whose list of things to connect to is open: one at a time, so long lists stay quick. */
  protected connecting: string | null = null;
  protected confirmDelete = false;
  protected anchorStates = new Map<string, AnchorState>();
  protected exportFormat: 'markdown' | 'mermaid' = 'markdown';
  /** The snapshot before a refresh: which documents had been read, and their links, to say what changed. */
  protected previous: { commit: string; read: Set<string>; edges: Set<string> } | null = null;
  /** Paths the review changes, when opened from one. */
  protected readonly changed: Set<string>;
  protected search = '';
  /** The map reads its first batch by itself once; after that, only when the reader asks. */
  protected indexedOnce = false;
  protected toastTimer = 0;
  protected readonly palettes = new PaletteCarousel(this.shadow);
  /** The control that opened the sheet that is open, to give focus back to: found again, as a view may be drawn anew. */
  protected sheetOpener = '';
  protected closed = false;
  protected readonly dark = matchMedia('(prefers-color-scheme: dark)');
  protected readonly prevOverflow: string;
  protected readonly prevFocus: Element | null;

  constructor(
    protected readonly onClose: ((action?: 'continue') => void) | undefined,
    protected readonly review: ReviewContext | null,
  ) {
    this.changed = new Set(review?.chapters.flatMap((chapter) => chapter.paths));
    loadReaderFonts(document);
    this.host.id = __GALLEY_DEV__ ? 'galley-repo-reader-dev' : 'galley-repo-reader';
    this.shadow.replaceChildren(markup(`<style>${css}${repoCss}</style>${TEMPLATE}`));
    this.root = this.q('.mr-root');
    // Both maps' details sheets look the same (mr-map-sheet); each is told apart by its own class.
    const sheet = (className: string, closeLabel: string, dismiss: () => void) => {
      const made = new Sheet({
        root: this.root,
        className,
        closeLabel,
        parts: () => this.slidingParts(),
        background: () => this.root.querySelectorAll<HTMLElement>('.mr-topbar, .mr-main'),
        dismiss,
      });
      made.element.classList.add('mr-map-sheet');
      return made;
    };
    this.mapSheet = sheet('mr-pm-sheet', 'Close details', () => this.mapView!.closeSheet());
    this.docSheet = sheet('mr-doc-sheet', 'Close details', () => this.reviewMap!.closeSheet());
    this.q('.mr-doc').append(this.skeleton());
    this.prevOverflow = document.documentElement.style.overflow;
    this.prevFocus = document.activeElement;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.append(this.host);
    this.root.focus({ preventScroll: true });
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
    this.root.addEventListener('submit', (e) => this.onSubmit(e));
    if (review) {
      // Opened over a review, the way back to it leads the top bar, in place of Close and the wordmark.
      this.root.classList.add('is-over-review');
      this.q('[data-view="review"]').hidden = false;
      this.q('[data-view="chapters"]').hidden = true;
      const chapter = review.chapters.find((chapter) => chapter.id !== undefined && chapter.id === review.entry?.chapter);
      const back = button('', 'close', 'mr-btn mr-repo-return');
      back.replaceChildren(glyph(icons.chevronLeft));
      back.append(h('span', 'mr-label-long', 'Return to review'), h('span', 'mr-label-short', 'Review'));
      back.setAttribute('aria-label', 'Return to review (Esc)');
      back.title = `Back to ${chapter ? chapter.title : review.title} in the review (Esc)`;
      // Opened from a chapter, reading here can carry on with that chapter: said once above the document.
      if (chapter) this.q('.mr-repo-read').prepend(this.continueBar(chapter.title, review.entry!.canContinue));
      this.q('.mr-tb-left > [data-act="close"]').replaceWith(back);
    }
    // Phones put view choices in the document menu, leaving the top bar for the reading title.
    const views = this.q('.mr-repo-views').cloneNode(true) as HTMLElement;
    views.className = 'mr-seg mr-repo-menu-views';
    views.hidden = false;
    views.setAttribute('aria-label', 'Library view');
    this.q('.mr-repo-docs').prepend(views);
    this.root.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.q('.mr-palette-track').addEventListener('scroll', () => this.palettes.update(), { passive: true });
    this.q('.mr-repo-search').addEventListener('input', (e) => {
      this.search = (e.target as HTMLInputElement).value;
      this.buildOutline();
    });
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, this.shield, true);
    this.dark.addEventListener('change', this.onSchemeChange);
    this.applySettings();
    void loadSettings().then((settings) => {
      this.settings = settings;
      this.applySettings();
    });
  }

  protected readonly shield = (e: Event) => {
    // The reader is modal: keys reach it when focus is inside it, or when focus fell back to the page body.
    const origin = e.target;
    if (origin !== this.host && origin !== document.body && origin !== document.documentElement) return;
    if (e.type === 'keydown') this.onKey(e as KeyboardEvent);
    e.stopPropagation();
  };

  protected readonly onSchemeChange = () => this.applySettings();
  // Methods of the layers above, called from here.
  protected abstract slidingParts(): NodeListOf<HTMLElement>;
  protected abstract skeleton(): HTMLElement;
  protected abstract onClick(e: MouseEvent): void;
  protected abstract onChange(e: Event): void;
  protected abstract onSubmit(e: SubmitEvent): void;
  protected abstract continueBar(title: string, enabled: boolean): HTMLElement;
  protected abstract onScroll(): void;
  protected abstract buildOutline(): void;
  protected abstract applySettings(): void;
  protected abstract applyCorrections(): void;
  protected abstract redraw(): void;
  protected abstract checkAnchors(): Promise<void>;
  protected abstract open(
    path: string,
    options?: {
      anchor?: string;
      line?: number;
      push?: boolean;
      place?: Place;
    },
  ): Promise<void>;
  protected abstract autoIndex(): void;
  protected abstract showReview(): Promise<void>;
  protected abstract message(title: string, body: string, extra?: Node[]): void;
  protected abstract publishContext(): Map<string, import('../../core/review-context.ts').ReviewRelated[]>;
  protected abstract updateBacklinks(): void;
  protected abstract toast(text: string): void;
  protected abstract updateSequence(): void;
  protected abstract showMap(focus?: string | null): Promise<void>;
  protected abstract showSequence(): void;
  protected abstract drawNotes(): void;
  protected abstract setView(view: View): void;
  protected abstract drawDiagrams(): void;
  protected abstract closeMenus(): boolean;
  protected abstract drawReview(): void;
  protected abstract drawLens(lens: LensName): void;
  protected abstract sinceRefresh(): HTMLElement | null;
  protected abstract openSheet(sheet: HTMLElement, opener: string): void;
  protected abstract onKey(e: KeyboardEvent): void;
}
