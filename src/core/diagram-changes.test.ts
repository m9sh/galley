import { expect, it } from 'vitest';
import { CHANGE_CLASSES, flowchartChanges, readFlowchart } from './diagram-changes.ts';

const base = 'flowchart LR\n  Source[Markdown source] --> Parse[Parse blocks]\n  Parse --> Reader[Reader]\n';
const head =
  'flowchart LR\n  Source[Markdown source] --> Parse[Parse blocks]\n  Parse --> Compare[Compare versions]\n  Compare --> Reader[Reader]\n  Reader --> Comment[Review comment]\n';

it('draws the new version with what it adds marked, and what it removes drawn back in', () => {
  const changes = flowchartChanges(base, head)!;
  expect([changes.added, changes.edited, changes.removed]).toStrictEqual([5, 0, 1]);
  expect(changes.code).toBe(
    [
      'flowchart LR',
      '  Source[Markdown source] --> Parse[Parse blocks]',
      '  Parse  galleyAddedEdge1@--> Compare[Compare versions]',
      '  Compare  galleyAddedEdge2@--> Reader[Reader]',
      '  Reader  galleyAddedEdge3@--> Comment[Review comment]',
      '  Parse galleyRemovedEdge1@-.-> Reader',
      '  class Compare,Comment galleyAdded',
      '',
    ].join('\n'),
  );
  expect(CHANGE_CLASSES).toStrictEqual({ added: 'galleyAdded', edited: 'galleyEdited', removed: 'galleyRemoved' });
});

it('marks shapes whose words or form changed, links whose words changed, and removed shapes as they were written', () => {
  const before = 'graph TD\n  A[Start] -->|go| B(Old step)\n  B --> C{Choice}\n  D((Gone)) -.- A\n';
  const after = 'graph TD\n  A[Begin] -->|go on| B[Old step]\n  B --> C{Choice}\n';
  const changes = flowchartChanges(before, after)!;
  expect([changes.added, changes.edited, changes.removed]).toStrictEqual([0, 3, 2]);
  expect(changes.code).toBe(
    [
      'graph TD',
      '  A[Begin]  galleyEditedEdge1@-->|go on| B[Old step]',
      '  B --> C{Choice}',
      '  D((Gone))',
      '  D galleyRemovedEdge1@-.-> A',
      '  class A,B galleyEdited',
      '  class D galleyRemoved',
      '',
    ].join('\n'),
  );
});

it('reads the ways flowcharts are written: shapes, quoted words, arrows with words, chains, groups, settings and comments', () => {
  const chart = readFlowchart(
    [
      '---',
      'title: Pipeline',
      '---',
      '%%{init: {"theme": "dark"}}%%',
      'flowchart TB',
      '  %% a comment',
      '  subgraph Inputs [The inputs]',
      '    direction LR',
      '    a(((Circle))) --- b([Stadium]); c[[Sub]] ==> d[(Store)]',
      '  end',
      '  e[/Lean/] -- says --> f[\\Back\\] -. maybe .-> g{{Hex}} == firmly ==> h>Flag]',
      '  i["Quoted [words]"]:::warm <--> j@{ shape: rect, label: "Card" } ~~~ k@{ shape: rect }',
      '  a & b --o c --x d',
      '  classDef warm fill:#fee',
      '  class a warm',
      '  style b stroke:#333',
      '  linkStyle 0 stroke:#333',
      '  click a callback',
      '  l',
      '  l2[Named]; l2',
    ].join('\n'),
  )!;
  expect([...chart.shapes.values()].map((shape) => [shape.id, shape.label, shape.opener])).toStrictEqual([
    ['a', 'Circle', '((('],
    ['b', 'Stadium', '(['],
    ['c', 'Sub', '[['],
    ['d', 'Store', '[('],
    ['e', 'Lean', '[/'],
    ['f', 'Back', '[\\'],
    ['g', 'Hex', '{{'],
    ['h', 'Flag', '>'],
    ['i', 'Quoted [words]', '['],
    ['j', 'Card', '@{'],
    ['k', 'k', '@{'],
    ['l', null, ''],
    ['l2', 'Named', '['],
  ]);
  expect(chart.links.map((link) => [link.from, link.to, link.label, link.at === null])).toStrictEqual([
    ['a', 'b', '', false],
    ['c', 'd', '', false],
    ['e', 'f', 'says', true],
    ['f', 'g', 'maybe', true],
    ['g', 'h', 'firmly', true],
    ['i', 'j', '', false],
    ['j', 'k', '', false],
    ['a', 'c', '', true],
    ['b', 'c', '', true],
    ['c', 'd', '', false],
  ]);
});

it('keeps the two whole versions for anything it cannot read or mark, and when nothing drawn changed', () => {
  // Other diagram types, and flowcharts with something this does not read.
  expect(flowchartChanges('sequenceDiagram\n  A->>B: hi\n', 'sequenceDiagram\n  A->>B: hello\n')).toBeNull();
  expect(flowchartChanges(base, 'flowchart LR\n  my-node --> Parse\n')).toBeNull();
  expect(readFlowchart('flowchart LR\n  A --> \n')).toBeNull();
  expect(readFlowchart('flowchart LR\n  A[unclosed\n')).toBeNull();
  expect(readFlowchart('flowchart LR\n  A["unclosed]\n')).toBeNull();
  expect(readFlowchart('flowchart LR\n  A["quoted" x]\n')).toBeNull();
  expect(readFlowchart('flowchart LR\n  A -->|unclosed B\n')).toBeNull();
  expect(readFlowchart('flowchart LR\n  A e1@--> B\n')).toBeNull();
  expect(readFlowchart('%% only a comment\n')).toBeNull();
  expect(readFlowchart('')).toBeNull();
  // Only styling changed: nothing to mark.
  expect(flowchartChanges(base, `${base}  style Parse stroke:#333\n`)).toBeNull();
  // A changed link from a group cannot carry a mark.
  expect(flowchartChanges('flowchart LR\n  A & B --> C\n', 'flowchart LR\n  A & B & D --> C\n')).toBeNull();
  // An unchanged group link is fine.
  expect(flowchartChanges('flowchart LR\n  A & B --> C\n', 'flowchart LR\n  A & B --> C\n  C --> D\n')!.added).toBe(2);
});

it('says nothing more than the words of a removed link, and keeps links written more than once apart', () => {
  const changes = flowchartChanges('flowchart LR\n  A -->|one| B\n  A -->|two| B\n  A -- one|two --> B\n', 'flowchart LR\n  A -->|two| B\n')!;
  expect(changes.removed).toBe(2);
  expect(changes.code).toContain('  A galleyRemovedEdge1@-.->|one| B\n  A galleyRemovedEdge2@-.->|one two| B\n');
});
