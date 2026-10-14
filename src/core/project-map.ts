import type { Origin } from './architecture.ts';
import { classify, fileTitle, KIND_NAMES, pathKind, type Corrections, type DocLink, type KindSource, type ProjectIndex } from './docindex.ts';

/** Bounds for a map presentation, separate from discovery and indexing budgets. Omitted material stays counted. */
export const MAP_NODE_LIMIT = 2_000;
export const MAP_LINK_LIMIT = 6_000;
export const MAP_PROOF_LIMIT = 12;
export const MAP_NEIGHBOUR_LIMIT = 8;
/** Around a set, such as the files a review changes, the middle shows this many; the rest are in List. */
export const MAP_CENTRE_LIMIT = 24;

export interface MapPlace {
  id: string;
  title: string;
  path: string;
  /** Containment only; never an inferred system boundary. */
  folder: string;
  kind: string;
  kindFrom: KindSource;
  sourceKind: string;
  sourceKindFrom: KindSource;
  origin: Origin;
  statuses: string[];
  /** A file is not a document: a review changes it, and documents may link to it, but it is never read here. */
  state: 'indexed' | 'not-read' | 'failed' | 'too-large' | 'file';
}

export interface MapProof {
  path: string;
  line: number;
  quote: string;
  section: string | null;
}

export interface MapConnection {
  id: string;
  from: string;
  to: string;
  verb: string;
  origin: Origin;
  proof: MapProof[];
  hiddenProof: number;
}

export interface ProjectMapModel {
  places: MapPlace[];
  connections: MapConnection[];
  omittedPlaces: number;
  omittedConnections: number;
}

const compare = (a: string, b: string) => Number(a > b) - Number(a < b);
const pair = (from: string, to: string) => `${from}\u0000${to}`;

/** Adapt the existing index without fetching, changing classifications or manufacturing a relationship.
 * A broken anchor is still inspectable in ProjectIndex.problems, but cannot become a verified map line. */
export function documentMap(index: ProjectIndex, corrections: Corrections): ProjectMapModel {
  const listed = [...new Set(index.listed)].sort(compare);
  const places = listed.slice(0, MAP_NODE_LIMIT).map((path): MapPlace => {
    const doc = index.docs.get(path);
    const guessed = pathKind(path);
    const classification = doc ? classify(doc, corrections) : { kind: guessed ?? 'other', from: guessed ? ('path' as const) : ('none' as const) };
    return {
      id: path,
      title: doc?.title ?? fileTitle(path),
      path,
      folder: path.slice(0, Math.max(0, path.lastIndexOf('/'))),
      kind: KIND_NAMES[classification.kind],
      kindFrom: classification.from,
      sourceKind: KIND_NAMES[doc?.kind ?? guessed ?? 'other'],
      sourceKindFrom: doc?.kindFrom ?? (guessed ? 'path' : 'none'),
      origin: 'documented',
      statuses: doc ? [doc.status, doc.statusAlso].filter((value): value is string => value !== null) : [],
      state: doc ? (doc.unread ?? 'indexed') : 'not-read',
    };
  });
  const ids = new Set(places.map((place) => place.id));
  const broken = new Set(index.problems.map((problem) => problem.link));
  const connections: MapConnection[] = [];
  // The index already groups repeated links by endpoints. A presentation must also bound inspected edges.
  const candidates = index.edges.slice(0, MAP_LINK_LIMIT);
  let outside = 0;
  for (const edge of candidates) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      outside++;
      continue;
    }
    const evidence = edge.evidence.filter((link) => !broken.has(link));
    if (!evidence.length) continue;
    connections.push({
      id: pair(edge.from, edge.to),
      from: edge.from,
      to: edge.to,
      verb: 'links to',
      origin: 'documented',
      proof: evidence.slice(0, MAP_PROOF_LIMIT).map((link) => ({ path: edge.from, line: link.line, quote: link.text, section: link.section })),
      hiddenProof: Math.max(0, evidence.length - MAP_PROOF_LIMIT),
    });
  }
  return {
    places,
    connections,
    omittedPlaces: Math.max(0, listed.length - MAP_NODE_LIMIT),
    omittedConnections: Math.max(0, index.edges.length - MAP_LINK_LIMIT) + outside,
  };
}

/**
 * A review on the map: every document as in documentMap, and each file the review changes that is not a document as a
 * place of its own, so a document's link to changed code is drawn too. A line is still only an explicit Markdown link.
 */
export function reviewMap(index: ProjectIndex, corrections: Corrections, changed: readonly string[]): ProjectMapModel {
  const model = documentMap(index, corrections);
  const ids = new Set(model.places.map((place) => place.id));
  const files = [...new Set(changed)].filter((path) => !ids.has(path));
  const places = model.places.concat(
    files.map((path): MapPlace => {
      const at = path.lastIndexOf('/');
      return {
        id: path,
        title: path.slice(at + 1),
        path,
        folder: path.slice(0, Math.max(0, at)),
        kind: 'File',
        kindFrom: 'none',
        sourceKind: 'File',
        sourceKindFrom: 'none',
        origin: 'documented',
        statuses: [],
        state: 'file',
      };
    }),
  );
  const wanted = new Set(files);
  const connections = [...model.connections];
  for (const doc of [...index.docs.values()].sort((a, b) => compare(a.path, b.path))) {
    const links = new Map<string, DocLink[]>();
    for (const link of doc.links) if (link.path !== null && wanted.has(link.path)) links.set(link.path, [...(links.get(link.path) ?? []), link]);
    for (const [to, evidence] of links)
      connections.push({
        id: pair(doc.path, to),
        from: doc.path,
        to,
        verb: 'links to',
        origin: 'documented',
        proof: evidence.slice(0, MAP_PROOF_LIMIT).map((link) => ({ path: doc.path, line: link.line, quote: link.text, section: link.section })),
        hiddenProof: Math.max(0, evidence.length - MAP_PROOF_LIMIT),
      });
  }
  return { ...model, places, connections };
}

export interface MapRegion {
  folder: string;
  places: MapPlace[];
}

export interface RegionReference {
  from: string;
  to: string;
  /** The actual source connections represented by this count; containment adds none. */
  connections: MapConnection[];
}

/** Overview regions are literal folders. Counts between them are document references, not dependencies. */
export function mapOverview(model: ProjectMapModel): { regions: MapRegion[]; references: RegionReference[] } {
  const groups = new Map<string, MapPlace[]>();
  const folders = new Map<string, string>();
  for (const place of model.places) {
    const group = groups.get(place.folder) ?? [];
    group.push(place);
    groups.set(place.folder, group);
    folders.set(place.id, place.folder);
  }
  const references = new Map<string, RegionReference>();
  for (const connection of model.connections) {
    const from = folders.get(connection.from)!;
    const to = folders.get(connection.to)!;
    if (from === to) continue;
    const key = pair(from, to);
    const reference = references.get(key) ?? { from, to, connections: [] };
    reference.connections.push(connection);
    references.set(key, reference);
  }
  return {
    regions: [...groups].sort(([a], [b]) => compare(a, b)).map(([folder, places]) => ({ folder, places })),
    references: [...references.values()].sort((a, b) => compare(pair(a.from, a.to), pair(b.from, b.to))),
  };
}

export interface MapPosition {
  place: MapPlace;
  lane: 'here' | 'incoming' | 'outgoing';
  slot: number;
  /** Of the middle around a set, with no connection read so far. */
  quiet?: boolean;
}

export interface MapNeighbourhood {
  places: MapPosition[];
  connections: MapConnection[];
  hidden: number;
  /** Every neighbour in each lane, shown or not: a lane's count always matches where its places are drawn. */
  totals: { incoming: number; outgoing: number };
  /** Around a set (around()): every place of the set with a connection, shown or not, and those with none. */
  centre?: { connected: number; unconnected: number };
}

/** Where around() keeps its own places, apart from every document's. */
const AROUND = '\u0001around';

/** Session placement remembers occupied slots, so later indexing never moves an existing neighbour.
 * Clear it on a new commit. Inspection changes selection, not this focus or its placement. */
export class MapPlacement {
  private readonly positions = new Map<string, { lane: 'incoming' | 'outgoing'; slot: number }>();

  clear(): void {
    this.positions.clear();
  }

  neighbourhood(model: ProjectMapModel, focus: string, perLane: number): MapNeighbourhood {
    const center = model.places.find((place) => place.id === focus);
    if (!center) return { places: [], connections: [], hidden: 0, totals: { incoming: 0, outgoing: 0 } };
    const limit = Math.max(0, Math.min(MAP_NEIGHBOUR_LIMIT, Math.floor(perLane)));
    const incoming = new Set<string>();
    const outgoing = new Set<string>();
    for (const connection of model.connections) {
      if (connection.to === focus) incoming.add(connection.from);
      if (connection.from === focus) outgoing.add(connection.to);
    }
    incoming.delete(focus);
    outgoing.delete(focus);
    const ids = [...new Set([...incoming, ...outgoing])].sort(compare);
    const used = { incoming: 0, outgoing: 0 };
    const prefix = `${focus}\u0000`;
    for (const [key, position] of this.positions) {
      if (key.startsWith(prefix)) used[position.lane] = Math.max(used[position.lane], position.slot + 1);
    }
    for (const id of ids) {
      const key = pair(focus, id);
      if (!this.positions.has(key)) {
        const lane = incoming.has(id) ? 'incoming' : 'outgoing';
        this.positions.set(key, { lane, slot: used[lane]++ });
      }
    }
    const counts = { incoming: 0, outgoing: 0 };
    const byId = new Map(model.places.map((place) => [place.id, place]));
    const placed = ids
      .map((id) => ({ place: byId.get(id)!, ...this.positions.get(pair(focus, id))! }))
      .sort((a, b) => a.slot - b.slot || compare(a.place.id, b.place.id));
    const visible = placed.filter((position) => counts[position.lane]++ < limit);
    // counts now holds every neighbour in each lane, including those past the limit.
    const places: MapPosition[] = [{ place: center, lane: 'here', slot: 0 }, ...visible];
    const shown = new Set(places.map((position) => position.place.id));
    return {
      places,
      connections: model.connections.filter((connection) => shown.has(connection.from) && shown.has(connection.to)),
      hidden: ids.length - visible.length,
      totals: counts,
    };
  }

  /**
   * The neighbourhood of a set, such as the files a review changes: all of it in the middle, in the order given, between
   * what links to it and what it links to. Each side keeps a neighbourhood's bounds; the middle shows up to
   * `inMiddle`, those with a connection first, and those with none are quiet. Every lane counts what it does not show.
   */
  around(model: ProjectMapModel, centre: readonly string[], perLane: number, inMiddle: number): MapNeighbourhood {
    const limit = Math.max(0, Math.min(MAP_NEIGHBOUR_LIMIT, Math.floor(perLane)));
    const byId = new Map(model.places.map((place) => [place.id, place]));
    const { incoming, outgoing, middle, unconnected } = linksAround(model, centre);
    const used = { incoming: 0, outgoing: 0 };
    for (const [key, position] of this.positions) {
      if (key.startsWith(AROUND)) used[position.lane] = Math.max(used[position.lane], position.slot + 1);
    }
    const into = new Set(incoming);
    // A neighbour is first placed level with the places of the middle it connects to, so lines rarely cross.
    const at = new Map(middle.map((id, index) => [id, index]));
    const level = new Map<string, { sum: number; count: number }>();
    for (const connection of model.connections)
      for (const [near, far] of [
        [connection.from, connection.to],
        [connection.to, connection.from],
      ]) {
        if (!at.has(far) || at.has(near)) continue;
        const entry = level.get(near) ?? { sum: 0, count: 0 };
        entry.sum += at.get(far)!;
        entry.count++;
        level.set(near, entry);
      }
    const mean = (id: string) => level.get(id)!.sum / level.get(id)!.count;
    const ids = [...incoming, ...outgoing].sort((a, b) => mean(a) - mean(b) || compare(a, b));
    for (const id of ids) {
      const key = pair(AROUND, id);
      if (!this.positions.has(key)) {
        const lane = into.has(id) ? 'incoming' : 'outgoing';
        this.positions.set(key, { lane, slot: used[lane]++ });
      }
    }
    const counts = { incoming: 0, outgoing: 0 };
    const placed = ids
      .map((id) => ({ place: byId.get(id)!, ...this.positions.get(pair(AROUND, id))! }))
      .sort((a, b) => a.slot - b.slot || compare(a.place.id, b.place.id));
    const visible = placed.filter((position) => counts[position.lane]++ < limit);
    const chosen = new Set([...middle, ...unconnected].slice(0, Math.max(0, Math.floor(inMiddle))));
    const quiet = new Set(unconnected);
    const centred = centre.filter((id, at) => chosen.has(id) && centre.indexOf(id) === at);
    const places: MapPosition[] = [
      ...centred.map((id, slot): MapPosition => ({ place: byId.get(id)!, lane: 'here', slot, ...(quiet.has(id) && { quiet: true }) })),
      ...visible,
    ];
    const shown = new Set(places.map((position) => position.place.id));
    return {
      places,
      connections: model.connections.filter((connection) => shown.has(connection.from) && shown.has(connection.to)),
      hidden: ids.length - visible.length + middle.length + unconnected.length - centred.length,
      totals: counts,
      centre: { connected: middle.length, unconnected: unconnected.length },
    };
  }
}

/**
 * What a set links with, unbounded: the places that link to it, those it links to (a place that does both is only
 * linking in), and those of the set with a connection, in the order given, and without one.
 */
export function linksAround(
  model: ProjectMapModel,
  centre: readonly string[],
): { incoming: string[]; outgoing: string[]; middle: string[]; unconnected: string[] } {
  const known = new Set(model.places.map((place) => place.id));
  const set = new Set(centre.filter((id) => known.has(id)));
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  const connected = new Set<string>();
  for (const connection of model.connections) {
    const [from, to] = [set.has(connection.from), set.has(connection.to)];
    if (from) connected.add(connection.from);
    if (to) connected.add(connection.to);
    if (to && !from) incoming.add(connection.from);
    if (from && !to) outgoing.add(connection.to);
  }
  for (const id of incoming) outgoing.delete(id);
  return {
    incoming: [...incoming].sort(compare),
    outgoing: [...outgoing].sort(compare),
    middle: [...set].filter((id) => connected.has(id)),
    unconnected: [...set].filter((id) => !connected.has(id)),
  };
}
