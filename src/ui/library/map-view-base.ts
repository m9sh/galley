import { MapPlacement, type MapConnection, type MapPlace } from '../../core/project-map.ts';
import { h } from '../components/dom.ts';
import {
  CONNECTION_PAGE,
  type DocumentMapHost,
  type DocumentMapState,
  LIST_PAGE,
  type Lane,
  SHAPES,
  type Tab,
  act,
  iconAct,
  lineIcon,
} from './map-view-shared.ts';

export abstract class DocumentMapBase {
  /** Map or List: the library places it beside its own heading. */
  readonly tools = h('div', 'mr-seg mr-pm-choices');
  /** The map, or the list. */
  readonly element = h('div', 'mr-pm');
  protected readonly placement = new MapPlacement();
  protected readonly mobile = matchMedia('(max-width: 760px)');
  protected readonly observer: ResizeObserver;
  protected state!: DocumentMapState;
  protected places = new Map<string, MapPlace>();
  protected view: 'map' | 'list' = 'map';
  protected selected: string | null = null;
  protected sheetOpen = false;
  protected tab: Tab = 'preview';
  /** The connection whose evidence the sheet shows, instead of the selected document. */
  protected connection: string | null = null;
  /** List shows only the documents connected to this one, after Show more in List. */
  protected near: string | null = null;
  protected listLimit = LIST_PAGE;
  protected connectionLimit = CONNECTION_PAGE;
  protected hover: string | null = null;
  protected stacked = false;
  protected lines: MapConnection[] = [];
  protected readonly lanes = new Map<string, Lane>();
  protected camera = { x: 0, y: 0, zoom: 1 };
  protected drag: { x: number; y: number; left: number; top: number } | null = null;
  /** The last preview, kept so drawing the sheet again keeps the reader's place in it. */
  protected shown: { path: string; content: HTMLElement } | null = null;
  protected previewVersion = 0;
  protected readonly q = <T extends HTMLElement = HTMLElement>(selector: string) => this.element.querySelector<T>(selector)!;

  constructor(protected readonly host: DocumentMapHost) {
    this.tools.setAttribute('role', 'group');
    this.tools.setAttribute('aria-label', 'Show the documents as');
    for (const [view, label, title] of [
      ['map', 'Map', 'The document in focus and its links'],
      ['list', 'List', 'Every document, by folder'],
    ]) {
      const choice = act('', `view-${view}`, '');
      choice.title = title;
      choice.append(lineIcon(SHAPES[view]), h('span', '', label));
      this.tools.append(choice);
    }
    const pane = h('div', 'mr-pm-pane');
    const canvas = h('div', 'mr-pm-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', 'Map. Arrow keys move it, plus and minus zoom, 0 fits it.');
    const world = h('div', 'mr-pm-world');
    canvas.append(world);
    const controls = h('div', 'mr-pm-controls');
    const zoom = h('div', 'mr-pm-zoom');
    zoom.setAttribute('role', 'group');
    zoom.setAttribute('aria-label', 'Zoom');
    zoom.append(
      iconAct('zoom-out', 'Zoom out', SHAPES.minus, 'Zoom out (−)'),
      iconAct('zoom-in', 'Zoom in', SHAPES.plus, 'Zoom in (+)'),
      iconAct('fit', 'Fit map', SHAPES.fit, 'Fit map (0)'),
    );
    const home = act('Back to my place', 'home', 'mr-btn mr-pm-home');
    home.prepend(lineIcon(SHAPES.locate));
    home.title = 'Put the document you are reading in the middle';
    controls.append(zoom, home);
    pane.append(canvas, controls, h('div', 'mr-pm-list'));
    this.element.append(pane);

    // Dragging the background moves the map; places and lines stay clickable.
    canvas.addEventListener('pointerdown', (event) => {
      if (this.stacked || (event.target as Element).closest('[data-act]')) return;
      this.drag = { x: event.clientX, y: event.clientY, left: this.camera.x, top: this.camera.y };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      this.camera.x = this.drag.left + event.clientX - this.drag.x;
      this.camera.y = this.drag.top + event.clientY - this.drag.y;
      this.moveCamera();
    });
    for (const name of ['pointerup', 'pointercancel'])
      canvas.addEventListener(name, () => {
        this.drag = null;
      });
    // A trackpad moves the map; pinching, which arrives as ctrl + wheel, zooms where the pointer is.
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
    const light = (id: string | null) => {
      this.hover = id;
      this.mark();
    };
    world.addEventListener('pointerover', (event) => light((event.target as Element).closest<HTMLElement>('.mr-pm-place')?.dataset.id ?? null));
    world.addEventListener('focusin', (event) => light((event.target as HTMLElement).dataset.id ?? null));
    world.addEventListener('pointerleave', () => light(null));
    world.addEventListener('focusout', () => light(null));
    // A hidden map has no size; it is laid out again when it is shown.
    this.observer = new ResizeObserver(() => {
      if (!canvas.clientWidth) return;
      this.measure();
      this.drawLines();
      this.moveCamera();
    });
    this.observer.observe(canvas);
    this.mobile.addEventListener('change', this.onMobile);
  }

  protected readonly onMobile = () => {
    this.render();
    this.fit();
  };
  // Methods of the layers above, called from here.
  protected abstract moveCamera(): void;
  protected abstract zoomTo(
    level: number,
    at?: {
      x: number;
      y: number;
    },
  ): void;
  protected abstract mark(): void;
  protected abstract measure(): void;
  protected abstract drawLines(): void;
  protected abstract render(): void;
  protected abstract fit(): void;
  protected abstract drawList(): void;
  protected abstract drawSheet(): void;
}
