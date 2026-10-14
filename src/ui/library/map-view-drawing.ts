import { MAP_CENTRE_LIMIT, MAP_NEIGHBOUR_LIMIT, type MapConnection, type MapPlace } from '../../core/project-map.ts';
import { chip, h } from '../components/dom.ts';
import { type Box, type Curve, type Lane, PHONE_LANE, SHAPES, STACK_BELOW, SVG, type Shape, act, cardName, lineIcon, typeBadge } from './map-view-shared.ts';
import { DocumentMapBase } from './map-view-base.ts';

/** Drawing the map: places, lines and selection. */
export abstract class DocumentMapDrawing extends DocumentMapBase {
  protected place(id: string): MapPlace {
    return this.places.get(id)!;
  }

  protected render(): void {
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
  protected measure(): void {
    const width = this.q('.mr-pm-canvas').clientWidth;
    const stacked = this.mobile.matches || (width > 0 && width < STACK_BELOW);
    if (stacked === this.stacked) return;
    this.stacked = stacked;
    this.element.classList.toggle('is-stacked', stacked);
    if (stacked) this.camera = { x: 0, y: 0, zoom: 1 };
  }

  protected card(place: MapPlace, lane?: Lane): HTMLButtonElement {
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
  protected empty(lane: Lane, elsewhere: boolean): string {
    if (this.state.review)
      return lane === 'incoming' ? 'No document read so far links to what this review changes.' : 'What this review changes links to no other listed document.';
    if (lane === 'incoming') return elsewhere ? 'Every document that links here is also one it links to.' : 'No document read so far links here.';
    if (elsewhere) return 'Every document it links to also links here.';
    const state = this.place(this.state.focus).state;
    if (state === 'indexed') return 'It links to no other listed document.';
    return state === 'not-read' ? 'Not read yet: its links are not shown.' : 'Its links could not be read.';
  }

  protected drawMap(): void {
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
  protected centre(stack: HTMLElement, head: HTMLElement, places: MapPlace[], centre: { connected: number; unconnected: number }, quiet: Set<string>): void {
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
  protected drawLines(): void {
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
  protected focusShape(
    connection: MapConnection,
    frame: { id: string; box: Box; above: number },
    box: (id: string) => Box,
    curve: Curve,
    both: boolean,
  ): Shape {
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
  protected aroundShape(connection: MapConnection, box: (id: string) => Box, curve: Curve, both: boolean): Shape | null {
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
  protected sameLane(lane: Lane, from: Box, to: Box, both: boolean, touchesFocus: boolean): Shape {
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
  protected mark(): void {
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
}
