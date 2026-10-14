/**
 * What a change does to a Mermaid flowchart, drawn as one diagram: the new version, with the shapes and links
 * it adds or edits marked, and the ones it removes drawn back in, marked as removed. Only flowcharts are read,
 * and only when every statement in both versions is understood; anything else keeps its two whole versions.
 * Nothing here runs Mermaid: the reader draws the result in its sandboxed frame like any other diagram.
 */

export interface DiagramChanges {
  /** The new version's source, with change classes and edge ids, and what it removed added back. */
  code: string;
  added: number;
  edited: number;
  removed: number;
}

/**
 * Class names the diagram frame colours shapes by. Links take no classes of their own, so each changed link
 * gets an id that says what changed (`galleyAddedEdge1`), and the frame colours links by id.
 */
export const CHANGE_CLASSES = { added: 'galleyAdded', edited: 'galleyEdited', removed: 'galleyRemoved' } as const;

interface Shape {
  id: string;
  /** The words in the shape, or null where the id is only referred to. */
  label: string | null;
  /** How the shape opens, such as `[` or `((`, telling one shape from another. */
  opener: string;
  /** The declaration as written, to draw a removed shape again. */
  text: string;
}

interface Link {
  from: string;
  to: string;
  label: string;
  /** Where the link's arrow starts in the source, to give it an id; null when it joins groups (`A & B --> C`). */
  at: number | null;
}

interface Chart {
  shapes: Map<string, Shape>;
  links: Link[];
}

const HEADER = /^(?:flowchart|graph)(?:[^\S\n]+(?:TB|TD|BT|RL|LR))?[^\S\n]*$/i;
/** Statements that style or group what is drawn; they never add or remove a shape or link. */
const SETTING = /^(?:classDef|class|style|linkStyle|click|direction|subgraph|end)(?:\s|$)/;
const ID = /^[\p{L}\p{N}_$]+/u;
/** Arrows of three characters or more: `-->`, `---`, `-.->`, `==>`, `--o`, `<-->`, `~~~`. */
const ARROW = /^[<ox]?(?:-{2,}[>ox]|-{3,}|={2,}[>ox]|={3,}|-\.+-[>ox]?|~{3,})/;
/** Arrows with words inside: `-- words -->`, `-. words .->`, `== words ==>`. */
const WORDS = /^[<ox]?(?:--|==|-\.)[^\S\n]+(.*?)[^\S\n]+(?:-{2,}[>ox]?|={2,}[>ox]?|\.+-[>ox]?)(?=[\s\p{L}\p{N}_$]|$)/u;
const SHAPES: Array<[string, string[]]> = [
  ['@{', ['}']],
  ['(((', [')))']],
  ['([', ['])']],
  ['((', ['))']],
  ['[[', [']]']],
  ['[(', [')]']],
  ['[/', ['/]', '\\]']],
  ['[\\', ['\\]', '/]']],
  ['{{', ['}}']],
  ['(', [')']],
  ['[', [']']],
  ['{', ['}']],
  ['>', [']']],
];

/** Blank out front matter and directives, keeping every other character where it was. */
function blank(source: string): string {
  const spaces = (text: string) => text.replace(/[^\n]/g, ' ');
  return source.replace(/^\s*---[^\S\n]*\n[\s\S]*?\n---[^\S\n]*(?:\n|$)/, spaces).replace(/%%\{[\s\S]*?\}%%/g, spaces);
}

/** A line's statements, split at semicolons outside quotes and brackets, with where each starts. */
function statements(line: string, at: number): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && '[({'.includes(c)) depth++;
    else if (!quoted && '])}'.includes(c)) depth--;
    else if (c === ';' && !quoted && depth <= 0) {
      out.push([line.slice(start, i), at + start]);
      start = i + 1;
    }
  }
  out.push([line.slice(start), at + start]);
  return out;
}

/** Read one statement of shapes and links; false when any part of it is not understood. */
function statement(text: string, at: number, chart: Chart): boolean {
  let i = 0;
  const space = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const shape = (): string | null => {
    const id = ID.exec(text.slice(i))?.[0];
    if (!id) return null;
    const begin = i;
    i += id.length;
    let label: string | null = null;
    let opener = '';
    const kind = SHAPES.find(([open]) => text.startsWith(open, i));
    if (kind) {
      const [open, closes] = kind;
      let from = i + open.length;
      let end: number;
      if (text[from] === '"') {
        const quote = text.indexOf('"', from + 1);
        if (quote < 0) return null;
        label = text.slice(from + 1, quote);
        from = quote + 1;
        end = closes.some((close) => text.startsWith(close, from)) ? from : -1;
      } else {
        end = Math.min(...closes.map((close) => text.indexOf(close, from)).filter((index) => index >= 0));
        label = Number.isFinite(end) ? text.slice(from, end) : null;
      }
      if (end < 0 || !Number.isFinite(end)) return null;
      i = end + closes.find((close) => text.startsWith(close, end))!.length;
      opener = open;
      // A shape written as `A@{ shape: …, label: "…" }` names its words in a label field.
      if (open === '@{') label = /label:\s*"([^"]*)"/.exec(label!)?.[1] ?? id;
    }
    const style = /^:::[\w-]+/.exec(text.slice(i));
    if (style) i += style[0].length;
    const known = chart.shapes.get(id);
    if (!known || label !== null)
      chart.shapes.set(id, { id, label: label ?? known?.label ?? null, opener: opener || (known?.opener ?? ''), text: text.slice(begin, i) });
    return id;
  };
  const group = (): string[] | null => {
    const ids: string[] = [];
    for (;;) {
      space();
      const id = shape();
      if (!id) return null;
      ids.push(id);
      space();
      if (text[i] !== '&') return ids;
      i++;
    }
  };
  const link = (): { label: string; begin: number; arrow: boolean } | null => {
    const begin = i;
    const rest = text.slice(i);
    const arrow = ARROW.exec(rest);
    if (arrow) {
      i += arrow[0].length;
      const after = i;
      space();
      if (text[i] !== '|') {
        i = after;
        return { label: '', begin, arrow: true };
      }
      const close = text.indexOf('|', i + 1);
      if (close < 0) return null;
      const label = text.slice(i + 1, close);
      i = close + 1;
      return { label, begin, arrow: true };
    }
    const words = WORDS.exec(rest);
    if (!words) return null;
    i += words[0].length;
    return { label: words[1], begin, arrow: false };
  };
  let left = group();
  if (!left) return false;
  for (;;) {
    space();
    if (i >= text.length) return true;
    const joint = link();
    if (!joint) return false;
    const right = group();
    if (!right) return false;
    // Only a link between two single shapes, written as an arrow, can carry an id to colour it by.
    const single = left.length === 1 && right.length === 1 && joint.arrow;
    for (const from of left) for (const to of right) chart.links.push({ from, to, label: joint.label.trim(), at: single ? at + joint.begin : null });
    left = right;
  }
}

/** A flowchart's shapes and links, or null when it is not a flowchart or a statement is not understood. */
export function readFlowchart(source: string): Chart | null {
  const chart: Chart = { shapes: new Map(), links: [] };
  let header = false;
  let at = 0;
  for (const line of blank(source).split('\n')) {
    for (const [text, start] of statements(line, at)) {
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('%%')) continue;
      if (!header) {
        if (!HEADER.test(trimmed)) return null;
        header = true;
      } else if (!SETTING.test(trimmed) && !statement(text, start, chart)) return null;
    }
    at += line.length + 1;
  }
  return header ? chart : null;
}

const words = (shape: Shape) => (shape.label ?? shape.id).replace(/\s+/g, ' ').trim();

/**
 * The new version marked with what changed since the old one, or null when either is not a flowchart this
 * reads, when nothing drawn changed, or when a changed link cannot carry a mark (such as `A & B --> C`).
 */
export function flowchartChanges(base: string, head: string): DiagramChanges | null {
  const before = readFlowchart(base);
  const after = readFlowchart(head);
  if (!before || !after) return null;
  const added = [...after.shapes.keys()].filter((id) => !before.shapes.has(id));
  const removed = [...before.shapes.values()].filter((shape) => !after.shapes.has(shape.id));
  const edited = [...after.shapes.values()]
    .filter((shape) => before.shapes.has(shape.id))
    .filter((shape) => {
      const old = before.shapes.get(shape.id)!;
      return words(old) !== words(shape) || (old.opener !== '' && shape.opener !== '' && old.opener !== shape.opener);
    })
    .map((shape) => shape.id);
  // Links are matched by their ends; between the same two shapes, by their words first.
  const pairs = (links: Link[]) => {
    const map = new Map<string, Link[]>();
    for (const link of links) map.set(`${link.from}\u0000${link.to}`, [...(map.get(`${link.from}\u0000${link.to}`) ?? []), link]);
    return map;
  };
  const oldLinks = pairs(before.links);
  const newLinks = pairs(after.links);
  const marked: Array<{ link: Link; kind: keyof typeof CHANGE_CLASSES }> = [];
  const gone: Link[] = [];
  for (const key of new Set([...oldLinks.keys(), ...newLinks.keys()])) {
    const old = [...(oldLinks.get(key) ?? [])];
    const now: Link[] = [];
    for (const link of newLinks.get(key) ?? []) {
      const same = old.findIndex((other) => other.label === link.label);
      if (same >= 0) old.splice(same, 1);
      else now.push(link);
    }
    for (const link of now) marked.push({ link, kind: old.shift() ? 'edited' : 'added' });
    gone.push(...old);
  }
  if (!added.length && !removed.length && !edited.length && !marked.length && !gone.length) return null;
  if (marked.some(({ link }) => link.at === null)) return null;
  let code = head;
  const ids = new Map<Link, string>(marked.map(({ link, kind }, n) => [link, `${CHANGE_CLASSES[kind]}Edge${n + 1}`]));
  for (const { link } of [...marked].sort((a, b) => b.link.at! - a.link.at!)) code = `${code.slice(0, link.at!)} ${ids.get(link)}@${code.slice(link.at!)}`;
  const lines = removed.map((shape) => `  ${shape.text}`);
  const goneIds = gone.map((_, n) => `${CHANGE_CLASSES.removed}Edge${n + 1}`);
  gone.forEach((link, n) => {
    const label = link.label.replace(/[|\n]/g, ' ').trim();
    lines.push(`  ${link.from} ${goneIds[n]}@-.->${label ? `|${label}|` : ''} ${link.to}`);
  });
  const mark = (members: string[], kind: keyof typeof CHANGE_CLASSES) => {
    if (members.length) lines.push(`  class ${members.join(',')} ${CHANGE_CLASSES[kind]}`);
  };
  mark(added, 'added');
  mark(edited, 'edited');
  mark(
    removed.map((shape) => shape.id),
    'removed',
  );
  return {
    code: `${code.replace(/\s*$/, '')}\n${lines.join('\n')}\n`,
    added: added.length + marked.filter((m) => m.kind === 'added').length,
    edited: edited.length + marked.filter((m) => m.kind === 'edited').length,
    removed: removed.length + gone.length,
  };
}
