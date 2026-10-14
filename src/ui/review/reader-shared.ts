import {
  ReaderError,
  type DocContents,
  type DocRef,
  type DocStatus,
  type CommentTarget,
  type CommentPlan,
  type ReviewSince,
  type Thread,
} from '../../platforms/types.ts';
import type { Baseline, Revisions } from './revisions.ts';
import type { QuietFile } from '../../core/quiet.ts';
import { h } from '../components/dom.ts';
import { icons } from '../components/icons.ts';
import { layoutPanel } from '../components/layout-controls.ts';
import type { RenderedBlock, RenderedDoc } from '../rendering/render.ts';
import { keyGroups, READING_SECTIONS, settingsSheet, type Shortcuts } from '../components/settings-sheet.ts';

export const STATUS_LABEL: Record<DocStatus, string> = { added: 'New', removed: 'Deleted', modified: 'Edited', renamed: 'Renamed' };
export const WORDS_PER_MINUTE = 230;
/** Changes are brought to this fraction of the viewport height when navigating. */
export const FOCUS_LINE = 0.3;

/** Settings tabs, in order: arrow keys move through them. */
export const SETTINGS_TABS = ['reading', 'layout', 'review', 'keys'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
/** Every shortcut, grouped the way a review goes; the Keys tab lists them and onKey handles them. */
export const SHORTCUTS: Shortcuts = [
  [
    'Move through the review',
    [
      [['J', 'K'], 'Next / previous change'],
      [['N', 'P'], 'Next / previous conversation'],
      [[']', '['], 'Next / previous file'],
      [['F'], 'Go to a file'],
      [['/'], 'Search this review, including folded parts'],
    ],
  ],
  [
    'Chapters and Library',
    [
      [['M'], 'Open or close them'],
      [['↑', '↓'], 'Move through a list'],
      [['↵'], 'Open what you are on'],
      [['←', '→'], 'Previous / next chapter, in a chapter'],
      [['/'], 'Search the docs, in the Library'],
      [['Esc'], 'Back a sheet, then close'],
    ],
  ],
  [
    'Comment',
    [
      [['R'], 'Comment on the selection or the paragraph in focus'],
      [['⌘/Ctrl', 'Enter'], 'Post the comment or reply'],
      [['Esc'], 'Leave the editor; your draft is kept'],
      [['V'], 'Mark the file viewed'],
    ],
  ],
  [
    'Change the view',
    [
      [['C'], 'Change marks on / off'],
      [['A'], 'Changed parts / whole files'],
      [['U'], 'Only what changed since you looked / the whole review'],
      [['L'], 'Next layout'],
      [['D'], 'Comfortable / compact'],
      [['+', '−'], 'Larger / smaller text'],
      [['0'], 'Default text size'],
    ],
  ],
  [
    'Settings',
    [
      [[','], 'Open settings'],
      [['?'], 'Show these shortcuts'],
      [['Esc'], 'Close settings, then the reader'],
    ],
  ],
];
const KEY_GROUPS = keyGroups(SHORTCUTS);

/** Settings chosen from a group of buttons in the settings sheet (data-setting / data-value). */
export type SettingKey = 'theme' | 'appearance' | 'font' | 'images' | 'tests' | 'codeComments' | 'layout' | 'density' | 'order';

/** The Review tab: how changes, files, tests and code comments are shown. */
const REVIEW_PANEL = `
      <section class="mr-settings-section" aria-label="Review">
        <div class="mr-set-row"><span>Change marks<small>Highlight inserted and removed text</small></span><div class="mr-seg" role="group" aria-label="Show changes"><button data-mode="changes" aria-pressed="true">Marked</button><button data-mode="clean" aria-pressed="false">Clean</button></div></div>
        <div class="mr-set-row"><span>Context<small>Show changed sections or read the full files</small></span><div class="mr-seg" role="group" aria-label="Paragraph filter"><button data-scope="changed" aria-pressed="true">Changed parts</button><button data-scope="all" aria-pressed="false">Whole files</button></div></div>
        <div class="mr-set-row"><span id="mr-overview-label">Title &amp; description<small>Show the request’s title and description before the files</small></span><button class="mr-switch mr-overview-toggle" data-act="overview" role="switch" aria-checked="false" aria-labelledby="mr-overview-label"></button></div>
        <div class="mr-set-row"><span id="mr-code-label">Code files<small>Review changed source files after the documents</small></span><button class="mr-switch mr-code-toggle" data-act="code-files" role="switch" aria-checked="false" aria-labelledby="mr-code-label"></button></div>
        <div class="mr-set-row"><span id="mr-signs-label">+ and − signs<small>Mark added and removed lines of code with + and −</small></span><button class="mr-switch" data-act="signs" role="switch" aria-checked="true" aria-labelledby="mr-signs-label"></button></div>
        <div class="mr-set-row"><span id="mr-fold-label">Fold files you can skip<small>Lockfiles, generated code and whitespace-only edits start as one line</small></span><button class="mr-switch" data-act="fold" role="switch" aria-checked="true" aria-labelledby="mr-fold-label"></button></div>
        <div class="mr-set-row"><span>File order<small>Suggested reads tests after their code, and skippable files last</small></span><div class="mr-seg" data-setting="order" role="group" aria-label="File order"><button data-value="suggested">Suggested</button><button data-value="listed">As listed</button></div></div>
        <div class="mr-set-row"><span>Test files<small>Read suites and cases, or every line of the raw source</small></span><div class="mr-seg" data-setting="tests" role="group" aria-label="Test files"><button data-value="plan">Test plan</button><button data-value="source">Whole file</button></div></div>
        <div class="mr-set-row"><span>Code comments<small>Show comments in code as formatted notes, or as written</small></span><div class="mr-seg" data-setting="codeComments" role="group" aria-label="Code comments"><button data-value="formatted">Formatted</button><button data-value="source">Source</button></div></div>
        <div class="mr-set-row"><span>External images<small>Images hosted elsewhere can tell their host who is reading</small></span><div class="mr-seg" data-setting="images" role="group" aria-label="External images"><button data-value="ask">Ask</button><button data-value="load">Load</button></div></div>
      </section>
      <p class="mr-settings-note">To comment, select some text or point at a paragraph. Replies stay in their thread.</p>`;
const KEYS_PANEL = `${KEY_GROUPS}
      <p class="mr-settings-note">Shortcuts work while the reader has focus and no text field is active. Press ? at any time to come back here.</p>`;

export const TEMPLATE = `
<div class="mr-root mode-changes" tabindex="-1" role="dialog" aria-modal="true" aria-label="Galley reader">
  <div class="mr-progress"><div></div></div>
  <header class="mr-topbar">
    <div class="mr-tb-left">
      <button class="mr-btn mr-icon-btn" data-act="close" title="Close reader (Esc)" aria-label="Close reader (Esc)">${icons.close}</button>
      <span class="mr-brand">galley${__GALLEY_DEV__ ? '<span class="mr-dev">dev</span>' : ''}</span>
    </div>
    <div class="mr-tb-center">
      <button class="mr-btn mr-file-btn" data-act="files" aria-haspopup="menu" aria-expanded="false" hidden>
        <span class="mr-status-dot" aria-hidden="true"></span><span class="mr-file-name"></span><span class="mr-count"></span>${icons.chevronDown}
      </button>
    </div>
    <div class="mr-tb-right">
      <button type="button" class="mr-btn mr-icon-btn mr-search-btn" data-act="search" hidden aria-haspopup="dialog" aria-expanded="false" title="Search this review (/)" aria-label="Search this review">${icons.search}</button>
      <button type="button" class="mr-btn mr-chapters-toggle" hidden aria-haspopup="dialog" aria-expanded="false">Chapters</button>
      <button class="mr-btn mr-icon-btn mr-viewed" data-act="viewed" aria-pressed="false" disabled hidden>${icons.viewed}</button>
      <button class="mr-btn mr-icon-btn" data-act="settings" aria-haspopup="dialog" aria-expanded="false" title="Reading settings" aria-label="Reading settings">${icons.settings}</button>
    </div>
  </header>
  <p class="mr-viewed-feedback" role="status" hidden></p>
  <div class="mr-menu mr-files" role="menu" aria-label="Changed files" hidden></div>
${settingsSheet('Choose a view that helps you follow the changes.', [
  {
    id: 'reading',
    label: 'Reading',
    icon: icons.book,
    panel: `${READING_SECTIONS}
      <p class="mr-settings-note">Changes to your settings appear in the reader right away.</p>`,
  },
  { id: 'layout', label: 'Layout', icon: icons.layout, panel: layoutPanel('review') },
  { id: 'review', label: 'Review', icon: icons.check, panel: REVIEW_PANEL },
  { id: 'keys', label: 'Keys', icon: icons.keyboard, panel: KEYS_PANEL },
])}
  <nav class="mr-toc" aria-label="Contents"></nav>
  <main class="mr-main">
    <article class="mr-article">
      <div class="mr-gutter" aria-hidden="true"></div>
      <div class="mr-empty-reader" hidden><h1>No document changes</h1><p>Turn on “Code files” in reading settings to review the changed source files.</p><button class="mr-btn mr-outline" data-act="settings">Reading settings</button></div>
      <div class="mr-doc"></div>
    </article>
  </main>
  <button type="button" class="mr-select-chip" data-act="comment-selection" hidden>${icons.comment}<span>Comment</span></button>
  <div class="mr-lightbox" role="dialog" aria-modal="true" aria-label="Enlarged diagram" hidden>
    <div class="mr-lightbox-stage" data-act="close-lightbox"><img alt="" draggable="false" data-act="diagram-canvas"></div>
    <div class="mr-lightbox-bar" role="toolbar" aria-label="Zoom">
      <button class="mr-btn mr-icon-btn" data-act="zoom-out" aria-label="Zoom out (−)" title="Zoom out (−)">${icons.minus}</button>
      <button class="mr-btn mr-zoom-level" data-act="zoom-fit" aria-label="Fit the diagram to the window (0)" title="Fit to the window (0)">100%</button>
      <button class="mr-btn mr-icon-btn" data-act="zoom-in" aria-label="Zoom in (+)" title="Zoom in (+)">${icons.plus}</button>
      <span class="mr-lightbox-hint">Pinch or ⌘/Ctrl + scroll to zoom · drag to move</span>
    </div>
    <button class="mr-btn mr-icon-btn mr-lightbox-close" data-act="close-lightbox" aria-label="Close diagram (Esc)" title="Close (Esc)">${icons.close}</button>
  </div>
  <p class="mr-toast" role="status" aria-live="polite" hidden></p>
  <div class="mr-resume" role="status" hidden><span class="mr-resume-text"></span><button type="button" class="mr-resume-go" data-act="resume">Continue</button><button type="button" class="mr-resume-close" data-act="dismiss-resume" aria-label="Start from the top">×</button></div>
  <div class="mr-pill" hidden>
    <button class="mr-btn" data-act="prev" title="Previous change (K)" aria-label="Previous change">${icons.up}</button>
    <span class="mr-pill-label" aria-live="polite"></span>
    <button class="mr-btn" data-act="next" title="Next change (J)" aria-label="Next change">${icons.down}</button>
  </div>
</div>`;

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function actionButton(label: string, act: string, className: string): HTMLButtonElement {
  const b = h('button', `mr-btn ${className}`, label);
  b.dataset.act = act;
  return b;
}

/** "docs/adr/0007-use-markdown.md" → "0007 use markdown" */
export function prettyName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.replace(/\.(md|markdown|mdown|mkd|mdx)$/i, '').replace(/[-_]+/g, ' ');
}

export function textWithoutDeletions(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const del of clone.querySelectorAll('del')) del.remove();
  return clone.textContent!.trim();
}

export const relative =
  typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }) : null;

export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  if (!relative) return new Date(iso).toLocaleDateString();
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  if (Math.abs(minutes) < 60 * 24) return relative.format(Math.round(minutes / 60), 'hour');
  if (Math.abs(minutes) < 60 * 24 * 30) return relative.format(Math.round(minutes / 1440), 'day');
  return new Date(iso).toLocaleDateString();
}

/** Tight list items are inline spans; their visual block is the list item. */
export function surfaceOf(el: HTMLElement): HTMLElement {
  return el.matches('.mr-tight') ? el.closest('li')! : el;
}

/** What a failed write says to the reviewer, with the platform's advice when it has some. */
export function problem(err: unknown): string {
  return err instanceof ReaderError ? `${err.message} ${err.hint}`.trim() : err instanceof Error ? err.message : String(err);
}

/** Whether an editor holds something the reviewer wrote, beyond what it opened with. */
export function hasDraft(editor: { textarea: HTMLTextAreaElement; prefill: string }): boolean {
  const text = editor.textarea.value.trim();
  return Boolean(text) && text !== editor.prefill.trim();
}

export function sameTarget(a: CommentTarget, b: CommentTarget): boolean {
  return a.doc === b.doc && a.side === b.side && a.startLine === b.startLine && a.endLine === b.endLine && a.quote === b.quote;
}

/** "line 5", "old lines 30–34": where a comment lands, in the words of the document beside it. */
export function placeName(side: 'base' | 'head', start: number, end: number): string {
  return `${side === 'base' ? 'old ' : ''}${start === end ? `line ${start}` : `lines ${start}–${end}`}`;
}

/** The block a comment on `line` belongs to, in whichever view of a code comment the reader shows. */
export function blockAt(r: RenderedDoc, side: 'base' | 'head', line: number): RenderedBlock | undefined {
  return r.blocks.find((block) => {
    const unit = block[side];
    return unit && !block.el.closest('[data-mr-comment-view][hidden]') && line - 1 >= unit.lines[0] && line - 1 < Math.max(unit.lines[1], unit.lines[0] + 1);
  });
}

/** The enlarged diagram keeps this much space around it, and leaves room for the zoom bar along the bottom. */
export const ZOOM_MARGIN = 32;
export const ZOOM_BAR = 72;

export const SUBMIT_KEY = `${typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}↵`;

/** Where a hidden element (a removed block in Clean mode) would be: the next visible element. */
export function nextVisible(el: Element, stop: Element): Element | null {
  for (let node: Element | null = el; node && node !== stop; node = node.parentElement) {
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (sib.getClientRects().length) return sib;
    }
  }
  return null;
}

export interface View {
  doc: DocRef;
  section: HTMLElement;
  rendered: RenderedDoc | null;
  failed?: boolean;
  /** Folded as noise (a lockfile, generated code, a whitespace-only edit) until the reviewer opens it. */
  quiet?: QuietFile;
  open?: boolean;
  /** Folded by the reviewer: its content stays, hidden behind the same one-line card. */
  folded?: boolean;
}

/** A document as the reader draws it now: the review's own, or against an earlier head while only what changed since is shown. */
export interface Shown {
  doc: DocRef;
  contents: DocContents;
}

/** What the reader knows about the review's earlier heads (RFC 0039): what is remembered, what it is compared with, and what the platform said. */
export interface RevisionState {
  /** The commit the review is at now. */
  head: string;
  /** What is remembered for this review on this device. */
  stored: Revisions;
  /** The earlier head to compare with, or none when the reviewer has seen nothing earlier or has marked this head reviewed. */
  baseline: Baseline | null;
  /** The platform's answer for the baseline; null until it comes. */
  outcome: ReviewSince | { state: 'failed'; message: string } | null;
  /** Only what changed since the baseline is shown, each document against its earlier version. */
  active: boolean;
  /** Above the documents: what is new, and how to read only that. */
  bar: HTMLElement;
  /** Below them: the reviewer's mark that this version is reviewed. */
  foot: HTMLElement;
}

/** The short form of a commit id, as the platforms show it. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export interface Hit {
  view: View;
  block: RenderedBlock;
  side: 'base' | 'head';
  /** The element to target: the block, or one version of a diagram. */
  el: HTMLElement;
}

/** Where a search result is: one version of a block, a line of a folded file, a comment or the description, or a draft. */
export type SearchAt =
  | { type: 'block'; view: View; block: RenderedBlock; side: 'base' | 'head' }
  | { type: 'line'; view: View; side: 'base' | 'head'; line: number }
  | { type: 'text'; view: View | null; el: HTMLElement; card: HTMLElement | null }
  | { type: 'draft'; editor: Editor };

/** A text box inside a card, for a new comment or a reply. Each keeps its own draft and posting state. */
export interface Editor {
  form: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  status: HTMLElement;
  cancel: HTMLButtonElement;
  submit: HTMLButtonElement;
  /** False until a new comment knows where it will be posted. */
  ready: boolean;
  busy: boolean;
  /** Text the editor started with, such as a mention; it alone is not a draft. */
  prefill: string;
  send(): void;
}

/** A thread's reply box. It opens under the comment being answered. */
export interface ReplyEditor extends Editor {
  thread: Thread;
  /** Index of the comment being answered. */
  to: number;
  context: HTMLElement;
}

/** A new comment, written where its thread will appear: beside its block, or below it on narrow screens. */
export interface Draft extends Editor {
  target: CommentTarget;
  view: View;
  /** The block its thread will belong to. */
  anchor: HTMLElement;
  /** What stays marked while the comment is written: the selected words, or the blocks. */
  range?: Range;
  marks: HTMLElement[];
  plan: CommentPlan | null;
}

/** The right column holds review threads when its side of the page has room for them and a gap. */
export const RAIL_SPACE = 296;
/** Vertical space between cards in the comments column. */
export const CARD_GAP = 12;
/** On the way to the comment control, passing over other text keeps it; stopping on a block this long moves it. */
export const AIM_DELAY = 280;
/** In the comments column, the text level with the pointer, or failing that the nearest text this close above or below. */
export const LANE_OFFSETS = [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 48, -48];

/** The reader that is open, if any: opening another closes it, and closing it clears this. */
export const session: { reader: { close(): void } | null } = { reader: null };

/** The selection the comment chip is offered for: what it would comment on, and the text it sits under. */
export type ChipTarget = { target: CommentTarget; elements: HTMLElement[]; range?: Range };
