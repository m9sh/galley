import { expect, it } from 'vitest';
import { indexDocument, ProjectIndex } from './docindex.ts';
import { ChapterContext, relatedDocuments, type ChapterAttachment } from './review-context.ts';

it('shares explicit links, folder README targets and readable evidence, never folder proximity or external links', () => {
  const index = new ProjectIndex(['docs/README.md', 'spec.md', 'NOTES.md', 'unrelated.md']);
  for (const [path, text] of Object.entries({
    'docs/README.md': '# Docs\n\n[myself](README.md)',
    'spec.md': '# A spec\n\n[render](src/render.ts) and [](src/render.ts). [Docs](docs/). [outside](https://example.org) and [other](unrelated.md).',
    'NOTES.md': '# Z notes\n\n[renderer](src/render.ts). [Docs](docs/README.md).',
    'unrelated.md': '# Nearby\n\nNo connection.',
  }))
    index.add(indexDocument(path, text));
  const corrections = { docs: new Map(), folders: new Map() };
  expect(relatedDocuments(index, 'src/render.ts', new Set(['spec.md']), corrections)).toEqual([
    {
      path: 'spec.md',
      title: 'A spec',
      kind: null,
      flag: 'changed',
      evidence: [
        { path: 'spec.md', line: 3, text: 'render' },
        { path: 'spec.md', line: 3, text: 'src/render.ts' },
      ],
    },
    { path: 'NOTES.md', title: 'Z notes', kind: null, flag: 'worth-checking', evidence: [{ path: 'NOTES.md', line: 3, text: 'renderer' }] },
  ]);
  expect(relatedDocuments(index, 'docs/README.md', new Set(), corrections).map((doc) => doc.path)).toEqual(['spec.md', 'NOTES.md']);
  expect(relatedDocuments(index, 'not-linked.ts', new Set(), corrections)).toEqual([]);
});

it('attachments are session choices, separated by chapter, revision, document and heading, and can be replaced or removed', () => {
  const context = new ChapterContext();
  const first: ChapterAttachment = { chapter: 'one', revision: 'head', commit: 'aaa', path: 'spec.md', heading: '', title: 'Spec' };
  const variants = [
    { ...first, chapter: 'two' },
    { ...first, revision: 'base' as const },
    { ...first, path: 'adr.md' },
    { ...first, heading: 'goals' },
  ];
  for (const item of [first, ...variants]) context.add(item);
  context.add({ ...first, title: 'A better title' });
  expect(context.forChapter('one', 'head').map((item) => item.title)).toEqual(['Spec', 'Spec', 'A better title']);
  expect(context.forChapter('one', 'base')).toEqual([variants[1]]);
  context.remove(first);
  expect(context.forChapter('one', 'head')).toEqual([variants[2], variants[3]]);
  expect(new ChapterContext().forChapter('one', 'head')).toEqual([]);
});
