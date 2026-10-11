import { expect, it } from 'vitest';
import { indexDocument, ProjectIndex, type Corrections } from './docindex.ts';
import {
  documentMap,
  MAP_LINK_LIMIT,
  MAP_NEIGHBOUR_LIMIT,
  MAP_NODE_LIMIT,
  MAP_PROOF_LIMIT,
  mapOverview,
  MapPlacement,
  type ProjectMapModel,
} from './project-map.ts';

const corrections: Corrections = { docs: new Map(), folders: new Map() };
const indexOf = (docs: Record<string, string>) => {
  const index = new ProjectIndex(Object.keys(docs));
  for (const [path, text] of Object.entries(docs)) index.add(indexDocument(path, text));
  return index;
};
const graph = (links: Array<[string, string]>, isolated: string[] = []): ProjectMapModel => {
  const ids = [...new Set([...isolated, ...links.flat()])];
  return {
    places: ids.map((id) => ({
      id,
      title: id,
      path: id,
      folder: id.split('/').slice(0, -1).join('/'),
      kind: 'Document',
      kindFrom: 'none',
      sourceKind: 'Document',
      sourceKindFrom: 'none',
      origin: 'documented',
      statuses: [],
      state: 'indexed',
    })),
    connections: links.map(([from, to]) => ({
      id: `${from}\u0000${to}`,
      from,
      to,
      verb: 'links to',
      origin: 'documented',
      proof: [{ path: from, line: 3, quote: to, section: 'Links' }],
      hiddenProof: 0,
    })),
    omittedPlaces: 0,
    omittedConnections: 0,
  };
};

it('keeps the source kind, both conflicting statuses and exact link evidence, without changing the index', () => {
  const index = indexOf({
    'docs/adr/z.md': '---\ntype: adr\nstatus: Accepted\n---\n# Decision\n\n## Status\n\nProposed\n\n## Context\n\n[guide](../guide.md)',
    'docs/guide.md': '# Guide',
    'README.md': '# Start\n\n[decision](docs/adr/z.md)',
  });
  const model = documentMap(index, corrections);
  expect(model.places.map((place) => place.id)).toEqual(['README.md', 'docs/adr/z.md', 'docs/guide.md']);
  expect(model.places[1]).toMatchObject({
    title: 'Decision',
    folder: 'docs/adr',
    kind: 'Decision',
    kindFrom: 'metadata',
    statuses: ['Accepted', 'Proposed'],
    state: 'indexed',
  });
  expect(model.connections.find((connection) => connection.from === 'docs/adr/z.md')).toMatchObject({
    to: 'docs/guide.md',
    verb: 'links to',
    origin: 'documented',
    proof: [{ path: 'docs/adr/z.md', quote: 'guide', line: 13, section: 'Context' }],
    hiddenProof: 0,
  });
  expect(index.edges).toHaveLength(2);
  expect(index.docs.get('docs/adr/z.md')!.kind).toBe('decision');
  const own = documentMap(index, { docs: new Map([['docs/adr/z.md', 'runbook']]), folders: new Map() });
  expect(own.places[1]).toMatchObject({ kind: 'Runbook', kindFrom: 'reader', sourceKind: 'Decision', sourceKindFrom: 'metadata' });
});

it('does not present a missing section as verified, while retaining another valid link between the same documents', () => {
  const index = indexOf({ 'README.md': '# Home\n\n[bad](guide.md#gone) [good](guide.md#present)', 'guide.md': '# Guide\n\n## Present' });
  const model = documentMap(index, corrections);
  expect(model.connections[0].proof.map((proof) => proof.quote)).toEqual(['good']);
  expect(index.problems).toHaveLength(1);
  expect(index.edges[0].evidence).toHaveLength(2);
  index.add(indexDocument('README.md', '# Home\n\n[bad](guide.md#gone) [missing](missing.md)'));
  expect(documentMap(index, corrections).connections).toEqual([]);
  expect(index.problems).toHaveLength(2);
});

it('distinguishes unindexed, unreadable and oversized documents from a successfully read empty document', () => {
  const index = new ProjectIndex(['README.md', 'docs/adr/a.md', 'scratch.md', 'failed.md', 'huge.md', 'empty.md']);
  const failed = indexDocument('failed.md', '');
  failed.unread = 'failed';
  index.add(failed);
  const huge = indexDocument('huge.md', '');
  huge.unread = 'too-large';
  index.add(huge);
  index.add(indexDocument('empty.md', ''));
  const model = documentMap(index, corrections);
  expect(model.places.find((place) => place.path === 'README.md')).toMatchObject({
    title: 'README',
    kind: 'Overview',
    kindFrom: 'path',
    folder: '',
    state: 'not-read',
  });
  expect(model.places.find((place) => place.path === 'scratch.md')).toMatchObject({ kind: 'Document', kindFrom: 'none', state: 'not-read', statuses: [] });
  expect(model.places.find((place) => place.path === 'failed.md')!.state).toBe('failed');
  expect(model.places.find((place) => place.path === 'huge.md')!.state).toBe('too-large');
  expect(model.places.find((place) => place.path === 'empty.md')!.state).toBe('indexed');
});

it('caps places and inspected relationships, counts omissions and deduplicates the listing', () => {
  const listed = Array.from({ length: MAP_NODE_LIMIT + 1 }, (_, i) => `p${String(i).padStart(4, '0')}.md`);
  const index = new ProjectIndex([...listed, listed[0]]);
  const proof = indexDocument(listed[0], '# A\n\n[B](p0001.md)').links;
  for (let from = 0; from < 80 && index.edges.length <= MAP_LINK_LIMIT; from++) {
    for (let to = 0; to < 80 && index.edges.length <= MAP_LINK_LIMIT; to++) {
      if (from !== to) index.edges.push({ from: listed[from], to: listed[to], evidence: proof });
    }
  }
  index.edges[0] = { from: listed[0], to: listed[MAP_NODE_LIMIT], evidence: proof };
  const model = documentMap(index, corrections);
  expect(model.places).toHaveLength(MAP_NODE_LIMIT);
  expect(model.omittedPlaces).toBe(1);
  expect(model.connections).toHaveLength(MAP_LINK_LIMIT - 1);
  expect(model.omittedConnections).toBe(2);
});

it('counts evidence beyond the preview budget rather than silently losing its existence', () => {
  const index = indexOf({ 'README.md': `# Start\n\n${Array.from({ length: MAP_PROOF_LIMIT + 2 }, (_, i) => `[link ${i}](a.md)`).join(' ')}`, 'a.md': '# A' });
  const connection = documentMap(index, corrections).connections[0];
  expect(connection.proof).toHaveLength(MAP_PROOF_LIMIT);
  expect(connection.hiddenProof).toBe(2);
  expect(index.edges[0].evidence).toHaveLength(MAP_PROOF_LIMIT + 2);
});

it('groups only by literal containment and counts real directional references between regions', () => {
  const model = graph(
    [
      ['a/first.md', 'b/one.md'],
      ['a/second.md', 'b/one.md'],
      ['b/one.md', 'a/first.md'],
      ['b/one.md', 'b/two.md'],
    ],
    ['README.md', 'isolated/x.md'],
  );
  const overview = mapOverview(model);
  expect(overview.regions.map((region) => region.folder)).toEqual(['', 'a', 'b', 'isolated']);
  expect(overview.regions[1].places).toHaveLength(2);
  expect(overview.references.map((reference) => [reference.from, reference.to, reference.connections.length])).toEqual([
    ['a', 'b', 2],
    ['b', 'a', 1],
  ]);
  expect(overview.references.flatMap((reference) => reference.connections)).not.toContain(model.connections[3]);
  expect(mapOverview(graph([], [])).regions).toEqual([]);
});

it('places each neighbour once, including cycles and reciprocal links, and never invents a line', () => {
  const model = graph(
    [
      ['a', 'focus'],
      ['focus', 'a'],
      ['focus', 'b'],
      ['b', 'c'],
      ['focus', 'focus'],
    ],
    ['lonely'],
  );
  const layout = new MapPlacement();
  const view = layout.neighbourhood(model, 'focus', 8);
  expect(view.places.map((position) => [position.place.id, position.lane])).toEqual([
    ['focus', 'here'],
    ['a', 'incoming'],
    ['b', 'outgoing'],
  ]);
  expect(view.connections).toEqual(model.connections.filter((connection) => connection.to !== 'c'));
  expect(view.hidden).toBe(0);
  expect(layout.neighbourhood(model, 'lonely', 8)).toMatchObject({ places: [{ place: { id: 'lonely' }, lane: 'here', slot: 0 }], connections: [], hidden: 0 });
  expect(layout.neighbourhood(model, 'missing', 8)).toEqual({ places: [], connections: [], hidden: 0 });
});

it('keeps occupied slots as indexing adds earlier names or changes a connection direction; a new snapshot resets them', () => {
  const before = graph([
    ['b', 'focus'],
    ['focus', 'z'],
  ]);
  const layout = new MapPlacement();
  const first = layout.neighbourhood(before, 'focus', 8);
  const after = graph([
    ['a', 'focus'],
    ['b', 'focus'],
    ['z', 'focus'],
    ['focus', 'y'],
  ]);
  const second = layout.neighbourhood(after, 'focus', 8);
  for (const id of ['b', 'z']) expect(second.places.find((p) => p.place.id === id)).toMatchObject(first.places.find((p) => p.place.id === id)!);
  expect(second.places.find((p) => p.place.id === 'a')).toMatchObject({ lane: 'incoming', slot: 1 });
  // Other neighbourhoods do not consume this focus's slots.
  layout.neighbourhood(after, 'a', 8);
  expect(layout.neighbourhood(after, 'focus', 8)).toEqual(second);
  layout.clear();
  expect(layout.neighbourhood(after, 'focus', 8).places.find((p) => p.place.id === 'a')).toMatchObject({ lane: 'incoming', slot: 0 });
  expect(new MapPlacement().neighbourhood(after, 'focus', 8)).toEqual(layout.neighbourhood(after, 'focus', 8));
});

it('bounds high-degree neighbourhoods, keeps hidden counts and supports a centre-only inspection', () => {
  const model = graph(Array.from({ length: 30 }, (_, i) => (i % 2 ? [`i${i}`, 'focus'] : ['focus', `o${i}`])));
  const layout = new MapPlacement();
  const view = layout.neighbourhood(model, 'focus', 1000);
  expect(view.places).toHaveLength(1 + MAP_NEIGHBOUR_LIMIT * 2);
  expect(view.hidden).toBe(30 - MAP_NEIGHBOUR_LIMIT * 2);
  expect(layout.neighbourhood(model, 'focus', 1.9).places).toHaveLength(3);
  const only = layout.neighbourhood(model, 'focus', -1);
  expect(only.places).toHaveLength(1);
  expect(only.connections).toEqual([]);
  expect(only.hidden).toBe(30);
});
