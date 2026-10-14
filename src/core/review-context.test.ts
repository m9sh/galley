import { expect, it, vi } from 'vitest';
import { indexDocument, ProjectIndex } from './docindex.ts';
import { MAX_DOCUMENT_CHARS } from './limits.ts';
import { ChapterContext, relatedDocuments, ReviewDocs, type ChapterAttachment } from './review-context.ts';

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

it('attachments are session choices, separated by chapter, document and heading, and can be replaced or removed', () => {
  const context = new ChapterContext();
  const first: ChapterAttachment = { chapter: 'one', commit: 'aaa', path: 'spec.md', heading: '', title: 'Spec' };
  const variants = [
    { ...first, chapter: 'two' },
    { ...first, path: 'adr.md' },
    { ...first, heading: 'goals' },
  ];
  for (const item of [first, ...variants]) context.add(item);
  context.add({ ...first, title: 'A better title' });
  expect(context.forChapter('one').map((item) => item.title)).toEqual(['Spec', 'Spec', 'A better title']);
  expect(context.forChapter('two')).toEqual([variants[0]]);
  context.remove(first);
  expect(context.forChapter('one')).toEqual([variants[1], variants[2]]);
  expect(new ChapterContext().forChapter('one')).toEqual([]);
});

/** A repository at one commit: its listing, and its documents. */
function repository(files: Record<string, string>, sizes: Record<string, number> = {}) {
  return {
    commit: 'c0ffee1234567890',
    discover: vi.fn(async () => ({
      docs: Object.keys(files).map((path) => (path in sizes ? { path, size: sizes[path] } : { path })),
      limits: ['Only Markdown at the top level was listed.'],
      configs: { files: [], limits: [] },
    })),
    load: vi.fn(async (path: string) => {
      if (files[path] === 'offline') throw new Error('offline');
      return files[path];
    }),
  };
}

it('reads the docs behind a review when asked, once listed, and says in each changed file what links to it', async () => {
  const source = repository(
    {
      'docs/specs/render.md': '# Spec\n\nSee [the renderer](../../src/render.ts).',
      'guide.md': '# Guide\n\nNothing here.',
      'gone.md': 'offline',
      'big.md': '',
    },
    { 'big.md': MAX_DOCUMENT_CHARS + 1 },
  );
  const context = new ChapterContext();
  const changes = vi.fn();
  const docs = new ReviewDocs(source, context, () => new Set(['src/render.ts', 'guide.md']), changes);
  expect([docs.state, docs.complete, context.snapshot]).toStrictEqual(['idle', false, null]);
  const reading = docs.read();
  expect(docs.state).toBe('reading');
  expect(changes).toHaveBeenCalledOnce();
  // Asked again while reading, it reads once.
  await docs.read();
  await reading;
  expect(source.discover).toHaveBeenCalledOnce();
  expect(docs.state).toBe('read');
  expect(docs.complete).toBe(true);
  expect(changes).toHaveBeenCalledTimes(2);
  expect(context.snapshot!.commit).toBe('c0ffee1234567890');
  expect(context.snapshot!.status).toBe(
    'Built from all 4 documents at c0ffee1. Only Markdown at the top level was listed. 1 document could not be read. 1 document is too large to read.',
  );
  expect(context.snapshot!.related.get('src/render.ts')!.map((doc) => [doc.title, doc.kind, doc.flag, doc.evidence[0].text])).toStrictEqual([
    ['Spec', 'Spec', 'worth-checking', 'the renderer'],
  ]);
  expect(context.snapshot!.related.get('guide.md')).toStrictEqual([]);
  // Reading more lists nothing again.
  await docs.read();
  expect(source.discover).toHaveBeenCalledOnce();
});

it('a listing that fails says why and can be tried again; a review that closed hears nothing more', async () => {
  const source = repository({ 'a.md': '# A' });
  source.discover.mockRejectedValueOnce(new Error('GitHub did not answer.')).mockRejectedValueOnce('down');
  const changes = vi.fn();
  const docs = new ReviewDocs(source, new ChapterContext(), () => new Set(), changes);
  await docs.read();
  expect([docs.state, docs.error]).toStrictEqual(['failed', 'GitHub did not answer.']);
  await docs.read();
  expect(docs.error).toBe('down');
  const calls = changes.mock.calls.length;
  docs.stop();
  await docs.read();
  expect(docs.state).toBe('read');
  expect(changes).toHaveBeenCalledTimes(calls + 1);
});
