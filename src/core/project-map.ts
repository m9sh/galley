import type { Origin } from './architecture.ts';
import { classify, fileTitle, KIND_NAMES, pathKind, type Corrections, type KindSource, type ProjectIndex } from './docindex.ts';

/** Bounds for a map presentation, separate from discovery and indexing budgets. Omitted material stays counted. */
export const MAP_NODE_LIMIT = 2_000;
export const MAP_LINK_LIMIT = 6_000;
export const MAP_PROOF_LIMIT = 12;
export const MAP_NEIGHBOUR_LIMIT = 8;

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
  state: 'indexed' | 'not-read' | 'failed' | 'too-large';
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
}

export interface MapNeighbourhood {
  places: MapPosition[];
  connections: MapConnection[];
  hidden: number;
}

/** Session placement remembers occupied slots, so later indexing never moves an existing neighbour.
 * Clear it on a new commit. Inspection changes selection, not this focus or its placement. */
export class MapPlacement {
  private readonly positions = new Map<string, { lane: 'incoming' | 'outgoing'; slot: number }>();

  clear(): void {
    this.positions.clear();
  }

  neighbourhood(model: ProjectMapModel, focus: string, perLane: number): MapNeighbourhood {
    const center = model.places.find((place) => place.id === focus);
    if (!center) return { places: [], connections: [], hidden: 0 };
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
    const places: MapPosition[] = [{ place: center, lane: 'here', slot: 0 }, ...visible];
    const shown = new Set(places.map((position) => position.place.id));
    return {
      places,
      connections: model.connections.filter((connection) => shown.has(connection.from) && shown.has(connection.to)),
      hidden: ids.length - visible.length,
    };
  }
}
