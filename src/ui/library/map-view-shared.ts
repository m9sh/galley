import type { MapPlace, MapPosition, ProjectMapModel } from '../../core/project-map.ts';
import { button, h } from '../components/dom.ts';
import type { Sheet } from '../components/sheet.ts';

/**
 * The Documents map (ADR 0030): the document in focus between what links to it and what it links to, details in
 * the reader's sheet beside the map, and the same places as a List. This review draws the same map around what a
 * review changes: its files in the middle, chapter by chapter. The library reads documents, opens evidence and keeps
 * the reader's corrections; this view lays out places and lines, and keeps its own camera, selection and focus while
 * the reader goes off to read.
 */

export type Lane = MapPosition['lane'];
export type Tab = 'preview' | 'links';
/** Where a card is, for drawing lines to it. */
export type Box = { l: number; r: number; b: number; y: number };
export type Curve = (a: { x: number; y: number }, b: { x: number; y: number }) => string;
/** A line: its path, the ends that may carry an arrowhead, and whether it touches the middle or is context. */
export type Shape = { d: string; ends: Array<{ x: number; y: number; dir: number; into: boolean }>; touchesFocus: boolean };

/** What the library supplies. Reading and evidence are the library's own `open` and `evidence` actions. */
export interface DocumentMapHost {
  /** The document as the reader renders it, for Preview; null when it cannot be shown. Never rejects. */
  preview(path: string): Promise<HTMLElement | null>;
  /** The library's type, status and type editor for a document that has been read, for the Links tab. */
  details(path: string): HTMLElement[];
  /** Links in the document the map cannot follow; null when there are none. */
  problems(path: string): HTMLElement | null;
  /** The map's middle moved: the library keeps it as the map's place for the next drawing. Not around a review. */
  refocus?(path: string): void;
  /** The library's sheet for details; Close asks the map to close it (closeSheet()). */
  sheet: Sheet;
  /** The details are about to take the sheet from whatever the library showed in it, such as Notes. */
  claim?(): void;
  /** Show its connections, from This review: the library opens its Documents map at the document. */
  explore?(path: string): void;
  /** The commit everything was read at. */
  commit: string;
}

export interface DocumentMapState {
  model: ProjectMapModel;
  /** The document in the middle. */
  focus: string;
  /** The document open in the reader: You are here. */
  here: string | null;
  /** Documents the review changes, when the library was opened from one. */
  changed: ReadonlySet<string>;
  /** This review: the files the review changes in the middle, chapter by chapter, instead of one document. */
  review?: ReviewCentre;
}

interface ReviewCentre {
  chapters: Array<{
    title: string;
    paths: string[];
    /** Sections the reader added to the chapter, in List: reading aids, never lines. */
    attachments?: Array<{ path: string; heading: string; title: string; commit: string }>;
  }>;
  /** What a changed configuration file declares, once configuration is read. */
  declares?: Record<string, string[]>;
}

/** Below this canvas width the three lanes stack, so an open sheet never forces sideways panning. */
export const STACK_BELOW = 720;
/** Phones keep a short neighbourhood; the rest are one tap away in List. */
export const PHONE_LANE = 4;
export const LIST_PAGE = 100;
export const CONNECTION_PAGE = 12;
export const ZOOM = { min: 0.5, max: 1.5 };
export const SVG = 'http://www.w3.org/2000/svg';
/** Line art at the reader's icon weight; a document type is told by shape and label, never by colour. */
export const SHAPES: Record<string, string> = {
  Overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  Spec: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  Decision: 'M12 3l9 9-9 9-9-9zM8 12h8',
  Architecture: 'M8 3h8v6H8zM3 15h6v6H3zM15 15h6v6h-6zM12 9v3M6 15v-3h12v3',
  Runbook: 'M5 5h14v14H5zM8 9l3 3-3 3M13 15h3',
  Guide: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
  Document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  File: 'M6 3h8l4 4v14H6zM14 3v5h4M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  read: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  down: 'M12 5v14M6 13l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
};

/** Separate only identifiers written in the title; never invent a record number from its path. */
export function cardName(title: string): { label: string | null; name: string } {
  const record = /^(ADR|RFC)\s+(\d+)\s*[:—–-]\s*(\S.*)$/i.exec(title);
  return record ? { label: `${record[1].toUpperCase()} ${record[2]}`, name: record[3] } : { label: null, name: title };
}

export function lineIcon(shape: string): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    class: 'mr-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }))
    icon.setAttribute(name, value);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', shape);
  icon.append(path);
  return icon;
}

export function typeBadge(kind: string, label: string | null): HTMLElement {
  const badge = h('small', 'mr-pm-type', label ?? kind);
  badge.prepend(lineIcon(SHAPES[kind]));
  return badge;
}

/** The map's own controls are `pm-` actions, which the library hands back through onAct(). */
export const act = (label: string, name: string, className = 'mr-btn mr-outline') => button(label, `pm-${name}`, className);

/** An icon-only control names itself, and its shortcut when it has one. */
export function iconAct(name: string, label: string, shape: string, title = label): HTMLButtonElement {
  const control = act('', name, 'mr-btn mr-icon-btn');
  control.setAttribute('aria-label', label);
  control.title = title;
  control.append(lineIcon(shape));
  return control;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
/** Failed and too-large documents have nothing to preview; one not read yet is read when previewed. */
export const previewable = (place: MapPlace) => place.state === 'indexed' || place.state === 'not-read';
