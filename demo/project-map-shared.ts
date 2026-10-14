import type { MapPlace, MapPosition } from '../src/core/project-map.ts';
import { button, h } from '../src/ui/components/dom.ts';

export const SETTINGS_TABS = ['reading', 'layout', 'keys'];
export const SHEET_TABS = ['preview', 'links'] as const;
export type SheetTab = (typeof SHEET_TABS)[number];
export type Lane = MapPosition['lane'];
export const DENSITY_SECTION = `<section class="mr-settings-section" aria-label="Layout">
  <div class="mr-set-row"><span>Density<small>Compact fits more on the screen</small></span><div class="mr-seg" data-setting="density" role="group" aria-label="Density"><button data-value="comfortable">Comfortable</button><button data-value="compact">Compact</button></div></div>
  </section><p class="mr-settings-note">Narrow screens stack the map in one column.</p>`;
/** Below this canvas width the three lanes stack, so an open sheet never forces sideways panning. */
export const STACK_BELOW = 720;
/** Phones keep a short neighbourhood; the rest is one tap away in List. */
export const PHONE_LANE = 4;
export const ZOOM = { min: 0.5, max: 1.5 };
/** The search popup shows the best few; the rest are one choice away in List. */
export const RESULT_LIMIT = 8;
export const LIST_RESULTS = '*list*';
export const SHAPES = {
  search: 'M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM20 20l-4.6-4.6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  panel: 'M4 5h16v14H4zM14.5 5v14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  down: 'M12 5v14M6 13l6 6 6-6',
  read: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
};

/** Separate only identifiers actually written in the title; never invent a record number from its path. */
export function cardName(title: string): { label: string | null; name: string } {
  const record = /^(ADR|RFC)\s+(\d+)\s*[:—–-]\s*(\S.*)$/i.exec(title);
  return record ? { label: `${record[1].toUpperCase()} ${record[2]}`, name: record[3] } : { label: null, name: title };
}

/** Bundled line art shares the reader's icon weight; document content never becomes markup. */
export function lineIcon(shape: string): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'mr-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', shape);
  icon.append(path);
  return icon;
}

/** An icon-only control always names itself and its shortcut. */
export function iconButton(act: string, label: string, title: string, icon: SVGSVGElement | string): HTMLButtonElement {
  const control = button('', act, 'mr-btn mr-icon-btn');
  control.setAttribute('aria-label', label);
  control.title = title;
  if (typeof icon === 'string') {
    // biome-ignore lint/plugin: a bundled reader icon constant, never document content.
    control.innerHTML = icon;
  } else control.append(icon);
  return control;
}

/** Shape distinguishes type without borrowing the colours reserved for edits, focus and selection. */
export function typeIcon(kind: string): SVGSVGElement {
  const shapes: Record<string, string> = {
    Overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    Spec: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
    Decision: 'M12 3l9 9-9 9-9-9zM8 12h8',
    Architecture: 'M8 3h8v6H8zM3 15h6v6H3zM15 15h6v6h-6zM12 9v3M6 15v-3h12v3',
    Runbook: 'M5 5h14v14H5zM8 9l3 3-3 3M13 15h3',
    Guide: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
    Document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  };
  return lineIcon(shapes[kind]);
}

export function placeBadge(kind: string, label: string | null): HTMLElement {
  const badge = h('small', 'mr-atlas-type', label ?? kind);
  badge.prepend(typeIcon(kind));
  return badge;
}

/** How well a document matches the typed words: a word at the start of the title counts most, then a word
 * start inside it, then anywhere in it, then the path. Every word must match somewhere; -1 when one does not. */
export function matchScore(place: MapPlace, words: string[]): number {
  const title = place.title.toLowerCase();
  const path = place.path.toLowerCase();
  let score = 0;
  for (const word of words) {
    const at = title.indexOf(word);
    const inPath = path.indexOf(word);
    if (at < 0 && inPath < 0) return -1;
    if (at === 0) score += 100;
    else if (at > 0) score += /[^\p{L}\p{N}]/u.test(title[at - 1]) ? 60 : 30;
    else score += /[^\p{L}\p{N}]/u.test(path[inPath - 1] ?? '/') ? 15 : 5;
  }
  return score;
}

export const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Matched words are marked; the text stays text. */
export function highlight(text: string, query: string): Array<Node | string> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const word of searchWords(query)) {
    const at = lower.indexOf(word);
    if (at >= 0) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  const parts: Array<Node | string> = [];
  let from = 0;
  for (const [start, end] of merged) {
    if (start > from) parts.push(text.slice(from, start));
    parts.push(h('mark', '', text.slice(start, end)));
    from = end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
