import { MAP_NEIGHBOUR_LIMIT, type MapPlace, type MapPosition } from '../src/core/project-map.ts';
import { button, h } from '../src/ui/components/dom.ts';
import { applyReadingControls, selectTab } from '../src/ui/components/settings-sheet.ts';
import { TEXT_SIZES, type Settings } from '../src/ui/preferences/settings.ts';
import { type Lane, PHONE_LANE, SHAPES, STACK_BELOW, cardName, lineIcon, placeBadge } from './project-map-shared.ts';
import { PrototypeBase } from './project-map-base.ts';

export abstract class PrototypeDrawing extends PrototypeBase {
  protected place(id: string): MapPlace {
    return this.places.get(id)!;
  }

  protected title(id: string): string {
    return this.place(id).title;
  }

  protected applySettings(): void {
    this.root.dataset.theme = this.settings.theme;
    this.root.dataset.font = this.settings.font;
    this.root.dataset.density = this.settings.density;
    this.root.classList.toggle('is-dark', this.settings.appearance === 'dark' || (this.settings.appearance === 'auto' && this.dark.matches));
    this.root.classList.toggle('no-top-glow', !this.settings.topGlow);
    this.root.style.setProperty('--text-scale', String(TEXT_SIZES[this.settings.size] / 20));
    this.root.style.setProperty('--body-size', `${TEXT_SIZES[this.settings.size]}px`);
    applyReadingControls(this.root, this.settings);
  }

  protected update(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    this.applySettings();
    this.draw();
  }

  protected openSettings(tab = 'reading'): void {
    const sheet = this.q('.mr-settings');
    sheet.hidden = false;
    selectTab(sheet, tab);
    for (const selector of ['.mr-atlas-chrome', '.mr-atlas-shell']) this.q(selector).inert = true;
    this.q('[data-act="settings"]').setAttribute('aria-expanded', 'true');
    this.palettes.reveal(this.settings.theme);
    this.q('.mr-settings-heading [data-act="close-settings"]').focus();
  }

  protected closeSettings(): void {
    this.q('.mr-settings').hidden = true;
    for (const selector of ['.mr-atlas-chrome', '.mr-atlas-shell']) this.q(selector).inert = false;
    this.drawDetail();
    this.q('[data-act="settings"]').setAttribute('aria-expanded', 'false');
    this.q('[data-act="settings"]').focus({ preventScroll: true });
  }

  protected draw(): void {
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
  protected measure(): void {
    const canvas = this.q('.mr-atlas-canvas');
    const stacked = this.mobile.matches || (canvas.clientWidth > 0 && canvas.clientWidth < STACK_BELOW);
    if (stacked === this.stacked) return;
    this.stacked = stacked;
    this.root.classList.toggle('is-stacked', stacked);
    if (stacked) this.camera = { x: 0, y: 0, zoom: 1 };
  }

  protected placeCard(place: MapPlace, lane?: Lane): HTMLButtonElement {
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

  protected drawMap(): void {
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
  protected drawLines(): void {
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
  protected markSelection(): void {
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
}
