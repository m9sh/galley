import type { CommentTarget, DocRef } from '../../platforms/types.ts';
import type { RenderedBlock, RenderedDoc } from './render.ts';

const revealed = new WeakMap<RenderedDoc, Set<HTMLElement>>();
/** Source files keep this many unchanged lines on each side of a change in view, as a diff does. */
const CODE_CONTEXT = 2;

/** Hide unchanged blocks, retain relevant headings, and let every gap reveal its own context. */
export function filterDocument(r: RenderedDoc, changedOnly: boolean): void {
  r.content.dataset.mrScope = changedOnly ? 'changed' : 'all';
  for (const gap of r.content.querySelectorAll('.mr-context-gap')) gap.remove();
  for (const el of r.content.querySelectorAll<HTMLElement>('[hidden]:not([data-mr-comment-view])')) el.hidden = false;
  const blocks = r.blocks.filter((block) => !block.el.closest('[data-mr-comment-view][hidden]'));
  if (!changedOnly) return;
  let expanded = revealed.get(r);
  if (!expanded) {
    expanded = new Set();
    revealed.set(r, expanded);
  }
  const context = new Set<HTMLElement>();
  const headings: RenderedBlock[] = [];
  for (const block of blocks) {
    const unit = block.head ?? block.base!;
    if (unit.kind === 'heading' && block.kind !== 'removed') {
      while (headings.length && headings[headings.length - 1].head!.level >= unit.level) headings.pop();
      headings.push(block);
    }
    if (block.kind !== 'same') for (const heading of headings) context.add(heading.el);
  }
  if (r.lead) context.add(r.lead);
  if (r.isCode) {
    for (const block of blocks) if ('mrSpecContext' in block.el.dataset) context.add(block.el);
    blocks.forEach((block, i) => {
      if (block.kind === 'same') return;
      for (let j = Math.max(0, i - CODE_CONTEXT); j <= Math.min(blocks.length - 1, i + CODE_CONTEXT); j++) context.add(blocks[j].el);
    });
  }
  const gaps: Array<{ blocks: RenderedBlock[]; anchor: HTMLElement; parent: HTMLElement }> = [];
  let previous: (typeof gaps)[number] | undefined;
  for (const block of blocks) {
    // Blocks with review threads stay in view, like changed ones.
    const unchanged = block.kind === 'same' && !context.has(block.el) && !('mrThreads' in block.el.dataset);
    block.el.hidden = unchanged && !expanded.has(block.el);
    if (!unchanged) {
      previous = undefined;
      continue;
    }
    const anchor = block.el.classList.contains('mr-tight') ? block.el.closest('li')! : block.el;
    const parent = anchor.parentElement!;
    // A continuous stretch is one fold, even when it crosses lists or quotes.
    if (!previous) {
      previous = { blocks: [], anchor, parent };
      gaps.push(previous);
    }
    previous.blocks.push(block);
  }
  for (const gap of gaps) {
    const isExpanded = gap.blocks.some((block) => expanded.has(block.el));
    const marker = r.content.ownerDocument.createElement(gap.parent.matches('ul, ol') ? 'li' : 'div');
    marker.className = 'mr-context-gap';
    const button = r.content.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'mr-context-toggle';
    button.textContent = `${gap.blocks.length} unchanged ${r.isCode ? (gap.blocks.length === 1 ? 'line' : 'lines') : gap.blocks.length === 1 ? 'block' : 'blocks'}`;
    button.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${button.textContent}`);
    button.setAttribute('aria-expanded', String(isExpanded));
    button.title = `${isExpanded ? 'Collapse' : 'Expand'} nearby unchanged content`;
    button.addEventListener('click', () => {
      for (const block of gap.blocks) isExpanded ? expanded.delete(block.el) : expanded.add(block.el);
      filterDocument(r, true);
      r.content.dispatchEvent(new r.content.ownerDocument.defaultView!.Event('galley:context', { bubbles: true }));
      r.content.querySelectorAll<HTMLButtonElement>('.mr-context-toggle')[gaps.indexOf(gap)]?.focus({ preventScroll: true });
    });
    marker.append(button);
    gap.parent.insertBefore(marker, gap.anchor);
  }
  // Empty wrappers disappear, except when they contain a context toggle.
  for (const el of [...r.content.querySelectorAll<HTMLElement>('li:not(.mr-context-gap), ul, ol, blockquote, section')].reverse()) {
    const children = blocks.filter((block) => el.contains(block.el));
    if (children.length) el.hidden = children.every((block) => block.el.hidden) && !el.querySelector('.mr-context-gap');
    else if (el.matches('section.footnotes')) el.hidden = !blocks.some((block) => !block.el.hidden && block.el.querySelector('.footnote-ref'));
  }
  const separator = r.content.querySelector<HTMLElement>('.footnotes-sep');
  if (separator) separator.hidden = r.content.querySelector<HTMLElement>('section.footnotes')!.hidden;
}

/** Show one unchanged block hidden by Changed parts, as its own context toggle would. */
export function revealContext(r: RenderedDoc, el: HTMLElement): void {
  revealed.get(r)!.add(el);
  filterDocument(r, true);
  r.content.dispatchEvent(new r.content.ownerDocument.defaultView!.Event('galley:context', { bubbles: true }));
}

/** What belongs to the other version of a block, and what is no one's text: controls and line numbers. */
const NOT_TEXT = 'button, [aria-hidden="true"]';
const OTHER_SIDE = { head: 'del.mr-del, .mr-ghost-row, [data-mr-side="base"]', base: 'ins.mr-ins, [data-mr-side="head"]' } as const;

/**
 * The text a reader sees in one version of an element, with each text node and where it starts, so a match
 * found in the text can be marked in place. A source line is its source text alone.
 */
export function readableText(el: HTMLElement, side?: 'base' | 'head'): { text: string; nodes: Array<{ node: Text; at: number }> } {
  const scope = el.querySelector<HTMLElement>('.mr-code-text') ?? el;
  const skip = side ? `${NOT_TEXT}, ${OTHER_SIDE[side]}` : NOT_TEXT;
  const nodes: Array<{ node: Text; at: number }> = [];
  let text = '';
  const walker = el.ownerDocument.createTreeWalker(scope, 4);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    let skipped = false;
    for (let parent = node.parentElement; parent && parent !== el && !skipped; parent = parent.parentElement) skipped = parent.matches(skip);
    if (skipped) continue;
    nodes.push({ node, at: text.length });
    text += node.data;
  }
  return { text, nodes };
}

/** The range of [start, end) in readableText(el, side): what a search marks. */
export function textRange(el: HTMLElement, side: 'base' | 'head' | undefined, start: number, end: number): Range {
  const { nodes } = readableText(el, side);
  const range = el.ownerDocument.createRange();
  const at = (offset: number, isEnd: boolean) => {
    const found = nodes.findLast((item) => (isEnd ? item.at < offset : item.at <= offset))!;
    return [found.node, offset - found.at] as const;
  };
  range.setStart(...at(start, false));
  range.setEnd(...at(end, true));
  return range;
}

function owner(node: Node, blocks: RenderedBlock[]): RenderedBlock | undefined {
  return blocks.find((block) => block.el === node || block.el.contains(node));
}
function oldText(node: Node, block: RenderedBlock): boolean {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !block.head || Boolean(el?.closest('del.mr-del, .mr-ghost-row, [data-mr-side="base"]'));
}

export function paragraphTarget(doc: DocRef, block: RenderedBlock, side: 'base' | 'head' = block.head ? 'head' : 'base', quote?: string): CommentTarget | null {
  const unit = side === 'base' ? block.base : block.head;
  if (!unit) return null;
  const clone = block.el.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll(side === 'head' ? 'del.mr-del, .mr-ghost-row, [data-mr-side="base"]' : 'ins.mr-ins, [data-mr-side="head"]'))
    el.remove();
  return {
    doc,
    side,
    startLine: unit.lines[0] + 1,
    endLine: unit.lines[1],
    quote: quote ?? (unit.kind === 'code' ? unit.source.replace(/\n$/, '') : clone.textContent!.replace(/\s+/g, ' ').trim()),
  };
}

/** A selection quotes its exact text and targets the source ranges of its containing blocks. */
export function selectionTarget(doc: DocRef, blocks: RenderedBlock[], range: Range): CommentTarget | null {
  const first = owner(range.startContainer, blocks),
    last = owner(range.endContainer, blocks);
  if (!first || !last) return null;
  const side = oldText(range.startContainer, first) ? 'base' : 'head';
  if ((oldText(range.endContainer, last) ? 'base' : 'head') !== side) return null;
  const covered = blocks.filter(
    (block) => range.intersectsNode(block.el) && !block.el.closest('[hidden]') && !(block.el.classList.contains('mr-ghost') && block.el.closest('.mode-clean')),
  );
  if (covered.some((block) => !(side === 'base' ? block.base : block.head))) return null;
  const prose = first.el.closest('.mr-source-comment-body');
  if (doc.kind === 'code' && covered.some((block) => Boolean(block.el.closest('.mr-source-comment-body')) !== Boolean(prose))) return null;
  if (doc.kind === 'code' && !prose) {
    // DOM ranges include gutters and concatenate rows. Quote only source text, with its newlines.
    const rows = covered.flatMap((block) => {
      // The whole line: once highlighted, its text is split across token spans. Blank lines count too.
      const text = block.el.querySelector('.mr-code-text')!;
      if (!text.textContent) return [{ block, text: '' }];
      const selected = block.el.ownerDocument.createRange();
      selected.selectNodeContents(text);
      if (range.compareBoundaryPoints(0, selected) > 0) selected.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(2, selected) < 0) selected.setEnd(range.endContainer, range.endOffset);
      return selected.collapsed ? [] : [{ block, text: selected.toString().replace(/\u200b/g, '') }];
    });
    if (!rows.length) return null;
    const start = paragraphTarget(doc, rows[0].block, side)!,
      end = paragraphTarget(doc, rows[rows.length - 1].block, side)!;
    return { ...start, endLine: end.endLine, quote: rows.map((row) => row.text).join('\n') };
  }
  // Inline removed/inserted text across both versions cannot have a single source range.
  const fragment = range.cloneContents();
  if (
    (side === 'head' && fragment.querySelector('del.mr-del, .mr-ghost-row, [data-mr-side="base"]')) ||
    (side === 'base' && fragment.querySelector('ins.mr-ins, [data-mr-side="head"]'))
  )
    return null;
  // Both ends were checked to have this side, so both have a unit for it.
  const start = paragraphTarget(doc, first, side)!,
    end = paragraphTarget(doc, last, side)!;
  return { ...start, endLine: end.endLine, quote: range.toString().trim() };
}
