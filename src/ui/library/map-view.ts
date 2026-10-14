import { ORIGIN_NAMES } from '../../core/architecture.ts';
import {
  linksAround,
  MAP_CENTRE_LIMIT,
  MAP_NEIGHBOUR_LIMIT,
  MapPlacement,
  type MapConnection,
  type MapPlace,
  type MapPosition,
  type MapProof,
  type ProjectMapModel,
} from '../../core/project-map.ts';
import { button, chip, h } from '../components/dom.ts';
import type { Sheet } from '../components/sheet.ts';

/**
 * The Documents map (ADR 0030): the document in focus between what links to it and what it links to, details in
 * the reader's sheet beside the map, and the same places as a List. This review draws the same map around what a
 * review changes: its files in the middle, chapter by chapter. The library reads documents, opens evidence and keeps
 * the reader's corrections; this view lays out places and lines, and keeps its own camera, selection and focus while
 * the reader goes off to read.
 */

type Lane = MapPosition['lane'];
type Tab = 'preview' | 'links';
/** Where a card is, for drawing lines to it. */
type Box = { l: number; r: number; b: number; y: number };
type Curve = (a: { x: number; y: number }, b: { x: number; y: number }) => string;
/** A line: its path, the ends that may carry an arrowhead, and whether it touches the middle or is context. */
type Shape = { d: string; ends: Array<{ x: number; y: number; dir: number; into: boolean }>; touchesFocus: boolean };

/** What the library supplies. Reading and evidence are the library's own `open` and `evidence` actions. */
export interface DocumentMapHost {
  /** The document as the reader renders it, for Preview; null when it cannot be shown. Never rejects. */
  preview(path: string): Promise<HTMLElement | null>;
  /** The library's type, status and type editor for a document that has been read, for the Links tab. */
  details(path: string): HTMLElement[];
  /** Links in the document the map cannot follow; null when there are none. */
  problems(path: string): HTMLElement | null;
  /** The map's middle moved: the library keeps it as the map's place for the next drawing. Not around a review. */
  refocus?(path: string): void;
  /** The library's sheet for details; Close asks the map to close it (closeSheet()). */
  sheet: Sheet;
  /** Show its connections, from This review: the library opens its Documents map at the document. */
  explore?(path: string): void;
  /** The commit everything was read at. */
  commit: string;
}

export interface DocumentMapState {
  model: ProjectMapModel;
  /** The document in the middle. */
  focus: string;
  /** The document open in the reader: You are here. */
  here: string | null;
  /** Documents the review changes, when the library was opened from one. */
  changed: ReadonlySet<string>;
  /** This review: the files the review changes in the middle, chapter by chapter, instead of one document. */
  review?: ReviewCentre;
}

interface ReviewCentre {
  chapters: Array<{
    title: string;
    paths: string[];
    /** Sections the reader added to the chapter, in List: reading aids, never lines. */
    attachments?: Array<{ path: string; heading: string; title: string; commit: string }>;
  }>;
  /** What a changed configuration file declares, once configuration is read. */
  declares?: Record<string, string[]>;
}

/** Below this canvas width the three lanes stack, so an open sheet never forces sideways panning. */
const STACK_BELOW = 720;
/** Phones keep a short neighbourhood; the rest are one tap away in List. */
const PHONE_LANE = 4;
const LIST_PAGE = 100;
const CONNECTION_PAGE = 12;
const ZOOM = { min: 0.5, max: 1.5 };
const SVG = 'http://www.w3.org/2000/svg';
/** Line art at the reader's icon weight; a document type is told by shape and label, never by colour. */
const SHAPES: Record<string, string> = {
  Overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  Spec: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  Decision: 'M12 3l9 9-9 9-9-9zM8 12h8',
  Architecture: 'M8 3h8v6H8zM3 15h6v6H3zM15 15h6v6h-6zM12 9v3M6 15v-3h12v3',
  Runbook: 'M5 5h14v14H5zM8 9l3 3-3 3M13 15h3',
  Guide: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
  Document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  File: 'M6 3h8l4 4v14H6zM14 3v5h4M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  read: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  down: 'M12 5v14M6 13l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
};

/** Separate only identifiers written in the title; never invent a record number from its path. */
function cardName(title: string): { label: string | null; name: string } {
  const record = /^(ADR|RFC)\s+(\d+)\s*[:—–-]\s*(\S.*)$/i.exec(title);
  return record ? { label: `${record[1].toUpperCase()} ${record[2]}`, name: record[3] } : { label: null, name: title };
}

function lineIcon(shape: string): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    class: 'mr-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }))
    icon.setAttribute(name, value);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', shape);
  icon.append(path);
  return icon;
}

function typeBadge(kind: string, label: string | null): HTMLElement {
  const badge = h('small', 'mr-pm-type', label ?? kind);
  badge.prepend(lineIcon(SHAPES[kind]));
  return badge;
}

/** The map's own controls are `pm-` actions, which the library hands back through onAct(). */
const act = (label: string, name: string, className = 'mr-btn mr-outline') => button(label, `pm-${name}`, className);

/** An icon-only control names itself, and its shortcut when it has one. */
function iconAct(name: string, label: string, shape: string, title = label): HTMLButtonElement {
  const control = act('', name, 'mr-btn mr-icon-btn');
  control.setAttribute('aria-label', label);
  control.title = title;
  control.append(lineIcon(shape));
  return control;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
/** Failed and too-large documents have nothing to preview; one not read yet is read when previewed. */
const previewable = (place: MapPlace) => place.state === 'indexed' || place.state === 'not-read';

export class DocumentMap {
  /** Map or List: the library places it beside its own heading. */
  readonly tools = h('div', 'mr-seg mr-pm-choices');
  /** The map, or the list. */
  readonly element = h('div', 'mr-pm');
  private readonly placement = new MapPlacement();
  private readonly mobile = matchMedia('(max-width: 760px)');
  private readonly observer: ResizeObserver;
  private state!: DocumentMapState;
  private places = new Map<string, MapPlace>();
  private view: 'map' | 'list' = 'map';
  private selected: string | null = null;
  private sheetOpen = false;
  private tab: Tab = 'preview';
  /** The connection whose evidence the sheet shows, instead of the selected document. */
  private connection: string | null = null;
  /** List shows only the documents connected to this one, after Show more in List. */
  private near: string | null = null;
  private listLimit = LIST_PAGE;
  private connectionLimit = CONNECTION_PAGE;
  private hover: string | null = null;
  private stacked = false;
  private lines: MapConnection[] = [];
  private readonly lanes = new Map<string, Lane>();
  private camera = { x: 0, y: 0, zoom: 1 };
  private drag: { x: number; y: number; left: number; top: number } | null = null;
  /** The last preview, kept so drawing the sheet again keeps the reader's place in it. */
  private shown: { path: string; content: HTMLElement } | null = null;
  private previewVersion = 0;
  private readonly q = <T extends HTMLElement = HTMLElement>(selector: string) => this.element.querySelector<T>(selector)!;

  constructor(private readonly host: DocumentMapHost) {
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

  /** Draw for the index as it is now. Selection, the sheet, the camera and the view stay as the reader left them. */
  draw(state: DocumentMapState): void {
    const moved = this.state?.focus !== state.focus;
    this.state = state;
    this.places = new Map(state.model.places.map((place) => [place.id, place]));
    const active = (this.element.getRootNode() as Document | ShadowRoot).activeElement;
    const { sheet } = this.host;
    // A control drawn again is found by what it does and what it is; the sheet keeps its own Close.
    const keep: Record<string, string | undefined> | null =
      active instanceof HTMLElement && (this.element.contains(active) || sheet.element.contains(active))
        ? { ...active.dataset, className: active.className }
        : null;
    const scroll = sheet.body.scrollTop;
    this.render();
    sheet.body.scrollTop = scroll;
    if (keep)
      [...this.element.querySelectorAll<HTMLElement>('[data-act]'), ...sheet.element.querySelectorAll<HTMLElement>('[data-act]')]
        .find((el) => el.className === keep.className && ['act', 'id', 'path', 'line', 'tab'].every((key) => el.dataset[key] === keep[key]))
        ?.focus({ preventScroll: true });
    if (moved) this.fit();
  }

  /** The reader is closing, or reading a new commit: stop watching the window, and close the sheet. */
  destroy(): void {
    this.host.sheet.hide();
    this.observer.disconnect();
    this.mobile.removeEventListener('change', this.onMobile);
    this.previewVersion++;
  }

  /** Put keyboard focus on the document in the middle, after the library moved it there. */
  focusCentre(): void {
    this.focusPlace(this.state.focus);
  }

  /** Close, the backdrop or Escape close the details sheet while the map is shown; focus goes back to the place it was about. */
  closeSheet(): boolean {
    if (!this.sheetOpen || !this.host.sheet.isOpen) return false;
    this.sheetOpen = false;
    this.connection = null;
    this.host.sheet.hide();
    this.focusPlace(this.selected!);
    return true;
  }

  /** The map is put away: its sheet goes with it, and comes back as it was when the map is drawn again. */
  park(): void {
    this.host.sheet.hide();
  }

  /** A link in a preview previews the document it points to in the same sheet; anything else the library follows. */
  previewLink(link: HTMLAnchorElement, e: MouseEvent): boolean {
    const path = link.dataset.mrPath!.split('#')[0].replace(/\?.*$/, '');
    if (e.ctrlKey || e.metaKey || e.shiftKey || !this.places.has(path)) return false;
    e.preventDefault();
    this.open(path, 'preview');
    return true;
  }

  /** Arrow keys between the sheet's tabs, and the camera keys while the map itself has focus. */
  onKey(e: KeyboardEvent): boolean {
    const target = e.composedPath()[0] as HTMLElement;
    if (target.matches('.mr-pm-tab') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      this.setTab(this.tab === 'preview' ? 'links' : 'preview');
      return true;
    }
    if (!target.matches('.mr-pm-canvas') || this.stacked) return false;
    const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[e.key]) {
      this.camera.x += moves[e.key][0];
      this.camera.y += moves[e.key][1];
      this.moveCamera();
    } else if (e.key === '0') this.fit();
    else if (e.key === '+' || e.key === '=') this.zoomTo(this.camera.zoom + 0.1);
    else if (e.key === '-') this.zoomTo(this.camera.zoom - 0.1);
    else return false;
    e.preventDefault();
    return true;
  }

  /** The library passes every `pm-` action here. */
  onAct(control: HTMLElement): void {
    const data = control.dataset;
    switch (data.act) {
      case 'pm-view-map':
      case 'pm-view-list':
        this.view = data.act === 'pm-view-map' ? 'map' : 'list';
        this.near = null;
        this.listLimit = LIST_PAGE;
        this.render();
        if (this.view === 'map') this.fit();
        return;
      case 'pm-select':
        this.open(data.id!, 'preview');
        return;
      case 'pm-tab':
        this.setTab(data.tab as Tab);
        return;
      case 'pm-details':
        this.connection = null;
        this.setTab('links');
        return;
      case 'pm-connection': {
        const connection = this.state.model.connections.find((c) => c.id === data.id)!;
        this.connection = connection.id;
        this.selected ??= connection.from;
        this.sheetOpen = true;
        this.mark();
        this.drawSheet();
        this.host.sheet.body.querySelector<HTMLElement>('[data-act="evidence"]')!.focus({ preventScroll: true });
        return;
      }
      case 'pm-connections-more':
        this.connectionLimit += CONNECTION_PAGE;
        this.drawSheet();
        return;
      case 'pm-focus':
        // Around a review, its connections are the Documents map's, with the document in the middle.
        if (this.state.review) this.host.explore!(this.selected!);
        else this.refocus(this.selected!);
        return;
      case 'pm-home':
        this.selected = this.state.here;
        this.refocus(this.state.here!);
        return;
      case 'pm-more':
        this.near = this.state.review ? null : this.state.focus;
        this.listLimit = LIST_PAGE;
        this.view = 'list';
        this.render();
        return;
      case 'pm-clear-near':
        this.near = null;
        this.listLimit = LIST_PAGE;
        this.render();
        this.q('.mr-pm-list .mr-pm-place').focus();
        return;
      case 'pm-list-more':
        this.listLimit += LIST_PAGE;
        this.drawList();
        return;
      case 'pm-fit':
        this.fit();
        return;
      case 'pm-zoom-in':
        this.zoomTo(this.camera.zoom + 0.1);
        return;
      case 'pm-zoom-out':
        this.zoomTo(this.camera.zoom - 0.1);
        return;
    }
  }

  private readonly onMobile = () => {
    this.render();
    this.fit();
  };

  private place(id: string): MapPlace {
    return this.places.get(id)!;
  }

  private render(): void {
    const list = this.view === 'list';
    this.element.classList.toggle('is-list', list);
    this.element.classList.toggle('is-review', Boolean(this.state.review));
    this.q('.mr-pm-canvas').hidden = list;
    this.q('.mr-pm-controls').hidden = list;
    this.q('.mr-pm-list').hidden = !list;
    for (const choice of this.tools.querySelectorAll<HTMLElement>('button'))
      choice.setAttribute('aria-pressed', String(choice.dataset.act === `pm-view-${this.view}`));
    const here = this.state.here;
    const home = this.q<HTMLButtonElement>('[data-act="pm-home"]');
    home.disabled = !here || !this.places.has(here);
    // Around a review there is no one document to come back to.
    home.hidden = Boolean(this.state.review);
    this.measure();
    this.drawMap();
    this.drawList();
    this.drawSheet();
  }

  /** Three lanes on a wide canvas; one column on phones, and on a canvas the sheet has narrowed. */
  private measure(): void {
    const width = this.q('.mr-pm-canvas').clientWidth;
    const stacked = this.mobile.matches || (width > 0 && width < STACK_BELOW);
    if (stacked === this.stacked) return;
    this.stacked = stacked;
    this.element.classList.toggle('is-stacked', stacked);
    if (stacked) this.camera = { x: 0, y: 0, zoom: 1 };
  }

  private card(place: MapPlace, lane?: Lane): HTMLButtonElement {
    const { here, changed } = this.state;
    const node = act('', 'select', 'mr-pm-place');
    node.dataset.id = place.id;
    if (lane) node.dataset.lane = lane;
    node.title = place.path;
    node.setAttribute('aria-label', `${place.title}, ${place.kind}, ${place.path}${place.id === here ? ', you are here' : ''}`);
    const name = cardName(place.title);
    const caption = {
      indexed: place.folder || 'Top folder',
      'not-read': 'Not read yet',
      failed: 'Could not be read',
      'too-large': 'Too large to read',
      file: place.folder || 'Top folder',
    }[place.state];
    node.append(typeBadge(place.kind, name.label), h('strong', '', name.name), h('small', 'mr-pm-caption', caption));
    // Around a review, everything it changes is in the middle, which says so.
    if (changed.has(place.id) && !this.state.review) node.append(chip('modified', 'Changed in this review'));
    if (place.id === here) node.append(h('span', 'mr-pm-here', 'You are here'));
    return node;
  }

  /** What an empty lane says: a zero is never a claim about documents not read yet. A document that links both ways
   * stays in the lane where it was first drawn, with an arrowhead at each end, so the other lane may hold them all. */
  private empty(lane: Lane, elsewhere: boolean): string {
    if (this.state.review)
      return lane === 'incoming' ? 'No document read so far links to what this review changes.' : 'What this review changes links to no other listed document.';
    if (lane === 'incoming') return elsewhere ? 'Every document that links here is also one it links to.' : 'No document read so far links here.';
    if (elsewhere) return 'Every document it links to also links here.';
    const state = this.place(this.state.focus).state;
    if (state === 'indexed') return 'It links to no other listed document.';
    return state === 'not-read' ? 'Not read yet: its links are not shown.' : 'Its links could not be read.';
  }

  private drawMap(): void {
    const world = this.q('.mr-pm-world');
    world.replaceChildren();
    this.lanes.clear();
    if (this.view === 'list') return;
    const { model, focus, review } = this.state;
    const perLane = this.mobile.matches ? PHONE_LANE : MAP_NEIGHBOUR_LIMIT;
    const neighbourhood = review
      ? this.placement.around(
          model,
          review.chapters.flatMap((chapter) => chapter.paths),
          perLane,
          this.mobile.matches ? MAP_CENTRE_LIMIT / 2 : MAP_CENTRE_LIMIT,
        )
      : this.placement.neighbourhood(model, focus, perLane);
    const quiet = new Set(neighbourhood.places.filter((position) => position.quiet).map((position) => position.place.id));
    this.lines = neighbourhood.connections;
    const linked = {
      incoming: model.connections.some((connection) => connection.to === focus && connection.from !== focus),
      outgoing: model.connections.some((connection) => connection.from === focus && connection.to !== focus),
    };
    const groups: Record<Lane, MapPlace[]> = { incoming: [], here: [], outgoing: [] };
    for (const position of neighbourhood.places) {
      groups[position.lane].push(position.place);
      this.lanes.set(position.place.id, position.lane);
    }
    for (const lane of ['incoming', 'here', 'outgoing'] as const) {
      const column = h('section', 'mr-pm-lane');
      column.dataset.lane = lane;
      const stack = h('div', 'mr-pm-stack');
      const head = h('h2', 'mr-pm-lane-head', lane === 'incoming' ? 'Linked from' : lane === 'outgoing' ? 'Links to' : review ? 'In this review' : 'In focus');
      column.setAttribute('aria-label', head.textContent!);
      if (lane === 'here' && review) this.centre(stack, head, groups.here, neighbourhood.centre!, quiet);
      else for (const place of groups[lane]) stack.append(this.card(place, lane));
      if (lane !== 'here') {
        const total = neighbourhood.totals[lane];
        head.append(h('span', '', String(total)));
        if (!total) stack.append(h('p', 'mr-pm-empty', this.empty(lane, linked[lane])));
        const hidden = total - groups[lane].length;
        if (hidden > 0) stack.append(act(`Show ${hidden} more in List`, 'more', 'mr-btn mr-outline mr-pm-more'));
      }
      column.append(head, stack);
      world.append(column);
      // Stacked, the map reads top to bottom; an arrow says which way the links run between the groups.
      if (lane !== 'outgoing') {
        const flow = h('div', 'mr-pm-flow');
        flow.setAttribute('aria-hidden', 'true');
        flow.append(lineIcon(SHAPES.down), h('span', '', 'links to'));
        world.append(flow);
      }
    }
    this.drawLines();
  }

  /**
   * The middle of a review: every file it changes, under the chapter each is in; one that nothing read so far links to
   * or from is quiet, with no line. More than the middle shows are in List.
   */
  private centre(stack: HTMLElement, head: HTMLElement, places: MapPlace[], centre: { connected: number; unconnected: number }, quiet: Set<string>): void {
    const total = centre.connected + centre.unconnected;
    head.append(h('span', '', String(total)));
    for (const chapter of this.state.review!.chapters) {
      const members = places.filter((place) => chapter.paths.includes(place.id));
      if (!members.length) continue;
      stack.append(h('p', 'mr-pm-group-head', chapter.title), ...members.filter((place) => !quiet.has(place.id)).map((place) => this.card(place, 'here')));
      // Those nothing read so far links to or from, as small chips after the rest, so every file is here and the map stays readable.
      const loose = members.filter((place) => quiet.has(place.id));
      if (!loose.length) continue;
      const chips = h('div', 'mr-pm-quiet');
      for (const place of loose) {
        const node = act('', 'select', 'mr-pm-place is-chip');
        node.dataset.id = place.id;
        node.dataset.lane = 'here';
        node.title = place.path;
        node.setAttribute('aria-label', `${place.title}, ${place.kind}, ${place.path}, no links so far`);
        node.append(lineIcon(SHAPES[place.kind]), h('strong', '', place.title));
        chips.append(node);
      }
      stack.append(chips);
    }
    const hidden = total - places.length;
    if (hidden > 0) stack.append(act(`Show ${hidden} more in List`, 'more', 'mr-btn mr-outline mr-pm-more'));
  }

  /** Lines leave the side of a card that faces the focus, so direction reads left to right, like the lane headings. */
  private drawLines(): void {
    const world = this.q('.mr-pm-world');
    world.querySelector('.mr-pm-lines')?.remove();
    if (this.view === 'list' || this.stacked) {
      this.mark();
      return;
    }
    const focusId = this.state.focus;
    const nodes = new Map([...world.querySelectorAll<HTMLElement>('.mr-pm-place')].map((node) => [node.dataset.id!, node]));
    const box = (id: string): Box => {
      const node = nodes.get(id)!;
      return { l: node.offsetLeft, r: node.offsetLeft + node.offsetWidth, b: node.offsetTop + node.offsetHeight, y: node.offsetTop + node.offsetHeight / 2 };
    };
    const svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('mr-pm-lines');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', String(world.scrollWidth));
    svg.setAttribute('height', String(world.scrollHeight));
    // Around the focus means around its lane heading too; around a review, the middle is a lane of its own.
    const frame = this.state.review ? null : { id: focusId, box: box(focusId), above: nodes.get(focusId)!.closest<HTMLElement>('.mr-pm-lane')!.offsetTop - 20 };
    const pairs = new Set(this.lines.map((connection) => connection.id));
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
      const shape = frame ? this.focusShape(connection, frame, box, curve, both) : this.aroundShape(connection, box, curve, both);
      if (!shape) continue;
      const { d, ends, touchesFocus } = shape;
      const edge = document.createElementNS(SVG, 'g');
      edge.setAttribute('class', `mr-pm-edge ${touchesFocus ? 'is-focus' : 'is-context'}`);
      edge.dataset.from = connection.from;
      edge.dataset.to = connection.to;
      const line = document.createElementNS(SVG, 'path');
      line.setAttribute('class', 'mr-pm-line');
      line.setAttribute('d', d);
      edge.append(line);
      for (const end of ends.filter((end) => end.into)) {
        const arrow = document.createElementNS(SVG, 'path');
        arrow.setAttribute('class', 'mr-pm-arrow');
        arrow.setAttribute('d', `M ${end.x - end.dir * 7} ${end.y - 4} L ${end.x} ${end.y} L ${end.x - end.dir * 7} ${end.y + 4}`);
        edge.append(arrow);
      }
      // The visible line is thin; a wider transparent stroke makes it easy to choose.
      const hit = document.createElementNS(SVG, 'path');
      hit.setAttribute('class', 'mr-pm-hit');
      hit.setAttribute('d', d);
      hit.dataset.act = 'pm-connection';
      hit.dataset.id = connection.id;
      edge.append(hit);
      svg.append(edge);
    }
    world.prepend(svg);
    this.mark();
  }

  /** A line around one document: to and from the focus, and between its neighbours, bending around it. */
  private focusShape(connection: MapConnection, frame: { id: string; box: Box; above: number }, box: (id: string) => Box, curve: Curve, both: boolean): Shape {
    const { id: focusId, box: focus, above } = frame;
    // Each end may carry an arrowhead: its point, which way it faces, and whether the link runs into it.
    if (connection.from === focusId || connection.to === focusId) {
      const other = connection.from === focusId ? connection.to : connection.from;
      const place = box(other);
      const towardFocus = connection.to === focusId;
      if (this.lanes.get(other) === 'incoming')
        return {
          d: curve({ x: place.r, y: place.y }, { x: focus.l, y: focus.y }),
          ends: [
            { x: focus.l, y: focus.y, dir: 1, into: towardFocus || both },
            { x: place.r, y: place.y, dir: -1, into: !towardFocus || both },
          ],
          touchesFocus: true,
        };
      return {
        d: curve({ x: focus.r, y: focus.y }, { x: place.l, y: place.y }),
        ends: [
          { x: place.l, y: place.y, dir: 1, into: !towardFocus || both },
          { x: focus.r, y: focus.y, dir: -1, into: towardFocus || both },
        ],
        touchesFocus: true,
      };
    }
    const from = box(connection.from);
    const to = box(connection.to);
    const fromLane = this.lanes.get(connection.from)!;
    if (fromLane === this.lanes.get(connection.to)) return this.sameLane(fromLane, from, to, both, false);
    // Across the map, a line bends around the focus instead of running behind it.
    const [left, right] = fromLane === 'incoming' ? [from, to] : [to, from];
    const a = { x: left.r, y: left.y };
    const b = { x: right.l, y: right.y };
    let d: string;
    if (Math.max(a.y, b.y) < above || Math.min(a.y, b.y) > focus.b + 16) d = curve(a, b);
    else {
      const ry = (a.y + b.y) / 2 < focus.y ? above : focus.b + 24;
      const m1 = (a.x + focus.l) / 2;
      const m2 = (focus.r + b.x) / 2;
      d = `M ${a.x} ${a.y} C ${m1} ${a.y}, ${m1} ${ry}, ${focus.l} ${ry} L ${focus.r} ${ry} C ${m2} ${ry}, ${m2} ${b.y}, ${b.x} ${b.y}`;
    }
    const intoRight = fromLane === 'incoming';
    return {
      d,
      ends: [
        { x: b.x, y: b.y, dir: 1, into: intoRight || both },
        { x: a.x, y: a.y, dir: -1, into: !intoRight || both },
      ],
      touchesFocus: false,
    };
  }

  /**
   * A line around a review: from what links in to the middle and from the middle out, and between two of the middle on
   * its outer side. Between two neighbours a line is context; across the middle it is left to the sheet.
   */
  private aroundShape(connection: MapConnection, box: (id: string) => Box, curve: Curve, both: boolean): Shape | null {
    const order: Record<Lane, number> = { incoming: 0, here: 1, outgoing: 2 };
    const [a, b] = [this.lanes.get(connection.from)!, this.lanes.get(connection.to)!];
    if (a === b) return this.sameLane(a, box(connection.from), box(connection.to), both, a === 'here');
    if (Math.abs(order[a] - order[b]) > 1) return null;
    const intoRight = order[a] < order[b];
    const [left, right] = intoRight ? [box(connection.from), box(connection.to)] : [box(connection.to), box(connection.from)];
    const p = { x: left.r, y: left.y };
    const q = { x: right.l, y: right.y };
    return {
      d: curve(p, q),
      ends: [
        { x: q.x, y: q.y, dir: 1, into: intoRight || both },
        { x: p.x, y: p.y, dir: -1, into: !intoRight || both },
      ],
      touchesFocus: true,
    };
  }

  /** Two places in one lane connect on its outer side, away from the middle; the middle's own on its right. */
  private sameLane(lane: Lane, from: Box, to: Box, both: boolean, touchesFocus: boolean): Shape {
    const sign = lane === 'incoming' ? -1 : 1;
    const ax = sign < 0 ? from.l : from.r;
    const bx = sign < 0 ? to.l : to.r;
    const bulge = 28 + Math.abs(from.y - to.y) * 0.2;
    return {
      d: `M ${ax} ${from.y} C ${ax + sign * bulge} ${from.y}, ${bx + sign * bulge} ${to.y}, ${bx} ${to.y}`,
      ends: [
        { x: bx, y: to.y, dir: -sign, into: true },
        { x: ax, y: from.y, dir: -sign, into: both },
      ],
      touchesFocus,
    };
  }

  /** Selection and hover change classes only, so cards keep their place and keyboard focus. */
  private mark(): void {
    const review = Boolean(this.state.review);
    for (const node of this.element.querySelectorAll<HTMLElement>('.mr-pm-place')) {
      node.setAttribute('aria-pressed', String(node.dataset.id === this.selected));
      // One document in focus stands out; a review's files share the middle.
      node.classList.toggle('is-focus', node.dataset.lane === 'here' && !review);
      node.classList.toggle('is-centre', node.dataset.lane === 'here' && review);
    }
    const lit = this.hover ?? (review || this.selected !== this.state.focus ? this.selected : null);
    for (const edge of this.element.querySelectorAll<SVGGElement>('.mr-pm-edge')) {
      const touches = edge.dataset.from === lit || edge.dataset.to === lit;
      edge.classList.toggle('is-lit', lit !== null && touches);
      edge.classList.toggle('is-dim', lit !== null && !touches);
    }
  }

  /** The same places as rows, by folder: everything the map can show, without geometry. */
  private drawList(): void {
    const list = this.q('.mr-pm-list');
    list.replaceChildren();
    if (this.view === 'map') return;
    const { model } = this.state;
    const inner = h('div', 'mr-pm-list-inner');
    list.append(inner);
    const degree = new Map(model.places.map((place) => [place.id, { incoming: 0, outgoing: 0 }]));
    for (const connection of model.connections) {
      degree.get(connection.from)!.outgoing++;
      degree.get(connection.to)!.incoming++;
    }
    if (this.state.review) {
      this.reviewList(inner, degree);
      this.mark();
      return;
    }
    let places = model.places;
    if (this.near) {
      const near = this.near;
      const ids = new Set(model.connections.flatMap((c) => (c.from === near ? [c.to] : c.to === near ? [c.from] : [])));
      ids.delete(near);
      places = places.filter((place) => ids.has(place.id));
      const filter = h('p', 'mr-pm-filter');
      filter.append(
        h('span', '', `${plural(ids.size, 'document')} connected to ${this.place(near).title}`),
        iconAct('clear-near', 'Show every document', SHAPES.close),
      );
      inner.append(filter);
    }
    const folders = new Map<string, MapPlace[]>();
    for (const place of places.slice(0, this.listLimit)) folders.set(place.folder, [...(folders.get(place.folder) ?? []), place]);
    for (const [folder, group] of folders) {
      const section = h('section', 'mr-pm-group');
      const name = folder ? `${folder}/` : 'Top folder';
      section.setAttribute('aria-label', name);
      const heading = h('h2', 'mr-pm-folder', name);
      heading.append(h('span', '', plural(group.length, 'document')));
      const rows = h('div', 'mr-pm-rows');
      for (const place of group) rows.append(this.listRow(place, degree));
      section.append(heading, rows);
      inner.append(section);
    }
    if (places.length > this.listLimit)
      inner.append(act(`Show ${Math.min(LIST_PAGE, places.length - this.listLimit)} more of ${places.length}`, 'list-more', 'mr-btn mr-outline mr-pm-more'));
    this.mark();
  }

  /** A place as a row of List: its card, with its path for where it is, and how many links run each way. */
  private listRow(place: MapPlace, degree: Map<string, { incoming: number; outgoing: number }>): HTMLElement {
    const row = this.card(place);
    const caption = row.querySelector('.mr-pm-caption')!;
    const plain = place.state === 'indexed' || place.state === 'file';
    caption.replaceWith(h('small', 'mr-pm-path', plain ? place.path : `${place.path} · ${caption.textContent}`));
    const counts = degree.get(place.id)!;
    // A file has no links of its own to count.
    row.append(
      h('small', 'mr-pm-counts', place.state === 'file' ? `${counts.incoming} linked from` : `${counts.incoming} linked from · ${counts.outgoing} links to`),
    );
    return row;
  }

  /**
   * This review as rows: what links to what it changes, each chapter's files, every one of them, and what they link to.
   * What the reader added to a chapter is listed with it, as a reading aid, never as a link.
   */
  private reviewList(inner: HTMLElement, degree: Map<string, { incoming: number; outgoing: number }>): void {
    const review = this.state.review!;
    const around = linksAround(
      this.state.model,
      review.chapters.flatMap((chapter) => chapter.paths),
    );
    const group = (title: string, ids: string[], unit: string, added: Node[] = []) => {
      const section = h('section', 'mr-pm-group');
      section.setAttribute('aria-label', title);
      const heading = h('h2', 'mr-pm-folder', title);
      heading.append(h('span', '', plural(ids.length, unit)));
      const rows = h('div', 'mr-pm-rows');
      rows.append(...ids.map((id) => this.listRow(this.place(id), degree)), ...added);
      section.append(heading, rows);
      inner.append(section);
    };
    if (around.incoming.length) group('Linked from', around.incoming, 'document');
    for (const chapter of review.chapters) {
      const added = (chapter.attachments ?? []).map((attachment) => {
        const row = button('', 'open', 'mr-pm-place mr-pm-attachment');
        row.dataset.path = attachment.path;
        row.dataset.anchor = attachment.heading;
        row.append(h('strong', '', attachment.title), h('small', 'mr-pm-path', `Added by you · ${attachment.commit.slice(0, 7)}`));
        return row;
      });
      group(chapter.title, chapter.paths, 'file', added);
    }
    if (around.outgoing.length) group('Links to', around.outgoing, 'document');
    inner.append(h('p', 'mr-pm-note', 'Galley says what is worth checking; it never says a document is wrong.'));
  }

  private open(id: string, tab: Tab): void {
    this.selected = id;
    this.tab = previewable(this.place(id)) ? tab : 'links';
    this.connection = null;
    this.connectionLimit = CONNECTION_PAGE;
    this.sheetOpen = true;
    this.mark();
    this.drawSheet();
    if (this.mobile.matches) this.host.sheet.close.focus();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.drawSheet();
    this.host.sheet.element.querySelector<HTMLElement>(`.mr-pm-tab[data-tab="${tab}"]`)!.focus();
  }

  /** The details sheet: the reader's sheet, beside the map on wide screens and over it on phones. */
  private drawSheet(): void {
    this.previewVersion++;
    // Closing keeps the contents, so the sheet slides away whole; a map put away keeps its sheet for the return.
    if (!this.sheetOpen || !this.element.isConnected || this.element.closest('[hidden]')) return;
    const { sheet } = this.host;
    const body = sheet.body;
    for (const name of ['id', 'role', 'aria-labelledby']) body.removeAttribute(name);
    const place = this.place(this.selected!);
    if (this.connection) {
      const connection = this.state.model.connections.find((c) => c.id === this.connection)!;
      const back = act('Back to document', 'details', 'mr-btn mr-pm-sheet-back');
      back.prepend(lineIcon(SHAPES.back));
      const proof: Node[] = connection.proof.map((item) => this.proof(item));
      if (connection.hiddenProof) proof.push(h('p', 'mr-pm-note', `${plural(connection.hiddenProof, 'more link')} not listed here.`));
      sheet.fill({
        label: 'Link evidence',
        lead: [back],
        kicker: `${ORIGIN_NAMES[connection.origin]} · ${connection.verb}`,
        title: 'Link evidence',
        description: `${this.place(connection.from).title} → ${this.place(connection.to).title}`,
        body: proof,
      });
      sheet.show();
      return;
    }
    const { focus, here, changed, review } = this.state;
    const name = cardName(place.title);
    const badges: Node[] = [typeBadge(place.kind, name.label)];
    if (changed.has(place.id)) badges.push(chip('modified', 'Changed in this review'));
    if (place.id === here) badges.push(h('span', 'mr-pm-here', 'You are here'));
    const actions: Node[] = [];
    // A file is not a document: there is nothing to read, and nothing of its own to map.
    const file = place.state === 'file';
    if (review ? !file : place.id !== focus) actions.push(iconAct('focus', 'Show its connections', SHAPES.locate, 'Show its connections on the map'));
    if (!file) {
      const read = button('Read', 'open', 'mr-btn mr-outline mr-pm-read');
      read.dataset.path = place.id;
      read.prepend(lineIcon(SHAPES.read));
      read.title = 'Read the whole document';
      actions.push(read);
    }
    const connected = this.state.model.connections.filter((connection) => connection.from === place.id || connection.to === place.id);
    const tabs = h('div', 'mr-pm-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Document details');
    for (const id of ['preview', 'links'] as const) {
      const tab = act(id === 'preview' ? 'Preview' : 'Links', 'tab', 'mr-pm-tab');
      if (id === 'links') tab.append(h('span', '', String(connected.length)));
      tab.dataset.tab = id;
      tab.id = `mr-pm-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === this.tab));
      tab.setAttribute('aria-controls', 'mr-pm-sheet-panel');
      tab.tabIndex = id === this.tab ? 0 : -1;
      tab.disabled = id === 'preview' && !previewable(place);
      tabs.append(tab);
    }
    sheet.fill({
      label: this.tab === 'preview' ? 'Document preview' : 'Selected document',
      lead: badges,
      actions,
      title: name.name,
      description: `${place.path} · ${this.host.commit.slice(0, 7)}`,
      extra: [tabs],
      body: [],
    });
    body.id = 'mr-pm-sheet-panel';
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-labelledby', `mr-pm-tab-${this.tab}`);
    sheet.show();
    if (this.tab === 'links') this.links(body, place, connected);
    else if (this.shown?.path === place.id) body.append(this.shown.content);
    else {
      body.append(h('p', 'mr-pm-note', 'Opening the document…'));
      const version = this.previewVersion;
      void this.host.preview(place.id).then((content) => {
        if (version !== this.previewVersion) return;
        if (content) this.shown = { path: place.id, content };
        body.replaceChildren(content ?? h('p', 'mr-pm-note', 'This document cannot be shown here. Read it to see why.'));
      });
    }
  }

  /** Links: how a neighbour connects to the focus, every link in and out, what cannot be followed, and the type. */
  private links(body: HTMLElement, place: MapPlace, connected: MapConnection[]): void {
    const { focus, review } = this.state;
    if (place.state === 'file') {
      body.append(h('p', 'mr-pm-note', 'A file, not a document: only the documents that link to it are shown.'));
      const declares = review!.declares?.[place.id];
      if (declares?.length) body.append(h('p', 'mr-pm-note', `Declares ${declares.join(', ')}.`));
    } else if (place.state !== 'indexed') body.append(h('p', 'mr-pm-note', 'Not read: only the links to it are shown.'));
    // How it connects to the middle: the document in focus, or around a review, what the review changes.
    const centre = new Set(review ? review.chapters.flatMap((chapter) => chapter.paths) : [focus]);
    const between = centre.has(place.id) ? [] : connected.filter((connection) => centre.has(connection.from) || centre.has(connection.to));
    if (between.length) {
      const why = h('section', 'mr-pm-why');
      why.append(h('h3', '', review ? 'How it connects to this review' : `How it connects to ${cardName(this.place(focus).title).name}`));
      for (const connection of between) {
        const other = cardName(this.place(connection.from === place.id ? connection.to : connection.from).title).name;
        why.append(h('p', 'mr-pm-why-direction', connection.from === place.id ? `This links to ${other}` : `${other} links here`));
        for (const proof of connection.proof.slice(0, 2)) why.append(this.proof(proof));
        const count = connection.proof.length + connection.hiddenProof;
        if (count > 2) {
          const all = act(`See all ${count} links`, 'connection');
          all.dataset.id = connection.id;
          why.append(all);
        }
      }
      body.append(why);
    }
    const visible = new Set(connected.slice(0, this.connectionLimit));
    for (const incoming of [true, false]) {
      const links = connected.filter((connection) => (incoming ? connection.to : connection.from) === place.id);
      const label = incoming ? 'Linked from' : 'Links to';
      const group = h('section', 'mr-pm-link-group');
      group.setAttribute('aria-label', label);
      const heading = h('h3', '', label);
      heading.append(h('span', '', String(links.length)));
      group.append(heading);
      for (const connection of links.filter((connection) => visible.has(connection))) {
        const other = this.place(incoming ? connection.from : connection.to);
        const name = cardName(other.title);
        const row = act('', 'connection', 'mr-pm-connection');
        row.dataset.id = connection.id;
        row.setAttribute('aria-label', `Link evidence: ${this.place(connection.from).title} links to ${this.place(connection.to).title}`);
        row.append(
          h('strong', '', name.name),
          h('small', '', `${name.label ?? other.kind} · ${plural(connection.proof.length + connection.hiddenProof, 'link')}`),
        );
        group.append(row);
      }
      if (!links.length) group.append(h('p', 'mr-pm-path', incoming ? 'No document read so far links here.' : 'No links to other listed documents.'));
      body.append(group);
    }
    if (connected.length > this.connectionLimit)
      body.append(
        act(`Show ${Math.min(CONNECTION_PAGE, connected.length - this.connectionLimit)} more links`, 'connections-more', 'mr-btn mr-outline mr-pm-more'),
      );
    const problems = this.host.problems(place.id);
    if (problems) body.append(problems);
    const details = this.host.details(place.id);
    if (details.length) {
      const about = h('section', 'mr-pm-about');
      about.append(h('h3', '', 'Type and status'), ...details);
      body.append(about);
    }
  }

  /** One link as evidence: its words, where it is, and the way to the paragraph that holds it. */
  private proof(proof: MapProof): HTMLElement {
    const item = h('div', 'mr-pm-proof');
    const open = button('Read source paragraph', 'evidence');
    open.dataset.path = proof.path;
    open.dataset.line = String(proof.line);
    item.append(
      h('blockquote', '', proof.quote || 'A link without text'),
      h('p', 'mr-pm-path', `${proof.path} · ${proof.section ?? 'Document'} · line ${proof.line} · ${this.host.commit.slice(0, 7)}`),
      open,
    );
    return item;
  }

  private focusPlace(id: string): void {
    [...this.element.querySelectorAll<HTMLElement>('.mr-pm-place')].find((node) => node.dataset.id === id)?.focus();
  }

  /** Fit shows the whole neighbourhood: at full size when it fits, otherwise scaled down, and centred. */
  private fit(): void {
    const canvas = this.q('.mr-pm-canvas');
    const world = this.q('.mr-pm-world');
    canvas.scrollTop = 0;
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

  /** Zoom keeps the point under the pointer, or the middle of the map, where it is. */
  private zoomTo(level: number, at?: { x: number; y: number }): void {
    const canvas = this.q('.mr-pm-canvas');
    const point = at ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const zoom = Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, level)) * 100) / 100;
    this.camera.x = point.x - ((point.x - this.camera.x) * zoom) / this.camera.zoom;
    this.camera.y = point.y - ((point.y - this.camera.y) * zoom) / this.camera.zoom;
    this.camera.zoom = zoom;
    this.moveCamera();
  }

  private moveCamera(): void {
    const { x, y, zoom } = this.camera;
    this.q('.mr-pm-world').style.transform = this.stacked ? '' : `translate(${x}px, ${y}px) scale(${zoom})`;
    this.q<HTMLButtonElement>('[data-act="pm-zoom-in"]').disabled = zoom >= ZOOM.max;
    this.q<HTMLButtonElement>('[data-act="pm-zoom-out"]').disabled = zoom <= ZOOM.min;
  }

  /** Show its connections, and Back to my place: a deliberate new middle, which the library remembers. */
  private refocus(id: string): void {
    this.host.refocus!(id);
    this.state = { ...this.state, focus: id };
    this.view = 'map';
    this.near = null;
    this.connection = null;
    this.render();
    this.fit();
  }
}
