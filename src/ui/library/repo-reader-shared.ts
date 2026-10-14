import type { ChapterContext } from '../../core/review-context.ts';
import type { ContextOpening } from '../components/chapter-context.ts';
import type { Anchor } from '../../core/notes.ts';
import { ReaderError } from '../../platforms/types.ts';
import { icons } from '../components/icons.ts';
import { layoutPanel } from '../components/layout-controls.ts';
import { keyGroups, READING_SECTIONS, settingsSheet, type Shortcuts } from '../components/settings-sheet.ts';

/**
 * The repository reader: a project's docs read at one commit, with the same typography, sanitiser and
 * diagrams as the review reader, and none of its review operations. Its views share one index: Read,
 * a document with its contents and the documents that link to it; Map, one document's neighbourhood
 * of links as a map or a list (map-view.ts), or what configuration and decision records state, with the
 * evidence for each; Notes, the
 * reader's own thinking; and, when opened from a review, This review. History lasts as long as the
 * reader is open; notes, proposals and types are kept only when the reader saves them (ADR 0028).
 */

export const WORDS_PER_MINUTE = 230;
/** Below this many documents, every folder of the outline starts open. */
export const OPEN_OUTLINE = 40;
/** Room under the top bar when a paragraph is brought into view. */
export const TOP = 72;
/** Configuration files read at a time. */
export const CONFIG_CONCURRENCY = 4;
/** Longest address a new-issue link may have: browsers and platforms refuse longer ones. */
export const MAX_ISSUE_URL = 8_000;

/** Every shortcut of the repository reader; the Keys tab lists them and onKey() handles them. */
export const SHORTCUTS: Shortcuts = [
  [
    'Move through the library',
    [
      [['/'], 'Find a document or heading'],
      [['Alt', '←'], 'Back to where you were'],
      [['Alt', '→'], 'Forward again'],
    ],
  ],
  [
    'Views',
    [
      [['C'], 'Open library chapters (standalone reading)'],
      [['M'], 'Open the map, or go back to reading'],
      [['L'], 'Next reading layout'],
      [['N'], 'Open your notes, or go back to reading'],
    ],
  ],
  [
    'Settings',
    [
      [[','], 'Open settings'],
      [['?'], 'Show these shortcuts'],
      [['Esc'], 'Close what is open, then the reader'],
    ],
  ],
];
export const SETTINGS_TABS = ['reading', 'layout', 'keys'];

export const TEMPLATE = `
<div class="mr-root mr-repo" tabindex="-1" role="dialog" aria-modal="true" aria-label="Galley: project library">
  <div class="mr-progress"><div></div></div>
  <header class="mr-topbar">
    <div class="mr-tb-left">
      <button class="mr-btn mr-icon-btn" data-act="close" title="Close reader (Esc)" aria-label="Close reader (Esc)">${icons.close}</button>
      <span class="mr-brand">galley${__GALLEY_DEV__ ? '<span class="mr-dev">dev</span>' : ''}</span>
      <span class="mr-repo-history">
        <button class="mr-btn mr-icon-btn" data-act="back" title="Back (Alt+←)" aria-label="Back" disabled>${icons.chevronLeft}</button>
        <button class="mr-btn mr-icon-btn" data-act="forward" title="Forward (Alt+→)" aria-label="Forward" disabled>${icons.chevronRight}</button>
      </span>
    </div>
    <div class="mr-tb-center">
      <button class="mr-btn mr-file-btn" data-act="docs" aria-haspopup="dialog" aria-expanded="false" title="Project library (/)"><span class="mr-file-name">Project library</span>${icons.chevronDown}</button>
    </div>
    <div class="mr-tb-right">
      <div class="mr-views-pick"><button class="mr-btn mr-views-btn" data-act="views" aria-haspopup="true" aria-expanded="false" title="Change the view"><span class="mr-views-icon">${icons.book}</span><span class="mr-views-label">Read</span>${icons.chevronDown}</button><div class="mr-repo-views" role="group" aria-label="View" hidden><button data-view="review" aria-pressed="false" aria-label="This review" hidden>${icons.review}<span>This review</span></button><button data-view="chapters" aria-pressed="false" aria-label="Library chapters" data-key="C">${icons.book}<span>Chapters</span></button><button data-view="read" aria-pressed="true" aria-label="Read">${icons.book}<span>Read</span></button><button data-view="map" aria-pressed="false" aria-label="Map" title="Map (M)" data-key="M">${icons.map}<span>Map</span></button><button data-view="notes" aria-pressed="false" aria-label="Notes" title="Your notes (N)" data-key="N">${icons.note}<span>Notes</span></button></div></div>
      <button class="mr-btn mr-repo-commit" data-act="refresh" hidden>${icons.refresh}<span class="mr-repo-commit-label"></span></button>
      <button class="mr-btn mr-icon-btn" data-act="settings" aria-haspopup="dialog" aria-expanded="false" title="Reading settings" aria-label="Reading settings">${icons.settings}</button>
    </div>
  </header>
  <div class="mr-menu mr-repo-docs" role="dialog" aria-label="Project library" hidden>
    <div class="mr-files-head"><p class="mr-files-title"></p><p class="mr-files-meta"></p></div>
    <input type="search" class="mr-repo-search" placeholder="Find a document or heading" aria-label="Find a document or heading">
    <div class="mr-repo-notes"></div>
    <nav class="mr-repo-outline" aria-label="Documents in this repository"></nav>
  </div>
${settingsSheet('Set type, appearance and layout for comfortable reading.', [
  {
    id: 'reading',
    label: 'Reading',
    icon: icons.book,
    panel: `${READING_SECTIONS}
      <section class="mr-settings-section" aria-label="Images">
        <div class="mr-set-row"><span>External images<small>Images hosted elsewhere can tell their host who is reading</small></span><div class="mr-seg" data-setting="images" role="group" aria-label="External images"><button data-value="ask">Ask</button><button data-value="load">Load</button></div></div>
      </section>
      <p class="mr-settings-note">Changes to your settings appear in both readers right away.</p>`,
  },
  { id: 'layout', label: 'Layout', icon: icons.layout, panel: layoutPanel('library') },
  {
    id: 'keys',
    label: 'Keys',
    icon: icons.keyboard,
    panel: `${keyGroups(SHORTCUTS)}
      <p class="mr-settings-note">Shortcuts work while the reader has focus and no text field is active. Press ? at any time to come back here.</p>`,
  },
])}
  <nav class="mr-toc" aria-label="Contents"></nav>
  <main class="mr-main">
    <article class="mr-article mr-repo-read"><div class="mr-doc"></div></article>
    <section class="mr-repo-map" aria-label="Project map" hidden></section>
    <div class="mr-repo-thinking" hidden></div>
    <div class="mr-repo-review" hidden></div>
    <div class="mr-repo-chapters" hidden></div>
  </main>
  <div class="mr-settings mr-repo-export" hidden>
    <div class="mr-settings-backdrop" data-act="close-export"></div>
    <aside class="mr-settings-panel" role="dialog" aria-modal="true" aria-labelledby="mr-export-title" tabindex="-1"></aside>
  </div>
  <div class="mr-repo-zoom" role="dialog" aria-modal="true" aria-label="Enlarged diagram" hidden><button class="mr-btn mr-icon-btn" data-act="close-zoom" aria-label="Close diagram (Esc)" title="Close (Esc)">${icons.close}</button><img alt=""></div>
  <p class="mr-toast" role="status" aria-live="polite" hidden></p>
</div>`;

export const shortSha = (sha: string) => sha.slice(0, 7);
export const edgeKey = (from: string, to: string) => `${from}\u0000${to}`;
export const sectionKey = (anchor: Anchor) => `${anchor.path}\u0000${anchor.heading ?? ''}`;
export const newId = (prefix: string) => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
export const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
export const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** What the reader typed or chose in a view's forms, put back after the view is drawn again, with the focus. */
export function typed(root: HTMLElement): () => void {
  const key = (form: HTMLFormElement) => `${form.dataset.act}:${form.dataset.id ?? form.dataset.from ?? form.dataset.lens ?? ''}`;
  const fields = (form: HTMLFormElement) => [...form.querySelectorAll<HTMLInputElement>('input, textarea, select, [role="switch"]')];
  const isSwitch = (el: HTMLElement) => el.getAttribute('role') === 'switch';
  const name = (el: HTMLInputElement) => el.name || el.dataset.act!;
  const active = (root.getRootNode() as ShadowRoot).activeElement;
  const before = new Map(
    [...root.querySelectorAll('form')].map((form) => [
      key(form),
      new Map(fields(form).map((el) => [name(el), { value: isSwitch(el) ? el.getAttribute('aria-checked')! : el.value, focused: el === active }])),
    ]),
  );
  return () => {
    for (const form of root.querySelectorAll('form')) {
      const saved = before.get(key(form));
      if (!saved) continue;
      for (const el of fields(form)) {
        const was = saved.get(name(el));
        if (!was) continue;
        if (isSwitch(el)) el.setAttribute('aria-checked', was.value);
        else el.value = was.value;
        if (was.focused) el.focus();
      }
      // Only alternatives answer a question.
      const group = form.querySelector<HTMLElement>('.mr-note-group');
      if (group) group.hidden = form.querySelector<HTMLSelectElement>('[data-act="note-kind"]')!.value !== 'alternative';
    }
  };
}

export function problem(err: unknown): { title: string; hint: string } {
  if (err instanceof ReaderError) return { title: err.message, hint: err.hint };
  return { title: 'Galley could not read this.', hint: err instanceof Error ? err.message : String(err) };
}

/** Where the reader was in a document: the first paragraph in view, and how far below the top bar it sat. */
export interface Place {
  path: string;
  block: number;
  offset: number;
  anchor?: string;
}

export type View = 'read' | 'map' | 'notes' | 'review' | 'chapters';

/** The review a repository reader was opened from (RFC 0049, Phase 5): its title, its head and its chapters. */
export interface ReviewContext {
  title: string;
  /** The branch the change is on: the library reads the repository as the change leaves it. */
  ref: string;
  /** The review's chapters, in reading order, with the paths each one changes. */
  chapters: Array<{ id?: string; title: string; paths: string[] }>;
  context?: ChapterContext;
  entry?: ContextOpening;
}

/** The reader that is open, if any: opening another closes it, and closing it clears this. */
export const session: { reader: { close(): void } | null } = { reader: null };
