import type { ProjectIndex } from '../src/core/docindex.ts';
import { MapPlacement, type MapConnection, type MapPlace, type MapProof, type ProjectMapModel } from '../src/core/project-map.ts';
import type { RepositorySource } from '../src/platforms/types.ts';
import { nextTab, PaletteCarousel, selectTab } from '../src/ui/components/settings-sheet.ts';
import { TEXT_SIZES, type Settings } from '../src/ui/preferences/settings.ts';
import { type Lane, SETTINGS_TABS, SHEET_TABS, type SheetTab } from './project-map-shared.ts';

/** The prototype's state: every field, and the constructor. The layers above it add drawing, the list and the details; a method of a higher layer that this one calls is declared abstract at the end. */
export abstract class PrototypeBase {
  protected readonly layout = new MapPlacement();
  protected readonly q = <T extends HTMLElement = HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
  protected readonly here: string;
  protected readonly places: Map<string, MapPlace>;
  /** Per document, how many indexed documents link to it and how many it links to. */
  protected readonly degree = new Map<string, { incoming: number; outgoing: number }>();
  protected focus: string;
  protected selected: string;
  protected connection: MapConnection | null = null;
  protected tab: SheetTab = 'preview';
  protected previewScroll = { path: '', top: 0 };
  protected view: 'map' | 'list' = 'map';
  /** List shows only documents matching this when the search popup's "See all" sent the reader there. */
  protected listQuery = '';
  /** Search results in popup order, and the one the arrow keys have reached. */
  protected results: string[] = [];
  protected active = -1;
  /** This session's recently selected documents, newest first; kept in memory only. */
  protected recent: string[] = [];
  /** History entries this prototype has pushed since the map; Back to map returns through them. */
  protected depth = 0;
  /** List shows only the neighbours of this document when a lane's "more" sent the reader there. */
  protected near: string | null = null;
  protected listLimit = 100;
  protected connectionLimit = 12;
  protected listScroll = 0;
  protected drawVersion = 0;
  protected detailsOpen = false;
  protected sheetBeforeRead = false;
  protected hover: string | null = null;
  protected stacked = false;
  protected lines: MapConnection[] = [];
  protected readonly lanes = new Map<string, Lane>();
  protected camera = { x: 0, y: 0, zoom: 1 };
  protected drag: { x: number; y: number; left: number; top: number } | null = null;
  protected readonly mobile = matchMedia('(max-width: 760px)');
  protected readonly dark = matchMedia('(prefers-color-scheme: dark)');
  protected readonly onScheme = () => this.applySettings();
  protected readonly palettes: PaletteCarousel;
  protected readonly observer: ResizeObserver;
  protected readonly onMobile = () => {
    this.draw();
    this.fit();
  };
  protected readonly onHistory = (event: PopStateEvent) => {
    const depth = (event.state as { atlasDepth?: number } | null)?.atlasDepth;
    if (depth === undefined) return;
    this.depth = depth;
    const path = new URLSearchParams(location.search).get('doc');
    if (path && this.texts.has(path)) this.read(path, undefined, undefined, false);
    else if (!this.q('.mr-atlas-article').hidden) this.showMap();
  };
  protected readonly close = () => {
    removeEventListener('popstate', this.onHistory);
    this.observer.disconnect();
    this.mobile.removeEventListener('change', this.onMobile);
    this.dark.removeEventListener('change', this.onScheme);
    this.host.remove();
  };

  constructor(
    protected readonly root: HTMLElement,
    protected readonly model: ProjectMapModel,
    protected readonly index: ProjectIndex,
    protected readonly texts: Map<string, string>,
    protected readonly source: RepositorySource,
    protected readonly settings: Settings,
    protected readonly host: HTMLElement,
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

  protected readonly onSearchKey = (event: KeyboardEvent): void => {
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

  protected readonly onClick = (event: MouseEvent): void => {
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

  protected readonly onKey = (event: KeyboardEvent): void => {
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
  // Methods of the layers above, called from here.
  protected abstract applySettings(): void;
  protected abstract draw(): void;
  protected abstract fit(): void;
  protected abstract read(path: string, proof?: MapProof, anchor?: string, push?: boolean): void;
  protected abstract showMap(): void;
  protected abstract drawResults(): void;
  protected abstract closeResults(): void;
  protected abstract update(patch: Partial<Settings>): void;
  protected abstract moveCamera(): void;
  protected abstract zoomTo(
    level: number,
    at?: {
      x: number;
      y: number;
    },
  ): void;
  protected abstract markSelection(): void;
  protected abstract measure(): void;
  protected abstract drawLines(): void;
  protected abstract drawDetail(): void;
  protected abstract drawList(): void;
  protected abstract returnToMap(): void;
  protected abstract select(id: string, tab?: SheetTab): void;
  protected abstract focusSelected(): void;
  protected abstract markResult(): void;
  protected abstract pick(index: number): void;
  protected abstract showPreview(path: string, anchor?: string): void;
  protected abstract openSettings(tab?: string): void;
  protected abstract closeSettings(): void;
  protected abstract closeDetails(): void;
  protected abstract refocus(id: string): void;
}
