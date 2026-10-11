// Issue #68's layout spike is demo-only while ADR 0030 is Proposed. The extension's Map is unchanged.
import { indexDocument, KIND_SOURCES, ProjectIndex } from '../src/core/docindex.ts';
import { documentMap, mapOverview, MapPlacement, type MapConnection, type MapPlace, type MapProof, type ProjectMapModel } from '../src/core/project-map.ts';
import type { RepositorySource } from '../src/platforms/types.ts';
import { button, chip, h, option } from '../src/ui/components/dom.ts';
import { loadReaderFonts } from '../src/ui/components/fonts.ts';
import readerCss from '../src/ui/components/reader.css';
import { DEFAULT_SETTINGS, loadSettings, TEXT_SIZES, THEMES, type Settings } from '../src/ui/preferences/settings.ts';
import { renderDocument } from '../src/ui/rendering/render.ts';
import css from './project-map.css';

/** Try the real document index and safe renderer, without introducing a second provider or storage model. */
export async function openMapPrototype(source: RepositorySource, fixture = 'small'): Promise<void> {
  document.querySelector('#galley-map-prototype')?.dispatchEvent(new Event('close-prototype'));
  const host = h('div');
  host.id = 'galley-map-prototype';
  const shadow = host.attachShadow({ mode: 'open' });
  const styles = h('style', '', readerCss + css);
  const root = h('div', 'mr-root mr-atlas mode-clean no-top-glow');
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Project map prototype');
  const top = h('header', 'mr-atlas-chrome');
  top.append(
    button('Close prototype', 'close'),
    h('span', 'mr-brand', 'galley'),
    h('span', 'mr-atlas-repo', source.name),
    h('span', 'mr-atlas-prototype', 'Design prototype · #68'),
  );
  const head = h('header', 'mr-atlas-head');
  head.append(h('h1', '', 'Project map'), h('p', '', 'See where this fits. Follow the sources.'));
  const tools = h('div', 'mr-atlas-tools');
  const choices = h('div', 'mr-atlas-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Map presentation');
  choices.append(button('Map', 'map'), button('List', 'list'), button('Overview', 'overview'));
  const search = h('input');
  search.type = 'search';
  search.placeholder = 'Find a place…';
  search.setAttribute('aria-label', 'Find a place');
  const controls = h('details', 'mr-atlas-controls');
  controls.append(h('summary', '', 'Preview settings'));
  const settings = { ...DEFAULT_SETTINGS, ...(await loadSettings()) };
  if (settings.appearance === 'auto') settings.appearance = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const choose = (label: string, name: string, values: Array<[string, string]>, selected: string) => {
    const box = h('label', '', label);
    const select = h('select');
    select.dataset.setting = name;
    for (const [value, title] of values) select.append(option(value, title, value === selected));
    box.append(select);
    return box;
  };
  controls.append(
    choose(
      'Palette',
      'theme',
      THEMES.map((key) => [key, key]),
      settings.theme,
    ),
    choose(
      'Appearance',
      'appearance',
      [
        ['light', 'Light'],
        ['dark', 'Dark'],
      ],
      settings.appearance === 'dark' ? 'dark' : 'light',
    ),
    choose(
      'Text size',
      'size',
      TEXT_SIZES.map((size, index) => [String(index), `${size} px`]),
      String(settings.size),
    ),
    choose(
      'Density',
      'density',
      [
        ['comfortable', 'Comfortable'],
        ['compact', 'Compact'],
      ],
      settings.density,
    ),
  );
  tools.append(choices, search, controls);
  const status = h('p', 'mr-atlas-status', 'Reading the demo documents…');
  status.setAttribute('role', 'status');
  const workspace = h('div', 'mr-atlas-workspace');
  const mapColumn = h('section', 'mr-atlas-map-column');
  mapColumn.setAttribute('aria-label', 'Places and connections');
  const canvas = h('div', 'mr-atlas-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Map canvas: arrow keys pan, plus and minus zoom, zero fits the map');
  const world = h('div', 'mr-atlas-world');
  canvas.append(world);
  const list = h('div', 'mr-atlas-list');
  const navigation = h('div', 'mr-atlas-navigation');
  navigation.append(
    button('Fit map', 'fit'),
    button('−', 'zoom-out'),
    button('+', 'zoom-in'),
    button('Back to my place', 'home'),
    button('Details', 'details'),
  );
  navigation.querySelector('[data-act="zoom-out"]')!.setAttribute('aria-label', 'Zoom out');
  navigation.querySelector('[data-act="zoom-in"]')!.setAttribute('aria-label', 'Zoom in');
  const hidden = button('', 'more');
  mapColumn.append(canvas, list, hidden, navigation);
  const backdrop = button('Close details', 'close-details', 'mr-atlas-backdrop');
  backdrop.hidden = true;
  const detail = h('aside', 'mr-atlas-detail');
  detail.setAttribute('aria-label', 'Selected place');
  workspace.append(mapColumn, backdrop, detail);
  const footer = h('p', 'mr-atlas-footer', 'Regions are source folders. Lines are explicit document links.');
  const mapView = h('div', 'mr-atlas-map-view');
  mapView.append(head, tools, status, workspace, footer);
  const article = h('article', 'mr-atlas-article');
  article.hidden = true;
  root.append(top, mapView, article);
  shadow.append(styles, root);
  document.body.append(host);
  loadReaderFonts(document);
  root.focus();
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
    new Prototype(root, model, index, texts, source, settings, host);
  } catch {
    status.textContent = 'The demo documents could not be read. Close the prototype and reopen it to try again.';
  }
}

class Prototype {
  private readonly layout = new MapPlacement();
  private readonly q = <T extends HTMLElement = HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
  private readonly here: string;
  private focus: string;
  private selected: string;
  private connection: MapConnection | null = null;
  private view: 'map' | 'list' | 'overview' = 'map';
  private neighbours = 2;
  private query = '';
  private listLimit = 100;
  private connectionLimit = 12;
  private mapScroll = 0;
  private drawVersion = 0;
  private region: string | null = null;
  private detailsOpen = false;
  private camera = { x: 0, y: 0, zoom: 1 };
  private drag: { x: number; y: number; left: number; top: number } | null = null;
  private readonly mobile = matchMedia('(max-width: 760px)');
  private readonly observer: ResizeObserver;
  private readonly onMobile = () => {
    this.draw();
    this.fit();
  };
  private readonly close = () => {
    this.observer.disconnect();
    this.mobile.removeEventListener('change', this.onMobile);
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
    this.here = model.places.find((place) => place.id === source.start.path)?.id ?? 'docs/architecture/overview.md';
    this.focus = this.selected = this.here;
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKey);
    this.q<HTMLInputElement>('input').addEventListener('input', (event) => {
      this.query = (event.target as HTMLInputElement).value;
      this.listLimit = 100;
      this.region = null;
      this.view = this.query ? 'list' : 'map';
      this.draw();
    });
    root.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement;
      if (!select.matches('.mr-atlas-controls select[data-setting]')) return;
      const key = select.dataset.setting!;
      Object.assign(settings, { [key]: key === 'size' ? Number(select.value) : select.value });
      this.applySettings();
      this.draw();
    });
    const canvas = this.q('.mr-atlas-canvas');
    canvas.addEventListener('pointerdown', (event) => {
      if (this.mobile.matches || (event.target as Element).closest('button')) return;
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
    canvas.addEventListener('pointerup', () => {
      this.drag = null;
    });
    canvas.addEventListener('pointercancel', () => {
      this.drag = null;
    });
    this.mobile.addEventListener('change', this.onMobile);
    host.addEventListener('close-prototype', this.close);
    this.observer = new ResizeObserver(() => {
      this.drawMap();
      this.moveCamera();
    });
    this.observer.observe(canvas);
    this.applySettings();
    this.draw();
    this.fit();
  }

  private applySettings(): void {
    this.root.dataset.theme = this.settings.theme;
    this.root.dataset.font = 'galley';
    this.root.dataset.density = this.settings.density;
    this.root.classList.toggle('is-dark', this.settings.appearance === 'dark');
    this.root.style.setProperty('--text-scale', String(TEXT_SIZES[this.settings.size] / 20));
    this.root.style.setProperty('--body-size', `${TEXT_SIZES[this.settings.size]}px`);
  }

  private draw(): void {
    this.q('.mr-atlas-status').textContent =
      `${this.index.docs.size} of ${this.index.listed.length} documents indexed · ${this.source.commit.slice(0, 7)}${this.index.problems.length ? ` · ${this.index.problems.length} unresolved links` : ''}`;
    this.q('.mr-atlas-canvas').hidden = this.view === 'list';
    this.q('.mr-atlas-list').hidden = this.view !== 'list';
    for (const choice of this.root.querySelectorAll<HTMLElement>('.mr-atlas-choices button'))
      choice.setAttribute('aria-pressed', String(choice.dataset.act === this.view));
    this.drawMap();
    this.drawList();
    this.drawDetail();
  }

  private placeButton(place: MapPlace): HTMLButtonElement {
    const node = button('', 'select', 'mr-atlas-place');
    node.dataset.id = place.id;
    node.setAttribute('aria-pressed', String(place.id === this.selected));
    node.setAttribute('aria-label', `${place.title}, ${place.kind}, ${place.path}`);
    node.append(h('strong', '', place.title), h('small', '', place.kind));
    if (place.id === this.here) node.append(h('span', 'mr-atlas-here', '● You are here'));
    if (place.state !== 'indexed')
      node.append(h('small', '', place.state === 'not-read' ? 'Not indexed yet' : place.state === 'failed' ? 'Could not be read' : 'Too large to read'));
    return node;
  }

  private drawMap(): void {
    if (this.view === 'list') return;
    const version = ++this.drawVersion;
    const world = this.q('.mr-atlas-world');
    world.replaceChildren();
    const more = this.q<HTMLButtonElement>('[data-act="more"]');
    more.hidden = true;
    if (this.view === 'overview') {
      world.className = 'mr-atlas-world mr-atlas-overview';
      const overview = mapOverview(this.model);
      for (const region of overview.regions.slice(0, 12)) {
        const item = button('', 'region', 'mr-atlas-region');
        item.dataset.folder = region.folder;
        item.append(h('strong', '', region.folder ? `${region.folder}/` : 'Top folder'), h('span', '', `${region.places.length} documents`));
        const outgoing = overview.references
          .filter((reference) => reference.from === region.folder)
          .reduce((sum, reference) => sum + reference.connections.length, 0);
        item.append(h('small', '', `${outgoing} outgoing document references`));
        world.append(item);
      }
      if (overview.regions.length > 12) {
        more.hidden = false;
        more.textContent = `${overview.regions.length - 12} more folders in List`;
      }
      return;
    }
    world.className = 'mr-atlas-world mr-atlas-neighbourhood';
    const neighbourhood = this.layout.neighbourhood(this.model, this.focus, this.mobile.matches ? 1 : this.neighbours);
    for (const position of neighbourhood.places) {
      const node = this.placeButton(position.place);
      node.dataset.lane = position.lane;
      node.style.gridColumn = this.mobile.matches ? '1' : position.lane === 'incoming' ? '1' : position.lane === 'here' ? '2' : '3';
      node.style.gridRow = String(this.mobile.matches ? (position.lane === 'incoming' ? 1 : position.lane === 'here' ? 2 : 3) : position.slot + 1);
      world.append(node);
    }
    if (neighbourhood.hidden) {
      more.hidden = false;
      more.textContent = `${neighbourhood.hidden} more connected places`;
    }
    requestAnimationFrame(() => {
      if (version === this.drawVersion) this.drawLines(neighbourhood.connections);
    });
  }

  private drawLines(connections: MapConnection[]): void {
    const world = this.q('.mr-atlas-world');
    if (this.view !== 'map' || !world.isConnected) return;
    world.querySelector('svg')?.remove();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('mr-atlas-lines');
    svg.setAttribute('viewBox', `0 0 ${world.scrollWidth} ${world.scrollHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    const nodes = new Map([...world.querySelectorAll<HTMLElement>('.mr-atlas-place')].map((node) => [node.dataset.id!, node]));
    for (const connection of connections) {
      const from = nodes.get(connection.from)!,
        to = nodes.get(connection.to)!;
      if (from === to) continue;
      const a = { x: from.offsetLeft + from.offsetWidth / 2, y: from.offsetTop + from.offsetHeight / 2 };
      const b = { x: to.offsetLeft + to.offsetWidth / 2, y: to.offsetTop + to.offsetHeight / 2 };
      const vertical = this.mobile.matches;
      const direction = Math.sign(vertical ? b.y - a.y : b.x - a.x);
      if (vertical) {
        a.y += (direction * from.offsetHeight) / 2;
        b.y -= (direction * to.offsetHeight) / 2;
      } else {
        a.x += (direction * from.offsetWidth) / 2;
        b.x -= (direction * to.offsetWidth) / 2;
      }
      const line = document.createElementNS(svg.namespaceURI, 'path');
      line.setAttribute(
        'd',
        vertical ? `M ${a.x} ${a.y} L ${b.x} ${b.y}` : `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`,
      );
      line.setAttribute('class', 'mr-atlas-line');
      svg.append(line);
      const end = document.createElementNS(svg.namespaceURI, 'path');
      end.setAttribute('class', 'mr-atlas-arrow');
      end.setAttribute(
        'd',
        vertical
          ? `M ${b.x - 4} ${b.y - direction * 7} L ${b.x} ${b.y} L ${b.x + 4} ${b.y - direction * 7}`
          : `M ${b.x - direction * 7} ${b.y - 4} L ${b.x} ${b.y} L ${b.x - direction * 7} ${b.y + 4}`,
      );
      svg.append(end);
      if (connection.from === this.focus || connection.to === this.focus) {
        const label = button('links to', 'connection', 'mr-atlas-edge');
        label.dataset.id = connection.id;
        label.setAttribute('aria-label', `${this.title(connection.from)} links to ${this.title(connection.to)}: inspect evidence`);
        label.style.left = `${(a.x + b.x) / 2}px`;
        label.style.top = `${(a.y + b.y) / 2}px`;
        world.append(label);
      }
    }
    world.prepend(svg);
  }

  private drawList(): void {
    const list = this.q('.mr-atlas-list');
    list.replaceChildren();
    if (this.view !== 'list') return;
    const found = this.model.places.filter(
      (place) => (this.region === null || place.folder === this.region) && `${place.title} ${place.path}`.toLowerCase().includes(this.query.toLowerCase()),
    );
    if (!found.length) list.append(h('p', '', 'No indexed name or path matches.'));
    if (this.index.docs.size < this.index.listed.length) list.append(h('p', '', 'Names from unindexed documents may be incomplete.'));
    for (const place of found.slice(0, this.listLimit)) {
      const row = this.placeButton(place);
      row.append(h('small', 'mr-atlas-path', place.path));
      list.append(row);
    }
    if (found.length > this.listLimit) list.append(button(`Show ${Math.min(100, found.length - this.listLimit)} more of ${found.length} places`, 'list-more'));
  }

  private drawDetail(): void {
    const detail = this.q('.mr-atlas-detail');
    detail.replaceChildren();
    detail.classList.toggle('is-open', this.detailsOpen);
    detail.setAttribute('role', this.mobile.matches ? 'dialog' : 'complementary');
    const modal = this.mobile.matches && this.detailsOpen;
    if (modal) detail.setAttribute('aria-modal', 'true');
    else detail.removeAttribute('aria-modal');
    for (const section of ['.mr-atlas-chrome', '.mr-atlas-head', '.mr-atlas-tools', '.mr-atlas-map-column']) this.q(section).inert = modal;
    this.q('.mr-atlas-backdrop').hidden = !modal;
    const close = button('Close details', 'close-details', 'mr-btn mr-atlas-close-detail');
    detail.append(close);
    const place = this.model.places.find((item) => item.id === this.selected)!;
    if (this.connection) {
      const connection = this.connection;
      detail.append(
        h('p', 'mr-atlas-kicker', 'Selected connection'),
        h('h2', '', `${this.title(connection.from)} → ${this.title(connection.to)}`),
        chip(null, 'Documented · links to'),
      );
      for (const [at, proof] of connection.proof.entries()) {
        const item = h('div', 'mr-atlas-proof');
        item.append(
          h('blockquote', '', proof.quote),
          h('p', 'mr-atlas-path', `${proof.path} · ${proof.section || 'Document'} · line ${proof.line} · ${this.source.commit.slice(0, 7)}`),
        );
        const open = button('Read source paragraph', 'proof');
        open.dataset.at = String(at);
        item.append(open);
        detail.append(item);
      }
      if (connection.hiddenProof) detail.append(h('p', '', `${connection.hiddenProof} additional source links beyond this preview budget.`));
      detail.append(button('Back to selected place', 'place-detail'));
      return;
    }
    detail.append(h('p', 'mr-atlas-kicker', 'Selected place'), h('h2', '', place.title), h('p', 'mr-atlas-path', place.path), chip(null, 'Documented'));
    detail.append(h('p', 'mr-atlas-path', `${place.kind} · ${KIND_SOURCES[place.kindFrom]}`));
    if (place.kindFrom === 'reader')
      detail.append(h('p', '', `The source says ${place.sourceKind} (${KIND_SOURCES[place.sourceKindFrom]}); you set ${place.kind}.`));
    for (const status of place.statuses) detail.append(chip(null, status));
    if (place.state !== 'indexed')
      detail.append(h('p', '', place.state === 'not-read' ? 'Not indexed: its outgoing links are unknown.' : 'This document could not be indexed.'));
    const read = button('Read document', 'read', 'mr-btn mr-primary');
    read.dataset.id = place.id;
    detail.append(read, button('Show connections', 'focus'));
    const connected = this.model.connections.filter((connection) => connection.from === place.id || connection.to === place.id);
    detail.append(h('h3', '', `${connected.length} connections`));
    for (const connection of connected.slice(0, this.connectionLimit)) {
      const row = button('', 'connection', 'mr-atlas-connection');
      row.dataset.id = connection.id;
      row.append(
        h('strong', '', this.title(connection.from === place.id ? connection.to : connection.from)),
        h('small', '', `${this.title(connection.from)} links to ${this.title(connection.to)}`),
      );
      detail.append(row);
    }
    if (connected.length > this.connectionLimit)
      detail.append(button(`Show ${Math.min(12, connected.length - this.connectionLimit)} more connections`, 'connections-more'));
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
      detail.append(box);
    }
  }

  private title(id: string): string {
    return this.model.places.find((place) => place.id === id)!.title;
  }

  private read(path: string, proof?: MapProof, anchor?: string): void {
    const text = this.texts.get(path);
    if (text === undefined) return;
    if (this.q('.mr-atlas-article').hidden) this.mapScroll = this.root.scrollTop;
    const rendered = renderDocument(document, {
      path,
      status: 'modified',
      base: text,
      head: text,
      links: this.source.links,
      origin: location.origin,
      images: 'ask',
    });
    const article = this.q('.mr-atlas-article');
    article.replaceChildren(button('← Back to map', 'return'), h('p', 'mr-atlas-path', `${path} · ${this.source.commit.slice(0, 7)}`), rendered.content);
    this.detailsOpen = false;
    this.drawDetail();
    this.q('.mr-atlas-map-view').hidden = true;
    article.hidden = false;
    const block = proof ? rendered.blocks.find((block) => block.head && block.head.lines[0] < proof.line && block.head.lines[1] >= proof.line) : undefined;
    const target =
      block?.el ??
      (anchor ? [...rendered.content.querySelectorAll<HTMLElement>('[id]')].find((el) => el.id === anchor || el.id === `user-content-${anchor}`) : undefined);
    if (target) {
      target.classList.add('mr-flash');
      target.scrollIntoView({ block: 'center' });
    } else this.root.scrollTop = 0;
    article.querySelector('button')!.focus({ preventScroll: true });
    // The spike leaves diagrams as their safe, readable source instead of extracting architectural entities.
    for (const diagram of rendered.diagrams) for (const version of diagram.versions) version.sourceDetails.open = true;
  }

  private fit(): void {
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.q('.mr-atlas-canvas').scrollTop = this.q('.mr-atlas-canvas').scrollLeft = 0;
    this.moveCamera();
  }
  private moveCamera(): void {
    this.q('.mr-atlas-world').style.transform = this.mobile.matches ? '' : `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.zoom})`;
  }
  private inspect(): void {
    this.detailsOpen = true;
    this.drawDetail();
    if (this.mobile.matches) this.q('.mr-atlas-detail [data-act="close-details"]').focus();
    else this.q(this.connection ? '[data-act="proof"]' : '.mr-atlas-detail [data-act="read"]').focus({ preventScroll: true });
  }
  private returnToMap(): void {
    this.q('.mr-atlas-article').hidden = true;
    this.q('.mr-atlas-map-view').hidden = false;
    this.draw();
    this.moveCamera();
    const node = [...this.root.querySelectorAll<HTMLElement>('.mr-atlas-place')].find(
      (node) => node.getClientRects().length && node.dataset.id === this.selected,
    );
    node?.focus({ preventScroll: true });
    this.root.scrollTop = this.mapScroll;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-mr-path]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      const [path, anchor] = link.dataset.mrPath!.split('#');
      if (this.texts.has(path)) {
        event.preventDefault();
        this.read(path, undefined, anchor);
      }
      return;
    }
    const control = (event.target as Element).closest<HTMLElement>('[data-act]');
    if (!control) return;
    switch (control.dataset.act) {
      case 'close':
        this.close();
        return;
      case 'select':
        this.selected = control.dataset.id!;
        this.connection = null;
        this.connectionLimit = 12;
        this.draw();
        this.inspect();
        if (!this.mobile.matches)
          [...this.root.querySelectorAll<HTMLElement>('.mr-atlas-place')]
            .find((node) => node.getClientRects().length && node.dataset.id === this.selected)
            ?.focus({ preventScroll: true });
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
        this.connection = this.model.connections.find((connection) => connection.id === control.dataset.id)!;
        this.inspect();
        return;
      case 'proof': {
        const proof = this.connection!.proof[Number(control.dataset.at)];
        this.read(proof.path, proof);
        return;
      }
      case 'read':
        this.read(control.dataset.id!);
        return;
      case 'return':
        this.returnToMap();
        return;
      case 'place-detail':
        this.connection = null;
        this.inspect();
        return;
      case 'close-details':
        this.detailsOpen = false;
        this.drawDetail();
        [...this.root.querySelectorAll<HTMLElement>('.mr-atlas-place')]
          .find((node) => node.getClientRects().length && node.dataset.id === this.selected)
          ?.focus();
        return;
      case 'details':
        this.inspect();
        return;
      case 'map':
        this.view = 'map';
        break;
      case 'list':
        this.view = 'list';
        this.region = null;
        break;
      case 'overview':
        this.view = 'overview';
        break;
      case 'region':
        this.region = control.dataset.folder!;
        this.view = 'list';
        this.query = '';
        this.q<HTMLInputElement>('input').value = '';
        break;
      case 'focus':
        this.focus = this.selected;
        this.view = 'map';
        this.connection = null;
        this.detailsOpen = false;
        this.neighbours = 2;
        break;
      case 'home':
        this.focus = this.selected = this.here;
        this.view = 'map';
        this.connection = null;
        this.neighbours = 2;
        break;
      case 'more':
        if (this.mobile.matches || this.view === 'overview' || this.neighbours === 8) {
          this.view = 'list';
          this.region = null;
        } else this.neighbours = 8;
        break;
      case 'fit':
        this.fit();
        return;
      case 'zoom-in':
        this.camera.zoom = Math.min(1.5, this.camera.zoom + 0.1);
        this.moveCamera();
        return;
      case 'zoom-out':
        this.camera.zoom = Math.max(0.75, this.camera.zoom - 0.1);
        this.moveCamera();
        return;
    }
    this.draw();
    if (['focus', 'home', 'overview'].includes(control.dataset.act!)) this.fit();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (!this.q('.mr-atlas-article').hidden) this.returnToMap();
      else if (this.detailsOpen) this.q<HTMLElement>('.mr-atlas-detail [data-act="close-details"]').click();
      else if (this.view !== 'map') {
        this.view = 'map';
        this.draw();
      } else this.q<HTMLElement>('[data-act="close"]').click();
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab' && this.mobile.matches && this.detailsOpen) {
      const buttons = [...this.q('.mr-atlas-detail').querySelectorAll<HTMLElement>('button,summary')].filter((node) => node.getClientRects().length);
      const active = this.root.getRootNode() as ShadowRoot;
      const first = buttons[0],
        last = buttons.at(-1)!;
      if (event.shiftKey && active.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === 'Tab' && !(this.mobile.matches && this.detailsOpen)) {
      const controls = [...this.root.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex="0"]')].filter(
        (node) => node.getClientRects().length && !node.closest('[inert]'),
      );
      const active = (this.root.getRootNode() as ShadowRoot).activeElement;
      if (event.shiftKey && active === controls[0]) {
        event.preventDefault();
        controls.at(-1)!.focus();
      } else if (!event.shiftKey && active === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    }
    if (event.target !== this.q('.mr-atlas-canvas') || this.mobile.matches) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (moves[event.key]) {
      event.preventDefault();
      this.camera.x += moves[event.key][0];
      this.camera.y += moves[event.key][1];
      this.moveCamera();
    } else if (event.key === '0') this.fit();
    else if (event.key === '+' || event.key === '-') this.q<HTMLElement>(`[data-act="zoom-${event.key === '+' ? 'in' : 'out'}"]`).click();
  };
}
