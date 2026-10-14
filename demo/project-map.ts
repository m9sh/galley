// Issue #68's layout spike is demo-only while ADR 0030 is Proposed. The extension's Map is unchanged.
import { indexDocument, KIND_SOURCES, ProjectIndex } from '../src/core/docindex.ts';
import {
  documentMap,
  MAP_NEIGHBOUR_LIMIT,
  MapPlacement,
  type MapConnection,
  type MapPlace,
  type MapPosition,
  type MapProof,
  type ProjectMapModel,
} from '../src/core/project-map.ts';
import type { RepositorySource } from '../src/platforms/types.ts';
import { button, chip, h } from '../src/ui/components/dom.ts';
import { loadReaderFonts } from '../src/ui/components/fonts.ts';
import { icons } from '../src/ui/components/icons.ts';
import { applyReadingControls, keyGroups, nextTab, PaletteCarousel, READING_SECTIONS, selectTab, settingsSheet } from '../src/ui/components/settings-sheet.ts';
import readerCss from '../src/ui/components/reader-styles.ts';
import { DEFAULT_SETTINGS, loadSettings, TEXT_SIZES, type Settings } from '../src/ui/preferences/settings.ts';
import { renderDocument } from '../src/ui/rendering/render.ts';
import css from './project-map-styles.ts';

const SETTINGS_TABS = ['reading', 'layout', 'keys'];
const SHEET_TABS = ['preview', 'links'] as const;
type SheetTab = (typeof SHEET_TABS)[number];
type Lane = MapPosition['lane'];
const DENSITY_SECTION = `<section class="mr-settings-section" aria-label="Layout">
  <div class="mr-set-row"><span>Density<small>Compact fits more on the screen</small></span><div class="mr-seg" data-setting="density" role="group" aria-label="Density"><button data-value="comfortable">Comfortable</button><button data-value="compact">Compact</button></div></div>
  </section><p class="mr-settings-note">Narrow screens stack the map in one column.</p>`;
/** Below this canvas width the three lanes stack, so an open sheet never forces sideways panning. */
const STACK_BELOW = 720;
/** Phones keep a short neighbourhood; the rest is one tap away in List. */
const PHONE_LANE = 4;
const ZOOM = { min: 0.5, max: 1.5 };
/** The search popup shows the best few; the rest are one choice away in List. */
const RESULT_LIMIT = 8;
const LIST_RESULTS = '*list*';
const SHAPES = {
  search: 'M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM20 20l-4.6-4.6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  panel: 'M4 5h16v14H4zM14.5 5v14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  down: 'M12 5v14M6 13l6 6 6-6',
  read: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
};

/** Separate only identifiers actually written in the title; never invent a record number from its path. */
function cardName(title: string): { label: string | null; name: string } {
  const record = /^(ADR|RFC)\s+(\d+)\s*[:—–-]\s*(\S.*)$/i.exec(title);
  return record ? { label: `${record[1].toUpperCase()} ${record[2]}`, name: record[3] } : { label: null, name: title };
}

/** Bundled line art shares the reader's icon weight; document content never becomes markup. */
function lineIcon(shape: string): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'mr-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', shape);
  icon.append(path);
  return icon;
}

/** An icon-only control always names itself and its shortcut. */
function iconButton(act: string, label: string, title: string, icon: SVGSVGElement | string): HTMLButtonElement {
  const control = button('', act, 'mr-btn mr-icon-btn');
  control.setAttribute('aria-label', label);
  control.title = title;
  if (typeof icon === 'string') {
    // biome-ignore lint/plugin: a bundled reader icon constant, never document content.
    control.innerHTML = icon;
  } else control.append(icon);
  return control;
}

/** Shape distinguishes type without borrowing the colours reserved for edits, focus and selection. */
function typeIcon(kind: string): SVGSVGElement {
  const shapes: Record<string, string> = {
    Overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    Spec: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
    Decision: 'M12 3l9 9-9 9-9-9zM8 12h8',
    Architecture: 'M8 3h8v6H8zM3 15h6v6H3zM15 15h6v6h-6zM12 9v3M6 15v-3h12v3',
    Runbook: 'M5 5h14v14H5zM8 9l3 3-3 3M13 15h3',
    Guide: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
    Document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  };
  return lineIcon(shapes[kind]);
}

function placeBadge(kind: string, label: string | null): HTMLElement {
  const badge = h('small', 'mr-atlas-type', label ?? kind);
  badge.prepend(typeIcon(kind));
  return badge;
}

/** How well a document matches the typed words: a word at the start of the title counts most, then a word
 * start inside it, then anywhere in it, then the path. Every word must match somewhere; -1 when one does not. */
function matchScore(place: MapPlace, words: string[]): number {
  const title = place.title.toLowerCase();
  const path = place.path.toLowerCase();
  let score = 0;
  for (const word of words) {
    const at = title.indexOf(word);
    const inPath = path.indexOf(word);
    if (at < 0 && inPath < 0) return -1;
    if (at === 0) score += 100;
    else if (at > 0) score += /[^\p{L}\p{N}]/u.test(title[at - 1]) ? 60 : 30;
    else score += /[^\p{L}\p{N}]/u.test(path[inPath - 1] ?? '/') ? 15 : 5;
  }
  return score;
}

const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Matched words are marked; the text stays text. */
function highlight(text: string, query: string): Array<Node | string> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const word of searchWords(query)) {
    const at = lower.indexOf(word);
    if (at >= 0) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  const parts: Array<Node | string> = [];
  let from = 0;
  for (const [start, end] of merged) {
    if (start > from) parts.push(text.slice(from, start));
    parts.push(h('mark', '', text.slice(start, end)));
    from = end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** Try the real document index and safe renderer, without introducing a second provider or storage model. */
export async function openMapPrototype(source: RepositorySource, fixture = 'small'): Promise<void> {
  document.querySelector('#galley-map-prototype')?.dispatchEvent(new Event('close-prototype'));
  const host = h('div');
  host.id = 'galley-map-prototype';
  const shadow = host.attachShadow({ mode: 'open' });
  const styles = h('style', '', readerCss + css);
  const root = h('div', 'mr-root mr-atlas mode-clean no-top-glow is-waiting');
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Project map prototype');

  // One bar: where you are on the left, finding in the middle, how to look on the right.
  const top = h('header', 'mr-topbar mr-atlas-chrome');
  const left = h('div', 'mr-tb-left');
  // Reading a document puts the way back where the reader looks for it: first in the bar, beside where they are.
  const back = button('Back to map', 'return', 'mr-btn mr-atlas-back');
  back.title = 'Back to map (Esc)';
  back.hidden = true;
  // biome-ignore lint/plugin: a bundled reader icon constant, never document content.
  back.insertAdjacentHTML('afterbegin', icons.chevronLeft);
  const reading = h('span', 'mr-atlas-reading');
  reading.hidden = true;
  left.append(
    iconButton('close', 'Close prototype', 'Close prototype (Esc)', icons.close),
    back,
    h('span', 'mr-brand', 'galley'),
    h('span', 'mr-atlas-crumb', '/'),
    h('h1', 'mr-atlas-title', source.name),
    reading,
  );
  const center = h('div', 'mr-tb-center');
  // A combobox: results appear in a popup under the field and never replace the Map.
  const find = h('div', 'mr-atlas-search');
  const search = h('input');
  search.type = 'search';
  search.placeholder = 'Find a document…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-label', 'Find a document');
  search.setAttribute('aria-keyshortcuts', '/');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-controls', 'mr-atlas-results-list');
  const slash = h('kbd', '', '/');
  slash.setAttribute('aria-hidden', 'true');
  const results = h('div', 'mr-atlas-results');
  results.hidden = true;
  const options = h('div', 'mr-atlas-results-list');
  options.id = 'mr-atlas-results-list';
  options.setAttribute('role', 'listbox');
  options.setAttribute('aria-label', 'Documents');
  const empty = h('p', 'mr-atlas-results-empty');
  empty.setAttribute('role', 'status');
  results.append(options, empty);
  find.append(lineIcon(SHAPES.search), search, slash, results);
  center.append(find);
  const right = h('div', 'mr-tb-right');
  const choices = h('div', 'mr-seg mr-atlas-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Map presentation');
  for (const [action, label, title] of [
    ['map', 'Map', 'Places and the links between them'],
    ['list', 'List', 'Every document, by folder'],
  ]) {
    const choice = button('', action, '');
    choice.title = title;
    if (action === 'map') {
      const icon = h('span', 'mr-atlas-choice-icon');
      // biome-ignore lint/plugin: a bundled reader icon constant, never document content.
      icon.innerHTML = icons.map;
      choice.append(icon);
    } else choice.append(lineIcon(SHAPES.list));
    choice.append(h('span', '', label));
    choices.append(choice);
  }
  const details = iconButton('details', 'Details', 'Details', lineIcon(SHAPES.panel));
  details.setAttribute('aria-expanded', 'false');
  details.setAttribute('aria-controls', 'mr-atlas-detail');
  const settingsButton = iconButton('settings', 'Reading settings', 'Reading settings (,)', icons.settings);
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  settingsButton.setAttribute('aria-expanded', 'false');
  right.append(choices, details, settingsButton);
  top.append(left, center, right);

  const mapView = h('section', 'mr-atlas-map-view');
  mapView.setAttribute('aria-label', 'Places and connections');
  const canvas = h('div', 'mr-atlas-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Map canvas: arrow keys pan, plus and minus zoom, zero fits the map');
  canvas.append(h('div', 'mr-atlas-world'));
  const controls = h('div', 'mr-atlas-controls');
  const zoom = h('div', 'mr-atlas-zoom');
  zoom.setAttribute('role', 'group');
  zoom.setAttribute('aria-label', 'Zoom');
  zoom.append(
    iconButton('zoom-out', 'Zoom out', 'Zoom out (−)', icons.minus),
    iconButton('zoom-in', 'Zoom in', 'Zoom in (+)', icons.plus),
    iconButton('fit', 'Fit map', 'Fit map (0)', lineIcon(SHAPES.fit)),
  );
  const home = button('Back to my place', 'home', 'mr-btn mr-atlas-home');
  home.prepend(lineIcon(SHAPES.locate));
  controls.append(zoom, home);
  const status = h('p', 'mr-atlas-status', 'Reading the demo documents…');
  status.setAttribute('role', 'status');
  const info = h('div', 'mr-atlas-info');
  info.append(status, h('p', 'mr-atlas-footer', 'Prototype · #68 · Lines are links written in the documents. Select one to see its source.'));
  const list = h('div', 'mr-atlas-list');
  list.hidden = true;
  mapView.append(canvas, controls, info, list);
  const article = h('article', 'mr-atlas-article');
  article.hidden = true;
  const backdrop = button('Close details', 'close-details', 'mr-atlas-backdrop');
  backdrop.hidden = true;
  // A push sheet: on wider screens it takes a column beside the Map instead of covering it.
  const detail = h('aside', 'mr-atlas-detail');
  detail.id = 'mr-atlas-detail';
  detail.setAttribute('aria-label', 'Selected document');
  const shell = h('div', 'mr-atlas-shell');
  shell.append(mapView, article, backdrop, detail);
  const sheet = h('div');
  // biome-ignore lint/plugin: shared settings compose only bundled controls, copy and icons; no document content.
  sheet.innerHTML = settingsSheet('Your reading preferences. Changes stay with this prototype.', [
    { id: 'reading', label: 'Reading', icon: icons.book, panel: READING_SECTIONS },
    { id: 'layout', label: 'Layout', icon: icons.layout, panel: DENSITY_SECTION },
    {
      id: 'keys',
      label: 'Keys',
      icon: icons.keyboard,
      panel: keyGroups([
        [
          'Map',
          [
            [['/'], 'Find a document'],
            [['↑', '↓', 'Enter'], 'Choose a search result'],
            [['←', '↑', '→', '↓'], 'Pan the focused canvas'],
            [['+', '−'], 'Zoom the focused canvas'],
            [['0'], 'Fit the map to the canvas'],
            [['←', '→'], 'Switch Links and Preview in the details sheet'],
          ],
        ],
        [
          'Settings',
          [
            [[','], 'Open reading settings'],
            [['?'], 'Show shortcuts'],
            [['Esc'], 'Close the innermost panel, then the prototype'],
          ],
        ],
      ]),
    },
  ]);
  root.append(top, shell, sheet.firstElementChild!);
  shadow.append(styles, root);
  document.body.append(host);
  loadReaderFonts(document);
  root.focus();
  const settings = { ...DEFAULT_SETTINGS, ...(await loadSettings()) };
  let closed = false;
  const closeWaiting = () => {
    closed = true;
    host.remove();
  };
  const closeLoading = (event: MouseEvent) => {
    if ((event.target as Element).closest('[data-act="close"]')) closeWaiting();
  };
  const closeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWaiting();
    }
  };
  host.addEventListener('close-prototype', closeWaiting);
  root.addEventListener('keydown', closeKey);
  root.addEventListener('click', closeLoading);
  const texts = new Map<string, string>();
  try {
    const listing = await source.discover();
    const paths = listing.docs.map((doc) => doc.path);
    // Additional fixtures are bundled demo data, never repository discovery or provider reads.
    if (fixture !== 'small') {
      for (let i = 0; i < (fixture === 'dense' ? 300 : 30); i++) {
        const path = `docs/synthetic/${String(i).padStart(3, '0')}.md`;
        paths.push(path);
        texts.set(
          path,
          `# Demo place ${i}\n\n${fixture === 'sparse' ? '' : '[Architecture](../architecture/overview.md)'}\n\n${fixture === 'dense' ? '[Next](000.md)' : ''}`,
        );
      }
    }
    const index = new ProjectIndex(paths);
    await Promise.all(
      listing.docs.map(async (doc) => {
        const text = await source.load(doc.path);
        texts.set(doc.path, text);
        if (fixture !== 'partial' || doc.path === 'README.md' || doc.path === 'docs/architecture/overview.md') index.add(indexDocument(doc.path, text));
      }),
    );
    if (closed) return;
    for (const [path, text] of texts) if (path.startsWith('docs/synthetic/')) index.add(indexDocument(path, text));
    const model = documentMap(index, { docs: new Map(), folders: new Map() });
    host.removeEventListener('close-prototype', closeWaiting);
    root.removeEventListener('keydown', closeKey);
    root.removeEventListener('click', closeLoading);
    root.classList.remove('is-waiting');
    new Prototype(root, model, index, texts, source, settings, host);
  } catch {
    status.textContent = 'The demo documents could not be read. Close the prototype and reopen it to try again.';
  }
}

class Prototype {
  private readonly layout = new MapPlacement();
  private readonly q = <T extends HTMLElement = HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
  private readonly here: string;
  private readonly places: Map<string, MapPlace>;
  /** Per document, how many indexed documents link to it and how many it links to. */
  private readonly degree = new Map<string, { incoming: number; outgoing: number }>();
  private focus: string;
  private selected: string;
  private connection: MapConnection | null = null;
  private tab: SheetTab = 'preview';
  private previewScroll = { path: '', top: 0 };
  private view: 'map' | 'list' = 'map';
  /** List shows only documents matching this when the search popup's "See all" sent the reader there. */
  private listQuery = '';
  /** Search results in popup order, and the one the arrow keys have reached. */
  private results: string[] = [];
  private active = -1;
  /** This session's recently selected documents, newest first; kept in memory only. */
  private recent: string[] = [];
  /** History entries this prototype has pushed since the map; Back to map returns through them. */
  private depth = 0;
  /** List shows only the neighbours of this document when a lane's "more" sent the reader there. */
  private near: string | null = null;
  private listLimit = 100;
  private connectionLimit = 12;
  private listScroll = 0;
  private drawVersion = 0;
  private detailsOpen = false;
  private sheetBeforeRead = false;
  private hover: string | null = null;
  private stacked = false;
  private lines: MapConnection[] = [];
  private readonly lanes = new Map<string, Lane>();
  private camera = { x: 0, y: 0, zoom: 1 };
  private drag: { x: number; y: number; left: number; top: number } | null = null;
  private readonly mobile = matchMedia('(max-width: 760px)');
  private readonly dark = matchMedia('(prefers-color-scheme: dark)');
  private readonly onScheme = () => this.applySettings();
  private readonly palettes: PaletteCarousel;
  private readonly observer: ResizeObserver;
  private readonly onMobile = () => {
    this.draw();
    this.fit();
  };
  private readonly onHistory = (event: PopStateEvent) => {
    const depth = (event.state as { atlasDepth?: number } | null)?.atlasDepth;
    if (depth === undefined) return;
    this.depth = depth;
    const path = new URLSearchParams(location.search).get('doc');
    if (path && this.texts.has(path)) this.read(path, undefined, undefined, false);
    else if (!this.q('.mr-atlas-article').hidden) this.showMap();
  };
  private readonly close = () => {
    removeEventListener('popstate', this.onHistory);
    this.observer.disconnect();
    this.mobile.removeEventListener('change', this.onMobile);
    this.dark.removeEventListener('change', this.onScheme);
    this.host.remove();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly model: ProjectMapModel,
    private readonly index: ProjectIndex,
    private readonly texts: Map<string, string>,
    private readonly source: RepositorySource,
    private readonly settings: Settings,
    private readonly host: HTMLElement,
  ) {
    this.places = new Map(model.places.map((place) => [place.id, place]));
    for (const place of model.places) this.degree.set(place.id, { incoming: 0, outgoing: 0 });
    for (const connection of model.connections) {
      this.degree.get(connection.from)!.outgoing++;
      this.degree.get(connection.to)!.incoming++;
    }
    this.here = this.places.has(source.start.path) ? source.start.path : 'docs/architecture/overview.md';
    this.palettes = new PaletteCarousel(root);
    this.focus = this.selected = this.here;
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKey);
    const search = this.q<HTMLInputElement>('.mr-atlas-search input');
    search.addEventListener('input', () => this.drawResults());
    search.addEventListener('focus', () => this.drawResults());
    search.addEventListener('keydown', this.onSearchKey);
    this.q('.mr-atlas-search').addEventListener('focusout', (event) => {
      if (!this.q('.mr-atlas-search').contains(event.relatedTarget as Node | null)) this.closeResults();
    });
    // Choosing a result with the pointer must not take focus from the field first.
    this.q('.mr-atlas-results').addEventListener('pointerdown', (event) => event.preventDefault());
    root.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement;
      if (select.matches('#mr-typeface')) this.update({ font: select.value as Settings['font'] });
    });
    const canvas = this.q('.mr-atlas-canvas');
    canvas.addEventListener('pointerdown', (event) => {
      if (this.stacked || (event.target as Element).closest('button, [data-act]')) return;
      this.drag = { x: event.clientX, y: event.clientY, left: this.camera.x, top: this.camera.y };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.drag) {
        this.camera.x = this.drag.left + event.clientX - this.drag.x;
        this.camera.y = this.drag.top + event.clientY - this.drag.y;
        this.moveCamera();
      }
    });
    for (const name of ['pointerup', 'pointercancel'])
      canvas.addEventListener(name, () => {
        this.drag = null;
      });
    // A trackpad scrolls the map; pinching (reported as ctrl + wheel) zooms where the pointer is.
    canvas.addEventListener(
      'wheel',
      (event) => {
        if (this.stacked) return;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const box = canvas.getBoundingClientRect();
          this.zoomTo(this.camera.zoom * Math.exp(-event.deltaY / 300), { x: event.clientX - box.left, y: event.clientY - box.top });
        } else {
          this.camera.x -= event.deltaX;
          this.camera.y -= event.deltaY;
          this.moveCamera();
        }
      },
      { passive: false },
    );
    // Pointing at or tabbing to a place lights its lines, so its connections read without selecting it.
    const world = this.q('.mr-atlas-world');
    const lightUp = (event: Event) => {
      const id = (event.target as Element).closest<HTMLElement>('.mr-atlas-place')?.dataset.id ?? null;
      if (id !== this.hover) {
        this.hover = id;
        this.markSelection();
      }
    };
    world.addEventListener('pointerover', lightUp);
    world.addEventListener('focusin', lightUp);
    for (const name of ['pointerleave', 'focusout'])
      world.addEventListener(name, () => {
        this.hover = null;
        this.markSelection();
      });
    this.mobile.addEventListener('change', this.onMobile);
    this.dark.addEventListener('change', this.onScheme);
    this.q('.mr-palette-track').addEventListener('scroll', () => this.palettes.update());
    host.addEventListener('close-prototype', this.close);
    // Opening the sheet narrows the canvas; lines follow the cards without rebuilding them, so focus stays put.
    this.observer = new ResizeObserver(() => {
      this.measure();
      this.drawLines();
      this.moveCamera();
    });
    this.observer.observe(canvas);
    addEventListener('popstate', this.onHistory);
    this.applySettings();
    this.draw();
    this.measure();
    this.fit();
    // A link to a document opens it directly; Back to map then shows the map it belongs to.
    const path = new URLSearchParams(location.search).get('doc');
    history.replaceState({ atlasDepth: 0 }, '');
    if (path && this.texts.has(path)) {
      this.selected = path;
      this.read(path, undefined, undefined, false);
    }
  }

  private place(id: string): MapPlace {
    return this.places.get(id)!;
  }

  private title(id: string): string {
    return this.place(id).title;
  }

  private applySettings(): void {
    this.root.dataset.theme = this.settings.theme;
    this.root.dataset.font = this.settings.font;
    this.root.dataset.density = this.settings.density;
    this.root.classList.toggle('is-dark', this.settings.appearance === 'dark' || (this.settings.appearance === 'auto' && this.dark.matches));
    this.root.classList.toggle('no-top-glow', !this.settings.topGlow);
    this.root.style.setProperty('--text-scale', String(TEXT_SIZES[this.settings.size] / 20));
    this.root.style.setProperty('--body-size', `${TEXT_SIZES[this.settings.size]}px`);
    applyReadingControls(this.root, this.settings);
  }

  private update(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    this.applySettings();
    this.draw();
  }

  private openSettings(tab = 'reading'): void {
    const sheet = this.q('.mr-settings');
    sheet.hidden = false;
    selectTab(sheet, tab);
    for (const selector of ['.mr-atlas-chrome', '.mr-atlas-shell']) this.q(selector).inert = true;
    this.q('[data-act="settings"]').setAttribute('aria-expanded', 'true');
    this.palettes.reveal(this.settings.theme);
    this.q('.mr-settings-heading [data-act="close-settings"]').focus();
  }

  private closeSettings(): void {
    this.q('.mr-settings').hidden = true;
    for (const selector of ['.mr-atlas-chrome', '.mr-atlas-shell']) this.q(selector).inert = false;
    this.drawDetail();
    this.q('[data-act="settings"]').setAttribute('aria-expanded', 'false');
    this.q('[data-act="settings"]').focus({ preventScroll: true });
  }

  private draw(): void {
    const unresolved = this.index.problems.length;
    this.q('.mr-atlas-status').textContent =
      `${this.index.docs.size} of ${this.index.listed.length} documents indexed · ${this.source.commit.slice(0, 7)}${unresolved ? ` · ${unresolved} unresolved links` : ''}`;
    this.root.dataset.view = this.view;
    for (const selector of ['.mr-atlas-canvas', '.mr-atlas-controls', '.mr-atlas-info']) this.q(selector).hidden = this.view === 'list';
    this.q('.mr-atlas-list').hidden = this.view !== 'list';
    const reading = !this.q('.mr-atlas-article').hidden;
    for (const choice of this.root.querySelectorAll<HTMLElement>('.mr-atlas-choices button'))
      choice.setAttribute('aria-pressed', String(!reading && choice.dataset.act === this.view));
    this.drawMap();
    this.drawList();
    this.drawDetail();
  }

  /** The canvas decides between three lanes and one stacked column; phones always stack. */
  private measure(): void {
    const canvas = this.q('.mr-atlas-canvas');
    const stacked = this.mobile.matches || (canvas.clientWidth > 0 && canvas.clientWidth < STACK_BELOW);
    if (stacked === this.stacked) return;
    this.stacked = stacked;
    this.root.classList.toggle('is-stacked', stacked);
    if (stacked) this.camera = { x: 0, y: 0, zoom: 1 };
  }

  private placeCard(place: MapPlace, lane?: Lane): HTMLButtonElement {
    const node = button('', 'select', 'mr-atlas-place');
    node.dataset.id = place.id;
    node.dataset.kind = place.kind;
    if (lane) node.dataset.lane = lane;
    node.title = place.title;
    node.setAttribute('aria-label', `${place.title}, ${place.kind}, ${place.path}${place.id === this.here ? ', you are here' : ''}`);
    const name = cardName(place.title);
    node.append(placeBadge(place.kind, name.label), h('strong', '', name.name));
    const caption =
      place.state === 'indexed'
        ? place.folder || 'Project root'
        : place.state === 'not-read'
          ? 'Not indexed yet'
          : place.state === 'failed'
            ? 'Could not be read'
            : 'Too large to read';
    node.append(h('small', 'mr-atlas-card-caption', caption));
    if (place.id === this.here) node.append(h('span', 'mr-atlas-here', 'You are here'));
    return node;
  }

  private drawMap(): void {
    const world = this.q('.mr-atlas-world');
    world.replaceChildren();
    this.lanes.clear();
    this.lines = [];
    if (this.view === 'list') return;
    const version = ++this.drawVersion;
    const neighbourhood = this.layout.neighbourhood(this.model, this.focus, this.mobile.matches ? PHONE_LANE : MAP_NEIGHBOUR_LIMIT);
    this.lines = neighbourhood.connections;
    // MapPlacement puts a document that links both ways in the incoming lane; the counts follow the same rule.
    const incoming = new Set<string>();
    const outgoing = new Set<string>();
    for (const connection of this.model.connections) {
      if (connection.to === this.focus && connection.from !== this.focus) incoming.add(connection.from);
      if (connection.from === this.focus && connection.to !== this.focus) outgoing.add(connection.to);
    }
    for (const id of incoming) outgoing.delete(id);
    const groups: Record<Lane, MapPosition[]> = { incoming: [], here: [], outgoing: [] };
    for (const position of neighbourhood.places) {
      groups[position.lane].push(position);
      this.lanes.set(position.place.id, position.lane);
    }
    const focus = this.place(this.focus);
    for (const lane of ['incoming', 'here', 'outgoing'] as const) {
      const column = h('div', 'mr-atlas-lane');
      column.dataset.lane = lane;
      const total = lane === 'incoming' ? incoming.size : outgoing.size;
      const head = h('h2', 'mr-atlas-lane-head', lane === 'incoming' ? 'Linked from' : lane === 'outgoing' ? 'Links to' : 'In focus');
      if (lane !== 'here') head.append(h('span', '', String(total)));
      const stack = h('div', 'mr-atlas-stack');
      for (const position of groups[lane]) stack.append(this.placeCard(position.place, lane));
      if (lane !== 'here') {
        if (!total)
          stack.append(
            h(
              'p',
              'mr-atlas-lane-empty',
              lane === 'incoming'
                ? 'No indexed documents link here.'
                : focus.state === 'indexed'
                  ? 'No outgoing document links found.'
                  : 'Outgoing links have not been indexed.',
            ),
          );
        const hidden = total - groups[lane].length;
        if (hidden > 0) {
          const more = button(`Show ${hidden} more in List`, 'more', 'mr-btn mr-outline mr-atlas-more');
          more.dataset.lane = lane;
          stack.append(more);
        }
      }
      column.append(head, stack);
      world.append(column);
      // A stacked map reads top to bottom; the arrow says which way the links run between the groups.
      if (lane !== 'outgoing') {
        const flow = h('div', 'mr-atlas-flow');
        flow.setAttribute('aria-hidden', 'true');
        flow.append(lineIcon(SHAPES.down), h('span', '', 'links to'));
        world.append(flow);
      }
    }
    this.markSelection();
    requestAnimationFrame(() => {
      if (version === this.drawVersion) this.drawLines();
    });
  }

  /** Lines leave the side of a card that faces the focus, so direction reads left to right, like the lane headers. */
  private drawLines(): void {
    const world = this.q('.mr-atlas-world');
    world.querySelector('.mr-atlas-lines')?.remove();
    if (this.view !== 'map' || this.stacked || !world.isConnected) return;
    const nodes = new Map([...world.querySelectorAll<HTMLElement>('.mr-atlas-place')].map((node) => [node.dataset.id!, node]));
    const box = (id: string) => {
      const node = nodes.get(id)!;
      return {
        l: node.offsetLeft,
        r: node.offsetLeft + node.offsetWidth,
        t: node.offsetTop,
        b: node.offsetTop + node.offsetHeight,
        y: node.offsetTop + node.offsetHeight / 2,
      };
    };
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('mr-atlas-lines');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', String(world.scrollWidth));
    svg.setAttribute('height', String(world.scrollHeight));
    const focus = box(this.focus);
    // Around the focus means around its lane heading too.
    const above = (nodes.get(this.focus)!.closest<HTMLElement>('.mr-atlas-lane')?.offsetTop ?? focus.t) - 20;
    const pairs = new Set(this.lines.map((connection) => `${connection.from}\u0000${connection.to}`));
    const drawn = new Set<string>();
    const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const mid = (a.x + b.x) / 2;
      return `M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
    };
    for (const connection of this.lines) {
      const key = [connection.from, connection.to].sort().join('\u0000');
      if (connection.from === connection.to || drawn.has(key)) continue;
      drawn.add(key);
      const both = pairs.has(`${connection.to}\u0000${connection.from}`);
      // Each end is where an arrowhead may go: its point, which way it faces, and whether the link runs into it.
      let d: string;
      let ends: Array<{ x: number; y: number; dir: number; into: boolean }>;
      const touchesFocus = connection.from === this.focus || connection.to === this.focus;
      if (touchesFocus) {
        const other = connection.from === this.focus ? connection.to : connection.from;
        const place = box(other);
        const towardFocus = connection.to === this.focus;
        if (this.lanes.get(other) === 'incoming') {
          d = curve({ x: place.r, y: place.y }, { x: focus.l, y: focus.y });
          ends = [
            { x: focus.l, y: focus.y, dir: 1, into: towardFocus || both },
            { x: place.r, y: place.y, dir: -1, into: !towardFocus || both },
          ];
        } else {
          d = curve({ x: focus.r, y: focus.y }, { x: place.l, y: place.y });
          ends = [
            { x: place.l, y: place.y, dir: 1, into: !towardFocus || both },
            { x: focus.r, y: focus.y, dir: -1, into: towardFocus || both },
          ];
        }
      } else {
        const from = box(connection.from);
        const to = box(connection.to);
        const fromLane = this.lanes.get(connection.from);
        if (fromLane === this.lanes.get(connection.to)) {
          // Neighbours in the same lane connect on the lane's outer side, away from the focus.
          const sign = fromLane === 'incoming' ? -1 : 1;
          const ax = sign < 0 ? from.l : from.r;
          const bx = sign < 0 ? to.l : to.r;
          const bulge = 28 + Math.abs(from.y - to.y) * 0.2;
          d = `M ${ax} ${from.y} C ${ax + sign * bulge} ${from.y}, ${bx + sign * bulge} ${to.y}, ${bx} ${to.y}`;
          ends = [
            { x: bx, y: to.y, dir: -sign, into: true },
            { x: ax, y: from.y, dir: -sign, into: both },
          ];
        } else {
          // Across the map, a line bends around the focus instead of running behind it.
          const [left, right] = fromLane === 'incoming' ? [from, to] : [to, from];
          const a = { x: left.r, y: left.y };
          const b = { x: right.l, y: right.y };
          if (Math.max(a.y, b.y) < above || Math.min(a.y, b.y) > focus.b + 16) d = curve(a, b);
          else {
            const ry = (a.y + b.y) / 2 < focus.y ? above : focus.b + 24;
            const m1 = (a.x + focus.l) / 2;
            const m2 = (focus.r + b.x) / 2;
            d = `M ${a.x} ${a.y} C ${m1} ${a.y}, ${m1} ${ry}, ${focus.l} ${ry} L ${focus.r} ${ry} C ${m2} ${ry}, ${m2} ${b.y}, ${b.x} ${b.y}`;
          }
          const intoRight = fromLane === 'incoming';
          ends = [
            { x: b.x, y: b.y, dir: 1, into: intoRight || both },
            { x: a.x, y: a.y, dir: -1, into: !intoRight || both },
          ];
        }
      }
      const edge = document.createElementNS(SVG, 'g');
      edge.setAttribute('class', `mr-atlas-edge ${touchesFocus ? 'is-focus' : 'is-context'}`);
      edge.dataset.from = connection.from;
      edge.dataset.to = connection.to;
      const line = document.createElementNS(SVG, 'path');
      line.setAttribute('class', 'mr-atlas-line');
      line.setAttribute('d', d);
      edge.append(line);
      for (const end of ends.filter((end) => end.into)) {
        const arrow = document.createElementNS(SVG, 'path');
        arrow.setAttribute('class', 'mr-atlas-arrow');
        arrow.setAttribute('d', `M ${end.x - end.dir * 7} ${end.y - 4} L ${end.x} ${end.y} L ${end.x - end.dir * 7} ${end.y + 4}`);
        edge.append(arrow);
      }
      // The visible line is thin; a wider transparent stroke makes it easy to select.
      const hit = document.createElementNS(SVG, 'path');
      hit.setAttribute('class', 'mr-atlas-hit');
      hit.setAttribute('d', d);
      hit.dataset.act = 'connection';
      hit.dataset.id = connection.id;
      edge.append(hit);
      svg.append(edge);
    }
    world.prepend(svg);
    this.markSelection();
  }

  /** Selection and hover change classes only, so cards keep their place and keyboard focus. */
  private markSelection(): void {
    for (const node of this.root.querySelectorAll<HTMLElement>('.mr-atlas-place')) {
      node.setAttribute('aria-pressed', String(node.dataset.id === this.selected));
      node.classList.toggle('is-focus', node.dataset.lane === 'here');
    }
    const lit = this.hover ?? (this.selected !== this.focus ? this.selected : null);
    for (const edge of this.root.querySelectorAll<SVGGElement>('.mr-atlas-edge')) {
      const touches = edge.dataset.from === lit || edge.dataset.to === lit;
      edge.classList.toggle('is-lit', lit !== null && touches);
      edge.classList.toggle('is-dim', lit !== null && !touches);
    }
  }

  private drawList(): void {
    const list = this.q('.mr-atlas-list');
    list.replaceChildren();
    if (this.view !== 'list') return;
    const inner = h('div', 'mr-atlas-list-inner');
    list.append(inner);
    let candidates = this.model.places;
    if (this.near) {
      const near = this.near;
      const ids = new Set(this.model.connections.flatMap((c) => (c.from === near ? [c.to] : c.to === near ? [c.from] : [])));
      ids.delete(near);
      candidates = candidates.filter((place) => ids.has(place.id));
      inner.append(this.filterChip(`${ids.size} documents connected to ${this.title(near)}`, 'clear-near'));
    }
    if (this.listQuery) inner.append(this.filterChip(`Matching “${this.listQuery}”`, 'clear-query'));
    const words = searchWords(this.listQuery);
    const found = candidates.filter((place) => matchScore(place, words) >= 0);
    if (!found.length) inner.append(h('p', 'mr-atlas-note', 'No indexed name or path matches.'));
    if (this.index.docs.size < this.index.listed.length) inner.append(h('p', 'mr-atlas-note', 'Names from unindexed documents may be incomplete.'));
    const folders = new Map<string, MapPlace[]>();
    for (const place of found.slice(0, this.listLimit)) folders.set(place.folder, [...(folders.get(place.folder) ?? []), place]);
    for (const [folder, places] of folders) {
      const section = h('section', 'mr-atlas-list-group');
      section.dataset.folder = folder;
      const heading = h('h2', 'mr-atlas-folder', folder ? `${folder}/` : 'Project root');
      heading.append(h('span', '', `${places.length} shown`));
      const rows = h('div', 'mr-atlas-list-rows');
      for (const place of places) {
        const row = this.placeCard(place);
        row.querySelector('.mr-atlas-card-caption')!.replaceWith(h('small', 'mr-atlas-path', place.path));
        const degree = this.degree.get(place.id)!;
        row.append(h('small', 'mr-atlas-counts', `${degree.incoming} linked from · ${degree.outgoing} links to`));
        rows.append(row);
      }
      section.append(heading, rows);
      inner.append(section);
    }
    if (found.length > this.listLimit)
      inner.append(
        button(`Show ${Math.min(100, found.length - this.listLimit)} more of ${found.length} places`, 'list-more', 'mr-btn mr-outline mr-atlas-more'),
      );
    this.markSelection();
  }

  private filterChip(label: string, act: string): HTMLElement {
    const filter = h('p', 'mr-atlas-filter');
    const clear = iconButton(act, `Remove filter: ${label}`, 'Remove filter', icons.close);
    filter.append(h('span', '', label), clear);
    return filter;
  }

  /** What choosing a result will do: stay on this map, or move the map to it. */
  private relation(id: string): string {
    const lane = this.lanes.get(id);
    return lane === 'here' ? 'In focus' : lane ? 'On the map' : id === this.here ? 'You are here' : '';
  }

  /** The popup: suggestions while the field is empty, ranked matches once the reader types. */
  private drawResults(): void {
    const input = this.q<HTMLInputElement>('.mr-atlas-search input');
    const list = this.q('.mr-atlas-results-list');
    const empty = this.q('.mr-atlas-results-empty');
    const query = input.value.trim();
    list.replaceChildren();
    this.results = [];
    const groups: Array<[string, MapPlace[]]> = [];
    let total = 0;
    if (query) {
      const words = searchWords(query);
      // Places already on the map, and the reader's own place, win ties: choosing them keeps the map still.
      const bonus = (id: string) => (this.lanes.has(id) ? 8 : 0) + (id === this.here ? 4 : 0);
      const ranked = this.model.places
        .map((place) => ({ place, score: matchScore(place, words) }))
        .filter((match) => match.score >= 0)
        .sort((a, b) => b.score + bonus(b.place.id) - a.score - bonus(a.place.id) || a.place.title.localeCompare(b.place.title))
        .map((match) => match.place);
      total = ranked.length;
      groups.push([`${total} ${total === 1 ? 'match' : 'matches'}`, ranked.slice(0, RESULT_LIMIT)]);
    } else {
      const recent = this.recent.slice(0, 4);
      const around = [...this.lanes.keys()].filter((id) => !recent.includes(id)).slice(0, 6);
      groups.push(['Recent', recent.map((id) => this.place(id))], [`Around ${cardName(this.title(this.focus)).name}`, around.map((id) => this.place(id))]);
    }
    for (const [at, [label, places]] of groups.entries()) {
      if (!places.length) continue;
      const group = h('div', 'mr-atlas-results-group');
      const heading = h('div', 'mr-atlas-results-heading', label);
      heading.id = `mr-atlas-results-heading-${at}`;
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', heading.id);
      group.append(heading);
      for (const place of places) {
        const option = this.resultOption();
        this.results.push(place.id);
        const text = h('span', 'mr-atlas-result-text');
        const title = h('span', 'mr-atlas-result-title');
        title.append(...highlight(place.title, query));
        const path = h('span', 'mr-atlas-result-path');
        path.append(...highlight(place.path, query));
        text.append(title, path);
        option.append(typeIcon(place.kind), text);
        const relation = this.relation(place.id);
        if (relation) option.append(h('span', 'mr-atlas-result-relation', relation));
        group.append(option);
      }
      list.append(group);
    }
    if (total > RESULT_LIMIT) {
      const all = this.resultOption();
      this.results.push(LIST_RESULTS);
      all.classList.add('mr-atlas-result-all');
      all.textContent = `See all ${total} in List`;
      list.append(all);
    }
    empty.textContent = query && !total ? `No document matches “${query}”.` : '';
    if (!this.results.length && !empty.textContent) {
      this.closeResults();
      return;
    }
    this.active = query && this.results.length ? 0 : -1;
    this.markResult();
    this.q('.mr-atlas-results').hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  private resultOption(): HTMLElement {
    const option = h('div', 'mr-atlas-result');
    option.id = `mr-atlas-result-${this.results.length}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.act = 'pick';
    option.dataset.index = String(this.results.length);
    return option;
  }

  private markResult(): void {
    const input = this.q('.mr-atlas-search input');
    for (const option of this.root.querySelectorAll<HTMLElement>('.mr-atlas-result'))
      option.setAttribute('aria-selected', String(option.dataset.index === String(this.active)));
    const current = this.active >= 0 ? this.q(`#mr-atlas-result-${this.active}`) : null;
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  private closeResults(): void {
    const input = this.q('.mr-atlas-search input');
    this.q('.mr-atlas-results').hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  private pick(index: number): void {
    const input = this.q<HTMLInputElement>('.mr-atlas-search input');
    const id = this.results[index];
    const query = input.value.trim();
    this.closeResults();
    input.value = '';
    const reading = !this.q('.mr-atlas-article').hidden;
    if (id === LIST_RESULTS) {
      this.listQuery = query;
      this.near = null;
      this.listLimit = 100;
      this.view = 'list';
      if (reading) this.returnToMap();
      else this.draw();
      return;
    }
    // Reading, a found document opens in the reader; on the map it is selected where it is, or becomes the centre.
    if (reading) {
      this.selected = id;
      this.read(id);
      return;
    }
    if (this.view === 'map' && !this.lanes.has(id)) {
      this.focus = id;
      this.connection = null;
      this.draw();
      this.fit();
    }
    this.select(id);
    if (!this.mobile.matches) this.focusSelected();
  }

  private readonly onSearchKey = (event: KeyboardEvent): void => {
    const input = event.target as HTMLInputElement;
    const open = !this.q('.mr-atlas-results').hidden;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) this.drawResults();
      const count = this.results.length;
      if (!count) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active = this.active < 0 ? (step > 0 ? 0 : count - 1) : (this.active + step + count) % count;
      this.markResult();
    } else if (event.key === 'Enter' && open && this.active >= 0) {
      event.preventDefault();
      this.pick(this.active);
    } else if (event.key === 'Escape' && (open || input.value)) {
      // The first Escape closes the popup, the next clears the field; only then does Escape leave the panel.
      event.preventDefault();
      event.stopPropagation();
      if (open) this.closeResults();
      else input.value = '';
    }
  };

  private proofItem(connection: MapConnection, at: number): HTMLElement {
    const proof = connection.proof[at];
    const item = h('div', 'mr-atlas-proof');
    const open = button('Read source paragraph', 'proof', 'mr-btn mr-outline');
    open.dataset.id = connection.id;
    open.dataset.at = String(at);
    item.append(
      h('blockquote', '', proof.quote),
      h('p', 'mr-atlas-path', `${proof.path} · ${proof.section || 'Document'} · line ${proof.line} · ${this.source.commit.slice(0, 7)}`),
      open,
    );
    return item;
  }

  private drawDetail(): void {
    const detail = this.q('.mr-atlas-detail');
    const previous = detail.querySelector('.mr-atlas-sheet-body');
    if (detail.dataset.tab === 'preview' && previous?.getClientRects().length) this.previewScroll = { path: detail.dataset.id!, top: previous.scrollTop };
    detail.classList.toggle('is-open', this.detailsOpen);
    this.q('.mr-atlas-shell').classList.toggle('has-sheet', this.detailsOpen);
    this.q('[data-act="details"]').setAttribute('aria-expanded', String(this.detailsOpen));
    // Beside the Map the sheet is a complementary region; on phones it covers the Map and becomes a modal dialog.
    const modal = this.mobile.matches && this.detailsOpen;
    if (modal) {
      detail.setAttribute('role', 'dialog');
      detail.setAttribute('aria-modal', 'true');
    } else {
      detail.removeAttribute('role');
      detail.removeAttribute('aria-modal');
    }
    const settingsOpen = !this.q('.mr-settings').hidden;
    for (const section of ['.mr-atlas-chrome', '.mr-atlas-map-view']) this.q(section).inert = modal || settingsOpen;
    this.q('.mr-atlas-backdrop').hidden = !modal;
    // Closing keeps the last contents so the sheet slides away whole; it is hidden from focus and assistive technology.
    if (!this.detailsOpen) return;
    detail.replaceChildren();
    const place = this.place(this.selected);
    detail.dataset.id = place.id;
    detail.dataset.tab = this.connection ? 'evidence' : this.tab;
    detail.setAttribute('aria-label', this.connection ? 'Link evidence' : this.tab === 'preview' ? 'Document preview' : 'Selected document');
    // Actions sit at the top beside Close, where the eye starts; the body below is only the document or its links.
    const header = h('header', 'mr-atlas-sheet-header');
    const top = h('div', 'mr-atlas-sheet-top');
    const actions = h('div', 'mr-atlas-sheet-actions');
    const body = h('div', 'mr-atlas-sheet-body');
    const close = iconButton('close-details', 'Close details', 'Close details (Esc)', icons.close);
    header.append(top);
    detail.append(header, body);
    const commit = this.source.commit.slice(0, 7);
    if (this.connection) {
      const connection = this.connection;
      const back = button('Back to document', 'place-detail', 'mr-btn mr-atlas-sheet-back');
      // biome-ignore lint/plugin: a bundled reader icon constant, never document content.
      back.insertAdjacentHTML('afterbegin', icons.chevronLeft);
      actions.append(close);
      top.append(back, actions);
      header.append(
        h('p', 'mr-atlas-kicker', 'Documented · links to'),
        h('h2', '', 'Link evidence'),
        h('p', 'mr-atlas-sheet-description', `${this.title(connection.from)} → ${this.title(connection.to)}`),
      );
      for (const at of connection.proof.keys()) body.append(this.proofItem(connection, at));
      if (connection.hiddenProof) body.append(h('p', 'mr-atlas-note', `${connection.hiddenProof} additional source links beyond this preview budget.`));
      return;
    }
    const name = cardName(place.title);
    const badges = h('div', 'mr-atlas-sheet-badges');
    badges.append(placeBadge(place.kind, name.label));
    if (place.id === this.here) badges.append(h('span', 'mr-atlas-here', 'You are here'));
    if (place.id !== this.focus) actions.append(iconButton('focus', 'Show its connections', 'Show its connections on the map', lineIcon(SHAPES.locate)));
    const read = button('Read', 'read', 'mr-btn mr-outline mr-atlas-sheet-read');
    read.prepend(lineIcon(SHAPES.read));
    read.dataset.id = place.id;
    read.title = 'Read the whole document';
    read.disabled = !this.texts.has(place.id);
    actions.append(read, close);
    top.append(badges, actions);
    header.append(h('h2', '', name.name), h('p', 'mr-atlas-sheet-description', `${place.path} · ${commit}`));
    const connected = this.model.connections.filter((connection) => connection.from === place.id || connection.to === place.id);
    const tabs = h('div', 'mr-atlas-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Document details');
    for (const id of SHEET_TABS) {
      const tab = button(id === 'links' ? 'Links' : 'Preview', 'sheet-tab', 'mr-atlas-tab');
      if (id === 'links') tab.append(h('span', '', String(connected.length)));
      tab.dataset.tab = id;
      tab.id = `mr-atlas-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.tab));
      tab.setAttribute('aria-controls', 'mr-atlas-sheet-panel');
      tab.tabIndex = id === this.tab ? 0 : -1;
      tab.disabled = id === 'preview' && !this.texts.has(place.id);
      tabs.append(tab);
    }
    header.append(tabs);
    body.id = 'mr-atlas-sheet-panel';
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', `mr-atlas-tab-${this.tab}`);
    body.tabIndex = 0;
    if (this.tab === 'preview') {
      const content = h('div', 'mr-atlas-preview');
      const rendered = this.render(place.id).content;
      // The sheet's header already names the document.
      const heading = rendered.querySelector('h1');
      if (heading?.textContent?.trim() === place.title) heading.hidden = true;
      content.append(rendered);
      body.append(content);
      body.scrollTop = this.previewScroll.path === place.id ? this.previewScroll.top : 0;
      return;
    }
    if (place.state !== 'indexed')
      body.append(h('p', 'mr-atlas-note', place.state === 'not-read' ? 'Not indexed: its outgoing links are unknown.' : 'This document could not be indexed.'));
    // A neighbour's sheet opens with the sentence that put it on this map.
    const between = connected.filter((connection) => connection.from === this.focus || connection.to === this.focus);
    if (place.id !== this.focus && between.length) {
      const why = h('section', 'mr-atlas-why');
      const focusName = cardName(this.title(this.focus)).name;
      why.append(h('h3', '', `How it connects to ${focusName}`));
      for (const connection of between) {
        why.append(h('p', 'mr-atlas-why-direction', connection.from === place.id ? `This links to ${focusName}` : `${focusName} links here`));
        for (const at of connection.proof.keys()) if (at < 2) why.append(this.proofItem(connection, at));
        const count = connection.proof.length + connection.hiddenProof;
        if (count > 2) {
          const all = button(`See all ${count} source links`, 'connection', 'mr-btn mr-outline');
          all.dataset.id = connection.id;
          why.append(all);
        }
      }
      body.append(why);
    }
    const visible = new Set(connected.slice(0, this.connectionLimit));
    for (const incoming of [true, false]) {
      const links = connected.filter((connection) => (incoming ? connection.to : connection.from) === place.id);
      const group = h('section', 'mr-atlas-link-group');
      group.dataset.direction = incoming ? 'incoming' : 'outgoing';
      const heading = h('h3', '', incoming ? 'Linked from' : 'Links to');
      heading.append(h('span', '', String(links.length)));
      group.append(heading);
      for (const connection of links.filter((connection) => visible.has(connection))) {
        const target = this.place(incoming ? connection.from : connection.to);
        const name = cardName(target.title);
        const row = button('', 'connection', 'mr-atlas-connection');
        row.dataset.id = connection.id;
        row.setAttribute('aria-label', `Inspect evidence: ${this.title(connection.from)} links to ${this.title(connection.to)}`);
        const count = connection.proof.length + connection.hiddenProof;
        row.append(h('strong', '', name.name), h('small', '', `${name.label ?? target.kind} · ${count} source ${count === 1 ? 'link' : 'links'}`));
        group.append(row);
      }
      if (!links.length)
        group.append(
          h(
            'p',
            'mr-atlas-path',
            incoming
              ? 'No indexed documents link here.'
              : place.state === 'indexed'
                ? 'No outgoing document links found.'
                : 'Outgoing links have not been indexed.',
          ),
        );
      body.append(group);
    }
    if (connected.length > this.connectionLimit)
      body.append(
        button(`Show ${Math.min(12, connected.length - this.connectionLimit)} more connections`, 'connections-more', 'mr-btn mr-outline mr-atlas-more'),
      );
    const issues = this.index.problems.filter((problem) => problem.from === place.id);
    if (issues.length) {
      const box = h('details', 'mr-atlas-issues');
      box.append(h('summary', '', `${issues.length} unresolved links`));
      for (const issue of issues.slice(0, 12))
        box.append(
          h(
            'p',
            '',
            `${issue.link.text}: ${issue.kind === 'missing-anchor' ? `section “${issue.link.anchor}” was not found` : 'document was not listed'} · line ${issue.link.line}`,
          ),
        );
      if (issues.length > 12) box.append(h('p', '', `${issues.length - 12} additional unresolved links beyond this preview budget.`));
      body.append(box);
    }
    const source = h('details', 'mr-atlas-source');
    source.append(
      h('summary', '', 'Source and status'),
      h('p', 'mr-atlas-path', `${place.path} · ${commit}`),
      chip(null, 'Documented'),
      h('p', 'mr-atlas-path', `${place.kind} · ${KIND_SOURCES[place.kindFrom]}`),
    );
    if (place.kindFrom === 'reader')
      source.append(h('p', '', `The source says ${place.sourceKind} (${KIND_SOURCES[place.sourceKindFrom]}); you set ${place.kind}.`));
    for (const status of place.statuses) source.append(chip(null, status));
    body.append(source);
  }

  private render(path: string): ReturnType<typeof renderDocument> {
    const text = this.texts.get(path)!;
    const rendered = renderDocument(document, {
      path,
      status: 'modified',
      base: text,
      head: text,
      links: this.source.links,
      origin: location.origin,
      images: 'ask',
    });
    // The spike leaves diagrams as their safe, readable source instead of extracting architectural entities.
    for (const diagram of rendered.diagrams)
      for (const version of diagram.versions) {
        version.view.hidden = true;
        version.sourceDetails.open = true;
      }
    return rendered;
  }

  /** Selecting changes the sheet and the lit lines; the cards and the camera stay where the reader left them. */
  private select(id: string, tab: SheetTab = this.texts.has(id) ? 'preview' : 'links'): void {
    this.selected = id;
    this.tab = tab;
    this.connection = null;
    this.connectionLimit = 12;
    this.detailsOpen = true;
    this.recent = [id, ...this.recent.filter((other) => other !== id)].slice(0, 5);
    this.markSelection();
    this.drawDetail();
    if (this.mobile.matches) this.q('.mr-atlas-detail [data-act="close-details"]').focus();
  }

  private showPreview(path: string, anchor?: string): void {
    this.select(path, 'preview');
    if (anchor) {
      const target = [...this.q('.mr-atlas-preview').querySelectorAll<HTMLElement>('[id]')].find(
        (el) => el.id === anchor || el.id === `user-content-${anchor}`,
      );
      target?.scrollIntoView({ block: 'start' });
    }
  }

  /** Reading puts the document in the address, so it can be shared, reloaded and reached with Back and Forward. */
  private read(path: string, proof?: MapProof, anchor?: string, push = true): void {
    const text = this.texts.get(path);
    if (text === undefined) return;
    const article = this.q('.mr-atlas-article');
    if (article.hidden) {
      this.listScroll = (this.mobile.matches ? this.root : this.q('.mr-atlas-list')).scrollTop;
      this.sheetBeforeRead = this.detailsOpen;
    }
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('doc', path);
      history.pushState({ atlasDepth: ++this.depth }, '', url);
    }
    this.closeResults();
    const rendered = this.render(path);
    article.replaceChildren(h('p', 'mr-atlas-path', `${path} · ${this.source.commit.slice(0, 7)}`), rendered.content);
    this.detailsOpen = false;
    this.drawDetail();
    this.q('.mr-atlas-map-view').hidden = true;
    article.hidden = false;
    this.root.classList.add('is-reading');
    this.q('[data-act="return"]').hidden = false;
    const reading = this.q('.mr-atlas-reading');
    reading.hidden = false;
    reading.textContent = cardName(this.title(path)).name;
    for (const choice of this.root.querySelectorAll<HTMLElement>('.mr-atlas-choices button')) choice.setAttribute('aria-pressed', 'false');
    const block = proof ? rendered.blocks.find((block) => block.head && block.head.lines[0] < proof.line && block.head.lines[1] >= proof.line) : undefined;
    const target =
      block?.el ??
      (anchor ? [...rendered.content.querySelectorAll<HTMLElement>('[id]')].find((el) => el.id === anchor || el.id === `user-content-${anchor}`) : undefined);
    if (target) {
      target.classList.add('mr-flash');
      target.scrollIntoView({ block: 'center' });
    } else {
      article.scrollTop = 0;
      this.root.scrollTop = 0;
    }
    this.q('[data-act="return"]').focus({ preventScroll: true });
  }

  /** Back to map retraces the entries reading added, so the browser's Back and Forward stay in step. */
  private returnToMap(): void {
    if (this.depth > 0) {
      history.go(-this.depth);
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('doc');
    history.replaceState({ atlasDepth: 0 }, '', url);
    this.showMap();
  }

  /** The map as the reader left it: the same view, camera, scroll and sheet. */
  private showMap(): void {
    this.q('.mr-atlas-article').hidden = true;
    this.q('.mr-atlas-map-view').hidden = false;
    this.root.classList.remove('is-reading');
    this.q('[data-act="return"]').hidden = true;
    this.q('.mr-atlas-reading').hidden = true;
    // The sheet the reader left comes back with them, so the Map keeps the width it had.
    this.detailsOpen = this.sheetBeforeRead;
    this.draw();
    this.moveCamera();
    (this.mobile.matches ? this.root : this.q('.mr-atlas-list')).scrollTop = this.listScroll;
    // Focus goes back to what the reader used to leave: the evidence they were checking, or the preview's tab.
    if (this.detailsOpen && this.mobile.matches) this.q('.mr-atlas-detail [data-act="close-details"]').focus({ preventScroll: true });
    else if (this.detailsOpen && this.connection) this.q('.mr-atlas-detail [data-act="proof"]').focus({ preventScroll: true });
    else if (this.detailsOpen && this.tab === 'preview') this.q('#mr-atlas-tab-preview').focus({ preventScroll: true });
    else this.focusSelected();
  }

  private focusSelected(): void {
    [...this.root.querySelectorAll<HTMLElement>('.mr-atlas-place')].find((node) => node.getClientRects().length && node.dataset.id === this.selected)?.focus();
  }

  private closeDetails(): void {
    this.connection = null;
    this.tab = 'preview';
    this.detailsOpen = false;
    this.drawDetail();
    this.focusSelected();
  }

  /** Fit shows the whole neighbourhood: at full size when it fits, otherwise scaled down and centred. */
  private fit(): void {
    const canvas = this.q('.mr-atlas-canvas');
    const world = this.q('.mr-atlas-world');
    canvas.scrollTop = canvas.scrollLeft = 0;
    if (this.stacked || !world.offsetWidth) this.camera = { x: 0, y: 0, zoom: 1 };
    else {
      const zoom = Math.max(ZOOM.min, Math.min(1, canvas.clientWidth / world.offsetWidth, canvas.clientHeight / world.offsetHeight));
      this.camera = {
        x: Math.round((canvas.clientWidth - world.offsetWidth * zoom) / 2),
        y: Math.round((canvas.clientHeight - world.offsetHeight * zoom) / 2),
        zoom,
      };
    }
    this.moveCamera();
  }

  /** Zoom keeps the point under the pointer (or the canvas centre) still. */
  private zoomTo(level: number, at?: { x: number; y: number }): void {
    const canvas = this.q('.mr-atlas-canvas');
    const point = at ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const zoom = Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, level)) * 100) / 100;
    this.camera.x = point.x - ((point.x - this.camera.x) * zoom) / this.camera.zoom;
    this.camera.y = point.y - ((point.y - this.camera.y) * zoom) / this.camera.zoom;
    this.camera.zoom = zoom;
    this.moveCamera();
  }

  private moveCamera(): void {
    this.q('.mr-atlas-world').style.transform = this.stacked ? '' : `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.zoom})`;
    this.q<HTMLButtonElement>('[data-act="zoom-in"]').disabled = this.camera.zoom >= ZOOM.max;
    this.q<HTMLButtonElement>('[data-act="zoom-out"]').disabled = this.camera.zoom <= ZOOM.min;
  }

  private refocus(id: string): void {
    this.focus = this.selected = id;
    this.view = 'map';
    this.connection = null;
    this.draw();
    this.fit();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as Element;
    const setting = target.closest<HTMLElement>('[data-setting] [data-value]');
    if (setting) {
      this.update({ [setting.closest<HTMLElement>('[data-setting]')!.dataset.setting!]: setting.dataset.value });
      return;
    }
    const tab = target.closest<HTMLElement>('[data-settings-tab]');
    if (tab) {
      selectTab(this.q('.mr-settings'), tab.dataset.settingsTab!);
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[data-mr-path]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      const [path, anchor] = link.dataset.mrPath!.split('#');
      if (this.texts.has(path)) {
        event.preventDefault();
        if (link.closest('.mr-atlas-preview')) this.showPreview(path, anchor);
        else this.read(path, undefined, anchor);
      }
      return;
    }
    const control = target.closest<HTMLElement | SVGElement>('[data-act]');
    if (!control) return;
    const data = control.dataset;
    switch (data.act) {
      case 'settings':
        this.openSettings();
        return;
      case 'close-settings':
        this.closeSettings();
        return;
      case 'smaller':
        this.update({ size: Math.max(0, this.settings.size - 1) });
        return;
      case 'larger':
        this.update({ size: Math.min(TEXT_SIZES.length - 1, this.settings.size + 1) });
        return;
      case 'top-glow':
        this.update({ topGlow: !this.settings.topGlow });
        return;
      case 'palette-prev':
      case 'palette-next':
      case 'palette-page':
        this.palettes.onClick(data.act, control as HTMLElement);
        return;
      case 'close':
        this.close();
        return;
      case 'select':
        this.select(data.id!);
        return;
      case 'sheet-tab':
        this.tab = data.tab as SheetTab;
        this.drawDetail();
        this.q(`#mr-atlas-tab-${this.tab}`).focus();
        return;
      case 'connections-more':
        this.connectionLimit += 12;
        this.drawDetail();
        this.q('.mr-atlas-detail h3').tabIndex = -1;
        this.q('.mr-atlas-detail h3').focus();
        return;
      case 'list-more':
        this.listLimit += 100;
        this.drawList();
        return;
      case 'connection':
        this.connection = this.model.connections.find((connection) => connection.id === data.id)!;
        this.detailsOpen = true;
        this.drawDetail();
        this.q(this.mobile.matches ? '.mr-atlas-detail [data-act="close-details"]' : '.mr-atlas-detail [data-act="proof"]').focus({ preventScroll: true });
        return;
      case 'proof': {
        const proof = this.model.connections.find((connection) => connection.id === data.id)!.proof[Number(data.at)];
        this.read(proof.path, proof);
        return;
      }
      case 'read':
        this.read(data.id!);
        return;
      case 'return':
        this.returnToMap();
        return;
      case 'place-detail':
        this.connection = null;
        this.tab = 'links';
        this.drawDetail();
        this.q('#mr-atlas-tab-links').focus({ preventScroll: true });
        return;
      case 'close-details':
        this.closeDetails();
        return;
      case 'details':
        if (this.detailsOpen) this.closeDetails();
        else this.select(this.selected, this.tab);
        return;
      case 'map':
      case 'list':
        this.view = data.act;
        this.near = null;
        this.listQuery = '';
        if (!this.q('.mr-atlas-article').hidden) {
          this.returnToMap();
          return;
        }
        this.draw();
        if (this.view === 'map') this.fit();
        return;
      case 'pick':
        this.pick(Number(data.index));
        return;
      case 'clear-query':
        this.listQuery = '';
        this.listLimit = 100;
        this.drawList();
        this.q('.mr-atlas-list .mr-atlas-place').focus();
        return;
      case 'clear-near':
        this.near = null;
        this.listLimit = 100;
        this.drawList();
        this.q('.mr-atlas-list .mr-atlas-place').focus();
        return;
      case 'focus':
        this.refocus(this.selected);
        return;
      case 'home':
        this.refocus(this.here);
        return;
      case 'more':
        this.near = this.focus;
        this.listLimit = 100;
        this.view = 'list';
        this.draw();
        return;
      case 'fit':
        this.fit();
        return;
      case 'zoom-in':
        this.zoomTo(this.camera.zoom + 0.1);
        return;
      case 'zoom-out':
        this.zoomTo(this.camera.zoom - 0.1);
        return;
    }
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    const settingsOpen = !this.q('.mr-settings').hidden;
    if (event.key === 'Escape') {
      if (settingsOpen) this.closeSettings();
      else if (!this.q('.mr-atlas-article').hidden) this.returnToMap();
      else if (this.detailsOpen) this.closeDetails();
      else if (this.view !== 'map') {
        this.view = 'map';
        this.near = null;
        this.listQuery = '';
        this.draw();
        this.fit();
      } else this.close();
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement;
    const settingsTab = target.matches('[data-settings-tab]') ? nextTab(SETTINGS_TABS, target.dataset.settingsTab!, event.key) : null;
    if (settingsTab) {
      event.preventDefault();
      selectTab(this.q('.mr-settings'), settingsTab, true);
      return;
    }
    const sheetTab = target.matches('.mr-atlas-tab') ? nextTab(SHEET_TABS, target.dataset.tab!, event.key) : null;
    if (sheetTab && !(sheetTab === 'preview' && !this.texts.has(this.selected))) {
      event.preventDefault();
      this.tab = sheetTab as SheetTab;
      this.drawDetail();
      this.q(`#mr-atlas-tab-${sheetTab}`).focus();
      return;
    }
    const typing = target.matches('input,select,textarea');
    if (!typing && !settingsOpen && event.key === '/') {
      event.preventDefault();
      this.q('input').focus();
      return;
    }
    if (!typing && [',', '?'].includes(event.key)) {
      event.preventDefault();
      this.openSettings(event.key === '?' ? 'keys' : 'reading');
      return;
    }
    if (event.key === 'Tab') {
      const trapped = this.mobile.matches && this.detailsOpen;
      const scope = trapped ? this.q('.mr-atlas-detail') : this.root;
      const controls = [...scope.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex="0"]')].filter(
        (node) => node.getClientRects().length && !node.closest('[inert]') && !node.matches(':disabled,[tabindex="-1"]'),
      );
      const active = (this.root.getRootNode() as ShadowRoot).activeElement;
      if (event.shiftKey && active === controls[0]) {
        event.preventDefault();
        controls.at(-1)!.focus();
      } else if (!event.shiftKey && active === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
      return;
    }
    if (event.target !== this.q('.mr-atlas-canvas') || this.stacked) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[event.key]) {
      event.preventDefault();
      this.camera.x += moves[event.key][0];
      this.camera.y += moves[event.key][1];
      this.moveCamera();
    } else if (event.key === '0') this.fit();
    else if (event.key === '+' || event.key === '=') this.zoomTo(this.camera.zoom + 0.1);
    else if (event.key === '-') this.zoomTo(this.camera.zoom - 0.1);
  };
}
