import { MAX_DOCUMENT_CHARS } from './limits.ts';
import { outlineDocument, type OutlineHeading, type OutlineLink } from './markdown.ts';
import { isMarkdownPath, resolveHref } from './paths.ts';

/**
 * The project map: documents read at one commit, the headings in them and the Markdown links between
 * them. Every connection comes from a link someone wrote, and keeps the link as evidence; folders are
 * kept apart as containment, never shown as a relationship between documents.
 */

export const DOC_KINDS = ['overview', 'spec', 'decision', 'architecture', 'runbook', 'guide', 'other'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const KIND_NAMES: Record<DocKind, string> = {
  overview: 'Overview',
  spec: 'Spec',
  decision: 'Decision',
  architecture: 'Architecture',
  runbook: 'Runbook',
  guide: 'Guide',
  other: 'Document',
};

/** How a kind was decided: stated in the document, guessed from its path, or chosen by the reader. */
export type KindSource = 'metadata' | 'path' | 'reader' | 'none';
export const KIND_SOURCES: Record<KindSource, string> = {
  metadata: 'from the document’s front matter',
  path: 'guessed from its path',
  reader: 'set by you',
  none: 'no type found',
};

/** Most documents read for the map in one pass, and how many at a time. */
export const INDEX_BATCH = 150;
const INDEX_CONCURRENCY = 4;

/** A Markdown link resolved against the repository. */
export interface DocLink extends OutlineLink {
  /** The repository path it points at; null for links outside the repository. */
  path: string | null;
  /** The section it points at, decoded; '' for the top of the document. */
  anchor: string;
}

export interface IndexedDoc {
  path: string;
  title: string;
  kind: DocKind;
  kindFrom: KindSource;
  /** A decision's or spec's status, when the document states one (front matter or a Status section). */
  status: string | null;
  /** A different status the same document states elsewhere: front matter and its Status section disagree. */
  statusAlso: string | null;
  /** Front matter, by lower-case key: where `supersedes`, `superseded-by` and `rfcs` are stated. */
  meta: Record<string, string>;
  headings: OutlineHeading[];
  links: DocLink[];
  /** Every id a link can point at: headings and ids written in raw HTML. */
  anchors: Set<string>;
  /** Why the map has nothing from this document: it could not be read, or it is too large to read. */
  unread?: 'failed' | 'too-large';
}

/** A connection between two documents: every link from one to the other, as evidence. */
export interface Edge {
  from: string;
  to: string;
  evidence: DocLink[];
}

/** A link the map cannot follow: its document is not listed, or its section is not in the document. */
interface Problem {
  from: string;
  link: DocLink;
  kind: 'missing-doc' | 'missing-anchor';
}

/** Session-only corrections from the reader: a kind for one document, or for everything in a folder. */
export interface Corrections {
  docs: Map<string, DocKind>;
  folders: Map<string, DocKind>;
}

const KIND_WORDS: Array<[RegExp, DocKind]> = [
  [/^(?:adrs?|decisions?|decision[-_ ]?records?|madr)$/i, 'decision'],
  [/^(?:rfcs?|specs?|specifications?|proposals?)$/i, 'spec'],
  [/^(?:architecture|arch|design|diagrams|c4)$/i, 'architecture'],
  [/^(?:runbooks?|playbooks?|operations|ops|incidents)$/i, 'runbook'],
  [/^(?:guides?|tutorials?|how-?tos?|handbook|manuals?)$/i, 'guide'],
  [/^(?:readme|overview)$/i, 'overview'],
];

function kindOfWord(word: string): DocKind | null {
  return KIND_WORDS.find(([pattern]) => pattern.test(word.trim()))?.[1] ?? null;
}

/** A guess from the path: a README, a file named like ADR-0001 or RFC-12, or a folder such as adr/ or runbooks/. */
export function pathKind(path: string): DocKind | null {
  const segments = path.split('/');
  const file = segments.pop()!.replace(/\.[^.]+$/, '');
  if (/^readme$/i.test(file)) return 'overview';
  const numbered = /^(adr|rfc|spec)[-_ ]?\d+/i.exec(file);
  if (numbered) return kindOfWord(numbered[1]);
  for (let i = segments.length - 1; i >= 0; i--) {
    const kind = kindOfWord(segments[i]);
    if (kind) return kind;
  }
  return null;
}

/** "docs/adr/0007-use-markdown.md" → "0007 use markdown" */
export function fileTitle(path: string): string {
  return path
    .slice(path.lastIndexOf('/') + 1)
    .replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '')
    .replace(/[-_]+/g, ' ');
}

/** Code-point order: the same on every machine, unlike a locale's. */
const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

const short = (text: string) => {
  const line = text.split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Read one document for the map: no rendering, only its title, kind, headings and links. */
export function indexDocument(path: string, src: string): IndexedDoc {
  const outline = outlineDocument(src);
  const fields = new Map((outline.frontmatter?.fields ?? []).map(([key, value]) => [key.toLowerCase(), value]));
  const stated = ['type', 'kind', 'category', 'doctype'].map((key) => kindOfWord(fields.get(key) ?? '')).find(Boolean);
  const guessed = pathKind(path);
  const h1 = outline.headings.find((heading) => heading.level === 1);
  const statusSection = outline.headings.find((heading) => /^status$/i.test(heading.text));
  const statusField = fields.get('status') || null;
  const statusText = (statusSection && outline.firstParagraph.get(statusSection.id)) || null;
  const status = statusField ?? statusText;
  const firstWord = (text: string) => text.toLowerCase().split(/[^a-z]+/)[0];
  const statusAlso = statusField && statusText && firstWord(statusField) !== firstWord(statusText) ? short(statusText) : null;
  const anchors = new Set(outline.headings.map((heading) => heading.id));
  for (const m of src.matchAll(/\s(?:id|name)\s*=\s*["']([^"'\s]+)["']/g)) anchors.add(m[1]);
  const links = outline.links.flatMap((link): DocLink[] => {
    const resolved = resolveHref(path, link.href);
    if (resolved.type === 'external') return [{ ...link, path: null, anchor: '' }];
    if (resolved.type === 'anchor') return [{ ...link, path, anchor: resolved.hash }];
    const hash = resolved.suffix.indexOf('#');
    return [{ ...link, path: resolved.path, anchor: hash === -1 ? '' : safeDecode(resolved.suffix.slice(hash + 1)) }];
  });
  return {
    path,
    title: fields.get('title') || h1?.text || fileTitle(path),
    kind: stated ?? guessed ?? 'other',
    kindFrom: stated ? 'metadata' : guessed ? 'path' : 'none',
    status: status ? short(status) : null,
    statusAlso,
    meta: Object.fromEntries(fields),
    headings: outline.headings,
    links,
    anchors,
  };
}

/**
 * The version of what `indexDocument` returns. A reading kept on the device (library/outline-cache.ts) from another
 * version is ignored, so change this whenever a document would be read differently. docindex.test.ts fails when it should change.
 */
export const OUTLINE_FORMAT = 1;

/** A document's reading as plain data, for keeping on the device. */
export type StoredDoc = Omit<IndexedDoc, 'anchors' | 'unread'> & { anchors: string[] };

export function storeDoc(doc: IndexedDoc): StoredDoc {
  const { anchors, unread: _unread, ...rest } = doc;
  return { ...rest, anchors: [...anchors] };
}

type Check = (value: unknown) => boolean;
const text: Check = (value) => typeof value === 'string';
const whole: Check = (value) => Number.isInteger(value);
const maybe =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const word =
  (words: object): Check =>
  (value) =>
    typeof value === 'string' && Object.hasOwn(words, value);
const listOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);
const mapOf =
  (check: Check): Check =>
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(check);
const shaped =
  (shape: Record<string, Check>): Check =>
  (value) =>
    typeof value === 'object' && value !== null && Object.entries(shape).every(([key, check]) => check((value as Record<string, unknown>)[key]));

/** Everything a stored reading must hold, checked before it is trusted: storage can be damaged or written by another version. */
const isStoredDoc: Check = shaped({
  path: text,
  title: text,
  kind: word(KIND_NAMES),
  kindFrom: word(KIND_SOURCES),
  status: maybe(text),
  statusAlso: maybe(text),
  meta: mapOf(text),
  headings: listOf(shaped({ level: whole, text, id: text, line: whole })),
  links: listOf(shaped({ href: text, text, line: whole, section: maybe(text), path: maybe(text), anchor: text })),
  anchors: listOf(text),
});

/** A reading kept by `storeDoc`, or null when it is not one for this path. */
export function restoreDoc(value: unknown, path: string): IndexedDoc | null {
  if (!isStoredDoc(value) || (value as StoredDoc).path !== path) return null;
  const stored = value as StoredDoc;
  return { ...stored, anchors: new Set(stored.anchors) };
}

/** The kind the reader sees: their correction first, then the document's own. */
export function classify(doc: IndexedDoc, corrections: Corrections): { kind: DocKind; from: KindSource } {
  const own = corrections.docs.get(doc.path);
  if (own) return { kind: own, from: 'reader' };
  for (let at = doc.path.lastIndexOf('/'); at > 0; at = doc.path.lastIndexOf('/', at - 1)) {
    const folder = corrections.folders.get(doc.path.slice(0, at));
    if (folder) return { kind: folder, from: 'reader' };
  }
  return { kind: doc.kind, from: doc.kindFrom };
}

const README = /^(?:readme|index)\.(?:md|markdown|mdown|mkd|mdx)$/i;

export class ProjectIndex {
  readonly listed: string[];
  private readonly listedSet: Set<string>;
  /** Folder → its README (or index page), which a link to the folder opens. */
  private readonly folderPage = new Map<string, string>();
  readonly docs = new Map<string, IndexedDoc>();
  edges: Edge[] = [];
  problems: Problem[] = [];

  constructor(listed: string[]) {
    this.listed = listed;
    this.listedSet = new Set(listed);
    for (const path of listed) {
      const at = path.lastIndexOf('/');
      const folder = at === -1 ? '' : path.slice(0, at);
      if (README.test(path.slice(at + 1)) && !this.folderPage.has(folder)) this.folderPage.set(folder, path);
    }
  }

  /** The listed document a repository path opens: the file itself, or a folder's README. */
  documentAt(path: string): string | null {
    if (this.listedSet.has(path)) return path;
    return this.folderPage.get(path.replace(/\/$/, '')) ?? null;
  }

  add(doc: IndexedDoc): void {
    this.docs.set(doc.path, doc);
    this.connect();
  }

  /** Edges and problems again, from every document read so far, in a stable order. */
  private connect(): void {
    const edges = new Map<string, Edge>();
    const problems: Problem[] = [];
    for (const doc of [...this.docs.values()].sort((a, b) => compare(a.path, b.path))) {
      for (const link of doc.links) {
        if (link.path === null) continue;
        const to = this.documentAt(link.path);
        if (!to) {
          if (isMarkdownPath(link.path)) problems.push({ from: doc.path, link, kind: 'missing-doc' });
          continue;
        }
        if (this.missingAnchor(to, link.anchor)) problems.push({ from: doc.path, link, kind: 'missing-anchor' });
        if (to === doc.path) continue;
        const key = `${doc.path}\u0000${to}`;
        const edge = edges.get(key) ?? { from: doc.path, to, evidence: [] };
        edge.evidence.push(link);
        edges.set(key, edge);
      }
    }
    this.edges = [...edges.values()];
    this.problems = problems;
  }

  /** Only a read document can be missing a section; footnotes are numbered, so their ids are never checked. */
  private missingAnchor(path: string, anchor: string): boolean {
    const target = this.docs.get(path);
    if (!anchor || !target || target.unread || /^fn(?:ref)?\d/.test(anchor)) return false;
    return !target.anchors.has(anchor) && !target.anchors.has(anchor.toLowerCase());
  }

  outgoing(path: string): Edge[] {
    return this.edges.filter((edge) => edge.from === path).sort((a, b) => compare(a.to, b.to));
  }

  incoming(path: string): Edge[] {
    return this.edges.filter((edge) => edge.to === path);
  }

  /** Documents not yet read, in listed order. */
  unread(): string[] {
    return this.listed.filter((path) => !this.docs.has(path));
  }

  /** Documents whose path, title or headings mention every word of the query, best matches first. */
  search(query: string): Array<{ path: string; heading?: OutlineHeading }> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.listed.map((path) => ({ path }));
    const has = (text: string) => words.every((word) => text.toLowerCase().includes(word));
    const named: Array<{ path: string; heading?: OutlineHeading }> = [];
    const within: Array<{ path: string; heading?: OutlineHeading }> = [];
    for (const path of this.listed) {
      const doc = this.docs.get(path);
      if (has(`${path} ${doc?.title ?? ''}`)) named.push({ path });
      else {
        const heading = doc?.headings.find((h) => has(h.text));
        if (heading) within.push({ path, heading });
      }
    }
    return [...named, ...within];
  }
}

/** A folder of the outline: its documents (README first) and sub-folders, alphabetically. */
export interface FolderNode {
  name: string;
  path: string;
  docs: string[];
  folders: FolderNode[];
}

export function folderTree(paths: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', docs: [], folders: [] };
  for (const path of paths) {
    const segments = path.split('/');
    let node = root;
    for (const name of segments.slice(0, -1)) {
      const at = node.path ? `${node.path}/${name}` : name;
      let next = node.folders.find((folder) => folder.name === name);
      if (!next) {
        next = { name, path: at, docs: [], folders: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.docs.push(path);
  }
  const order = (node: FolderNode) => {
    const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);
    node.docs.sort((a, b) => Number(README.test(base(b))) - Number(README.test(base(a))) || base(a).localeCompare(base(b), 'en'));
    node.folders.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    node.folders.forEach(order);
  };
  order(root);
  return root;
}

/**
 * Read documents for the map, a few at a time, stopping at INDEX_BATCH or when cancelled. Documents
 * that cannot be read or are too large are reported, never guessed at. The caller can reuse what it
 * already learned: `known` gives a document whose reading was remembered, which is then not read at all,
 * and `parse` the reading of a text.
 */
export async function readForIndex(
  index: ProjectIndex,
  load: (path: string) => Promise<string>,
  options: {
    sizes?: Map<string, number>;
    signal?: { cancelled: boolean };
    progress?: () => void;
    known?: (path: string) => IndexedDoc | undefined;
    parse?: (path: string, src: string) => IndexedDoc;
  } = {},
): Promise<{ read: number; failed: string[]; skipped: string[] }> {
  const parse = options.parse ?? indexDocument;
  const queue = index.unread().slice(0, INDEX_BATCH);
  const failed: string[] = [];
  const skipped: string[] = [];
  let read = 0;
  const unread = (path: string, why: NonNullable<IndexedDoc['unread']>) => {
    (why === 'failed' ? failed : skipped).push(path);
    index.add({ ...indexDocument(path, ''), unread: why });
  };
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined && !options.signal?.cancelled; path = queue.shift()) {
      const remembered = options.known?.(path);
      if (remembered) {
        index.add(remembered);
        read++;
      } else if ((options.sizes?.get(path) ?? 0) > MAX_DOCUMENT_CHARS) unread(path, 'too-large');
      else {
        let src: string;
        try {
          src = await load(path);
        } catch {
          unread(path, 'failed');
          options.progress?.();
          continue;
        }
        // A reader that closed, or a pass that was cancelled, stops here: late results are dropped.
        if (options.signal?.cancelled) return;
        if (src.length > MAX_DOCUMENT_CHARS) unread(path, 'too-large');
        else {
          index.add(parse(path, src));
          read++;
        }
      }
      options.progress?.();
    }
  };
  await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker));
  return { read, failed, skipped };
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/**
 * What an index built so far can show, in the words the library and Review chapters share: how many documents it
 * was built from, then what the listing left out and what could not be read. A zero is never a claim about the rest.
 */
export function indexCoverage(index: ProjectIndex, commit: string, unread: { limits: string[]; failed: number; skipped: number }): string[] {
  const read = index.docs.size;
  const total = index.listed.length;
  const at = commit.slice(0, 7);
  const lines = [
    read >= total
      ? `Built from all ${count(total, 'document')} at ${at}.`
      : `Built from ${read.toLocaleString('en')} of ${count(total, 'document')} at ${at}. Links from the others are not shown yet.`,
    ...unread.limits,
  ];
  if (unread.failed) lines.push(`${count(unread.failed, 'document')} could not be read.`);
  if (unread.skipped) lines.push(`${count(unread.skipped, 'document is', 'documents are')} too large to read.`);
  return lines;
}
