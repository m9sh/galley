import { expect, it } from 'vitest';
import { indexDocument, ProjectIndex, type Corrections } from './docindex.ts';
import {
  documentMap,
  linksAround,
  MAP_LINK_LIMIT,
  MAP_NEIGHBOUR_LIMIT,
  MAP_NODE_LIMIT,
  MAP_PROOF_LIMIT,
  MapPlacement,
  reviewMap,
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
  expect(view.totals).toEqual({ incoming: 1, outgoing: 1 });
  expect(layout.neighbourhood(model, 'lonely', 8)).toMatchObject({
    places: [{ place: { id: 'lonely' }, lane: 'here', slot: 0 }],
    connections: [],
    hidden: 0,
    totals: { incoming: 0, outgoing: 0 },
  });
  expect(layout.neighbourhood(model, 'missing', 8)).toEqual({ places: [], connections: [], hidden: 0, totals: { incoming: 0, outgoing: 0 } });
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
  // z now links here too, yet stays where it was drawn, and the lane counts say where the places are.
  expect(second.totals).toEqual({ incoming: 2, outgoing: 2 });
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
  expect(view.totals).toEqual({ incoming: 15, outgoing: 15 });
  expect(layout.neighbourhood(model, 'focus', 1.9).places).toHaveLength(3);
  const only = layout.neighbourhood(model, 'focus', -1);
  expect(only.places).toHaveLength(1);
  expect(only.connections).toEqual([]);
  expect(only.hidden).toBe(30);
});

it('maps a review: the files it changes that are not documents become places, and documents’ links to them lines', () => {
  const repeated = Array.from({ length: MAP_PROOF_LIMIT + 1 }, (_, at) => `[r${at}](../src/render.ts)`).join(' ');
  const index = indexOf({
    'docs/guide.md': '# Guide\n\n## Code\n\nThe [renderer](../src/render.ts) and the [store](../src/store.ts).',
    'docs/many.md': `# Many\n\n${repeated}`,
    'docs/spec.md': '# Spec\n\n[guide](guide.md)',
  });
  const model = reviewMap(index, corrections, ['docs/spec.md', 'src/render.ts', 'src/render.ts', 'logo.png']);
  // A changed document stays a document; any other changed file is a place of its own, read for nothing.
  expect(model.places.map((place) => [place.id, place.kind, place.state])).toStrictEqual([
    ['docs/guide.md', 'Document', 'indexed'],
    ['docs/many.md', 'Document', 'indexed'],
    ['docs/spec.md', 'Document', 'indexed'],
    ['src/render.ts', 'File', 'file'],
    ['logo.png', 'File', 'file'],
  ]);
  expect(model.places[3]).toMatchObject({ title: 'render.ts', folder: 'src', kindFrom: 'none', statuses: [] });
  expect(model.places[4]).toMatchObject({ title: 'logo.png', folder: '' });
  // Only explicit links to a changed file are lines, with their evidence; a link to unchanged code is not.
  const lines = model.connections.map((connection) => [connection.from, connection.to, connection.proof.length, connection.hiddenProof]);
  expect(lines).toStrictEqual([
    ['docs/spec.md', 'docs/guide.md', 1, 0],
    ['docs/guide.md', 'src/render.ts', 1, 0],
    ['docs/many.md', 'src/render.ts', MAP_PROOF_LIMIT, 1],
  ]);
  expect(model.connections[1].proof).toStrictEqual([{ path: 'docs/guide.md', line: 5, quote: 'renderer', section: 'Code' }]);
});

it('lays a set out in the middle, between what links to it and what it links to, quiet where nothing connects', () => {
  const model = graph(
    [
      ['in/a.md', 'mid/one.md'],
      ['in/b.md', 'mid/three.md'],
      ['mid/one.md', 'out/x.md'],
      ['mid/one.md', 'mid/three.md'],
      ['both.md', 'mid/one.md'],
      ['mid/three.md', 'both.md'],
      ['in/a.md', 'out/x.md'],
    ],
    ['mid/two.md', 'mid/four.md'],
  );
  const centre = ['mid/one.md', 'mid/two.md', 'mid/three.md', 'missing.md', 'mid/one.md', 'mid/four.md'];
  const around = new MapPlacement().around(model, centre, MAP_NEIGHBOUR_LIMIT, 24);
  // The middle in the order given, once each, quiet when nothing connects; what links both ways is linking in.
  expect(around.places.map((position) => [position.place.id, position.lane, position.quiet ?? false])).toStrictEqual([
    ['mid/one.md', 'here', false],
    ['mid/two.md', 'here', true],
    ['mid/three.md', 'here', false],
    ['mid/four.md', 'here', true],
    ['in/a.md', 'incoming', false],
    ['out/x.md', 'outgoing', false],
    ['both.md', 'incoming', false],
    ['in/b.md', 'incoming', false],
  ]);
  expect([around.totals, around.centre, around.hidden]).toStrictEqual([{ incoming: 3, outgoing: 1 }, { connected: 2, unconnected: 2 }, 0]);
  // Every line among the places shown, the middle's own included.
  expect(around.connections).toHaveLength(7);
  expect(linksAround(model, centre)).toStrictEqual({
    incoming: ['both.md', 'in/a.md', 'in/b.md'],
    outgoing: ['out/x.md'],
    middle: ['mid/one.md', 'mid/three.md'],
    unconnected: ['mid/two.md', 'mid/four.md'],
  });
  // Too many for the middle: those that connect come first, and what is not shown is counted.
  const small = new MapPlacement().around(model, centre, 1, 3);
  expect(small.places.map((position) => position.place.id)).toStrictEqual(['mid/one.md', 'mid/two.md', 'mid/three.md', 'in/a.md', 'out/x.md']);
  expect(small.hidden).toBe(3);
  expect(new MapPlacement().around(model, centre, 1, 1).places.filter((position) => position.lane === 'here')).toHaveLength(1);
});

it('seats a neighbour level with the middle it links to, and keeps its seat as more is read', () => {
  const placement = new MapPlacement();
  const first = graph([
    ['z.md', 'm/1.md'],
    ['a.md', 'm/3.md'],
    ['k.md', 'm/2.md'],
  ]);
  const centre = ['m/1.md', 'm/2.md', 'm/3.md'];
  const seats = (model: ProjectMapModel) =>
    placement
      .around(model, centre, MAP_NEIGHBOUR_LIMIT, 24)
      .places.filter((position) => position.lane === 'incoming')
      .map((position) => position.place.id);
  // Seats around one document are its own: they take nothing from those around a set.
  placement.neighbourhood(first, 'm/1.md', MAP_NEIGHBOUR_LIMIT);
  expect(seats(first)).toStrictEqual(['z.md', 'k.md', 'a.md']);
  // Read further, an earlier name and a new link change nothing for those already seated.
  expect(seats(graph([...first.connections.map((c): [string, string] => [c.from, c.to]), ['b.md', 'm/1.md'], ['a.md', 'm/1.md']]))).toStrictEqual([
    'z.md',
    'k.md',
    'a.md',
    'b.md',
  ]);
});
